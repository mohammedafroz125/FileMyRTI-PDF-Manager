import { supabase } from "@/integrations/supabase/client";
import { safeRandomUUID } from "@/lib/utils";

const BUCKET = "rti-files";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Content-Type": "application/json",
};

export async function handleMobileUpload(
  request: Request,
): Promise<Response> {
  // Handle OPTIONS preflight request for Android native HTTP clients
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split("/").filter(Boolean);

    // Token extraction order:
    // 1. From path: e.g. /m/upload/:token or /api/m/upload/:token
    // 2. From query param: ?token=... or ?sessionId=... or ?docId=...
    // 3. From headers: x-mobile-token, x-upload-token
    let tokenStr = "";

    const lastPart = pathParts[pathParts.length - 1];
    if (
      lastPart &&
      lastPart !== "upload" &&
      lastPart !== "upload-mobile" &&
      lastPart !== "mobile-upload" &&
      lastPart !== "create"
    ) {
      tokenStr = lastPart;
    }

    if (!tokenStr) {
      tokenStr =
        url.searchParams.get("token") ||
        url.searchParams.get("sessionId") ||
        url.searchParams.get("docId") ||
        request.headers.get("x-mobile-token") ||
        request.headers.get("x-upload-token") ||
        "";
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request payload. Expected multipart/form-data.",
        }),
        { status: 400, headers: CORS_HEADERS },
      );
    }

    if (!tokenStr) {
      tokenStr =
        (formData.get("token") as string) ||
        (formData.get("session_token") as string) ||
        (formData.get("upload_token") as string) ||
        (formData.get("sessionId") as string) ||
        (formData.get("docId") as string) ||
        "";
    }

    if (!tokenStr || !tokenStr.trim()) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid PDF Manager QR. Missing upload session token.",
        }),
        { status: 400, headers: CORS_HEADERS },
      );
    }

    tokenStr = tokenStr.trim();

    // Validate token against Supabase database rti_mobile_tokens
    let docId = tokenStr;
    try {
      const { data: tokenRecord } = await supabase
        .from("rti_mobile_tokens")
        .select("*")
        .eq("token", tokenStr)
        .maybeSingle();

      if (tokenRecord) {
        docId = tokenRecord.document_id;
        // Verify expiration
        if (tokenRecord.expires_at) {
          const expiresAt = new Date(tokenRecord.expires_at).getTime();
          if (Date.now() > expiresAt) {
            return new Response(
              JSON.stringify({
                success: false,
                error: "QR session expired. Generate a new QR.",
              }),
              { status: 400, headers: CORS_HEADERS },
            );
          }
        }
      }
    } catch {
      /* fallback: use tokenStr as docId if table lookup unavailable */
    }

    // Extract uploaded files from form data
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid PDF received. No file attached to upload request.",
        }),
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const uploadedResults: { fileId: string; filename: string; size: number }[] = [];

    for (const file of files) {
      // Validate file size (> 100 bytes)
      if (file.size <= 100) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Invalid PDF received: "${file.name}" is empty (${file.size} bytes).`,
          }),
          { status: 400, headers: CORS_HEADERS },
        );
      }

      const fileId = safeRandomUUID();
      const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const cloudPath = `${docId}/items/${Date.now()}-${fileId}-mobile-${cleanName}`;

      const contentType =
        file.type ||
        (cleanName.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "image/jpeg");

      // Upload file directly to Supabase Cloud Storage
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(cloudPath, file, { contentType, upsert: true });

      if (uploadError) {
        console.error("Supabase Storage upload error:", uploadError);
        return new Response(
          JSON.stringify({
            success: false,
            error: `Upload failed — storage error: ${uploadError.message}`,
          }),
          { status: 500, headers: CORS_HEADERS },
        );
      }

      // Signal laptop real-time listener by updating token created_at timestamp
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
        filename: file.name,
        size: file.size,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "PDF sent successfully.",
        fileId: uploadedResults[0].fileId,
        filename: uploadedResults[0].filename,
        size: uploadedResults[0].size,
        files: uploadedResults,
      }),
      { status: 200, headers: CORS_HEADERS },
    );
  } catch (err) {
    console.error("Mobile upload handler error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: (err as Error).message || "Upload failed — server error.",
      }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
}
