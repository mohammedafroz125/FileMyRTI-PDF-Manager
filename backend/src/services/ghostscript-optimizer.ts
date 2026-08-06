import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { getGhostscriptExecutable, ABSOLUTE_GS_PATH } from "../config";
import type {
  IPdfOptimizer,
  OptimizationOptions,
  OptimizationResult,
  OptimizationStepLog,
  DetailedOptimizationReport,
} from "../types";

const execAsync = promisify(exec);

export interface AdaptivePass {
  name: string;
  pdfSettings: string;
  colorDpi: number;
  grayDpi: number;
  monoDpi: number;
  jpegQuality: number;
}

export const ADAPTIVE_PASSES: AdaptivePass[] = [
  {
    name: "Pass 1: High-Quality RTI Ebook Pass (200 DPI)",
    pdfSettings: "/ebook",
    colorDpi: 200,
    grayDpi: 200,
    monoDpi: 300,
    jpegQuality: 80,
  },
  {
    name: "Pass 2: Balanced RTI Compression Pass (150 DPI)",
    pdfSettings: "/ebook",
    colorDpi: 150,
    grayDpi: 150,
    monoDpi: 200,
    jpegQuality: 70,
  },
  {
    name: "Pass 3: Aggressive Scanned RTI Pass (120 DPI / Screen)",
    pdfSettings: "/screen",
    colorDpi: 120,
    grayDpi: 120,
    monoDpi: 150,
    jpegQuality: 60,
  },
];

export interface PdfAnalysis {
  docType: "digital" | "scanned";
  pageCount: number;
  hasText: boolean;
  fontsCount: number;
  imagesCount: number;
  hasColor: boolean;
  isAlreadyOptimized: boolean;
  pageDimensions: { width: number; height: number; rotation: number }[];
}

export async function analyzePdfDocument(inputBuffer: Buffer): Promise<PdfAnalysis> {
  try {
    const pdfDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
    const pageCount = pdfDoc.getPageCount();
    let fontsCount = 0;
    let imagesCount = 0;
    const pageDimensions: { width: number; height: number; rotation: number }[] = [];

    const pages = pdfDoc.getPages();
    for (const page of pages) {
      const { width, height } = page.getSize();
      const rotation = page.getRotation().angle;
      pageDimensions.push({ width, height, rotation });

      const resources = page.node.Resources();
      if (resources) {
        const fontDict = resources.get(PDFName.of("Font"));
        if (fontDict instanceof PDFDict) {
          fontsCount += fontDict.keys().length;
        }
        const xObjectDict = resources.get(PDFName.of("XObject"));
        if (xObjectDict instanceof PDFDict) {
          imagesCount += xObjectDict.keys().length;
        }
      }
    }

    const hasText = fontsCount > 0;
    const isDigital = fontsCount > 0 && (imagesCount === 0 || fontsCount >= Math.ceil(pageCount / 2));
    const docType = isDigital ? "digital" : "scanned";
    const sizePerPage = inputBuffer.length / (pageCount || 1);
    const isAlreadyOptimized = sizePerPage < 100 * 1024 && inputBuffer.indexOf("/ObjStm") !== -1;

    return {
      docType,
      pageCount,
      hasText,
      fontsCount,
      imagesCount,
      hasColor: true,
      isAlreadyOptimized,
      pageDimensions,
    };
  } catch {
    return {
      docType: "scanned",
      pageCount: 1,
      hasText: false,
      fontsCount: 0,
      imagesCount: 1,
      hasColor: true,
      isAlreadyOptimized: false,
      pageDimensions: [{ width: 595, height: 842, rotation: 0 }],
    };
  }
}

