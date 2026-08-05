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
import { IndexedDbStorageAdapter } from "./indexeddb-adapter";

/**
 * Generic Database Adapter.
 * Serves as an extensible template provider for custom REST/GraphQL/Enterprise cloud backends.
 * Delegates to IndexedDB local cache when endpoints are unconfigured.
 */
export class GenericDbStorageAdapter implements IStorageProvider {
  name: "generic" = "generic";
  private fallback: IndexedDbStorageAdapter;

  constructor(
    private baseUrl?: string,
    private apiKey?: string,
  ) {
    this.fallback = new IndexedDbStorageAdapter();
  }

  async listDocuments(): Promise<RtiDocument[]> {
    if (!this.baseUrl) return this.fallback.listDocuments();
    throw new Error("Generic API endpoint listDocuments not configured.");
  }

  async getDocument(id: string): Promise<RtiDocument> {
    if (!this.baseUrl) return this.fallback.getDocument(id);
    throw new Error("Generic API endpoint getDocument not configured.");
  }

  async createProjectWithOriginals(
    customerName: string,
    files: File[],
  ): Promise<RtiDocument> {
    if (!this.baseUrl)
      return this.fallback.createProjectWithOriginals(customerName, files);
    throw new Error(
      "Generic API endpoint createProjectWithOriginals not configured.",
    );
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
    if (!this.baseUrl) return this.fallback.updateDocument(id, patch);
    throw new Error("Generic API endpoint updateDocument not configured.");
  }

  async deleteDocumentData(id: string): Promise<void> {
    if (!this.baseUrl) return this.fallback.deleteDocumentData(id);
    throw new Error("Generic API endpoint deleteDocumentData not configured.");
  }

  async listOriginals(docId: string): Promise<RtiOriginal[]> {
    if (!this.baseUrl) return this.fallback.listOriginals(docId);
    throw new Error("Generic API endpoint listOriginals not configured.");
  }

  async uploadOriginalFile(docId: string, file: File): Promise<string> {
    if (!this.baseUrl) return this.fallback.uploadOriginalFile(docId, file);
    throw new Error("Generic API endpoint uploadOriginalFile not configured.");
  }

  async uploadItemFile(
    docId: string,
    file: File,
    kind: "pdf" | "image",
  ): Promise<string> {
    if (!this.baseUrl) return this.fallback.uploadItemFile(docId, file, kind);
    throw new Error("Generic API endpoint uploadItemFile not configured.");
  }

  async uploadEdited(
    docId: string,
    blob: Blob,
    finalName: string,
  ): Promise<string> {
    if (!this.baseUrl)
      return this.fallback.uploadEdited(docId, blob, finalName);
    throw new Error("Generic API endpoint uploadEdited not configured.");
  }

  async downloadFromPath(
    path: string,
    filename: string,
    mime: string,
  ): Promise<File> {
    if (!this.baseUrl)
      return this.fallback.downloadFromPath(path, filename, mime);
    throw new Error("Generic API endpoint downloadFromPath not configured.");
  }

  async listDrafts(): Promise<DraftSummary[]> {
    return this.fallback.listDrafts();
  }

  async loadDraft(id: string): Promise<ManualDraft | null> {
    return this.fallback.loadDraft(id);
  }

  async saveDraft(draft: ManualDraft): Promise<void> {
    return this.fallback.saveDraft(draft);
  }

  async renameDraft(id: string, name: string): Promise<void> {
    return this.fallback.renameDraft(id, name);
  }

  async deleteDraft(id: string): Promise<void> {
    return this.fallback.deleteDraft(id);
  }

  async createMobileToken(
    docId: string,
    ttlMinutes = 120,
  ): Promise<MobileToken> {
    if (!this.baseUrl)
      return this.fallback.createMobileToken(docId, ttlMinutes);
    throw new Error("Generic API endpoint createMobileToken not configured.");
  }

  async getOrCreateActiveMobileToken(
    docId: string,
    ttlMinutes = 120,
  ): Promise<MobileToken> {
    if (!this.baseUrl)
      return this.fallback.getOrCreateActiveMobileToken(docId, ttlMinutes);
    throw new Error(
      "Generic API endpoint getOrCreateActiveMobileToken not configured.",
    );
  }

  async getTokenInfo(token: string): Promise<MobileToken | null> {
    if (!this.baseUrl) return this.fallback.getTokenInfo(token);
    throw new Error("Generic API endpoint getTokenInfo not configured.");
  }

  async uploadMobileFile(
    docId: string,
    token: string,
    file: File,
  ): Promise<string> {
    if (!this.baseUrl)
      return this.fallback.uploadMobileFile(docId, token, file);
    throw new Error("Generic API endpoint uploadMobileFile not configured.");
  }

  async listMobileUploads(
    docId: string,
  ): Promise<{ name: string; path: string }[]> {
    if (!this.baseUrl) return this.fallback.listMobileUploads(docId);
    throw new Error("Generic API endpoint listMobileUploads not configured.");
  }
}
