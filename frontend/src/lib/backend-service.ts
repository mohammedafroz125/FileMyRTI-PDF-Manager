/**
 * Central Backend Service Abstraction Module.
 *
 * Provides a unified interface for document processing.
 * All PDF optimization requests are processed via Ghostscript on Railway.
 */

import {
  getBackendUrl,
  convertWordToPdfOnServer,
  optimizePdfBlob,
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
   * Returns true (Ghostscript backend is mandatory).
   */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  /**
   * Returns current backend configuration status & URL.
   */
  getConfig(): { configured: boolean; url: string } {
    const url = getBackendUrl();
    return { configured: true, url };
  }

  /**
   * Universal document processor.
   * If Word (.doc/.docx): Converts via server-side LibreOffice + Ghostscript.
   * If PDF: Optimizes via Ghostscript backend (POST /api/optimize).
   * If Image: Wraps file.
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
    const isPdf = lower.endsWith(".pdf") || file.type === "application/pdf";

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

    if (isPdf) {
      if (options?.onStatus) options.onStatus("Optimizing PDF via Ghostscript...");
      const optimizedBlob = await optimizePdfBlob(
        file,
        file.name,
        options?.profile || "Balanced",
        options?.targetSizeMB || 2,
      );
      const optimizedFile = new File([optimizedBlob], file.name, {
        type: "application/pdf",
      });
      return {
        file: optimizedFile,
        converted: false,
        optimized: true,
        engineUsed: "Ghostscript Backend",
      };
    }

    return {
      file,
      converted: false,
      optimized: false,
      engineUsed: "Image File",
    };
  }

  /**
   * Ghostscript PDF optimization helper.
   */
  async optimizePdf(blob: Blob, targetSizeMB: number = 2): Promise<Blob> {
    return optimizePdfBlob(blob, "document.pdf", "Balanced", targetSizeMB);
  }
}

export const backendService = new BackendServiceManager();
