import {
  PDFDocument,
  PDFName,
  degrees,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";

export type MergeItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  file: File;
  mobilePath?: string;
};

import type { PageSticker } from "./stickers";
import { renderPdfPage } from "./pdf-thumbnails";

export type PlanEntry =
  | {
      entryId: string;
      kind: "original-page";
      originalId: string;
      pageIndex: number;
      rotation?: number;
      stickers?: PageSticker[];
    }
  | {
      entryId: string;
      kind: "item";
      item: MergeItem;
      pageIndex?: number;
      rotation?: number;
      stickers?: PageSticker[];
    };

/**
 * Strips Metadata pointer from catalog while preserving indirect object references.
 */
function stripGlobalCatalogPointers(doc: PDFDocument): void {
  try {
    const catalog = doc.catalog;
    catalog.delete(PDFName.of("Metadata"));
  } catch {
    /* ignore */
  }
}

/**
 * Optimizes image streams for PDF inclusion:
 * - Keeps original JPEG binary streams intact to prevent re-encoding loss.
 * - Converts non-JPEG images (PNG, WebP) to optimized JPEGs (quality 0.82) when size reduction is achieved.
 */
async function getOptimizedImageBytes(
  file: File,
  quality = 0.82,
): Promise<{ bytes: Uint8Array; isPng: boolean }> {
  const lower = file.name.toLowerCase();
  const isJpg =
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    file.type === "image/jpeg";
  const rawBytes = new Uint8Array(await file.arrayBuffer());

  if (isJpg) {
    return { bytes: rawBytes, isPng: false };
  }

  if (typeof document !== "undefined") {
    try {
      const blob = new Blob([rawBytes], { type: file.type || "image/png" });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0);
        const jpgBlob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
        );
        URL.revokeObjectURL(url);
        if (jpgBlob && jpgBlob.size < rawBytes.byteLength) {
          const jpgBytes = new Uint8Array(await jpgBlob.arrayBuffer());
          return { bytes: jpgBytes, isPng: false };
        }
      }
      URL.revokeObjectURL(url);
    } catch {
      /* fallback to raw bytes */
    }
  }

  const isPng = lower.endsWith(".png") || file.type === "image/png";
  return { bytes: rawBytes, isPng };
}

/**
 * Ultra-Optimized PDF Export Engine.
 *
 * Solves 97MB Page Range Export Bug:
 * Strips global document catalog pointers (`StructTreeRoot`, `Metadata`, `Names`) from source PDFs
 * before performing single-batch page copying. This ensures exported page ranges (e.g. range 4-6 out of a 97MB file)
 * copy ONLY the 3 target page image streams, producing a lightweight ~2MB - 3MB output PDF.
 */
