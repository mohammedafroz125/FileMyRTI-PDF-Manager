// IndexedDB-backed persistence for Manual Edit drafts.
// A draft holds: metadata (name, timestamps), original PDF files, item files
// (pdf/image) and the timeline plan. Files are stored as Blob + name.
import { get, set, del, keys } from "idb-keyval";

import type { RtiTypeSelected } from "./rti-storage";

export type DraftFileBlob = { name: string; type: string; blob: Blob };

export type DraftOriginal = { id: string; name: string; file: DraftFileBlob };
export type DraftItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  file: DraftFileBlob;
};
import type { PageSticker, StickerTemplate } from "./stickers";

export type DraftTimelineEntry =
  | {
      id: string;
      type: "original-page";
      originalId: string;
      pageIndex: number;
      rotation?: number;
      stickers?: PageSticker[];
    }
  | {
      id: string;
      type: "item";
      itemId: string;
      pageIndex?: number;
      rotation?: number;
      stickers?: PageSticker[];
    };

export type ManualDraft = {
  id: string;
  name: string;
  pdfName: string;
  createdAt: string;
  updatedAt: string;
  status?: "pending" | "completed";
  sessionId?: string;
  rtiType?: RtiTypeSelected;
  originals: DraftOriginal[];
  items: DraftItem[];
  timeline: DraftTimelineEntry[];
  courtStampTemplate?: StickerTemplate | null;
};

const KEY_PREFIX = "manual-draft:";
const INDEX_KEY = "manual-draft-index";

export type DraftSummary = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  status?: "pending" | "completed";
  rtiType?: RtiTypeSelected;
};

async function readIndex(): Promise<DraftSummary[]> {
  try {
    const v = (await get<DraftSummary[]>(INDEX_KEY)) ?? [];
    return v;
  } catch {
    return [];
  }
}

async function writeIndex(list: DraftSummary[]) {
  try {
    await set(INDEX_KEY, list);
  } catch (err) {
    console.warn("Failed to write draft index to IndexedDB", err);
  }
}

export async function listDrafts(): Promise<DraftSummary[]> {
  const idx = await readIndex();
  return [...idx].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function loadDraft(id: string): Promise<ManualDraft | null> {
  try {
    return (await get<ManualDraft>(KEY_PREFIX + id)) ?? null;
  } catch {
    return null;
  }
}

export async function saveDraft(draft: ManualDraft): Promise<void> {
  draft.updatedAt = new Date().toISOString();
  await set(KEY_PREFIX + draft.id, draft);
  const idx = await readIndex();
  const summary: DraftSummary = {
    id: draft.id,
    name: draft.name,
    updatedAt: draft.updatedAt,
    createdAt: draft.createdAt,
    status: draft.status,
    rtiType: draft.rtiType,
  };
  const filtered = idx.filter((d) => d.id !== draft.id);
  filtered.unshift(summary);
  await writeIndex(filtered);
}

export async function renameDraft(id: string, name: string): Promise<void> {
  const d = await loadDraft(id);
  if (!d) return;
  d.name = name;
  await saveDraft(d);
}

export async function deleteDraft(id: string): Promise<void> {
  await del(KEY_PREFIX + id);
  const idx = await readIndex();
  await writeIndex(idx.filter((d) => d.id !== id));
}

export async function deleteAllDrafts(): Promise<void> {
  const idx = await readIndex();
  for (const d of idx) {
    await del(KEY_PREFIX + d.id);
  }
  await writeIndex([]);
}

export function draftFileToFile(f: DraftFileBlob): File {
  return new File([f.blob], f.name, {
    type: f.type || "application/octet-stream",
  });
}

export async function fileToDraftBlob(file: File): Promise<DraftFileBlob> {
  return { name: file.name, type: file.type, blob: file };
}

// Rehydrate stray keys if index becomes out of sync.
export async function reconcileIndex(): Promise<void> {
  const allKeys = await keys();
  const draftKeys = allKeys.filter(
    (k) => typeof k === "string" && k.startsWith(KEY_PREFIX),
  ) as string[];
  const idx = await readIndex();
  const known = new Set(idx.map((d) => d.id));
  const additions: DraftSummary[] = [];
  for (const k of draftKeys) {
    const id = k.slice(KEY_PREFIX.length);
    if (known.has(id)) continue;
    const d = await get<ManualDraft>(k);
    if (d)
      additions.push({
        id: d.id,
        name: d.name,
        updatedAt: d.updatedAt,
        createdAt: d.createdAt,
        status: d.status,
        rtiType: d.rtiType,
      });
  }
  if (additions.length) await writeIndex([...additions, ...idx]);
}
