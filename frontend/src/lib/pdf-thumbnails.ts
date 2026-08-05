// pdfjs-dist references browser globals (DOMMatrix, etc.) at import time.
// Lazy-load it on the client only so the SSR bundle never touches it.

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

async function getPdfjs() {
  if (typeof window === "undefined") {
    throw new Error("PDF rendering is only available in the browser");
  }
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerMod = await import("pdfjs-dist/build/pdf.worker.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

// ---------- Cached document open (memory-friendly for large PDFs) ----------

type PdfDocProxy = Awaited<
  ReturnType<Awaited<ReturnType<typeof getPdfjs>>["getDocument"]>["promise"]
>;

const docCache = new Map<string, Promise<PdfDocProxy>>();
// Concurrency guard so many <PageThumb> mounts don't all render at once.
const renderQueue: Array<() => void> = [];
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 3;

function schedule<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeRenders += 1;
      try {
        resolve(await job());
      } catch (e) {
        reject(e);
      } finally {
        activeRenders -= 1;
        const next = renderQueue.shift();
        if (next) next();
      }
    };
    if (activeRenders < MAX_CONCURRENT_RENDERS) run();
    else renderQueue.push(run);
  });
}

export async function openPdfDoc(
  key: string,
  file: File,
): Promise<PdfDocProxy> {
  let p = docCache.get(key);
  if (!p) {
    p = (async () => {
      const pdfjs = await getPdfjs();
      const bytes = await file.arrayBuffer();
      // disableAutoFetch/Stream reduce memory pressure on very large PDFs.
      const task = pdfjs.getDocument({
        data: bytes,
        disableAutoFetch: true,
        disableStream: true,
      });
      return task.promise;
    })();
    docCache.set(key, p);
  }
  return p;
}

export async function getPdfPageCount(
  key: string,
  file: File,
): Promise<number> {
  const doc = await openPdfDoc(key, file);
  return doc.numPages;
}

export async function renderPdfPage(
  key: string,
  file: File,
  pageIndex: number,
  scale = 0.35,
): Promise<string | null> {
  return schedule(async () => {
    const doc = await openPdfDoc(key, file);
    if (pageIndex < 0 || pageIndex >= doc.numPages) return null;
    const page = await doc.getPage(pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      page.cleanup();
      return null;
    }
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const url = canvas.toDataURL("image/jpeg", 0.6);
    page.cleanup();
    return url;
  });
}

export function evictPdfDoc(key: string): void {
  const p = docCache.get(key);
  if (!p) return;
  docCache.delete(key);
  p.then((d) => {
    try {
      // pdf.js docs expose destroy()
      (d as unknown as { destroy?: () => Promise<void> }).destroy?.();
    } catch {
      /* ignore */
    }
  }).catch(() => {});
}

// ---------- Legacy eager renderer (kept for compatibility) ----------

export async function renderPdfThumbnails(
  file: File,
  scale = 0.35,
): Promise<string[]> {
  const pdfjs = await getPdfjs();
  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const doc = await loadingTask.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    out.push(canvas.toDataURL("image/jpeg", 0.7));
    page.cleanup();
  }
  await loadingTask.destroy();
  return out;
}

export async function renderPdfFirstThumbnail(
  file: File,
  scale = 0.35,
): Promise<string | null> {
  const thumbs = await renderPdfThumbnails(file, scale);
  return thumbs[0] ?? null;
}
