/**
 * Optional Backend Microservice Integration & PDF Optimizer / Word Converter Client.
 *
 * Automatically detects whether an optional backend service (VITE_BACKEND_URL / VITE_PDF_OPTIMIZER_URL) is configured and available.
 * If configured & available, enables server-side LibreOffice document conversion (.doc / .docx) and Ghostscript adaptive PDF optimization.
 * If unconfigured or offline, gracefully falls back to browser-native processing (0 backend dependency).
 */

export type OptimizationProfile =
  "High Quality" | "Balanced" | "Maximum Compression";
export type UploadStage =
  "Uploading..." | "Converting..." | "Optimizing..." | "Ready";

let backendAvailabilityCache: { available: boolean; timestamp: number } | null =
  null;
const CACHE_TTL_MS = 60_000; // Cache availability check for 60 seconds

/**
 * Returns the configured backend service base URL from environment variables, or null if unconfigured.
 * Never hardcodes fallback localhost URLs in source code.
 */
export function getBackendUrl(): string | null {
  const envUrl = (import.meta.env.VITE_BACKEND_URL ||
    import.meta.env.VITE_PDF_OPTIMIZER_URL) as string | undefined;
  if (!envUrl) return null;
  let trimmed = envUrl.trim().replace(/\/+$/, "");

  // If app is opened on mobile phone via LAN IP (e.g. 192.168.x.x) or external host,
  // adapt 'localhost' in VITE_BACKEND_URL to the current page hostname so mobile phone can reach backend.
  if (typeof window !== "undefined" && window.location?.hostname) {
    const pageHost = window.location.hostname;
    if (pageHost !== "localhost" && pageHost !== "127.0.0.1") {
      trimmed = trimmed
        .replace("localhost", pageHost)
        .replace("127.0.0.1", pageHost);
    }
  }

  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Lightweight startup & runtime check to verify if optional backend microservice is reachable via GET /api/health.
 * Caches availability result to prevent redundant network checks.
 * Rejects silently with 0 console errors, unhandled rejections, or broken UI when unconfigured or offline.
 */
export async function isBackendOptimizerAvailable(): Promise<boolean> {
  const baseUrl = getBackendUrl();
  if (!baseUrl) return false;

  // Use cached result if valid
  if (
    backendAvailabilityCache &&
    Date.now() - backendAvailabilityCache.timestamp < CACHE_TTL_MS
  ) {
    return backendAvailabilityCache.available;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s quick ping

    const res = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      const isOk = data && data.status === "ok";
      backendAvailabilityCache = { available: isOk, timestamp: Date.now() };
      return isOk;
    }
  } catch {
    /* Silent fallback: no console error, no unhandled rejection */
  }

  backendAvailabilityCache = { available: false, timestamp: Date.now() };
  return false;
}

/**
 * Sends a PDF Blob to the optional backend microservice for adaptive optimization.
 * If backend is unconfigured, offline, or fails, returns the original Blob seamlessly.
 */
export async function optimizePdfBlobSilently(
  originalBlob: Blob,
  profile: OptimizationProfile | string = "Balanced",
  targetSizeMB: number = 2,
): Promise<Blob> {
  const baseUrl = getBackendUrl();
  if (!baseUrl) return originalBlob;

  const isAvailable = await isBackendOptimizerAvailable();
  if (!isAvailable) return originalBlob;

  try {
    const formData = new FormData();
    formData.append("pdf", originalBlob, "input.pdf");
    formData.append("profile", profile);
    formData.append("targetSizeMB", targetSizeMB.toString());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const res = await fetch(`${baseUrl}/api/optimize`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const optimizedArrayBuffer = await res.arrayBuffer();
      if (optimizedArrayBuffer && optimizedArrayBuffer.byteLength > 0) {
        return new Blob([optimizedArrayBuffer], { type: "application/pdf" });
      }
    }
  } catch {
    /* Silent fallback to original Blob */
  }

  return originalBlob;
}

/**
 * Converts a Word document (.doc / .docx) to PDF using the backend microservice.
 * If backend is unconfigured or offline, throws a friendly user-facing error message:
 * "Word document conversion requires the optional backend service. PDF files continue to work normally."
 */
export async function convertWordToPdfOnServer(
  file: File,
  onProgress?: (stage: UploadStage) => void,
): Promise<File> {
  const baseUrl = getBackendUrl();
  const isAvailable = await isBackendOptimizerAvailable();

  if (!baseUrl || !isAvailable) {
    throw new Error(
      "Word document conversion requires the optional backend service. PDF files continue to work normally.",
    );
  }

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
    let errorDetails = "Word document conversion failed on server.";
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