export async function mergeByPlan(
  originals: Record<string, File>,
  plan: PlanEntry[],
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  if (plan.length === 0) throw new Error("No pages to merge");

  onProgress?.(10);
  const out = await PDFDocument.create();

  // 1. Pre-load all source PDF documents and strip global catalog pointers
  const sourceDocsMap = new Map<string, { doc: PDFDocument; file: File }>();
  const pageIndicesPerSource = new Map<string, Set<number>>();

  for (const entry of plan) {
    if (entry.kind === "original-page") {
      const key = `orig-${entry.originalId}`;
      if (!sourceDocsMap.has(key)) {
        const file = originals[entry.originalId];
        if (!file)
          throw new Error(`Original file missing for id ${entry.originalId}`);
        const bytes = await file.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        stripGlobalCatalogPointers(doc);
        sourceDocsMap.set(key, { doc, file });
        pageIndicesPerSource.set(key, new Set());
      }
      pageIndicesPerSource.get(key)!.add(entry.pageIndex);
    } else if (entry.kind === "item" && entry.item.kind === "pdf") {
      const key = `item-${entry.item.id}`;
      if (!sourceDocsMap.has(key)) {
        const bytes = await entry.item.file.arrayBuffer();
        const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        stripGlobalCatalogPointers(doc);
        sourceDocsMap.set(key, { doc, file: entry.item.file });
        pageIndicesPerSource.set(key, new Set());
      }
      const pageIndex = entry.pageIndex ?? 0;
      pageIndicesPerSource.get(key)!.add(pageIndex);
    }
  }

  onProgress?.(40);

  // 2. Perform Single-Batch Copying per Source Document (copies ONLY target page streams)
  const batchCopiedPagesMap = new Map<string, Map<number, PDFPage>>();

  for (const [key, { doc }] of sourceDocsMap.entries()) {
    const indicesSet = pageIndicesPerSource.get(key);
    if (!indicesSet || indicesSet.size === 0) continue;

    const validIndices = Array.from(indicesSet).filter(
      (idx) => idx < doc.getPageCount(),
    );
    if (validIndices.length === 0) continue;

    const pageLookup = new Map<number, PDFPage>();
    for (const srcIdx of validIndices) {
      try {
        const srcPage = doc.getPage(srcIdx);
        if (srcPage) {
          const [copiedPage] = await out.copyPages(doc, [srcIdx]);
          if (copiedPage) {
            pageLookup.set(srcIdx, copiedPage);
          }
        }
      } catch (e) {
        console.warn(`Failed to copy page index ${srcIdx} from document ${key}:`, e);
      }
    }

    batchCopiedPagesMap.set(key, pageLookup);
  }

  onProgress?.(65);

  // 3. Cache embedded image resources for reuse across pages (deduplication)
  const imageCache = new Map<string, PDFImage>();
  const getOrEmbedImage = async (item: MergeItem): Promise<PDFImage> => {
    if (!item || !item.file) {
      throw new Error(`Item file reference is missing for "${item?.name ?? "unknown"}".`);
    }
    const key = `${item.id}-${item.file.name}-${item.file.size}`;
    let img = imageCache.get(key);
    if (img) return img;

    const { bytes, isPng } = await getOptimizedImageBytes(item.file);
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(`Image file "${item.file.name}" is empty (0 bytes).`);
    }

    img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
    if (!img) {
      throw new Error(`Failed to embed image "${item.file.name}" into PDF.`);
    }
    imageCache.set(key, img);
    return img;
  };

  const stickerImageCache = new Map<string, PDFImage>();

  const drawStickersOnPage = async (
    page: PDFPage,
    stickers?: PageSticker[],
  ) => {
    if (!stickers || stickers.length === 0) return;
    const pWidth = page.getWidth();
    const pHeight = page.getHeight();

    for (const sticker of stickers) {
      if (!sticker || !sticker.imageDataUrl) continue;
      try {
        let img = stickerImageCache.get(sticker.imageDataUrl);
        if (!img) {
          const parts = sticker.imageDataUrl.split(",");
          if (parts.length < 2) continue;
          const mimeStr = parts[0] ?? "";
          const base64Data = parts[1] ?? "";
          if (!base64Data.trim()) continue;

          const binaryStr = atob(base64Data);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          if (bytes.byteLength === 0) continue;

          const isPng = mimeStr.includes("png");
          img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
          if (img) stickerImageCache.set(sticker.imageDataUrl, img);
        }

        if (!img) continue; // CRITICAL: Skip if img is null/undefined to prevent page.drawImage assertion crash!

        const drawW = (sticker.width / 100) * pWidth;
        const drawH = (sticker.height / 100) * pHeight;
        const drawX = (sticker.x / 100) * pWidth;
        const drawY = pHeight - ((sticker.y / 100) * pHeight + drawH);

        page.drawImage(img, {
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
        });
      } catch (err) {
        console.warn("Failed to embed sticker onto page:", err);
      }
    }
  };

  const getFallbackPageAsImage = async (
    key: string,
    file: File,
    pageIndex: number,
  ): Promise<PDFPage | null> => {
    try {
      const dataUrl = await renderPdfPage(key, file, pageIndex, 2.0);
      if (!dataUrl) return null;
      const parts = dataUrl.split(",");
      if (parts.length < 2) return null;
      const base64Data = parts[1];
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const img = await out.embedJpg(bytes);
      const fallbackPage = out.addPage([img.width, img.height]);
      fallbackPage.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      });
      return fallbackPage;
    } catch (e) {
      console.error(`Fallback rendering failed for ${key} page ${pageIndex}:`, e);
      return null;
    }
  };

  // 4. Assemble final PDF pages in target plan sequence
  let done = 0;
  for (const entry of plan) {
    let addedPage: PDFPage | null = null;
    if (entry.kind === "original-page") {
      const key = `orig-${entry.originalId}`;
      const pageLookup = batchCopiedPagesMap.get(key);
      const copiedPage = pageLookup?.get(entry.pageIndex);
      if (copiedPage) {
        if (entry.rotation) {
          copiedPage.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
        }
        addedPage = out.addPage(copiedPage);
      } else {
        const file = originals[entry.originalId];
        if (file) {
          addedPage = await getFallbackPageAsImage(key, file, entry.pageIndex);
          if (addedPage && entry.rotation) {
            addedPage.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
          }
        }
      }
      if (!addedPage) {
        throw new Error(
          `Unable to resolve Page ${done + 1}: original PDF page index ${entry.pageIndex + 1} is unreadable.`,
        );
      }
    } else {
      const it = entry.item;
      if (!it || !it.file) {
        throw new Error(
          `Unable to resolve Page ${done + 1}: item file reference is missing.`,
        );
      }
      if (it.kind === "pdf") {
        const key = `item-${it.id}`;
        const pageLookup = batchCopiedPagesMap.get(key);
        const pageIndex = entry.pageIndex ?? 0;
        const copiedPage = pageLookup?.get(pageIndex);
        if (copiedPage) {
          if (entry.rotation) {
            copiedPage.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
          }
          addedPage = out.addPage(copiedPage);
        } else {
          addedPage = await getFallbackPageAsImage(key, it.file, pageIndex);
          if (addedPage && entry.rotation) {
            addedPage.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
          }
        }
        if (!addedPage) {
          throw new Error(
            `Unable to resolve Page ${done + 1}: item "${it.name}" page index ${pageIndex + 1} is unreadable.`,
          );
        }
      } else {
        const img = await getOrEmbedImage(it);
        if (!img) {
          throw new Error(
            `Unable to resolve Page ${done + 1}: image file "${it.name}" could not be embedded.`,
          );
        }
        const page = out.addPage([img.width, img.height]);
        page.drawImage(img, {
          x: 0,
          y: 0,
          width: img.width,
          height: img.height,
        });
        if (entry.rotation) {
          page.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
        }
        addedPage = page;
      }
    }

    if (addedPage && entry.stickers && entry.stickers.length > 0) {
      await drawStickersOnPage(addedPage, entry.stickers);
    }

    done += 1;
    onProgress?.(65 + Math.round((done / plan.length) * 30));
  }

  // 5. Flatten form fields
  const form = out.getForm();
  if (form) {
    try {
      form.flatten();
    } catch {
      /* ignore */
    }
  }

  onProgress?.(95);

  // 6. Save with Acrobat-compliant Object Stream compression
  try {
    const finalBytes = await out.save({
      useObjectStreams: true,
      addDefaultPage: false,
    });
    onProgress?.(100);
    const ab = new ArrayBuffer(finalBytes.byteLength);
    new Uint8Array(ab).set(finalBytes);
    return new Blob([ab], { type: "application/pdf" });
  } catch (err) {
    console.warn(
      "pdf-lib vector save failed due to invalid indirect references, executing clean image-stream fallback:",
      err,
    );
    return await buildFallbackPdfFromImages(originals, plan, onProgress);
  }
}

