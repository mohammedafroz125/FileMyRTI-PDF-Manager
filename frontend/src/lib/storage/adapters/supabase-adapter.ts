import { supabase } from "@/integrations/supabase/client";
import type { IStorageProvider } from "../types";
import type {
  RtiDocument,
  RtiOriginal,
  RtiStatus,
  RtiTypeSelected,
  SavedPlan,
  MobileToken,
} from "../../rti-storage";
import type { DraftSummary, ManualDraft } from "../../manual-drafts";
import {
  listDrafts as listIdbDrafts,
  loadDraft as loadIdbDraft,
  saveDraft as saveIdbDraft,
  renameDraft as renameIdbDraft,
  deleteDraft as deleteIdbDraft,
} from "../../manual-drafts";
import { IndexedDbStorageAdapter } from "./indexeddb-adapter";
import { safeRandomUUID } from "@/lib/utils";

const BUCKET = "rti-files";

function slugify(s: string) {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "file"
  );
}

function normalizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[^/.]+$/, "") // strip extension
    .replace(/^[0-9]+-/, "") // strip leading order digits like "0-"
    .replace(/^[a-f0-9-]{36}-/, "") // strip leading UUID prefix
    .replace(/[^a-z0-9]/g, ""); // strip non-alphanumeric chars
}

function mimeForItem(kind: "pdf" | "image", name: string) {
  if (kind === "pdf") return "application/pdf";
  return name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string,
): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}

export class SupabaseStorageAdapter implements IStorageProvider {
  name: "supabase" = "supabase";
  private fallbackAdapter = new IndexedDbStorageAdapter();

  async listDocuments(): Promise<RtiDocument[]> {
    const localDocs = await this.fallbackAdapter.listDocuments();
    try {
      const { data } = await supabase
        .from("rti_documents")
        .select("*")
        .order("created_at", { ascending: false });
      const cloudDocs = (data ?? []) as RtiDocument[];
      const mergedMap = new Map<string, RtiDocument>();
      for (const d of cloudDocs) mergedMap.set(d.id, d);
      for (const d of localDocs)
        if (!mergedMap.has(d.id)) mergedMap.set(d.id, d);
      return Array.from(mergedMap.values()).sort((a, b) =>
        a.created_at < b.created_at ? 1 : -1,
      );
    } catch {
      return localDocs;
    }
  }

  async getDocument(id: string): Promise<RtiDocument> {
    try {
      return await this.fallbackAdapter.getDocument(id);
    } catch {
      const { data, error } = await supabase
        .from("rti_documents")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as RtiDocument;
    }
  }

