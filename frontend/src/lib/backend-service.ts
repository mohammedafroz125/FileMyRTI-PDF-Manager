/**
 * Central Backend Service Abstraction Module.
 *
 * Provides a unified interface for document processing.
 * Components interact with this abstraction rather than calling raw backend endpoints directly.
 *
 * Mode 1: Frontend Only Mode (Backend URL unconfigured or offline)
 * Mode 2: Backend Enhanced Mode (Backend URL configured & health check OK)
 */

import {
  getBackendUrl,
  isBackendOptimizerAvailable,
  convertWordToPdfOnServer,
  optimizePdfBlobSilently,
  UploadStage,
} from "./pdf-optimizer-client";

export interface ProcessDocumentOptions {
  targetSizeMB?: number;
  profile?: string;
  onStatus?: (status: string) => void;
}

export interface ProcessDocumentResult {
  file: File;
  converted: boolean;
  optimized: boolean;
  engineUsed: string;
}

export class BackendServiceManager {
  /**
   * Returns whether the optional backend service is configured and online.
   */
  async isAvailable(): Promise<boolean> {
    return isBackendOptimizerAvailable();
  }

  /**
   * Returns current backend configuration status & URL if set.
   */
  getConfig(): { configured: boolean; url: string | null } {
    const url = getBackendUrl();
    return { configured: url !== null, url };
  }

  /**
   * Universal document processor abstraction.
   * If file is Word (.doc/.docx):
   *   - If backend ON: Converts via server-side LibreOffice.
   *   - If backend OFF: Throws friendly graceful error.
   * If file is PDF or Image:
   *   - Returns file directly (0 backend dependency).
   */
  async processDocument(
    file: File,
    options?: ProcessDocumentOptions,
  ): Promise<ProcessDocumentResult> {
    const lower = file.name.toLowerCase();
    const isWord =
      lower.endsWith(".doc") ||
      lower.endsWith(".docx") ||
      file.type.includes("word");

    if (isWord) {
      const convertedPdf = await convertWordToPdfOnServer(
        file,
        (stage: UploadStage) => {
          if (options?.onStatus) options.onStatus(stage);
        },
      );
      return {
        file: convertedPdf,
        converted: true,
        optimized: true,
        engineUsed: "LibreOffice + Ghostscript Backend",
      };
    }

    // PDFs & Images work 100% in frontend-only mode
    return {
      file,
      converted: false,
      optimized: false,
      engineUsed: "Browser Native Engine",
    };
  }

  /**
   * Optional PDF optimization helper.
   */
  async optimizePdf(blob: Blob, targetSizeMB: number = 2): Promise<Blob> {
    return optimizePdfBlobSilently(blob, "Balanced", targetSizeMB);
  }
}

export const backendService = new BackendServiceManager();
