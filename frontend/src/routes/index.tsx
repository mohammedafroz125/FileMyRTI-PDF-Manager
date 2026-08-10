import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import {
  FileText,
  Save,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Timer,
  Ban,
  Download,
  Pencil,
  Eye,
  ChevronDown,
  ChevronRight,
  QrCode,
  Image as ImageIcon,
  ArrowLeft,
  Stamp,
  Settings,
  Printer,
} from "lucide-react";
import { toast } from "sonner";
import { safeRandomUUID } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  optimizePdfBlob,
  convertWordToPdfOnServer,
} from "@/lib/pdf-optimizer-client";
import { Dropzone } from "@/components/Dropzone";
import { PageThumb } from "@/components/PageThumb";
import { RtiSidebar } from "@/components/RtiSidebar";
import { QrPhonePanel } from "@/components/QrPhonePanel";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import {
  DocumentViewer,
  type ViewerTimelineItem,
} from "@/components/DocumentViewer";
import { CourtStampSetupModal } from "@/components/stickers/CourtStampSetupModal";
import { CourtStampSettingsModal } from "@/components/stickers/CourtStampSettingsModal";
import {
  getCourtStampTemplate,
  saveStickerTemplate,
  type StickerTemplate,
  type PageSticker,
} from "@/lib/stickers";
import { mergeByPlan, type MergeItem, type PlanEntry } from "@/lib/pdf-merge";
import {
  getPdfPageCount,
  renderPdfPage,
  evictPdfDoc,
} from "@/lib/pdf-thumbnails";
import {
  deleteDocumentData,
  downloadFromPath,
  getDocument,
  listDocuments,
  listMobileUploads,
  listOriginals,
  loadItemFile,
  updateDocument,
  uploadEdited,
  uploadItemFile,
  type RtiDocument,
  type RtiStatus,
  type RtiTypeSelected,
  ALL_RTI_TYPES,
  type SavedPlan,
  type SavedPlanItem,
  type SavedTimelineEntry,
} from "@/lib/rti-storage";
import {
  deleteDraft as deleteDraftStore,
  deleteAllDrafts as deleteAllDraftsStore,
  listDrafts,
  loadDraft,
  reconcileIndex,
  renameDraft as renameDraftStore,
  saveDraft,
  type DraftSummary,
  type ManualDraft,
} from "@/lib/manual-drafts";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RTI PDF Manager — Pending Queue & Editor" },
      {
        name: "description",
        content:
          "Internal RTI PDF Manager. Manage pending projects, merge PDFs and images, capture ACKs from mobile.",
      },
      {
        property: "og:title",
        content: "RTI PDF Manager — Pending Queue & Editor",
      },
      { property: "og:description", content: "Internal RTI PDF Manager." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

type Status =
  | { kind: "idle" }
  | { kind: "working"; pct: number; label?: string }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const STATUS_TEXT: Record<RtiStatus, string> = {
  pending: "🔴 Pending",
  waiting_ack: "🔴 Pending",
  completed: "🟢 Successful",
};

const MANUAL_PROJECT_ID = "manual-edit"; // legacy
const DRAFT_PREFIX = "draft:";
const isDraftId = (id: string | null | undefined) =>
  !!id && id.startsWith(DRAFT_PREFIX);

type ProjectCacheEntry = {
  activeDoc: RtiDocument;
  originals: { id: string; name: string; file: File }[];
  originalThumbs: Record<string, string[]>;
  originalPageCounts: Record<string, number>;
  items: MergeItem[];
  itemPaths: Record<string, string>;
  itemThumbs: Record<string, string[]>;
  itemPageCounts: Record<string, number>;
  timeline: SavedTimelineEntry[];
  pdfName: string;
  seenMobilePaths: string[];
  rtiTypeSelected: RtiTypeSelected;
};

function classify(file: File): "pdf" | "image" | "word" | null {
  const n = file.name.toLowerCase();
  if (n.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (/\.(jpe?g|png|webp)$/.test(n) || file.type.startsWith("image/"))
    return "image";
  if (
    /\.(docx?)$/.test(n) ||
    file.type.includes("wordprocessingml") ||
    file.type.includes("msword")
  )
    return "word";
  return null;
}

function sanitizeFile(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function savePdfBlob(blob: Blob, filename: string): Promise<boolean> {
  const picker = (
    window as unknown as {
      showSaveFilePicker?: (
        opts: unknown,
      ) => Promise<{
        createWritable: () => Promise<{
          write: (b: Blob) => Promise<void>;
          close: () => Promise<void>;
        }>;
      }>;
    }
  ).showSaveFilePicker;
  if (typeof picker !== "function") {
    downloadBlob(blob, filename);
    return true;
  }
  try {
    const handle = await picker({
      suggestedName: filename,
      types: [
        {
          description: "PDF document",
          accept: { "application/pdf": [".pdf"] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch (err) {
    if ((err as DOMException).name === "AbortError") return false;
    downloadBlob(blob, filename);
    return true;
  }
}

async function fileToPdf(
  file: File,
  onStatus?: (msg: string) => void,
): Promise<File | null> {
  const kind = classify(file);
  if (kind === "pdf") {
    try {
      console.log("CALLING optimizePdfBlob");
      if (onStatus) onStatus("Optimizing PDF via Ghostscript...");
      const blob = await optimizePdfBlob(file, file.name);
      return new File([blob], file.name, { type: "application/pdf" });
    } catch (e) {
      toast.error((e as Error).message || "Failed to optimize PDF on Ghostscript backend.");
      return null;
    }
  }
  if (kind === "word") {
    try {
      return await convertWordToPdfOnServer(file, (stage) => {
        if (onStatus) onStatus(stage);
      });
    } catch (e) {
      toast.error((e as Error).message || "Failed to convert Word document.");
      return null;
    }
  }
  if (kind === "image") {
    try {
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF();
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await new Promise((r) => {
        img.onload = r;
      });
      const imgProps = pdf.getImageProperties(img);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(img, "JPEG", 0, 0, pdfWidth, pdfHeight);
      URL.revokeObjectURL(url);
      return new File([pdf.output("blob")], file.name + ".pdf", {
        type: "application/pdf",
      });
    } catch (e) {
      console.error("Image conversion failed", e);
      return null;
    }
  }
  return null;
}

async function optimizeImage(file: File): Promise<File> {
  const lower = file.name.toLowerCase();
  if (!/\.(jpe?g|png|webp)$/.test(lower) && !file.type.startsWith("image/"))
    return file;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        const maxDim = 2000;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              const name = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
              resolve(new File([blob], name, { type: "image/jpeg" }));
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          0.82,
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

function defaultPdfNameForDoc(doc: RtiDocument): string {
  if (doc.final_name) return doc.final_name.replace(/\.pdf$/i, "");
  return doc.original_name.replace(/\.pdf$/i, "");
}

function Index() {
  const [activeDoc, setActiveDoc] = useState<RtiDocument | null>(null);
  const [originals, setOriginals] = useState<
    { id: string; name: string; file: File }[]
  >([]);
  const [originalThumbs, setOriginalThumbs] = useState<
    Record<string, string[]>
  >({});
  const [originalPageCounts, setOriginalPageCounts] = useState<
    Record<string, number>
  >({});
  const [items, setItems] = useState<MergeItem[]>([]);
  const [itemPaths, setItemPaths] = useState<Record<string, string>>({});
  const [itemThumbs, setItemThumbs] = useState<Record<string, string[]>>({});
  const [itemPageCounts, setItemPageCounts] = useState<Record<string, number>>(
    {},
  );
  const [timeline, setTimeline] = useState<SavedTimelineEntry[]>([]);
  const [pdfName, setPdfName] = useState<string>("");
  const [pageRange, setPageRange] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const objectUrlsRef = useRef<string[]>([]);
  const seenMobilePathsRef = useRef<Set<string>>(new Set());
  const projectCacheRef = useRef<Record<string, ProjectCacheEntry>>({});
  const replaceForEntryRef = useRef<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const persistTimerRef = useRef<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const manualSessionIdRef = useRef<string>(safeRandomUUID());
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const draftLoadingRef = useRef(false);
  const draftSaveTimerRef = useRef<number | null>(null);
  const [previewImage, setPreviewImage] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const [isCreatingDraft, setIsCreatingDraft] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerPdfPage, setViewerPdfPage] = useState<number>(0);
  const [rtiTypeSelected, setRtiTypeSelected] =
    useState<RtiTypeSelected>("RTI Application");
  const [userToggledAppend, setUserToggledAppend] = useState(false);
  const [appendRtiType, setAppendRtiType] = useState(true);
  const [mobileView, setMobileView] = useState<"queue" | "workspace">("queue");

  const [courtStampTemplate, setCourtStampTemplate] =
    useState<StickerTemplate | null>(null);
  const [isCourtStampSetupOpen, setIsCourtStampSetupOpen] = useState(false);
  const [isCourtStampSettingsOpen, setIsCourtStampSettingsOpen] =
    useState(false);
  const [selectedPageEntryId, setSelectedPageEntryId] = useState<string | null>(
    null,
  );

  // Load Court Stamp template on mount
  useEffect(() => {
    void (async () => {
      const template = await getCourtStampTemplate();
      setCourtStampTemplate(template);
    })();
  }, []);

  const handleUpdatePageStickers = (
    entryId: string,
    updatedStickers: PageSticker[],
  ) => {
    setTimeline((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        return { ...e, stickers: updatedStickers };
      }),
    );
  };

  // Update or remove sticker on timeline entry
  const handleUpdatePageSticker = (
    entryId: string,
    updatedSticker: PageSticker,
  ) => {
    setTimeline((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const stickers = e.stickers ? [...e.stickers] : [];
        const idx = stickers.findIndex((s) => s.id === updatedSticker.id);
        if (idx >= 0) {
          stickers[idx] = updatedSticker;
        } else {
          stickers.push(updatedSticker);
        }
        return { ...e, stickers };
      }),
    );
  };

  const handleRemovePageSticker = (entryId: string, stickerId: string) => {
    setTimeline((prev) =>
      prev.map((e) => {
        if (e.id !== entryId) return e;
        const stickers = (e.stickers ?? []).filter((s) => s.id !== stickerId);
        return { ...e, stickers };
      }),
    );
  };

  // 1-Click Court Stamp Insertion Logic
  const handleCourtStampClick = async () => {
    if (timeline.length === 0) {
      toast.error("Please add a document page first.");
      return;
    }

    if (!courtStampTemplate) {
      // First time setup: open setup modal
      setIsCourtStampSetupOpen(true);
      return;
    }

    // Determine target page entry ID (selected page or first page)
    const targetEntryId = selectedPageEntryId ?? timeline[0]?.id;
    if (!targetEntryId) return;

    const newSticker: PageSticker = {
      id: `sticker_${safeRandomUUID()}`,
      type: "court_stamp",
      templateId: courtStampTemplate.id,
      imageDataUrl: courtStampTemplate.imageDataUrl,
      x: courtStampTemplate.defaultX,
      y: courtStampTemplate.defaultY,
      width: courtStampTemplate.defaultWidth,
      height: courtStampTemplate.defaultHeight,
    };

    handleUpdatePageSticker(targetEntryId, newSticker);
    setSelectedPageEntryId(targetEntryId);
    toast.success("Court Stamp added to page!");
  };

  const handleCourtStampSetupSaved = async (template: StickerTemplate) => {
    setCourtStampTemplate(template);
    await saveStickerTemplate(template);
    // Immediately insert onto active page
    const targetEntryId = selectedPageEntryId ?? timeline[0]?.id;
    if (targetEntryId) {
      const newSticker: PageSticker = {
        id: `sticker_${safeRandomUUID()}`,
        type: "court_stamp",
        templateId: template.id,
        imageDataUrl: template.imageDataUrl,
        x: template.defaultX,
        y: template.defaultY,
        width: template.defaultWidth,
        height: template.defaultHeight,
      };
      handleUpdatePageSticker(targetEntryId, newSticker);
      setSelectedPageEntryId(targetEntryId);
    }
  };

  const isFullDownload = !pageRange.trim();
  const effectiveAppendRTI = userToggledAppend ? appendRtiType : isFullDownload;

  const getOutputFilename = () => {
    if (!activeDoc) return "Merged_PDF.pdf";
    const fallback =
      activeDoc.original_name.replace(/\.pdf$/i, "") || "Merged_PDF";
    const rawName = pdfName.trim() || fallback;
    const base = /\.pdf$/i.test(rawName)
      ? rawName.replace(/\.pdf$/i, "")
      : rawName;
    const cleanBase = base.replace(
      /\s*\((RTI Application|First Appeal|Second Appeal)\)$/i,
      "",
    );

    if (effectiveAppendRTI) {
      return `${cleanBase} (${rtiTypeSelected}).pdf`;
    }
    return `${cleanBase}.pdf`;
  };

  // Auto-hide status done message after 4 seconds
  useEffect(() => {
    if (status.kind === "done") {
      const timer = setTimeout(() => {
        setStatus({ kind: "idle" });
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [status.kind]);

  const originalsById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; file: File }>();
    for (const o of originals) m.set(o.id, o);
    return m;
  }, [originals]);

  const itemById = useMemo(() => {
    const m = new Map<string, MergeItem>();
    for (const i of items) m.set(i.id, i);
    return m;
  }, [items]);

  const viewableTimelineItems = useMemo(() => {
    const list: ViewerTimelineItem[] = [];
    for (const entry of timeline) {
      if (entry.type === "original-page") {
        const orig = originalsById.get(entry.originalId);
        if (orig) {
          list.push({
            id: entry.id,
            name: orig.name,
            file: orig.file,
            kind: "pdf",
            pageIndex: entry.pageIndex,
            totalPages: originalPageCounts[entry.originalId] ?? 1,
            rotation: entry.rotation ?? 0,
            stickers: entry.stickers,
          });
        }
      } else {
        const item = itemById.get(entry.itemId);
        if (item) {
          list.push({
            id: entry.id,
            name: item.name,
            file: item.file,
            kind: item.kind,
            pageIndex: entry.pageIndex ?? 0,
            totalPages: itemPageCounts[item.id] ?? 1,
            rotation: entry.rotation ?? 0,
            stickers: entry.stickers,
          });
        }
      }
    }
    return list;
  }, [timeline, originalsById, itemById, originalPageCounts, itemPageCounts]);

  const isManualProject =
    isDraftId(activeDoc?.id) || isDraftId(activeDoc?.id ?? null);
  const activeDraftId = isDraftId(activeDoc?.id ?? null)
    ? (activeDoc?.id ?? null)
    : null;

  // Universal Browser Page Title
  useEffect(() => {
    document.title = "FileMyRTI PDF Manager";
  }, []);

  const cacheCurrentProject = () => {
    if (!activeDoc || isManualProject || loadingDoc) return;

    projectCacheRef.current[activeDoc.id] = {
      activeDoc,
      originals,
      originalThumbs,
      originalPageCounts,
      items,
      itemPaths,
      itemThumbs,
      itemPageCounts,
      timeline,
      pdfName,
      seenMobilePaths: Array.from(seenMobilePathsRef.current),
      rtiTypeSelected,
    };
  };

  const restoreCachedProject = (cached: ProjectCacheEntry) => {
    setActiveDoc(cached.activeDoc);
    setOriginals(cached.originals);
    setOriginalThumbs(cached.originalThumbs);
    setOriginalPageCounts(cached.originalPageCounts);
    setItems(cached.items);
    setItemPaths(cached.itemPaths);
    setItemThumbs(cached.itemThumbs);
    setItemPageCounts(cached.itemPageCounts);
    setTimeline(cached.timeline);
    setPdfName(cached.pdfName);
    seenMobilePathsRef.current = new Set(cached.seenMobilePaths);
    setRtiTypeSelected(cached.rtiTypeSelected || "RTI Application");
    setStatus({ kind: "idle" });
  };

  const resetLocalState = () => {
    setOriginals([]);
    setOriginalThumbs({});
    setOriginalPageCounts({});
    setItems([]);
    setItemPaths({});
    setItemThumbs({});
    setItemPageCounts({});
    setTimeline([]);
    setPdfName("");
    setPageRange("");
    setRtiTypeSelected("RTI Application");
    setStatus({ kind: "idle" });
    seenMobilePathsRef.current = new Set();
  };

  // Lazy thumbnail resolver — renders and caches a single page on demand.
  const getOriginalThumb =
    (originalId: string, pageIndex: number) =>
    async (): Promise<string | null> => {
      const cached = originalThumbs[originalId]?.[pageIndex];
      if (cached) return cached;
      const orig = originalsById.get(originalId);
      if (!orig) return null;
      const url = await renderPdfPage(
        `orig-${originalId}`,
        orig.file,
        pageIndex,
      );
      if (url) {
        setOriginalThumbs((prev) => {
          const arr = prev[originalId] ? [...prev[originalId]] : [];
          arr[pageIndex] = url;
          return { ...prev, [originalId]: arr };
        });
      }
      return url;
    };

  const getItemThumb =
    (itemId: string, pageIndex: number) => async (): Promise<string | null> => {
      const cached = itemThumbs[itemId]?.[pageIndex];
      if (cached) return cached;
      const it = itemById.get(itemId);
      if (!it || it.kind !== "pdf") return null;
      const url = await renderPdfPage(`item-${itemId}`, it.file, pageIndex);
      if (url) {
        setItemThumbs((prev) => {
          const arr = prev[itemId] ? [...prev[itemId]] : [];
          arr[pageIndex] = url;
          return { ...prev, [itemId]: arr };
        });
      }
      return url;
    };

  // ---------- Add PDF/image item helper (expands PDF into per-page timeline entries) ----------
  const registerItem = async (
    file: File,
    kind: "pdf" | "image",
    opts?: {
      append?: boolean;
      replaceEntryId?: string;
      insertIndex?: number;
      mobilePath?: string;
    },
  ): Promise<void> => {
    const it: MergeItem = {
      id: `item-${safeRandomUUID()}`,
      name: file.name,
      kind,
      file,
      mobilePath: opts?.mobilePath,
    };
    setItems((prev) => [...prev, it]);

    if (kind === "image") {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      setItemThumbs((prev) => ({ ...prev, [it.id]: [url] }));
      setItemPageCounts((prev) => ({ ...prev, [it.id]: 1 }));
      const entry: SavedTimelineEntry = {
        id: `entry-${safeRandomUUID()}`,
        type: "item",
        itemId: it.id,
        pageIndex: 0,
      };
      if (opts?.replaceEntryId) {
        setTimeline((prev) =>
          prev.map((e) =>
            e.id === opts.replaceEntryId ? { ...entry, id: e.id } : e,
          ),
        );
      } else if (opts?.insertIndex !== undefined) {
        setTimeline((prev) => {
          const copy = [...prev];
          const idx = Math.min(copy.length, Math.max(0, opts.insertIndex!));
          copy.splice(idx, 0, entry);
          return copy;
        });
      } else {
        setTimeline((prev) => [...prev, entry]);
      }
      return;
    }

    // PDF item: fetch page count only; thumbnails render lazily per page.
    let pageCount = 1;
    try {
      pageCount = await getPdfPageCount(`item-${it.id}`, file);
    } catch (e) {
      console.error("PDF page-count failed", e);
    }
    setItemPageCounts((prev) => ({ ...prev, [it.id]: pageCount }));

    const newEntries: SavedTimelineEntry[] = Array.from(
      { length: pageCount },
      (_, i) => ({
        id: `entry-${safeRandomUUID()}`,
        type: "item",
        itemId: it.id,
        pageIndex: i,
      }),
    );

    if (opts?.replaceEntryId) {
      setTimeline((prev) => {
        const idx = prev.findIndex((e) => e.id === opts.replaceEntryId);
        if (idx < 0) return [...prev, ...newEntries];
        const copy = [...prev];
        copy.splice(idx, 1, ...newEntries);
        return copy;
      });
    } else if (opts?.insertIndex !== undefined) {
      setTimeline((prev) => {
        const copy = [...prev];
        const idx = Math.min(copy.length, Math.max(0, opts.insertIndex!));
        copy.splice(idx, 0, ...newEntries);
        return copy;
      });
    } else {
      setTimeline((prev) => [...prev, ...newEntries]);
    }
  };

  const openDocument = async (doc: RtiDocument) => {
    setMobileView("workspace");
    if (activeDoc?.id === doc.id) return;
    cacheCurrentProject();
    const cached = projectCacheRef.current[doc.id];
    if (cached) {
      setLoadingDoc(true);
      resetLocalState();
      restoreCachedProject(cached);
      if (typeof window !== "undefined") {
        localStorage.setItem("active_rti_project_id", doc.id);
      }
      setLoadingDoc(false);
      return;
    }

    setLoadingDoc(true);
    setStatus({ kind: "working", pct: 0, label: "Loading project…" });
    resetLocalState();
    setActiveDoc(doc);
    setPdfName(defaultPdfNameForDoc(doc));
    setRtiTypeSelected(doc.rti_type_selected || "RTI Application");
    if (typeof window !== "undefined") {
      localStorage.setItem("active_rti_project_id", doc.id);
    }
    try {
      let origRows = await listOriginals(doc.id);
      if (origRows.length === 0 && doc.original_path) {
        origRows = [
          {
            id: `orig-legacy-${doc.id}`,
            document_id: doc.id,
            path: doc.original_path,
            name: doc.original_name || "original.pdf",
            sort_order: 0,
            created_at: doc.created_at,
          },
        ];
      }

      const loadedOriginals: { id: string; name: string; file: File }[] = [];
      const origCounts: Record<string, number> = {};
      for (const row of origRows) {
        try {
          const f = await downloadFromPath(
            row.path,
            row.name,
            "application/pdf",
          );
          loadedOriginals.push({ id: row.id, name: row.name, file: f });
          try {
            const cnt = await getPdfPageCount(`orig-${row.id}`, f);
            origCounts[row.id] = Math.max(1, cnt);
          } catch {
            origCounts[row.id] = 1;
          }
        } catch (e) {
          console.error("Failed to download original file", row, e);
        }
      }
      setOriginals(loadedOriginals);
      setOriginalPageCounts(origCounts);

      const plan = doc.plan_json as SavedPlan | null;
      if (plan) {
        const seenSet = new Set<string>(plan.processedMobilePaths ?? []);
        const restoredItems: MergeItem[] = [];
        const nextPaths: Record<string, string> = {};
        const nextThumbs: Record<string, string[]> = {};
        const nextCounts: Record<string, number> = {};
        for (const savedItem of plan.items) {
          if (savedItem.mobilePath) seenSet.add(savedItem.mobilePath);
          if (savedItem.path && savedItem.path.includes("-mobile-")) {
            seenSet.add(savedItem.path);
          }
          try {
            const f = await loadItemFile(savedItem);
            restoredItems.push({
              id: savedItem.id,
              name: savedItem.name,
              kind: savedItem.kind,
              file: f,
              mobilePath: savedItem.mobilePath,
            });
            nextPaths[savedItem.id] = savedItem.path;
            if (savedItem.kind === "image") {
              const url = URL.createObjectURL(f);
              objectUrlsRef.current.push(url);
              nextThumbs[savedItem.id] = [url];
              nextCounts[savedItem.id] = 1;
            } else {
              try {
                const cnt = await getPdfPageCount(`item-${savedItem.id}`, f);
                nextCounts[savedItem.id] = Math.max(1, cnt);
              } catch {
                nextCounts[savedItem.id] = 1;
              }
            }
          } catch (e) {
            console.error("Skipping missing item", savedItem, e);
          }
        }
        seenMobilePathsRef.current = seenSet;
        setItems(restoredItems);
        setItemPaths(nextPaths);
        setItemThumbs(nextThumbs);
        setItemPageCounts(nextCounts);

        // Migrate legacy timeline entries (no pageIndex on item) → expand to all pages
        const migrated: SavedTimelineEntry[] = [];
        for (const e of plan.timeline) {
          if (e.type === "item") {
            const count = nextCounts[e.itemId] ?? 1;
            if (e.pageIndex === undefined && count > 1) {
              for (let i = 0; i < count; i++) {
                migrated.push({
                  id: `entry-${safeRandomUUID()}`,
                  type: "item",
                  itemId: e.itemId,
                  pageIndex: i,
                  rotation: e.rotation,
                });
              }
            } else {
              migrated.push({ ...e, pageIndex: e.pageIndex ?? 0 });
            }
          } else {
            migrated.push(e);
          }
        }
        if (plan.courtStampTemplate) {
          setCourtStampTemplate(plan.courtStampTemplate);
          void saveStickerTemplate(plan.courtStampTemplate);
        }
        setTimeline(migrated);
      } else {
        const t: SavedTimelineEntry[] = [];
        for (const o of loadedOriginals) {
          const count = Math.max(1, origCounts[o.id] ?? 1);
          for (let i = 0; i < count; i++) {
            t.push({
              id: `orig-${o.id}-${i}-${safeRandomUUID()}`,
              type: "original-page",
              originalId: o.id,
              pageIndex: i,
            });
          }
        }
        setTimeline(t);
      }

      try {
        const existing = await listMobileUploads(doc.id);
        for (const m of existing) seenMobilePathsRef.current.add(m.path);
      } catch {
        /* ignore */
      }

      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: `Failed to load project: ${(err as Error).message}`,
      });
    } finally {
      setLoadingDoc(false);
    }
  };

  const refreshDrafts = async () => {
    try {
      const list = await listDrafts();
      setDrafts(list);
    } catch (e) {
      console.error(e);
    }
  };

  const restoredOnMountRef = useRef(false);
  useEffect(() => {
    void (async () => {
      try {
        await reconcileIndex();
      } catch {
        /* ignore */
      }
      await refreshDrafts();
    })();
  }, []);

  useEffect(() => {
    if (restoredOnMountRef.current) return;
    const savedId =
      typeof window !== "undefined"
        ? localStorage.getItem("active_rti_project_id")
        : null;
    if (!savedId) {
      restoredOnMountRef.current = true;
      return;
    }

    if (savedId.startsWith(DRAFT_PREFIX) && drafts.length === 0) {
      return;
    }

    restoredOnMountRef.current = true;
    void (async () => {
      if (savedId.startsWith(DRAFT_PREFIX)) {
        await openDraft(savedId);
      } else {
        try {
          const doc = await getDocument(savedId);
          if (doc) {
            await openDocument(doc);
          }
        } catch (e) {
          console.error("Failed to restore project on refresh", e);
          localStorage.removeItem("active_rti_project_id");
        }
      }
    })();
  }, [drafts]);

  const buildDraftDoc = (
    draftId: string,
    name: string,
    originalName: string,
  ): RtiDocument => ({
    id: draftId,
    customer_name: name,
    rti_type: "RTI",
    status: "pending",
    original_path: "",
    original_name: originalName,
    edited_path: null,
    final_name: null,
    plan_json: null,
    rti_type_selected: null,
    deletion_scheduled_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const getNextDraftNumber = (existingDrafts: DraftSummary[]) => {
    let maxNum = 0;
    const regex = /^Manual Draft (\d+)$/;
    for (const d of existingDrafts) {
      const match = d.name.match(regex);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return maxNum + 1;
  };

  /** Create a brand-new manual draft (empty), and switch to it. */
  const createNewDraft = async (files: File[] = []) => {
    setMobileView("workspace");
    if (isCreatingDraft) return;
    setIsCreatingDraft(true);
    try {
      cacheCurrentProject();
      const sessionUuid = safeRandomUUID();
      manualSessionIdRef.current = sessionUuid;
      const draftId = `${DRAFT_PREFIX}${safeRandomUUID()}`;
      const nextNum = getNextDraftNumber(drafts);
      const displayName = `Manual Draft ${nextNum}`;
      const initialName = "";
      resetLocalState();
      const draftDoc = buildDraftDoc(draftId, displayName, "manual-edit.pdf");

      const now = new Date().toISOString();
      const emptyDraft: ManualDraft = {
        id: draftId,
        name: displayName,
        pdfName: initialName,
        createdAt: now,
        updatedAt: now,
        status: "pending",
        sessionId: sessionUuid,
        originals: [],
        items: [],
        timeline: [],
      };
      await saveDraft(emptyDraft);

      setActiveDoc(draftDoc);
      setPdfName(initialName);
      if (typeof window !== "undefined") {
        localStorage.setItem("active_rti_project_id", draftId);
      }
      await refreshDrafts();
    } finally {
      setIsCreatingDraft(false);
    }
  };

  /** Legacy alias — accept files to create a new draft. */
  const openManualProject = createNewDraft;

  const importOriginalFiles = async (files: File[]) => {
    if (!activeDoc || !isManualProject || loadingDoc) return;
    setLoadingDoc(true);
    setStatus({ kind: "working", pct: 0, label: "Processing files…" });
    try {
      const pdfs: File[] = [];
      for (const f of files) {
        const p = await fileToPdf(f, (msg) =>
          setStatus({ kind: "working", pct: 0, label: msg }),
        );
        if (p) pdfs.push(p);
      }
      if (!pdfs.length) {
        setStatus({ kind: "error", message: "No supported files found." });
        return;
      }
      const loadedOriginals: { id: string; name: string; file: File }[] = [];
      const countsMap: Record<string, number> = {};
      for (const file of pdfs) {
        const id = `manual-${safeRandomUUID()}`;
        loadedOriginals.push({ id, name: file.name, file });
        try {
          const cnt = await getPdfPageCount(`orig-${id}`, file);
          countsMap[id] = Math.max(1, cnt);
        } catch {
          countsMap[id] = 1;
        }
      }
      const timelineEntries: SavedTimelineEntry[] = [];
      for (const o of loadedOriginals) {
        const count = Math.max(1, countsMap[o.id] ?? 1);
        for (let i = 0; i < count; i++) {
          timelineEntries.push({
            id: `manual-orig-${o.id}-${i}-${safeRandomUUID()}`,
            type: "original-page",
            originalId: o.id,
            pageIndex: i,
          });
        }
      }
      setOriginals(loadedOriginals);
      setOriginalPageCounts(countsMap);
      setTimeline(timelineEntries);
      const firstOriginalName = pdfs[0]?.name?.replace(/\.pdf$/i, "") ?? "";
      setPdfName(firstOriginalName);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: `Failed to import original files: ${(err as Error).message}`,
      });
    } finally {
      setLoadingDoc(false);
    }
  };

  /** Open an existing draft from IndexedDB. */
  const openDraft = async (draftId: string) => {
    setMobileView("workspace");
    if (activeDoc?.id === draftId) return;
    cacheCurrentProject();
    setLoadingDoc(true);
    draftLoadingRef.current = true;
    setStatus({ kind: "working", pct: 0, label: "Loading draft…" });
    resetLocalState();
    if (typeof window !== "undefined") {
      localStorage.setItem("active_rti_project_id", draftId);
    }
    try {
      const d = await loadDraft(draftId);
      if (!d) {
        setStatus({ kind: "error", message: "Draft not found." });
        setLoadingDoc(false);
        draftLoadingRef.current = false;
        return;
      }

      const sessionUuid = d.sessionId ?? safeRandomUUID();
      manualSessionIdRef.current = sessionUuid;
      if (!d.sessionId) {
        d.sessionId = sessionUuid;
        await saveDraft(d);
      }

      const doc = buildDraftDoc(
        draftId,
        d.name,
        d.originals[0]?.name ?? "manual-edit.pdf",
      );
      setActiveDoc(doc);
      setPdfName(d.pdfName ?? "");
      setRtiTypeSelected(d.rtiType || "RTI Application");

      const loadedOriginals: { id: string; name: string; file: File }[] = [];
      const countsMap: Record<string, number> = {};
      for (const o of d.originals) {
        const file = new File([o.file.blob], o.file.name, {
          type: o.file.type || "application/pdf",
        });
        loadedOriginals.push({ id: o.id, name: o.name, file });
        try {
          const cnt = await getPdfPageCount(`orig-${o.id}`, file);
          countsMap[o.id] = Math.max(1, cnt);
        } catch {
          countsMap[o.id] = 1;
        }
      }
      setOriginals(loadedOriginals);
      setOriginalPageCounts(countsMap);

      const seenSet = new Set<string>(d.processedMobilePaths ?? []);
      const restoredItems: MergeItem[] = [];
      const nextThumbs: Record<string, string[]> = {};
      const nextCounts: Record<string, number> = {};
      for (const it of d.items) {
        if (it.mobilePath) seenSet.add(it.mobilePath);
        const file = new File([it.file.blob], it.file.name, {
          type:
            it.file.type || (it.kind === "pdf" ? "application/pdf" : "image/*"),
        });
        restoredItems.push({
          id: it.id,
          name: it.name,
          kind: it.kind,
          file,
          mobilePath: it.mobilePath,
        });
        if (it.kind === "image") {
          const url = URL.createObjectURL(file);
          objectUrlsRef.current.push(url);
          nextThumbs[it.id] = [url];
          nextCounts[it.id] = 1;
        } else {
          try {
            nextCounts[it.id] = await getPdfPageCount(`item-${it.id}`, file);
          } catch {
            nextCounts[it.id] = 1;
          }
        }
      }
      seenMobilePathsRef.current = seenSet;
      setItems(restoredItems);
      setItemThumbs(nextThumbs);
      setItemPageCounts(nextCounts);
      setTimeline(d.timeline);
      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({
        kind: "error",
        message: `Failed to load draft: ${(err as Error).message}`,
      });
    } finally {
      setLoadingDoc(false);
      // small delay to skip the initial auto-save triggered by state hydration
      setTimeout(() => {
        draftLoadingRef.current = false;
      }, 250);
    }
  };

  const renameDraft = async (id: string, name: string) => {
    await renameDraftStore(id, name);
    if (activeDoc?.id === id) {
      setActiveDoc({ ...activeDoc, customer_name: name });
    }
    await refreshDrafts();
  };

  const deleteDraft = async (id: string) => {
    // optimistic UI
    setDrafts((prev) => prev.filter((d) => d.id !== id));
    if (activeDoc?.id === id) {
      setActiveDoc(null);
      resetLocalState();
      if (typeof window !== "undefined") {
        localStorage.removeItem("active_rti_project_id");
      }
    }
    try {
      await deleteDraftStore(id);
      toast.success("Draft deleted");
    } catch (e) {
      toast.error("Failed to delete draft");
      await refreshDrafts();
    }
  };

  // Poll mobile uploads for active project (both Admin and Manual Edit sessions)
  useEffect(() => {
    if (!activeDoc) return;
    const effectiveId = isManualProject
      ? manualSessionIdRef.current
      : activeDoc.id;
    let cancelled = false;

    const tick = async () => {
      try {
        const list = await listMobileUploads(effectiveId);
        const fresh = list.filter((m) => {
          if (seenMobilePathsRef.current.has(m.path)) return false;
          if (items.some((it) => it.mobilePath === m.path)) return false;
          return true;
        });
        if (!fresh.length || cancelled) return;

        for (const m of fresh) seenMobilePathsRef.current.add(m.path);

        for (const m of fresh) {
          const lower = m.name.toLowerCase();
          const isDoc = lower.endsWith(".doc") || lower.endsWith(".docx");
          const isPdf = lower.endsWith(".pdf");
          const mime = isPdf
            ? "application/pdf"
            : isDoc
              ? lower.endsWith(".docx")
                ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                : "application/msword"
              : lower.endsWith(".png")
                ? "image/png"
                : "image/jpeg";

          const raw = await downloadFromPath(m.path, m.name, mime);
          let file: File = raw;
          let kind: "pdf" | "image" = isPdf || isDoc ? "pdf" : "image";

          if (isDoc) {
            const conv = await fileToPdf(raw);
            if (!conv) continue;
            file = conv;
            kind = "pdf";
          }

          if (cancelled) return;
          // Mobile uploads insert at Position 2 (index 1, immediately after Page 1)
          await registerItem(file, kind, { insertIndex: 1, mobilePath: m.path });
          toast.success(`New file received via QR upload: ${m.name}`);
        }
      } catch (err) {
        console.warn("Mobile upload polling notice:", err);
      }
    };

    void tick();
    const iv = window.setInterval(tick, 2000);

    const channel = supabase
      .channel(`mobile_poll_${effectiveId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "rti_mobile_tokens",
          filter: `document_id=eq.${effectiveId}`,
        },
        () => {
          void tick();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      window.clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.id, isManualProject]);

  // Live-update status & plan via realtime
  useEffect(() => {
    if (!activeDoc || isManualProject) return;
    const channel = supabase
      .channel(`rti_doc_${activeDoc.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rti_documents",
          filter: `id=eq.${activeDoc.id}`,
        },
        (payload) => {
          const updated = payload.new as RtiDocument;
          if (updated) {
            setActiveDoc(updated);
            if (updated.plan_json) {
              if (updated.plan_json.courtStampTemplate) {
                setCourtStampTemplate(updated.plan_json.courtStampTemplate);
                void saveStickerTemplate(updated.plan_json.courtStampTemplate);
              }
              if (updated.plan_json.timeline) {
                setTimeline((prev) =>
                  prev.map((local) => {
                    const match = updated.plan_json?.timeline.find(
                      (r) => r.id === local.id,
                    );
                    if (match) {
                      return {
                        ...local,
                        rotation: match.rotation ?? local.rotation,
                        stickers: match.stickers ?? local.stickers,
                      };
                    }
                    return local;
                  }),
                );
              }
            }
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeDoc?.id, isManualProject]);

  useEffect(() => {
    cacheCurrentProject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeDoc,
    originals,
    originalThumbs,
    originalPageCounts,
    items,
    itemPaths,
    itemThumbs,
    itemPageCounts,
    timeline,
    pdfName,
    loadingDoc,
  ]);

  // ---- Auto-persist plan for real projects (debounced) ----
  const persistPlan = async () => {
    if (!activeDoc || isManualProject) return;
    try {
      const nextPaths = { ...itemPaths };
      let changed = false;
      for (const it of items) {
        if (!nextPaths[it.id]) {
          nextPaths[it.id] = await uploadItemFile(
            activeDoc.id,
            it.file,
            it.kind,
          );
          changed = true;
        }
      }
      if (changed) setItemPaths(nextPaths);
      const savedItems: SavedPlanItem[] = items
        .filter((it) => !!nextPaths[it.id])
        .map((it) => ({
          id: it.id,
          name: it.name,
          kind: it.kind,
          path: nextPaths[it.id],
          mobilePath: it.mobilePath,
        }));
      const savedPlan: SavedPlan = {
        items: savedItems,
        timeline,
        courtStampTemplate,
        processedMobilePaths: Array.from(seenMobilePathsRef.current),
      };
      await updateDocument(activeDoc.id, { plan_json: savedPlan });
    } catch (e) {
      console.error("Auto-persist failed", e);
    }
  };

  useEffect(() => {
    if (!activeDoc || isManualProject || loadingDoc) return;
    if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      void persistPlan();
    }, 800);
    return () => {
      if (persistTimerRef.current) window.clearTimeout(persistTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, timeline, activeDoc?.id, loadingDoc]);

  // ---- Auto-save manual draft to IndexedDB (debounced) ----
  useEffect(() => {
    if (!activeDraftId || draftLoadingRef.current || loadingDoc) return;
    if (draftSaveTimerRef.current)
      window.clearTimeout(draftSaveTimerRef.current);
    draftSaveTimerRef.current = window.setTimeout(async () => {
      try {
        const firstDocName =
          originals[0]?.name?.replace(/\.pdf$/i, "") ??
          items[0]?.name?.replace(/\.[^/.]+$/, "");
        const syncedName =
          pdfName.trim() ||
          firstDocName ||
          activeDoc?.customer_name ||
          "Manual Draft";

        if (activeDoc && activeDoc.customer_name !== syncedName) {
          setActiveDoc((prev) =>
            prev ? { ...prev, customer_name: syncedName } : null,
          );
        }

        const draft: ManualDraft = {
          id: activeDraftId,
          name: syncedName,
          pdfName,
          createdAt: activeDoc?.created_at ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          status: activeDoc?.status === "completed" ? "completed" : "pending",
          sessionId: manualSessionIdRef.current,
          rtiType: rtiTypeSelected,
          originals: originals.map((o) => ({
            id: o.id,
            name: o.name,
            file: { name: o.file.name, type: o.file.type, blob: o.file },
          })),
          items: items.map((it) => ({
            id: it.id,
            name: it.name,
            kind: it.kind,
            file: { name: it.file.name, type: it.file.type, blob: it.file },
            mobilePath: it.mobilePath,
          })),
          timeline,
          courtStampTemplate,
          processedMobilePaths: Array.from(seenMobilePathsRef.current),
        };
        await saveDraft(draft);
        await refreshDrafts();
      } catch (e) {
        console.error("Failed to auto-save draft", e);
      }
    }, 400);
    return () => {
      if (draftSaveTimerRef.current)
        window.clearTimeout(draftSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    items,
    originals,
    timeline,
    activeDraftId,
    loadingDoc,
    activeDoc?.id,
    pdfName,
    rtiTypeSelected,
  ]);

  /** Insert a pasted image at Position 1 (index 0 / beginning of page list). */
  const insertPastedImageEntry = (itemId: string) => {
    setTimeline((prev) => {
      const entry: SavedTimelineEntry = {
        id: `entry-${crypto.randomUUID()}`,
        type: "item",
        itemId,
        pageIndex: 0,
      };
      return [entry, ...prev];
    });
  };

  /** Attach a pasted image as an item and insert at position 1. */
  const attachPastedImage = async (file: File) => {
    const optimized = await optimizeImage(file);
    const it: MergeItem = {
      id: `item-${crypto.randomUUID()}`,
      name: optimized.name || `pasted-${Date.now()}.jpg`,
      kind: "image",
      file: optimized,
    };
    setItems((prev) => [...prev, it]);
    const url = URL.createObjectURL(optimized);
    objectUrlsRef.current.push(url);
    setItemThumbs((prev) => ({ ...prev, [it.id]: [url] }));
    setItemPageCounts((prev) => ({ ...prev, [it.id]: 1 }));
    insertPastedImageEntry(it.id);
    toast.success("Image pasted at position 1");
  };

  const addFiles = async (files: File[]) => {
    setStatus({ kind: "working", pct: 0, label: "Processing files…" });
    const rejected: string[] = [];
    for (const f of files) {
      const kind = classify(f);
      if (!kind) {
        rejected.push(`${f.name} (unsupported format)`);
        continue;
      }
      if (kind === "pdf" || kind === "word") {
        try {
          const optimized = await fileToPdf(f, (msg) =>
            setStatus({ kind: "working", pct: 0, label: msg }),
          );
          if (optimized) {
            await registerItem(optimized, "pdf");
          } else {
            rejected.push(`${f.name} (conversion failed)`);
          }
        } catch (err) {
          rejected.push(`${f.name} (${(err as Error).message})`);
        }
      } else {
        const optimized = await optimizeImage(f);
        await registerItem(optimized, "image");
      }
    }
    if (rejected.length) {
      setStatus({ kind: "error", message: `Skipped: ${rejected.join(", ")}` });
      toast.error(`Some files could not be added: ${rejected.join("; ")}`);
    } else {
      setStatus({ kind: "idle" });
    }
  };

  // ---- Global paste (Ctrl+V) + drag/drop support ----
  useEffect(() => {
    if (!activeDoc) return;
    const onPaste = async (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      )
        return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      const otherFiles: File[] = [];
      for (const it of Array.from(items)) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (!f) continue;
          if (f.type.startsWith("image/")) imageFiles.push(f);
          else otherFiles.push(f);
        }
      }
      if (!imageFiles.length && !otherFiles.length) return;
      e.preventDefault();
      for (const img of imageFiles) await attachPastedImage(img);
      if (otherFiles.length) await addFiles(otherFiles);
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      const target = e.target as HTMLElement | null;
      // Let Dropzone handle its own drop events
      if (target?.closest("[data-dropzone-root]")) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer.files);
      const images = files.filter((f) => f.type.startsWith("image/"));
      const rest = files.filter((f) => !f.type.startsWith("image/"));
      for (const img of images) await attachPastedImage(img);
      if (rest.length) await addFiles(rest);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.id]);

  const removeEntry = useCallback((entryId: string) => {
    setTimeline((prev) => prev.filter((e) => e.id !== entryId));
  }, []);

  const rotateEntry = useCallback((entryId: string, direction: "cw" | "ccw" = "cw") => {
    setTimeline((prev) =>
      prev.map((e) =>
        e.id === entryId
          ? {
              ...e,
              rotation:
                direction === "cw"
                  ? ((e.rotation ?? 0) + 90) % 360
                  : ((e.rotation ?? 0) - 90 + 360) % 360,
            }
          : e,
      ),
    );
  }, []);

  const startReplace = useCallback((entryId: string) => {
    replaceForEntryRef.current = entryId;
    replaceInputRef.current?.click();
  }, []);

  const onReplaceFilePicked = async (fs: FileList | null) => {
    const targetId = replaceForEntryRef.current;
    replaceForEntryRef.current = null;
    if (!fs || !fs[0] || !targetId) return;

    setStatus({ kind: "working", pct: 0, label: "Processing replacement…" });
    let f = fs[0];
    let kind = classify(f);
    if (!kind) {
      setStatus({ kind: "idle" });
      return;
    }
    if (kind === "pdf" || kind === "word") {
      try {
        const p = await fileToPdf(f, (msg) =>
          setStatus({ kind: "working", pct: 0, label: msg }),
        );
        if (p) {
          f = p;
          kind = "pdf";
        } else {
          setStatus({ kind: "error", message: "Conversion failed" });
          return;
        }
      } catch (err) {
        setStatus({ kind: "error", message: (err as Error).message });
        toast.error((err as Error).message);
        return;
      }
    } else if (kind === "image") {
      f = await optimizeImage(f);
    }
    await registerItem(f, kind, { replaceEntryId: targetId });
    setStatus({ kind: "idle" });
  };

  const onTimelineDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setTimeline((prev) => {
      const oldIndex = prev.findIndex((x) => x.id === active.id);
      const newIndex = prev.findIndex((x) => x.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const generateAndSave = async () => {
    if (!activeDoc) return;
    setStatus({ kind: "working", pct: 0, label: "Merging pages…" });
    try {
      const originalFiles: Record<string, File> = {};
      for (const o of originals) originalFiles[o.id] = o.file;

      const plan: PlanEntry[] = timeline
        .map<PlanEntry | null>((entry) => {
          if (entry.type === "original-page") {
            if (!originalFiles[entry.originalId]) return null;
            return {
              entryId: entry.id,
              kind: "original-page",
              originalId: entry.originalId,
              pageIndex: entry.pageIndex,
              rotation: entry.rotation,
              stickers: entry.stickers,
            };
          }
          const item = itemById.get(entry.itemId);
          if (!item) return null;
          return {
            entryId: entry.id,
            kind: "item",
            item,
            pageIndex: entry.pageIndex ?? 0,
            rotation: entry.rotation,
            stickers: entry.stickers,
          };
        })
        .filter((x): x is PlanEntry => x !== null);

      let blob = await mergeByPlan(originalFiles, plan, (pct) =>
        setStatus({ kind: "working", pct, label: "Merging pages…" }),
      );
      console.log("CALLING optimizePdfBlob");
      blob = await optimizePdfBlob(blob, "output.pdf", "Balanced", 2);

      const filename = sanitizeFile(getOutputFilename());
      const saved = await savePdfBlob(blob, filename);
      if (!saved) {
        setStatus({ kind: "idle" });
        return;
      }

      if (isManualProject) {
        const updatedDoc = { ...activeDoc, status: "completed" as const };
        setActiveDoc(updatedDoc);
        const draft = await loadDraft(activeDoc.id);
        if (draft) {
          draft.status = "completed";
          draft.updatedAt = new Date().toISOString();
          await saveDraft(draft);
        }
        await refreshDrafts();
        setStatus({ kind: "done", message: `Saved ${filename}` });
        return;
      }

      setStatus({ kind: "working", pct: 100, label: "Saving to queue…" });
      const nextPaths = { ...itemPaths };
      for (const it of items) {
        if (!nextPaths[it.id]) {
          nextPaths[it.id] = await uploadItemFile(
            activeDoc.id,
            it.file,
            it.kind,
          );
        }
      }
      setItemPaths(nextPaths);

      const savedItems: SavedPlanItem[] = items.map((it) => ({
        id: it.id,
        name: it.name,
        kind: it.kind,
        path: nextPaths[it.id],
      }));
      const savedPlan: SavedPlan = { items: savedItems, timeline, courtStampTemplate };
      const editedPath = await uploadEdited(activeDoc.id, blob, filename);
      const patch: Parameters<typeof updateDocument>[1] = {
        plan_json: savedPlan,
        edited_path: editedPath,
        final_name: filename,
        status: "completed",
        deletion_scheduled_at: new Date(
          Date.now() + 24 * 60 * 60_000,
        ).toISOString(),
      };
      const updated = await updateDocument(activeDoc.id, patch);
      setActiveDoc(updated);
      projectCacheRef.current[activeDoc.id] = {
        activeDoc: updated,
        originals,
        originalThumbs,
        originalPageCounts,
        items,
        itemPaths: nextPaths,
        itemThumbs,
        itemPageCounts,
        timeline,
        pdfName,
        seenMobilePaths: Array.from(seenMobilePathsRef.current),
        rtiTypeSelected,
      };
      setStatus({
        kind: "done",
        message: `Saved. Status: ${STATUS_TEXT.completed}`,
      });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const cancelAutoDelete = async () => {
    if (!activeDoc) return;
    const updated = await updateDocument(activeDoc.id, {
      deletion_scheduled_at: null,
    });
    setActiveDoc(updated);
  };

  const deleteNow = async () => {
    if (!activeDoc) return;
    if (!confirm("Delete project data now? Saved PDFs on disk are kept."))
      return;
    await deleteDocumentData(activeDoc.id);
    delete projectCacheRef.current[activeDoc.id];
    setActiveDoc(null);
    resetLocalState();
    if (typeof window !== "undefined") {
      localStorage.removeItem("active_rti_project_id");
    }
  };

  const deleteProject = async (doc: RtiDocument) => {
    // Optimistic: remove from local cache and clear active state immediately.
    delete projectCacheRef.current[doc.id];
    if (activeDoc?.id === doc.id) {
      setActiveDoc(null);
      resetLocalState();
      if (typeof window !== "undefined") {
        localStorage.removeItem("active_rti_project_id");
      }
    }
    // Background delete + toast; sidebar refreshes itself via realtime.
    void (async () => {
      try {
        await deleteDocumentData(doc.id);
        toast.success(`Deleted "${doc.customer_name}"`);
      } catch (e) {
        toast.error(`Failed to delete: ${(e as Error).message}`);
      }
    })();
  };

  const deleteAllPendingProjects = async () => {
    try {
      const allDocs = await listDocuments();
      for (const doc of allDocs) {
        delete projectCacheRef.current[doc.id];
        if (activeDoc?.id === doc.id) {
          setActiveDoc(null);
          resetLocalState();
          if (typeof window !== "undefined") {
            localStorage.removeItem("active_rti_project_id");
          }
        }
        await deleteDocumentData(doc.id);
      }
      toast.success("Deleted all projects from Pending Queue");
    } catch (e) {
      toast.error(`Failed to delete pending projects: ${(e as Error).message}`);
    }
  };

  const deleteAllDrafts = async () => {
    try {
      for (const d of drafts) {
        if (activeDoc?.id === d.id) {
          setActiveDoc(null);
          resetLocalState();
        }
      }
      await deleteAllDraftsStore();
      await refreshDrafts();
      toast.success("Deleted all Manual Drafts");
    } catch (e) {
      toast.error(`Failed to delete drafts: ${(e as Error).message}`);
    }
  };

  const canGenerate =
    timeline.length > 0 &&
    status.kind !== "working" &&
    !loadingDoc &&
    !!activeDoc;

  // Parse "1,2,3", "5-8", "1,3,5-7" → 0-based timeline indices (unique, ordered).
  const parsePageRange = (input: string, total: number): number[] | null => {
    if (!input.trim()) return Array.from({ length: total }, (_, i) => i);
    const out: number[] = [];
    const seen = new Set<number>();
    for (const raw of input.split(",")) {
      const p = raw.trim();
      if (!p) continue;
      if (p.includes("-")) {
        const [a, b] = p.split("-").map((s) => parseInt(s.trim(), 10));
        if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
        const lo = Math.max(1, Math.min(a, b));
        const hi = Math.min(total, Math.max(a, b));
        for (let i = lo; i <= hi; i++) {
          if (!seen.has(i)) {
            seen.add(i);
            out.push(i - 1);
          }
        }
      } else {
        const n = parseInt(p, 10);
        if (!Number.isFinite(n)) return null;
        if (n >= 1 && n <= total && !seen.has(n)) {
          seen.add(n);
          out.push(n - 1);
        }
      }
    }
    return out;
  };

  const getRangeFilename = (rangeInput: string) => {
    if (!activeDoc) return "Pages.pdf";
    const trimmedRange = rangeInput.trim();
    if (!trimmedRange || trimmedRange === "1" || trimmedRange === "1-1") {
      return getOutputFilename();
    }

    const fallback =
      activeDoc.original_name.replace(/\.[^/.]+$/i, "") || "Project";
    const rawName = pdfName.trim() || activeDoc.customer_name || fallback;
    const cleanBase = rawName
      .replace(/\.pdf$/i, "")
      .replace(/\s*\((RTI Application|First Appeal|Second Appeal)\)$/i, "");

    const sanitizedRange = trimmedRange.replace(/\s+/g, "");

    return `${cleanBase}_Pages_${sanitizedRange}.pdf`;
  };

  const handlePrint = async () => {
    if (timeline.length === 0 || !activeDoc) return;
    setStatus({
      kind: "working",
      pct: 0,
      label: "Preparing document for printing…",
    });
    try {
      const originalFiles: Record<string, File> = {};
      for (const o of originals) originalFiles[o.id] = o.file;
      const plan: PlanEntry[] = timeline
        .map<PlanEntry | null>((entry) => {
          if (entry.type === "original-page") {
            if (!originalFiles[entry.originalId]) return null;
            return {
              entryId: entry.id,
              kind: "original-page",
              originalId: entry.originalId,
              pageIndex: entry.pageIndex,
              rotation: entry.rotation,
              stickers: entry.stickers,
            };
          }
          const item = itemById.get(entry.itemId);
          if (!item) return null;
          return {
            entryId: entry.id,
            kind: "item",
            item,
            pageIndex: entry.pageIndex ?? 0,
            rotation: entry.rotation,
            stickers: entry.stickers,
          };
        })
        .filter((x): x is PlanEntry => x !== null);

      const blob = await mergeByPlan(originalFiles, plan, (pct) =>
        setStatus({ kind: "working", pct, label: "Preparing print layout…" }),
      );
      const blobUrl = URL.createObjectURL(blob);

      const printIframe = document.createElement("iframe");
      printIframe.style.position = "fixed";
      printIframe.style.right = "0";
      printIframe.style.bottom = "0";
      printIframe.style.width = "0";
      printIframe.style.height = "0";
      printIframe.style.border = "0";
      printIframe.src = blobUrl;
      document.body.appendChild(printIframe);

      printIframe.onload = () => {
        setTimeout(() => {
          try {
            printIframe.contentWindow?.focus();
            printIframe.contentWindow?.print();
          } catch (e) {
            console.error("Iframe print error", e);
          }
          setTimeout(() => {
            if (document.body.contains(printIframe)) {
              document.body.removeChild(printIframe);
            }
            URL.revokeObjectURL(blobUrl);
          }, 60000);
        }, 500);
      };

      setStatus({ kind: "idle" });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
      toast.error(`Print failed: ${(err as Error).message}`);
    }
  };

  const downloadRange = async () => {
    if (!activeDoc) return;
    const indices = parsePageRange(pageRange, timeline.length);
    if (!indices || indices.length === 0) {
      setStatus({
        kind: "error",
        message: "Enter a valid page range (e.g. 1,3,5-7)",
      });
      return;
    }
    setStatus({ kind: "working", pct: 0, label: "Preparing pages…" });
    try {
      const subset = indices.map((i) => timeline[i]).filter(Boolean);
      const originalFiles: Record<string, File> = {};
      for (const o of originals) originalFiles[o.id] = o.file;
      const plan: PlanEntry[] = subset
        .map<PlanEntry | null>((entry) => {
          if (entry.type === "original-page") {
            if (!originalFiles[entry.originalId]) return null;
            return {
              entryId: entry.id,
              kind: "original-page",
              originalId: entry.originalId,
              pageIndex: entry.pageIndex,
              rotation: entry.rotation,
              stickers: entry.stickers,
            };
          }
          const item = itemById.get(entry.itemId);
          if (!item) return null;
          return {
            entryId: entry.id,
            kind: "item",
            item,
            pageIndex: entry.pageIndex ?? 0,
            rotation: entry.rotation,
            stickers: entry.stickers,
          };
        })
        .filter((x): x is PlanEntry => x !== null);
      let blob = await mergeByPlan(originalFiles, plan, (pct) =>
        setStatus({ kind: "working", pct, label: "Merging pages…" }),
      );
      console.log("CALLING optimizePdfBlob");
      blob = await optimizePdfBlob(blob, "output.pdf", "Balanced", 2);
      downloadBlob(blob, sanitizeFile(getRangeFilename(pageRange)));
      setStatus({ kind: "done", message: "Downloaded" });
    } catch (err) {
      setStatus({ kind: "error", message: (err as Error).message });
    }
  };

  const canDownload =
    timeline.length > 0 &&
    status.kind !== "working" &&
    !loadingDoc &&
    !!activeDoc;

  // Evict cached pdfjs documents on unmount.
  useEffect(() => {
    return () => {
      for (const u of objectUrlsRef.current) URL.revokeObjectURL(u);
      for (const o of originals) evictPdfDoc(`orig-${o.id}`);
      for (const it of items) evictPdfDoc(`item-${it.id}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global Desktop Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // Ctrl + S -> Save As
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (canGenerate) {
          void generateAndSave();
        }
      }

      // Ctrl + D -> Download
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (canDownload) {
          void downloadRange();
        }
      }

      // Delete key -> Delete page currently open in viewer
      if (e.key === "Delete" && viewerIndex !== null && timeline[viewerIndex]) {
        e.preventDefault();
        const entry = timeline[viewerIndex];
        if (confirm("Delete this page from project?")) {
          removeEntry(entry.id);
          setViewerIndex(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canGenerate, canDownload, viewerIndex, timeline]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Queue & Drafts Sidebar: 100% width on mobile when in 'queue' mode, side-by-side on md+ */}
      <div
        className={`w-full md:w-72 shrink-0 ${mobileView === "queue" ? "flex h-screen" : "hidden md:flex md:h-screen"}`}
      >
        <RtiSidebar
          activeId={activeDoc?.id ?? null}
          onSelect={(doc) => {
            openDocument(doc);
            setMobileView("workspace");
          }}
          onDelete={deleteProject}
          onDeleteAllPending={deleteAllPendingProjects}
          onManualEdit={() => {
            createNewDraft([]);
            setMobileView("workspace");
          }}
          drafts={drafts}
          activeDraftId={activeDraftId}
          onSelectDraft={(id) => {
            openDraft(id);
            setMobileView("workspace");
          }}
          onDeleteDraft={deleteDraft}
          onDeleteAllDrafts={deleteAllDrafts}
          onRenameDraft={renameDraft}
        />
      </div>

      {previewImage && (
        <ImagePreviewModal
          src={previewImage.src}
          alt={previewImage.alt}
          onClose={() => setPreviewImage(null)}
        />
      )}
      {viewerIndex !== null && (
        <DocumentViewer
          isOpen={viewerIndex !== null}
          onClose={() => setViewerIndex(null)}
          items={viewableTimelineItems}
          initialIndex={viewerIndex}
          onRotateItem={rotateEntry}
        />
      )}

      <input
        ref={replaceInputRef}
        type="file"
        accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => {
          onReplaceFilePicked(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Project Workspace Container: 100% width on mobile when in 'workspace' mode, flex-1 on md+ */}
      <div
        className={`min-w-0 flex-1 overflow-y-auto ${mobileView === "workspace" ? "block h-screen" : "hidden md:block md:h-screen"}`}
      >
        {/* Mobile Sticky Navigation Header with Back Button */}
        <div className="md:hidden sticky top-0 z-20 flex items-center justify-between border-b border-border bg-white px-4 py-2.5 shadow-sm">
          <button
            type="button"
            onClick={() => setMobileView("queue")}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 active:bg-slate-300 transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-slate-600" />
            <span>Back to Queue</span>
          </button>
          {activeDoc && (
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 truncate max-w-[160px]">
              <span className="truncate">{activeDoc.customer_name}</span>
            </div>
          )}
        </div>

        <header className="border-b border-border bg-white">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 sm:px-6 py-4 sm:py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-base sm:text-lg font-semibold text-foreground truncate">
                FileMyRTI PDF Manager
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                Merge PDFs &amp; images · Convert Word documents · Optimize RTI
                filings
              </p>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-8">
          {!activeDoc ? (
            <div className="rounded-xl border border-dashed border-border bg-white p-8 text-center animate-in fade-in slide-in-from-bottom-2 duration-300">
              <p className="text-sm font-medium text-foreground">
                No project open
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Pick a project from the queue on the left, use{" "}
                <b>Admin Upload</b>, or click below to start a manual draft.
              </p>
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => createNewDraft([])}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition-colors"
                >
                  <Pencil className="h-4 w-4" /> Start Manual Edit
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200/80 bg-blue-50/60 px-4 py-3 shadow-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">
                    {activeDoc.customer_name}
                  </p>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">
                    {timeline.length} Page{timeline.length === 1 ? "" : "s"}
                  </p>
                </div>
                {!isManualProject && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm border ${
                      activeDoc.status === "completed"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${activeDoc.status === "completed" ? "bg-emerald-500" : "bg-amber-500"}`}
                    />
                    {STATUS_TEXT[activeDoc.status]}
                  </span>
                )}
              </div>

              {!isManualProject &&
                activeDoc.status === "completed" &&
                activeDoc.deletion_scheduled_at && (
                  <AutoDeleteBanner
                    scheduledAt={activeDoc.deletion_scheduled_at}
                    onCancel={cancelAutoDelete}
                    onDeleteNow={deleteNow}
                  />
                )}

              {/* 2. Phone Upload */}
              <div className="mb-5">
                <QrPhonePanel
                  docId={activeDoc.id}
                  sessionId={
                    isManualProject ? manualSessionIdRef.current : undefined
                  }
                />
              </div>

              {/* 3. Add More Files / Original PDF */}
              {isManualProject &&
              originals.length === 0 &&
              items.length === 0 &&
              timeline.length === 0 ? (
                <section className="mb-5 rounded-xl border border-border bg-white p-5 shadow-sm">
                  <h2 className="mb-1 text-sm font-bold text-slate-800">
                    Original Document / PDF
                  </h2>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Drop one or more PDFs, Word documents (.doc/.docx), or
                    images to start editing.
                  </p>
                  <Dropzone
                    label="Drop original files here"
                    hint=".pdf, .doc, .docx, .jpg, .png, .webp"
                    multiple
                    accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                    onFiles={importOriginalFiles}
                  />
                </section>
              ) : (
                <>
                  <section className="mb-5 rounded-xl border border-border bg-white p-5 shadow-sm">
                    <h2 className="mb-1 text-sm font-bold text-slate-800">
                      Add More Files
                    </h2>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Add PDFs, Word documents, or Images. Drag thumbnails below
                      in the Page Editor to reorder or interleave pages.
                    </p>
                    <Dropzone
                      label="Drop files here or click to browse"
                      hint="Multiple .pdf, .doc, .docx, .jpg, .png, .webp"
                      multiple
                      accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                      onFiles={addFiles}
                    />
                  </section>

                  {/* 4. Page Editor (Primary Workspace) */}
                  <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div>
                        <h2 className="text-sm font-bold text-slate-800">
                          Page Editor ({timeline.length} page
                          {timeline.length === 1 ? "" : "s"})
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          Drag to reorder · Click 👁 or double-click to view
                          full-screen · Hover for rotate, replace, delete.
                        </p>
                      </div>

                      {/* 📑 Court Stamp & 🖨 Print Action Buttons */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleCourtStampClick}
                          disabled={timeline.length === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                          title="Insert Court Stamp onto selected page"
                        >
                          <Stamp className="h-4 w-4 text-blue-600" /> 📑 Court
                          Stamp
                        </button>
                        {courtStampTemplate && (
                          <button
                            type="button"
                            onClick={() => setIsCourtStampSettingsOpen(true)}
                            className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
                            title="Court Stamp Settings"
                          >
                            <Settings className="h-4 w-4 text-slate-600" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handlePrint}
                          disabled={
                            timeline.length === 0 || status.kind === "working"
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                          title="Print assembled document"
                        >
                          <Printer className="h-4 w-4 text-slate-700" /> 🖨 Print
                        </button>
                      </div>
                    </div>

                    {timeline.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                        No pages yet.
                      </p>
                    ) : (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onTimelineDragEnd}
                      >
                        <SortableContext
                          items={timeline.map((e) => e.id)}
                          strategy={rectSortingStrategy}
                        >
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                            {timeline.map((entry, idx) => {
                              const isPageSelected =
                                (selectedPageEntryId ?? timeline[0]?.id) ===
                                entry.id;
                              if (entry.type === "original-page") {
                                const orig = originalsById.get(
                                  entry.originalId,
                                );
                                const thumbs =
                                  originalThumbs[entry.originalId] ?? [];
                                const totalOrigPages =
                                  originalPageCounts[entry.originalId] ?? 0;
                                const sub =
                                  totalOrigPages > 0
                                    ? `Page ${entry.pageIndex + 1} of ${totalOrigPages}`
                                    : `Page ${entry.pageIndex + 1}`;
                                return (
                                  <div
                                    key={entry.id}
                                    className="relative"
                                    onClick={() =>
                                      setSelectedPageEntryId(entry.id)
                                    }
                                  >
                                    <PageThumb
                                      id={entry.id}
                                      label={orig?.name ?? "Original"}
                                      sublabel={sub}
                                      thumbnail={
                                        thumbs[entry.pageIndex] ?? null
                                      }
                                      getThumbnail={getOriginalThumb(
                                        entry.originalId,
                                        entry.pageIndex,
                                      )}
                                      rotation={entry.rotation}
                                      isSelected={
                                        isPageSelected || viewerIndex === idx
                                      }
                                      stickers={entry.stickers}
                                      kind="original"
                                      onDelete={removeEntry}
                                      onRotate={rotateEntry}
                                      onReplace={startReplace}
                                      onExpand={() => setViewerIndex(idx)}
                                      onUpdateStickers={
                                        handleUpdatePageStickers
                                      }
                                      onUpdateSticker={handleUpdatePageSticker}
                                      onRemoveSticker={handleRemovePageSticker}
                                    />
                                  </div>
                                );
                              }
                              const item = itemById.get(entry.itemId);
                              if (!item) return null;
                              const page = entry.pageIndex ?? 0;
                              const thumbList = itemThumbs[item.id] ?? [];
                              const thumb = thumbList[page] ?? null;
                              const totalPages = itemPageCounts[item.id] ?? 1;
                              const sub =
                                item.kind === "pdf" && totalPages > 1
                                  ? `Page ${page + 1} of ${totalPages}`
                                  : `Page ${idx + 1}`;
                              return (
                                <div
                                  key={entry.id}
                                  className="relative"
                                  onClick={() =>
                                    setSelectedPageEntryId(entry.id)
                                  }
                                >
                                  <PageThumb
                                    id={entry.id}
                                    label={item.name}
                                    sublabel={sub}
                                    thumbnail={thumb}
                                    getThumbnail={
                                      item.kind === "pdf"
                                        ? getItemThumb(item.id, page)
                                        : undefined
                                    }
                                    rotation={entry.rotation}
                                    isSelected={
                                      isPageSelected || viewerIndex === idx
                                    }
                                    stickers={entry.stickers}
                                    kind={item.kind}
                                    onDelete={removeEntry}
                                    onRotate={rotateEntry}
                                    onReplace={startReplace}
                                    onExpand={() => setViewerIndex(idx)}
                                    onUpdateStickers={handleUpdatePageStickers}
                                    onUpdateSticker={handleUpdatePageSticker}
                                    onRemoveSticker={handleRemovePageSticker}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
                  </section>
                </>
              )}

              {/* 5. Download & Output Settings */}
              <section className="mt-6 rounded-xl border border-border bg-white p-5 shadow-sm">
                <h3 className="text-sm font-bold text-slate-800 tracking-tight mb-4 flex items-center gap-2">
                  <Download className="h-4 w-4 text-blue-600" /> Download &
                  Output Settings
                </h3>

                <div className="space-y-4 mb-4">
                  {/* PDF Name Input */}
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      PDF Name
                    </label>
                    <input
                      type="text"
                      value={pdfName}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPdfName(val);
                        if (isManualProject && activeDoc) {
                          const syncName =
                            val.trim() ||
                            (originals[0]?.name?.replace(/\.pdf$/i, "") ??
                              items[0]?.name?.replace(/\.[^/.]+$/, ""));
                          if (syncName) {
                            setActiveDoc((prev) =>
                              prev
                                ? { ...prev, customer_name: syncName }
                                : null,
                            );
                          }
                        }
                      }}
                      placeholder={activeDoc.original_name.replace(
                        /\.pdf$/i,
                        "",
                      )}
                      className="w-full rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 transition-colors"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Leave blank to use the original PDF filename.
                    </p>
                  </div>

                  {/* RTI Type Radio Pill Selector for ALL_RTI_TYPES */}
                  <div>
                    <label className="mb-2 block text-xs font-bold text-slate-700">
                      RTI Type
                    </label>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      {ALL_RTI_TYPES.map((type) => {
                        const isChecked = rtiTypeSelected === type;
                        return (
                          <label
                            key={type}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all select-none ${
                              isChecked
                                ? "border-blue-600 bg-blue-50 text-blue-700 shadow-sm ring-1 ring-blue-500"
                                : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="radio"
                              name="rtiType"
                              value={type}
                              checked={isChecked}
                              onChange={async () => {
                                setRtiTypeSelected(type);
                                if (!isManualProject && activeDoc) {
                                  try {
                                    const updated = await updateDocument(
                                      activeDoc.id,
                                      { rti_type_selected: type },
                                    );
                                    setActiveDoc(updated);
                                  } catch (err) {
                                    console.error(
                                      "Failed to update RTI type on database",
                                      err,
                                    );
                                  }
                                }
                              }}
                              className="h-3.5 w-3.5 border-slate-300 text-blue-600 focus:ring-blue-500 accent-blue-600 cursor-pointer"
                            />
                            <span>{type}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Output File Live Filename Preview & Optional Append RTI Checkbox */}
                <div className="mb-4 bg-emerald-50/50 border border-emerald-200/50 rounded-xl p-3 shadow-sm space-y-2">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 rounded-lg bg-emerald-100 text-emerald-700 mt-0.5 shrink-0">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block mb-0.5">
                        Output Filename
                      </span>
                      <span className="text-xs font-bold text-slate-800 break-all select-all block">
                        {getOutputFilename()}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-emerald-200/40 pt-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 hover:text-slate-900 select-none">
                      <input
                        type="checkbox"
                        checked={effectiveAppendRTI}
                        onChange={(e) => {
                          setUserToggledAppend(true);
                          setAppendRtiType(e.target.checked);
                        }}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 accent-blue-600 cursor-pointer"
                      />
                      <span>Include RTI Type in filename</span>
                    </label>
                    <span className="text-[10px] text-muted-foreground">
                      {isFullDownload
                        ? "(Default ON for full project)"
                        : "(Default OFF for partial downloads)"}
                    </span>
                  </div>
                </div>

                {/* Advanced Options (Page Range Collapsible) */}
                <div className="mb-5 border-t border-slate-100 pt-3">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen(!advancedOpen)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    {advancedOpen ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5" />
                    )}
                    Advanced Options (Page Range)
                  </button>
                  {advancedOpen && (
                    <div className="mt-3 bg-slate-50 border border-slate-200/60 rounded-xl p-4 transition-all duration-200">
                      <label className="mb-1 block text-xs font-bold text-slate-700">
                        Page Range (optional)
                      </label>
                      <input
                        type="text"
                        value={pageRange}
                        onChange={(e) => setPageRange(e.target.value)}
                        placeholder="e.g. 1,3,5-7  (empty = all pages)"
                        className="w-full max-w-md rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Allows selecting a subset of pages. Leave blank to
                        process the whole document.
                      </p>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={generateAndSave}
                    disabled={!canGenerate}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow-md active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {status.kind === "working" ? (
                      <>
                        <Sparkles className="h-4 w-4 animate-pulse" />
                        {status.label ?? "Working…"}{" "}
                        {status.pct ? `${status.pct}%` : ""}
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save As
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={downloadRange}
                    disabled={!canDownload}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-input bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Download className="h-4 w-4 text-slate-500" />
                    Download
                  </button>
                </div>

                {status.kind === "working" && (
                  <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-blue-100">
                    <div
                      className="h-full bg-blue-600 transition-all"
                      style={{ width: `${status.pct}%` }}
                    />
                  </div>
                )}
                {status.kind === "done" && (
                  <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-emerald-50/80 border border-emerald-200/50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
                    <CheckCircle2 className="h-4.5 w-4.5 text-emerald-600 shrink-0" />
                    <div>
                      <span className="font-bold">Success:</span>{" "}
                      {status.message}
                    </div>
                  </div>
                )}
                {status.kind === "error" && (
                  <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-red-50/80 border border-red-200/50 px-4 py-3 text-sm text-red-800 shadow-sm">
                    <AlertCircle className="h-4.5 w-4.5 text-red-600 shrink-0" />
                    <div>
                      <span className="font-bold">Error:</span> {status.message}
                    </div>
                  </div>
                )}
              </section>

              <p className="mt-6 text-center text-xs text-muted-foreground">
                Merging runs in your browser · Projects & edits stored in
                internal queue
              </p>
            </>
          )}
        </main>
      </div>

      {/* 👁️ Full-Screen Document Viewer & Interactive Page Editor */}
      <DocumentViewer
        isOpen={viewerIndex !== null}
        onClose={() => setViewerIndex(null)}
        items={viewableTimelineItems}
        initialIndex={viewerIndex ?? 0}
        onRotateItem={(entryId) => rotateEntry(entryId)}
        onUpdateStickers={handleUpdatePageStickers}
        onAddCourtStamp={(entryId) => {
          setSelectedPageEntryId(entryId);
          void handleCourtStampClick();
        }}
      />

      {/* 📑 Court Stamp First-Time Setup Modal */}
      <CourtStampSetupModal
        isOpen={isCourtStampSetupOpen}
        onClose={() => setIsCourtStampSetupOpen(false)}
        onSave={handleCourtStampSetupSaved}
      />

      {/* ⚙️ Court Stamp Settings Modal */}
      <CourtStampSettingsModal
        isOpen={isCourtStampSettingsOpen}
        template={courtStampTemplate}
        onClose={() => setIsCourtStampSettingsOpen(false)}
        onUpdate={(updated) => setCourtStampTemplate(updated)}
      />
    </div>
  );
}

function AutoDeleteBanner({
  scheduledAt,
  onCancel,
  onDeleteNow,
}: {
  scheduledAt: string;
  onCancel: () => void;
  onDeleteNow: () => void;
}) {
  const remaining = useCountdown(scheduledAt);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
      <Timer className="h-5 w-5 text-amber-700" />
      <div className="flex-1 text-sm text-amber-900">
        Auto-delete in <b>{remaining}</b>. Only project data & temp files are
        removed — your saved PDF is untouched.
      </div>
      <button
        onClick={onCancel}
        className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
      >
        <Ban className="h-3.5 w-3.5" /> Cancel auto-delete
      </button>
      <button
        onClick={onDeleteNow}
        className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
      >
        <Trash2 className="h-3.5 w-3.5" /> Delete now
      </button>
    </div>
  );
}

function useCountdown(target: string) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(iv);
  }, []);
  const diff = Math.max(0, new Date(target).getTime() - now);
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}
