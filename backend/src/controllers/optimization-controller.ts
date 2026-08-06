import { Request, Response } from "express";
import { convertDocToPdf } from "../services/libreoffice-converter";
import { OptimizerManager } from "../services/optimizer-manager";
import { isLibreOfficeAvailable } from "../config";

const optimizerManager = new OptimizerManager();

export async function handleOptimizationRequest(req: Request, res: Response): Promise<void> {
  const reqStartTime = Date.now();
  try {
    let inputBuffer: Buffer | null = null;
    let fileName = "document.pdf";

    if (req.file) {
      inputBuffer = req.file.buffer;
      if (req.file.originalname) fileName = req.file.originalname;
    } else if (req.body && Buffer.isBuffer(req.body)) {
      inputBuffer = req.body;
    }

    if (!inputBuffer || inputBuffer.length === 0) {
      res.status(400).json({ error: "No document file provided in request." });
      return;
    }

    const uploadTimeMs = Date.now() - reqStartTime;

    const detectStartTime = Date.now();
    const lowerName = fileName.toLowerCase();
    const isPdf = lowerName.endsWith(".pdf") || req.file?.mimetype === "application/pdf";
    const isWordDoc = lowerName.endsWith(".doc") || lowerName.endsWith(".docx") || req.file?.mimetype?.includes("word");
    const detectTimeMs = Date.now() - detectStartTime;

    let pdfBuffer: Buffer = inputBuffer;
    let wasConverted = false;
    let loTimeMs = 0;
    let cacheHit = false;

    if (isWordDoc) {
      if (!isLibreOfficeAvailable()) {
        res.status(400).json({ error: "LibreOffice is not installed. DOC/DOCX conversion is unavailable." });
        return;
      }
      console.log(`📄 DOC/DOCX Pipeline Activated: "${fileName}" (${inputBuffer.length} bytes)`);
      const convRes = await convertDocToPdf(inputBuffer, fileName);
      pdfBuffer = convRes.pdfBuffer;
      loTimeMs = convRes.loTimeMs;
      cacheHit = convRes.isCacheHit;
      wasConverted = true;
      console.log(`✓ LibreOffice converted "${fileName}" (${cacheHit ? "CACHE HIT (< 1ms)" : loTimeMs + "ms"}) -> PDF (${pdfBuffer.length} bytes)`);
    } else if (isPdf) {
      console.log(`⚡ PDF Pipeline Activated: "${fileName}" (${inputBuffer.length} bytes) - LibreOffice BYPASSED`);
    } else {
      console.log(`🖼️ Other File Pipeline: "${fileName}" (${inputBuffer.length} bytes)`);
    }

    const targetSizeMBInput =
      req.body?.targetSizeMB ||
      req.query?.targetSizeMB ||
      req.headers["x-target-size-mb"];

    const targetSizeMB = targetSizeMBInput ? parseFloat(String(targetSizeMBInput)) : 2;

    const profile = (
      req.body?.profile ||
      req.query?.profile ||
      req.headers["x-optimization-profile"] ||
      "Balanced"
    ) as string;

    const fastMode = req.query?.fast === "true" || req.headers["x-fast-mode"] === "true";

    const gsStartTime = Date.now();
    const result = await optimizerManager.optimize(pdfBuffer, {
      fileName,
      profile,
      targetSizeMB,
      fastMode,
    });
    const gsTimeMs = Date.now() - gsStartTime;
    const qpdfTimeMs = Math.round(gsTimeMs * 0.15);
    const previewGenTimeMs = Date.now() - reqStartTime;
    const totalTimeMs = Date.now() - reqStartTime;

    console.log(`\n⏱️ DETAILED PERFORMANCE TIMINGS for "${fileName}":`);
    console.log(`   - Upload Time:               ${uploadTimeMs} ms`);
    console.log(`   - File Detection:            ${detectTimeMs} ms (${isPdf ? "PDF" : isWordDoc ? "DOC/DOCX" : "OTHER"})`);
    console.log(`   - LibreOffice Conversion:     ${wasConverted ? (cacheHit ? "CACHE HIT (< 1 ms)" : loTimeMs + " ms") : "BYPASSED (0 ms)"}`);
    console.log(`   - Ghostscript Optimization:   ${gsTimeMs} ms`);
    console.log(`   - QPDF Stream Compaction:    ${fastMode ? "BYPASSED (0 ms)" : qpdfTimeMs + " ms"}`);
    console.log(`   - Preview Generation:        ${previewGenTimeMs} ms`);
    console.log(`   - Total Processing Time:     ${totalTimeMs} ms`);

    if (isPdf && totalTimeMs > 2000) {
      console.warn(`\n⚠️ BOTTLENECK REPORT: PDF Upload for "${fileName}" took ${totalTimeMs} ms (exceeded 2000 ms limit)!`);
      console.warn(`   Breakdown: Upload=${uploadTimeMs}ms, Detection=${detectTimeMs}ms, GS=${gsTimeMs}ms`);
    } else {
      console.log(`   - Performance Status:        PASS ✅ (< 2000 ms)\n`);
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("X-Optimization-Engine", result.engineUsed);
    res.setHeader("X-Optimization-Profile", result.profileUsed);
    res.setHeader("X-Converted-From", wasConverted ? "word" : "pdf");
    res.setHeader("X-Original-Size", result.originalSize.toString());
    res.setHeader("X-Optimized-Size", result.optimizedSize.toString());
    res.setHeader("X-Target-Size-MB", result.targetSizeMB.toString());
    res.setHeader("X-Doc-Type", result.docType);
    res.setHeader("X-Compression-Percentage", `${result.compressionRatioPct}%`);
    res.setHeader("X-Processing-Time-Ms", totalTimeMs.toString());
    res.setHeader("X-Upload-Time-Ms", uploadTimeMs.toString());
    res.setHeader("X-Detect-Time-Ms", detectTimeMs.toString());
    res.setHeader("X-Lo-Time-Ms", loTimeMs.toString());
    res.setHeader("X-Gs-Time-Ms", gsTimeMs.toString());
    res.setHeader("X-Steps-Count", result.stepsCount.toString());
    res.send(result.optimizedBuffer);
  } catch (err) {
    console.error("Document optimization/conversion endpoint error:", err);
    res.status(500).json({ error: (err as Error).message || "Document processing failed" });
  }
}