function validateQuality(
  originalDimensions: { width: number; height: number; rotation: number }[],
  optimizedBuffer: Buffer
): Promise<boolean> {
  return (async () => {
    try {
      const optDoc = await PDFDocument.load(optimizedBuffer, { ignoreEncryption: true });
      if (optDoc.getPageCount() !== originalDimensions.length) return false;
      const optPages = optDoc.getPages();
      for (let i = 0; i < originalDimensions.length; i++) {
        const orig = originalDimensions[i];
        const opt = optPages[i].getSize();
        if (Math.abs(orig.width - opt.width) > 2 || Math.abs(orig.height - opt.height) > 2) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  })();
}

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export class GhostscriptOptimizer implements IPdfOptimizer {
  name = "Ghostscript Adaptive Engine";

  async isAvailable(): Promise<boolean> {
    const executable = getGhostscriptExecutable();
    return executable !== null;
  }

  async optimize(inputBuffer: Buffer, options?: OptimizationOptions): Promise<OptimizationResult> {
    const totalStartTime = Date.now();
    const executable = getGhostscriptExecutable();
    if (!executable) {
      throw new Error(`Ghostscript executable not found on server.`);
    }

    const fileName = options?.fileName || "document.pdf";
    const targetSizeMB = options?.targetSizeMB && options.targetSizeMB > 0 ? options.targetSizeMB : 2;
    const targetSizeBytes = Math.round(targetSizeMB * 1024 * 1024);
    const originalSize = inputBuffer.length;

    console.log(`\n==================================================`);
    console.log(`[1/11] Request received for PDF optimization.`);
    console.log(`[2/11] Uploaded file name: "${fileName}"`);
    console.log(`[3/11] Uploaded file size: ${formatMB(originalSize)} (${originalSize.toLocaleString()} bytes)`);

    const analysis = await analyzePdfDocument(inputBuffer);
    console.log(`       - Document Type: ${analysis.docType.toUpperCase()}`);
    console.log(`       - Total Pages:   ${analysis.pageCount}`);
    console.log(`       - Target Size:   ${targetSizeMB} MB`);

    const tempDir = os.tmpdir();
    const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const inputPath = path.join(tempDir, `input-gs-${id}.pdf`);

    console.log(`[4/11] Temporary input file path: "${inputPath}"`);
    await fs.promises.writeFile(inputPath, inputBuffer);

    let bestBuffer: Buffer = inputBuffer;
    let bestSize: number = originalSize;
    let bestPassName = "Original Preserved";
    let objectsRemovedCount = 0;
    const stepsLog: OptimizationStepLog[] = [];

    try {
      for (let i = 0; i < ADAPTIVE_PASSES.length; i++) {
        const pass = ADAPTIVE_PASSES[i];
        const stepNum = i + 1;
        const passStartTime = Date.now();
        const outputPath = path.join(tempDir, `output-gs-${id}-step${stepNum}.pdf`);

        const gsFlags = [
          `"${executable}"`,
          `-sDEVICE=pdfwrite`,
          `-dCompatibilityLevel=1.4`,
          `-dPDFSETTINGS=${pass.pdfSettings}`,
          `-dNOPAUSE`,
          `-dQUIET`,
          `-dBATCH`,
          `-dDetectDuplicateImages=true`,
          `-dCompressFonts=true`,
          `-dSubsetFonts=true`,
          `-dEmbedAllFonts=true`,
          `-dAutoRotatePages=/None`,
          `-dColorImageDownsampleType=/Bicubic`,
          `-dColorImageResolution=${pass.colorDpi}`,
          `-dColorImageThreshold=1.0`,
          `-dGrayImageDownsampleType=/Bicubic`,
          `-dGrayImageResolution=${pass.grayDpi}`,
          `-dGrayImageThreshold=1.0`,
          `-dMonoImageDownsampleType=/Bicubic`,
          `-dMonoImageResolution=${pass.monoDpi}`,
          `-dMonoImageThreshold=1.0`,
          `-sOutputFile="${outputPath}"`,
          `"${inputPath}"`,
        ];

        const gsCmd = gsFlags.join(" ");

        console.log(`\n--- Pass ${stepNum}/${ADAPTIVE_PASSES.length}: ${pass.name} ---`);
        console.log(`[5/11] Exact Ghostscript command being executed:`);
        console.log(`       ${gsCmd}`);

        let exitCode = 0;
        let stdout = "";
        let stderr = "";

        try {
          const execRes = await execAsync(gsCmd);
          stdout = execRes.stdout || "";
          stderr = execRes.stderr || "";
        } catch (execErr: unknown) {
          const errObj = execErr as { code?: number; stdout?: string; stderr?: string; message?: string };
          exitCode = errObj.code || 1;
          stdout = errObj.stdout || "";
          stderr = errObj.stderr || errObj.message || "Command execution failed";
        }

        console.log(`[6/11] Ghostscript exit code: ${exitCode}`);
        console.log(`[7/11] Ghostscript stdout/stderr: ${stdout.trim() || stderr.trim() || "Clean Execution (0 errors)"}`);
        console.log(`[8/11] Output PDF path: "${outputPath}"`);

        if (fs.existsSync(outputPath)) {
          const passBuffer = await fs.promises.readFile(outputPath);
          const passSize = passBuffer.length;
          const passTimeMs = Date.now() - passStartTime;
          const achievedTarget = passSize <= targetSizeBytes;

          console.log(`[9/11] Output PDF size: ${formatMB(passSize)} (${passSize.toLocaleString()} bytes)`);

          const passReduction = originalSize > 0 ? ((originalSize - passSize) / originalSize) * 100 : 0;
          const passReductionPct = Math.max(0, Math.round(passReduction * 10) / 10);

          console.log(`[10/11] Compression percentage: ${passReductionPct}% reduction`);

          const isValid = await validateQuality(analysis.pageDimensions, passBuffer);

          stepsLog.push({
            step: stepNum,
            passName: pass.name,
            colorDpi: pass.colorDpi,
            monoDpi: pass.monoDpi,
            outputSize: passSize,
            timeMs: passTimeMs,
            achievedTarget,
          });

          if (isValid && passSize < bestSize) {
            bestSize = passSize;
            bestBuffer = passBuffer;
            bestPassName = pass.name;

            if (achievedTarget) {
              console.log(`🎯 Target size achieved at Pass ${stepNum} (${formatMB(passSize)} <= ${targetSizeMB} MB).`);
              break;
            }
          }
        } else {
          console.warn(`⚠️ Pass ${stepNum} did not create an output file at "${outputPath}".`);
        }
      }
    } finally {
      try {
        if (fs.existsSync(inputPath)) await fs.promises.unlink(inputPath);
      } catch {
        /* ignore */
      }
    }

    const totalProcessingTimeMs = Date.now() - totalStartTime;

    let isOptimized = false;
    if (bestSize < originalSize) {
      isOptimized = true;
      console.log(`\n[11/11] Confirming response payload: Sending OPTIMIZED PDF (${formatMB(bestSize)}) to client.`);
    } else {
      console.log(`\n[11/11] Confirming response payload: Output size (${formatMB(bestSize)}) was not smaller than original (${formatMB(originalSize)}). Sending original PDF.`);
    }

    const totalReduction = originalSize > 0 ? ((originalSize - bestSize) / originalSize) * 100 : 0;
    const compressionRatioPct = Math.max(0, Math.round(totalReduction * 10) / 10);
    const qualityValidated = await validateQuality(analysis.pageDimensions, bestBuffer);

    const report: DetailedOptimizationReport = {
      originalSize,
      finalSize: bestSize,
      compressionRatioPct,
      docType: analysis.docType,
      imagesOptimized: analysis.imagesCount,
      fontsPreserved: analysis.fontsCount,
      objectsRemoved: 0,
      processingTimeMs: totalProcessingTimeMs,
      profileUsed: bestPassName,
      isAlreadyOptimized: analysis.isAlreadyOptimized,
      qualityValidated,
    };

    console.log(`==================================================\n`);

    return {
      optimizedBuffer: bestBuffer,
      engineUsed: this.name,
      originalSize,
      optimizedSize: bestSize,
      targetSizeMB,
      docType: analysis.docType,
      profileUsed: bestPassName,
      processingTimeMs: totalProcessingTimeMs,
      compressionRatioPct,
      stepsCount: stepsLog.length,
      stepsLog,
      report,
    };
  }
}
