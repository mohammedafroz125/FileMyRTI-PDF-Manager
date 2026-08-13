import { Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://osauijutbomcbzkhbamx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_UgrJNpxVWO-kCkZTrwQMsw__YFtbFZA";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const BUCKET = "rti-files";

export async function handleMobileUploadExpress(
  req: Request,
  res: Response,
): Promise<void> {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    let tokenStr =
      req.params.token ||
      (req.query.token as string) ||
      (req.query.sessionId as string) ||
      (req.query.docId as string) ||
      (req.headers["x-mobile-token"] as string) ||
      (req.headers["x-upload-token"] as string) ||
      "";

    if (!tokenStr && req.body) {
      tokenStr =
        req.body.token ||
        req.body.session_token ||
        req.body.upload_token ||
        req.body.sessionId ||
        req.body.docId ||
        "";
    }

    if (!tokenStr || !tokenStr.trim()) {
      res.status(400).json({
        success: false,
        error: "Invalid PDF Manager QR. Missing upload session token.",
      });
      return;
    }

    tokenStr = tokenStr.trim();

    let docId = tokenStr;
    try {
      const { data: tokenRecord } = await supabase
        .from("rti_mobile_tokens")
        .select("*")
        .eq("token", tokenStr)
        .maybeSingle();

      if (tokenRecord) {
        docId = tokenRecord.document_id;
        if (tokenRecord.expires_at) {
          const expiresAt = new Date(tokenRecord.expires_at).getTime();
          if (Date.now() > expiresAt) {
            res.status(400).json({
              success: false,
              error: "QR session expired. Generate a new QR.",
            });
            return;
          }
        }
      }
    } catch {
      /* ignore */
    }

    const files: Express.Multer.File[] = [];
    if (req.file) {
      files.push(req.file);
    }
    if (Array.isArray(req.files)) {
      files.push(...(req.files as Express.Multer.File[]));
    } else if (req.files && typeof req.files === "object") {
      for (const key of Object.keys(req.files)) {
        const arr = req.files[key];
        if (Array.isArray(arr)) files.push(...arr);
      }
    }

    if (files.length === 0) {
      res.status(400).json({
        success: false,
        error: "Invalid PDF received. No file attached to upload request.",
      });
      return;
    }

    const uploadedResults: { fileId: string; filename: string; size: number }[] = [];

    for (const file of files) {
      if (!file.buffer || file.buffer.length <= 100) {
        res.status(400).json({
          success: false,
          error: `Invalid PDF received: "${file.originalname || "document.pdf"}" is empty (${file.buffer ? file.buffer.length : 0} bytes).`,
        });
        return;
      }

      const fileId = crypto.randomUUID();
      const filename = file.originalname || "document.pdf";
      const cleanName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const cloudPath = `${docId}/items/${Date.now()}-${fileId}-mobile-${cleanName}`;

      const contentType =
        file.mimetype ||
        (cleanName.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "image/jpeg");

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(cloudPath, file.buffer, { contentType, upsert: true });

      if (uploadError) {
        console.error("Express Supabase Storage upload error:", uploadError);
        res.status(500).json({
          success: false,
          error: `Upload failed — storage error: ${uploadError.message}`,
        });
        return;
      }

      try {
        await supabase
          .from("rti_mobile_tokens")
          .update({ created_at: new Date().toISOString() })
          .eq("token", tokenStr);
      } catch {
        /* ignore */
      }

      uploadedResults.push({
        fileId,
        filename,
        size: file.buffer.length,
      });
    }

    res.status(200).json({
      success: true,
      message: "PDF sent successfully.",
      fileId: uploadedResults[0].fileId,
      filename: uploadedResults[0].filename,
      size: uploadedResults[0].size,
      files: uploadedResults,
    });
  } catch (err) {
    console.error("Express mobile upload error:", err);
    res.status(500).json({
      success: false,
      error: (err as Error).message || "Upload failed — server error.",
    });
  }
}
