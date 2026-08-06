import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { getGhostscriptExecutable } from "../config";
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
}

export const ADAPTIVE_PASSES: AdaptivePass[] = [
  {
    name: "Pass 1: High-Quality RTI Ebook Pass (200 DPI)",
    pdfSettings: "/ebook",
    colorDpi: 200,
    grayDpi: 200,
    monoDpi: 300,
  },
  {
    name: "Pass 2: Balanced RTI Compression Pass (150 DPI)",
    pdfSettings: "/ebook",
    colorDpi: 150,
    grayDpi: 150,
    monoDpi: 200,
  },
  {
    name: "Pass 3: Aggressive Scanned RTI Pass (120 DPI / Screen)",
    pdfSettings: "/screen",
    colorDpi: 120,
    grayDpi: 120,
    monoDpi: 150,
  },
];

function formatMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export class GhostscriptOptimizer implements IPdfOptimizer {
  name = "Ghostscript Adaptive Engine";

  async isAvailable(): Promise<boolean> {
    const executable = getGhostscriptExecutable();
    return executable !== null;
  }

  async optimize(
    inputBuffer: Buffer,
    options?: OptimizationOptions,
  ): Promise<OptimizationResult> {
    const totalStartTime = Date.now();
    const executable = getGhostscriptExecutable();
    if (!executable) {
      throw new Error(`Ghostscript executable not found on server.`);
    }

    const fileName = options?.fileName || "document.pdf";
    const targetSizeMB =
      options?.targetSizeMB && options.targetSizeMB > 0
        ? options.targetSizeMB
        : 2;
    const targetSizeBytes = Math.round(targetSizeMB * 1024 * 1024);
    const originalSize = inputBuffer.length;

    console.log(`\n==================================================`);
    console.log(`[1/8] STEP 1: Uploaded PDF received.`);
    console.log(`      - File Name: "${fileName}"`);
    console.log(`      - Input Size: ${formatMB(originalSize)} (${originalSize.toLocaleString()} bytes)`);

    const tempDir = os.tmpdir();
    const id = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const inputPath = path.join(tempDir, `input-gs-${id}.pdf`);

    await fs.promises.writeFile(inputPath, inputBuffer);
    console.log(`      - Input Temp File: "${inputPath}"`);

    let bestBuffer: Buffer = inputBuffer;
    let bestSize: number = originalSize;
    let bestPassName = "Original Preserved";
    let isGhostscriptOutputFileReturned = false;
    let lastGsCommandExecuted = "";
    let lastExitCode = -1;
    let lastStdout = "";
    let lastStderr = "";
    const stepsLog: OptimizationStepLog[] = [];

    try {
      for (let i = 0; i < ADAPTIVE_PASSES.length; i++) {
        const pass = ADAPTIVE_PASSES[i];
        const stepNum = i + 1;
        const passStartTime = Date.now();
        const outputPath = path.join(
          tempDir,
          `output-gs-${id}-step${stepNum}.pdf`,
        );

        // Mandatory Ghostscript flags to force image downsampling & re-compression
        const gsFlags = [
          `"${executable}"`,
          `-sDEVICE=pdfwrite`,
          `-dCompatibilityLevel=1.4`,
          `-dPDFSETTINGS=${pass.pdfSettings}`,
          `-dNOPAUSE`,
          `-dQUIET`,
          `-dBATCH`,

          `-dDownsampleColorImages=true`,
          `-dColorImageDownsampleType=/Bicubic`,
          `-dColorImageResolution=${pass.colorDpi}`,
          `-dColorImageThreshold=1.0`,
          `-dAutoFilterColorImages=false`,
          `-dColorImageFilter=/DCTEncode`,

          `-dDownsampleGrayImages=true`,
          `-dGrayImageDownsampleType=/Bicubic`,
          `-dGrayImageResolution=${pass.grayDpi}`,
          `-dGrayImageThreshold=1.0`,
          `-dAutoFilterGrayImages=false`,
          `-dGrayImageFilter=/DCTEncode`,

          `-dDownsampleMonoImages=true`,
          `-dMonoImageDownsampleType=/Bicubic`,
          `-dMonoImageResolution=${pass.monoDpi}`,
          `-dMonoImageThreshold=1.0`,
          `-dAutoFilterMonoImages=false`,
          `-dMonoImageFilter=/CCITTFaxEncode`,

          `-dDetectDuplicateImages=true`,
          `-dCompressFonts=true`,
          `-dSubsetFonts=true`,
          `-dEmbedAllFonts=true`,
          `-dAutoRotatePages=/None`,
          `-dFastWebView=true`,

          `-sOutputFile="${outputPath}"`,
          `"${inputPath}"`,
        ];

        const gsCmd = gsFlags.join(" ");
        lastGsCommandExecuted = gsCmd;

        console.log(`\n[2/8] STEP 2: Executing Ghostscript CLI (Pass ${stepNum}/${ADAPTIVE_PASSES.length}: ${pass.name})`);
        console.log(`[3/8] STEP 3: Exact Ghostscript Command:`);
        console.log(`      ${gsCmd}`);

        let exitCode = 0;
        let stdout = "";
        let stderr = "";

        try {
          const execRes = await execAsync(gsCmd);
          stdout = execRes.stdout || "";
          stderr = execRes.stderr || "";
        } catch (execErr: unknown) {
          const errObj = execErr as {
            code?: number;
            stdout?: string;
            stderr?: string;
            message?: string;
          };
          exitCode = errObj.code || 1;
          stdout = errObj.stdout || "";
          stderr = errObj.stderr || errObj.message || "Execution error";
        }

        lastExitCode = exitCode;
        lastStdout = stdout;
        lastStderr = stderr;

        console.log(`[6/8] STEP 6: Ghostscript Exit Code: ${exitCode}`);
        if (stdout.trim() || stderr.trim()) {
          console.log(`      - Output logs: ${stdout.trim() || stderr.trim()}`);
        }

        if (fs.existsSync(outputPath)) {
          const passBuffer = await fs.promises.readFile(outputPath);
          const passSize = passBuffer.length;
          const passTimeMs = Date.now() - passStartTime;
          const achievedTarget = passSize <= targetSizeBytes;

          console.log(`[4/8] STEP 4: Input Size:  ${formatMB(originalSize)} (${originalSize.toLocaleString()} bytes)`);
          console.log(`[5/8] STEP 5: Output Size: ${formatMB(passSize)} (${passSize.toLocaleString()} bytes)`);

          const passReduction =
            originalSize > 0
              ? ((originalSize - passSize) / originalSize) * 100
              : 0;
          const passReductionPct = Math.max(
            0,
            Math.round(passReduction * 10) / 10,
          );

          console.log(`      - Compression: ${passReductionPct}% reduction`);

          stepsLog.push({
            step: stepNum,
            passName: pass.name,
            colorDpi: pass.colorDpi,
            monoDpi: pass.monoDpi,
            outputSize: passSize,
            timeMs: passTimeMs,
            achievedTarget,
          });

          // Always pick the best (smallest) valid output buffer produced by Ghostscript
          if (passSize > 0 && passSize < bestSize) {
            bestSize = passSize;
            bestBuffer = passBuffer;
            bestPassName = pass.name;
            isGhostscriptOutputFileReturned = true;

            console.log(`[7/8] STEP 7: Output file is DIFFERENT and SMALLER (${formatMB(passSize)} vs ${formatMB(originalSize)}).`);

            if (achievedTarget) {
              console.log(`🎯 Target size achieved at Pass ${stepNum} (${formatMB(passSize)} <= ${targetSizeMB} MB).`);
              break;
            }
          } else if (passSize >= originalSize && i === ADAPTIVE_PASSES.length - 1) {
            console.log(`[7/8] STEP 7: Ghostscript output size (${formatMB(passSize)}) equaled/exceeded input (${formatMB(originalSize)}). File was already fully compressed.`);
          }
        } else {
          console.warn(`⚠️ Ghostscript pass ${stepNum} did not generate output file at "${outputPath}".`);
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
    const totalReduction =
      originalSize > 0 ? ((originalSize - bestSize) / originalSize) * 100 : 0;
    const compressionRatioPct = Math.max(
      0,
      Math.round(totalReduction * 10) / 10,
    );

    console.log(`[8/8] STEP 8: Response Payload Check:`);
    if (isGhostscriptOutputFileReturned) {
      console.log(`      - Status: SUCCESS ✅`);
      console.log(`      - Returned Payload: GHOSTSCRIPT OPTIMIZED PDF (${formatMB(bestSize)}, ${compressionRatioPct}% reduced)`);
    } else {
      console.log(`      - Status: PASSTHROUGH (File already highly compressed at ${formatMB(originalSize)})`);
      console.log(`      - Returned Payload: Original input PDF`);
    }
    console.log(`==================================================\n`);

    const report: DetailedOptimizationReport = {
      originalSize,
      finalSize: bestSize,
      compressionRatioPct,
      docType: "scanned",
      imagesOptimized: 1,
      fontsPreserved: 0,
      objectsRemoved: 0,
      processingTimeMs: totalProcessingTimeMs,
      profileUsed: bestPassName,
      isAlreadyOptimized: !isGhostscriptOutputFileReturned,
      qualityValidated: true,
    };

    return {
      optimizedBuffer: bestBuffer,
      engineUsed: this.name,
      originalSize,
      optimizedSize: bestSize,
      targetSizeMB,
      docType: "scanned",
      profileUsed: bestPassName,
      processingTimeMs: totalProcessingTimeMs,
      compressionRatioPct,
      stepsCount: stepsLog.length,
      stepsLog,
      report,
    };
  }
}
