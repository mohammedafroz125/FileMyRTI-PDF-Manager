import { get, set, del } from "idb-keyval";
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

import { safeRandomUUID } from "@/lib/utils";

const DOCS_KEY = "idb_rti_documents";
const ORIGINALS_PREFIX = "idb_rti_originals:";
const FILES_PREFIX = "idb_rti_files:";
const TOKENS_KEY = "idb_rti_mobile_tokens";

type StoredFileBlob = {
  path: string;
  name: string;
  mime: string;
  blob: Blob;
  createdAt: string;
};

export class IndexedDbStorageAdapter implements IStorageProvider {
  name: "indexeddb" = "indexeddb";

  private async getDocsList(): Promise<RtiDocument[]> {
    try {
      return (await get<RtiDocument[]>(DOCS_KEY)) ?? [];
    } catch {
      return [];
    }
  }

  private async saveDocsList(list: RtiDocument[]): Promise<void> {
    try {
      await set(DOCS_KEY, list);
    } catch (err) {
      console.warn("Failed to write documents list to IndexedDB", err);
    }
  }

  async listDocuments(): Promise<RtiDocument[]> {
    const docs = await this.getDocsList();
    return [...docs].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  async getDocument(id: string): Promise<RtiDocument> {
    const docs = await this.getDocsList();
    const doc = docs.find((d) => d.id === id);
    if (!doc) throw new Error("Document not found");
    return doc;
  }

  private async trackFileKey(key: string): Promise<void> {
    try {
      const keys = (await get<string[]>("idb_file_keys")) ?? [];
      if (!keys.includes(key)) {
        keys.push(key);
        await set("idb_file_keys", keys);
      }
    } catch {
      /* ignore */
    }
  }

  async uploadOriginalFile(docId: string, file: File): Promise<string> {
    const path = `${docId}/originals/${safeRandomUUID()}-${file.name}`;
    const stored: StoredFileBlob = {
      path,
      name: file.name,
      mime: file.type || "application/pdf",
      blob: file,
      createdAt: new Date().toISOString(),
    };
    await set(FILES_PREFIX + path, stored);
    await this.trackFileKey(FILES_PREFIX + path);
    return path;
  }

  async createProjectWithOriginals(
    customerName: string,
    files: File[],
  ): Promise<RtiDocument> {
    if (files.length === 0) throw new Error("At least one PDF is required.");

    const id = safeRandomUUID();
    const first = files[0];
    const firstPath = await this.uploadOriginalFile(id, first);

    const now = new Date().toISOString();
    const newDoc: RtiDocument = {
      id,
      customer_name: customerName.trim(),
      rti_type: "RTI",
      status: "pending",
      original_path: firstPath,
      original_name: first.name,
      edited_path: null,
      final_name: null,
      plan_json: null,
      rti_type_selected: "RTI Application",
      deletion_scheduled_at: null,
      created_at: now,
      updated_at: now,
    };

    const originalsList: RtiOriginal[] = [
      {
        id: safeRandomUUID(),
        document_id: id,
        path: firstPath,
        name: first.name,
        sort_order: 0,
        created_at: now,
      },
    ];

    for (let i = 1; i < files.length; i++) {
      const f = files[i];
      const p = await this.uploadOriginalFile(id, f);
      originalsList.push({
        id: safeRandomUUID(),
        document_id: id,
        path: p,
        name: f.name,
        sort_order: i,
        created_at: now,
      });
    }

    await set(ORIGINALS_PREFIX + id, originalsList);
    const docs = await this.getDocsList();
    docs.unshift(newDoc);
    await this.saveDocsList(docs);
    return newDoc;
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
    const docs = await this.getDocsList();
    const idx = docs.findIndex((d) => d.id === id);
    if (idx < 0) throw new Error("Document not found");

    const updated: RtiDocument = {
      ...docs[idx],
      ...patch,
      updated_at: new Date().toISOString(),
    };

    docs[idx] = updated;
    await this.saveDocsList(docs);
    return updated;
  }

  async deleteDocumentData(id: string): Promise<void> {
    const docs = await this.getDocsList();
    const filtered = docs.filter((d) => d.id !== id);
    await this.saveDocsList(filtered);
    await del(ORIGINALS_PREFIX + id);
  }

  async listOriginals(docId: string): Promise<RtiOriginal[]> {
    try {
      const origs = (await get<RtiOriginal[]>(ORIGINALS_PREFIX + docId)) ?? [];
      return [...origs].sort((a, b) => a.sort_order - b.sort_order);
    } catch {
      return [];
    }
  }

  async uploadItemFile(
    docId: string,
    file: File,
    kind: "pdf" | "image",
  ): Promise<string> {
    const path = `${docId}/items/${safeRandomUUID()}-${file.name}`;
    const stored: StoredFileBlob = {
      path,
      name: file.name,
      mime: file.type || (kind === "pdf" ? "application/pdf" : "image/jpeg"),
      blob: file,
      createdAt: new Date().toISOString(),
    };
    await set(FILES_PREFIX + path, stored);
    await this.trackFileKey(FILES_PREFIX + path);
    return path;
  }

  async uploadEdited(
    docId: string,
    blob: Blob,
    finalName: string,
  ): Promise<string> {
    const path = `${docId}/edited/${Date.now()}-${finalName}`;
    const stored: StoredFileBlob = {
      path,
      name: finalName,
      mime: "application/pdf",
      blob,
      createdAt: new Date().toISOString(),
    };
    await set(FILES_PREFIX + path, stored);
    await this.trackFileKey(FILES_PREFIX + path);
    return path;
  }

  async downloadFromPath(
    path: string,
    filename: string,
    mime: string,
  ): Promise<File> {
    const stored = await get<StoredFileBlob>(FILES_PREFIX + path);
    if (stored && stored.blob) {
      return new File([stored.blob], filename, { type: mime || stored.mime });
    }
    throw new Error(`File not found at path: ${path}`);
  }

  // Drafts
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

  // Mobile Tokens
  private async getTokens(): Promise<MobileToken[]> {
    try {
      return (await get<MobileToken[]>(TOKENS_KEY)) ?? [];
    } catch {
      return [];
    }
  }

  private async saveTokens(tokens: MobileToken[]): Promise<void> {
    try {
      await set(TOKENS_KEY, tokens);
    } catch (err) {
      console.warn("Failed to write mobile tokens to IndexedDB", err);
    }
  }

  async createMobileToken(
    docId: string,
    _ttlMinutes = 120,
  ): Promise<MobileToken> {
    let tokens = await this.getTokens();
    const existing = tokens.find((t) => t.document_id === docId);
    if (existing) return existing;

    const tokenStr =
      safeRandomUUID().replace(/-/g, "") +
      safeRandomUUID().replace(/-/g, "").slice(0, 8);
    const now = new Date().toISOString();
    const expires_at = "2099-12-31T23:59:59.000Z";

    const newToken: MobileToken = {
      id: safeRandomUUID(),
      document_id: docId,
      token: tokenStr,
      expires_at,
      created_at: now,
    };

    tokens.push(newToken);
    await this.saveTokens(tokens);
    return newToken;
  }

  async getOrCreateActiveMobileToken(
    docId: string,
    ttlMinutes = 120,
  ): Promise<MobileToken> {
    const tokens = await this.getTokens();
    const active = tokens.find((t) => t.document_id === docId);
    if (active) return active;
    return this.createMobileToken(docId, ttlMinutes);
  }

  async getTokenInfo(token: string): Promise<MobileToken | null> {
    const tokens = await this.getTokens();
    return tokens.find((t) => t.token === token) ?? null;
  }

  async uploadMobileFile(
    docId: string,
    token: string,
    file: File,
  ): Promise<string> {
    const path = `${docId}/items/${Date.now()}-${safeRandomUUID()}-mobile-${file.name}`;
    const stored: StoredFileBlob = {
      path,
      name: file.name,
      mime: file.type || "application/octet-stream",
      blob: file,
      createdAt: new Date().toISOString(),
    };
    await set(FILES_PREFIX + path, stored);
    await this.trackFileKey(FILES_PREFIX + path);

    const tokens = await this.getTokens();
    const idx = tokens.findIndex((t) => t.token === token);
    if (idx >= 0) {
      tokens[idx].expires_at = new Date(Date.now() + 15 * 60_000).toISOString();
      await this.saveTokens(tokens);
    }
    return path;
  }

  async listMobileUploads(
    docId: string,
  ): Promise<{ name: string; path: string }[]> {
    try {
      const allKeys = (await get<string[]>("idb_file_keys")) ?? [];
      const matches: { name: string; path: string }[] = [];
      const prefix = `${docId}/items/`;
      for (const k of allKeys) {
        if (k.startsWith(FILES_PREFIX + prefix) && k.includes("-mobile-")) {
          const path = k.slice(FILES_PREFIX.length);
          const cleanName = path
            .slice(prefix.length)
            .replace(/^\d+-[a-f0-9-]+-mobile-/, "");
          matches.push({ name: cleanName, path });
        }
      }
      return matches;
    } catch {
      return [];
    }
  }
}
