/**
 * Mandatory Railway Ghostscript Backend PDF Optimizer Client.
 *
 * Every PDF uploaded or exported is routed directly to the Railway Ghostscript backend (POST /api/optimize).
 * If the backend fails or is unreachable, throws an explicit user error instead of returning uncompressed original.
 */

export type OptimizationProfile =
  | "High Quality"
  | "Balanced"
  | "Maximum Compression";
export type UploadStage =
  | "Uploading..."
  | "Converting..."
  | "Optimizing..."
  | "Ready";

const DEFAULT_RAILWAY_BACKEND_URL =
  "https://pdf-optimizer-backend-production.up.railway.app";

/**
 * Returns the active backend service base URL.
 */
export function getBackendUrl(): string {
  const envUrl = (import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_PDF_OPTIMIZER_URL) as string | undefined;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return DEFAULT_RAILWAY_BACKEND_URL;
}

/**
 * Sends a PDF Blob to the Railway Ghostscript backend for optimization.
 * Throws an explicit error if backend is unreachable or optimization fails.
 */
export async function optimizePdfBlob(
  originalBlob: Blob,
  fileName: string = "document.pdf",
  profile: OptimizationProfile | string = "Balanced",
  targetSizeMB: number = 2,
): Promise<Blob> {
  console.log("CALLING optimizePdfBlob");
  const baseUrl = getBackendUrl();
  console.log("POSTING TO", baseUrl + "/api/optimize");

  const formData = new FormData();
  formData.append("pdf", originalBlob, fileName);
  formData.append("profile", profile);
  formData.append("targetSizeMB", targetSizeMB.toString());

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000); // 90s timeout

  try {
    const res = await fetch(`${baseUrl}/api/optimize`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      let errorDetails = `Ghostscript backend optimization failed with status ${res.status}.`;
      try {
        const errData = await res.json();
        if (errData.error) errorDetails = errData.error;
      } catch {
        /* ignore */
      }
      throw new Error(errorDetails);
    }

    const optimizedArrayBuffer = await res.arrayBuffer();
    if (!optimizedArrayBuffer || optimizedArrayBuffer.byteLength === 0) {
      throw new Error(
        "Received an empty PDF response from Railway Ghostscript backend.",
      );
    }

    return new Blob([optimizedArrayBuffer], { type: "application/pdf" });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === "AbortError") {
      throw new Error(
        "PDF optimization timed out on Railway backend. Please try again.",
      );
    }
    throw err;
  }
}

// Export alias for backward compatibility across existing routes
export const optimizePdfBlobSilently = optimizePdfBlob;

/**
 * Converts a Word document (.doc / .docx) to PDF using LibreOffice on the Railway backend.
 */
export async function convertWordToPdfOnServer(
  file: File,
  onProgress?: (stage: UploadStage) => void,
): Promise<File> {
  const baseUrl = getBackendUrl();

  if (onProgress) onProgress("Uploading...");

  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("targetSizeMB", "2");
  formData.append("profile", "Balanced");

  if (onProgress) onProgress("Converting...");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  const res = await fetch(`${baseUrl}/api/convert-doc?fast=true`, {
    method: "POST",
    body: formData,
    signal: controller.signal,
  });
  clearTimeout(timeoutId);

  if (onProgress) onProgress("Optimizing...");

  if (!res.ok) {
    let errorDetails = "Word document conversion failed on Railway server.";
    try {
      const errData = await res.json();
      if (errData.details) errorDetails = errData.details;
      else if (errData.error) errorDetails = errData.error;
    } catch {
      /* ignore */
    }
    throw new Error(errorDetails);
  }

  const pdfArrayBuffer = await res.arrayBuffer();
  if (!pdfArrayBuffer || pdfArrayBuffer.byteLength === 0) {
    throw new Error(
      "Received an empty PDF response from document conversion service.",
    );
  }

  if (onProgress) onProgress("Ready");

  const pdfFileName = file.name.replace(/\.(docx?|DOCX?)$/, "") + ".pdf";
  return new File([pdfArrayBuffer], pdfFileName, { type: "application/pdf" });
}

export async function isBackendOptimizerAvailable(): Promise<boolean> {
  return true;
}