  async uploadOriginalFile(docId: string, file: File): Promise<string> {
    const localPath = await this.fallbackAdapter.uploadOriginalFile(
      docId,
      file,
    );
    const path = `${docId}/originals/${crypto.randomUUID()}-${slugify(file.name)}.pdf`;
    (async () => {
      try {
        await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            contentType: "application/pdf",
            upsert: false,
          });
      } catch {
        /* ignore background error */
      }
    })();
    return localPath;
  }

  private async uploadTempOriginal(file: File): Promise<string> {
    const path = `_incoming/${crypto.randomUUID()}-${slugify(file.name)}.pdf`;
    const timeoutMs = Math.max(
      60000,
      Math.ceil(file.size / (1024 * 1024)) * 4000,
    );
    const { error } = await withTimeout(
      supabase.storage.from(BUCKET).upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      }),
      timeoutMs,
      `Upload of "${file.name}" timed out.`,
    );
    if (error) throw error;
    return path;
  }

  private async moveObject(from: string, to: string): Promise<string> {
    try {
      const { error } = await supabase.storage.from(BUCKET).move(from, to);
      if (error) return from;
      return to;
    } catch {
      return from;
    }
  }

  private async asyncCloudSync(
    customerName: string,
    files: File[],
    docId: string,
  ): Promise<void> {
    try {
      const first = files[0];
      const firstPath = await this.uploadTempOriginal(first);
      const { data: doc, error: docErr } = await supabase
        .from("rti_documents")
        .insert({
          id: docId,
          customer_name: customerName.trim(),
          rti_type: "RTI",
          status: "pending",
          original_path: firstPath,
          original_name: first.name,
        })
        .select()
        .single();
      if (docErr) return;

      const rows: Omit<RtiOriginal, "id" | "created_at">[] = [];
      const finalFirstPath = await this.moveObject(
        firstPath,
        `${doc.id}/originals/0-${slugify(first.name)}.pdf`,
      );
      rows.push({
        document_id: doc.id,
        path: finalFirstPath,
        name: first.name,
        sort_order: 0,
      });

      for (let i = 1; i < files.length; i++) {
        const f = files[i];
        const path = `${doc.id}/originals/${i}-${slugify(f.name)}.pdf`;
        await supabase.storage
          .from(BUCKET)
          .upload(path, f, { contentType: "application/pdf", upsert: false });
        rows.push({ document_id: doc.id, path, name: f.name, sort_order: i });
      }

      await supabase.from("rti_originals").insert(rows);
      await supabase
        .from("rti_documents")
        .update({ original_path: finalFirstPath, original_name: first.name })
        .eq("id", doc.id);
    } catch (err) {
      console.warn("Async cloud sync background warning:", err);
    }
  }

  async createProjectWithOriginals(
    customerName: string,
    files: File[],
  ): Promise<RtiDocument> {
    if (files.length === 0)
      throw new Error("At least one PDF or document file is required.");

    // 1. Instant local store in IndexedDB (< 0.05 seconds) so project creation finishes IMMEDIATELY
    const localDoc = await this.fallbackAdapter.createProjectWithOriginals(
      customerName,
      files,
    );

    // 2. Asynchronous background cloud sync to Supabase (non-blocking)
    this.asyncCloudSync(customerName, files, localDoc.id).catch((err) => {
      console.warn("Background cloud sync notice (local project active):", err);
    });

    return localDoc;
  }

  async updateDocument(
    id: string,
    patch: Partial<{
      status: RtiStatus;
      edited_path: string;
      final_name: string;
      plan_json: SavedPlan;
      rti_type_selected: RtiTypeSelected;
      deletion_scheduled_at: string | null;
    }>,
  ): Promise<RtiDocument> {
    const updatedLocal = await this.fallbackAdapter.updateDocument(id, patch);
    (async () => {
      try {
        await supabase.from("rti_documents").update(patch).eq("id", id);
      } catch {
        /* ignore background sync error */
      }
    })();
    return updatedLocal;
  }

  async deleteDocumentData(id: string): Promise<void> {
    await this.fallbackAdapter.deleteDocumentData(id);
    (async () => {
      try {
        await supabase.from("rti_documents").delete().eq("id", id);
      } catch {
        /* ignore background sync error */
      }
    })();
  }

  async listOriginals(docId: string): Promise<RtiOriginal[]> {
    try {
      const local = await this.fallbackAdapter.listOriginals(docId);
      if (local && local.length > 0) return local;
    } catch {
      /* ignore */
    }
    const { data } = await supabase
      .from("rti_originals")
      .select("*")
      .eq("document_id", docId)
      .order("sort_order", { ascending: true });
    return (data ?? []) as RtiOriginal[];
  }

  async uploadItemFile(
    docId: string,
    file: File,
    kind: "pdf" | "image",
  ): Promise<string> {
    const localPath = await this.fallbackAdapter.uploadItemFile(
      docId,
      file,
      kind,
    );
    const path = `${docId}/items/${safeRandomUUID()}-${slugify(file.name)}.${kind === "pdf" ? "pdf" : "jpg"}`;
    (async () => {
      try {
        await supabase.storage
          .from(BUCKET)
          .upload(path, file, {
            contentType: mimeForItem(kind, file.name),
            upsert: false,
          });
      } catch {
        /* ignore background sync error */
      }
    })();
    return localPath;
  }

  async uploadEdited(
    docId: string,
    blob: Blob,
    finalName: string,
  ): Promise<string> {
    const localPath = await this.fallbackAdapter.uploadEdited(
      docId,
      blob,
      finalName,
    );
    const path = `${docId}/edited/${safeRandomUUID()}-${slugify(finalName)}.pdf`;
    (async () => {
      try {
        await supabase.storage
          .from(BUCKET)
          .upload(path, blob, {
            contentType: "application/pdf",
            upsert: false,
          });
      } catch {
        /* ignore background sync error */
      }
    })();
    return localPath;
  }

  async downloadFromPath(
    path: string,
    filename: string,
    mime: string,
  ): Promise<File> {
    // 1. Try local IndexedDB first
    try {
      const localFile = await this.fallbackAdapter.downloadFromPath(path, filename, mime);
      if (localFile && localFile.size > 100) return localFile;
    } catch {
      /* ignore local error and fallback to cloud */
    }

    // 2. Try exact path in Supabase Cloud Storage
    try {
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (!error && data && data.size > 100) {
        return new File([data], filename, { type: mime });
      }
    } catch {
      /* ignore */
    }

    // Normalize target filename for fuzzy matching
    const targetNorm = normalizeFileName(filename);

    // 3. Smart Cloud Search: Extract docId from path or check all folders for docId
    const match = path.match(/([a-f0-9-]{36})/i);
    const docId = match ? match[1] : null;

    if (docId) {
      // Search in docId/originals, docId/items, and docId
      for (const folder of [`${docId}/originals`, `${docId}/items`, docId]) {
        try {
          const { data: files } = await supabase.storage
            .from(BUCKET)
            .list(folder, { limit: 100 });
          if (files && files.length > 0) {
            const found =
              files.find((f) => {
                const fNorm = normalizeFileName(f.name);
                return (
                  fNorm === targetNorm ||
                  (fNorm.length > 3 && targetNorm.includes(fNorm)) ||
                  (targetNorm.length > 3 && fNorm.includes(targetNorm))
                );
              }) || files[0]; // fallback to first file if single file in folder

            if (found) {
              const fileKey = `${folder}/${found.name}`;
              const { data: blob, error: dlErr } = await supabase.storage
                .from(BUCKET)
                .download(fileKey);
              if (!dlErr && blob && blob.size > 100) {
                return new File([blob], filename, { type: mime });
              }
            }
          }
        } catch {
          /* ignore */
        }
      }
    }

    // 4. Global Search in BUCKET root and _incoming
    for (const folder of ["_incoming", ""]) {
      try {
        const { data: files } = await supabase.storage
          .from(BUCKET)
          .list(folder, { limit: 100 });
        if (files && files.length > 0) {
          const found = files.find((f) => {
            const fNorm = normalizeFileName(f.name);
            return (
              fNorm === targetNorm ||
              (fNorm.length > 3 && targetNorm.includes(fNorm)) ||
              (targetNorm.length > 3 && fNorm.includes(targetNorm))
            );
          });
          if (found) {
            const fileKey = folder ? `${folder}/${found.name}` : found.name;
            const { data: blob, error: dlErr } = await supabase.storage
              .from(BUCKET)
              .download(fileKey);
            if (!dlErr && blob && blob.size > 100) {
              return new File([blob], filename, { type: mime });
            }
          }
        }
      } catch {
        /* ignore */
      }
    }

    throw new Error(`File "${filename}" could not be downloaded from storage.`);
  }

  async listDrafts(): Promise<DraftSummary[]> {
    return listIdbDrafts();
  }

  async loadDraft(id: string): Promise<ManualDraft | null> {
    return loadIdbDraft(id);
  }

  async saveDraft(draft: ManualDraft): Promise<void> {
    return saveIdbDraft(draft);
  }

  async renameDraft(id: string, name: string): Promise<void> {
    return renameIdbDraft(id, name);
  }

  async deleteDraft(id: string): Promise<void> {
    return deleteIdbDraft(id);
  }

  async createMobileToken(
    docId: string,
    ttlMinutes = 120,
  ): Promise<MobileToken> {
    const localToken = await this.fallbackAdapter.createMobileToken(
      docId,
      ttlMinutes,
    );
    try {
      await supabase.from("rti_mobile_tokens").insert({
        id: localToken.id,
        document_id: docId,
        token: localToken.token,
        expires_at: localToken.expires_at,
        created_at: localToken.created_at,
      });
    } catch {
      /* ignore if cloud DB table offline */
    }
    return localToken;
  }

  async getOrCreateActiveMobileToken(
    docId: string,
    ttlMinutes = 120,
  ): Promise<MobileToken> {
    try {
      const { data } = await supabase
        .from("rti_mobile_tokens")
        .select("*")
        .eq("document_id", docId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (data && data.length > 0) {
        return data[0] as MobileToken;
      }
    } catch {
      /* fallback to local */
    }
    return this.createMobileToken(docId, ttlMinutes);
  }

  async getTokenInfo(token: string): Promise<MobileToken | null> {
    const local = await this.fallbackAdapter.getTokenInfo(token);
    if (local) return local;

    try {
      const { data } = await supabase
        .from("rti_mobile_tokens")
        .select("*")
        .eq("token", token)
        .maybeSingle();
      if (data) return data as MobileToken;
    } catch {
      /* ignore */
    }
    return null;
  }

  async uploadMobileFile(
    docId: string,
    token: string,
    file: File,
  ): Promise<string> {
    const localPath = await this.fallbackAdapter.uploadMobileFile(
      docId,
      token,
      file,
    );
    const cloudPath = `${docId}/items/${Date.now()}-${safeRandomUUID()}-mobile-${file.name}`;
    try {
      const contentType =
        file.type ||
        (file.name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "image/jpeg");
      await supabase.storage
        .from(BUCKET)
        .upload(cloudPath, file, { contentType, upsert: true });
      await supabase
        .from("rti_mobile_tokens")
        .update({
          created_at: new Date().toISOString(),
        })
        .eq("token", token);
    } catch (err) {
      console.warn("Cloud mobile file upload notice:", err);
    }
    return localPath;
  }

  async listMobileUploads(
    docId: string,
  ): Promise<{ name: string; path: string }[]> {
    const localMatches = await this.fallbackAdapter.listMobileUploads(docId);
    const seenPaths = new Set(localMatches.map((m) => m.path));
    const combined = [...localMatches];

    try {
      const { data } = await supabase.storage
        .from(BUCKET)
        .list(`${docId}/items`, {
          limit: 1000,
          sortBy: { column: "created_at", order: "asc" },
        });

      if (data && data.length > 0) {
        for (const f of data) {
          if (f.name.includes("-mobile-")) {
            const path = `${docId}/items/${f.name}`;
            if (!seenPaths.has(path)) {
              seenPaths.add(path);
              const cleanName = f.name.replace(/^\d+-[a-f0-9-]+-mobile-/, "");
              combined.push({ name: cleanName, path });
            }
          }
        }
      }
    } catch {
      /* ignore Supabase list error */
    }

    return combined;
  }
}