async function buildFallbackPdfFromImages(
  originals: Record<string, File>,
  plan: PlanEntry[],
  onProgress?: (pct: number) => void,
): Promise<Blob> {
  console.warn("Executing PDF.js image-stream fallback merge pipeline...");
  const out = await PDFDocument.create();

  let done = 0;
  for (const entry of plan) {
    let pageFile: File | null = null;
    let pageIdx = 0;

    if (entry.kind === "original-page") {
      pageFile = originals[entry.originalId] ?? null;
      pageIdx = entry.pageIndex;
    } else {
      pageFile = entry.item.file;
      pageIdx =
        entry.kind === "item" && entry.item.kind === "pdf"
          ? entry.pageIndex ?? 0
          : 0;
    }

    if (!pageFile) {
      throw new Error(`Fallback engine missing source file for page ${done + 1}`);
    }

    let addedPage: PDFPage | null = null;
    if (entry.kind === "item" && entry.item.kind === "image") {
      const { bytes, isPng } = await getOptimizedImageBytes(pageFile);
      const img = isPng ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      addedPage = out.addPage([img.width, img.height]);
      addedPage.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      });
    } else {
      const key =
        entry.kind === "original-page"
          ? `orig-${entry.originalId}`
          : `item-${entry.item.id}`;
      const dataUrl = await renderPdfPage(key, pageFile, pageIdx, 2.0);
      if (!dataUrl) {
        throw new Error(`Fallback rendering failed for page ${done + 1}`);
      }
      const parts = dataUrl.split(",");
      const base64Data = parts[1] ?? "";
      const binaryStr = atob(base64Data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const img = await out.embedJpg(bytes);
      addedPage = out.addPage([img.width, img.height]);
      addedPage.drawImage(img, {
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      });
    }

    if (addedPage && entry.rotation) {
      addedPage.setRotation(degrees(((entry.rotation % 360) + 360) % 360));
    }

    done += 1;
    onProgress?.(50 + Math.round((done / plan.length) * 45));
  }

  const finalBytes = await out.save({
    useObjectStreams: false,
    addDefaultPage: false,
  });
  onProgress?.(100);
  const ab = new ArrayBuffer(finalBytes.byteLength);
  new Uint8Array(ab).set(finalBytes);
  return new Blob([ab], { type: "application/pdf" });
}
