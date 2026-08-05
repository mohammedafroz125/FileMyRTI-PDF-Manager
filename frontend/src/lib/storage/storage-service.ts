import type { IStorageProvider, StorageProviderType } from "./types";
import { SupabaseStorageAdapter } from "./adapters/supabase-adapter";
import { IndexedDbStorageAdapter } from "./adapters/indexeddb-adapter";
import { GenericDbStorageAdapter } from "./adapters/generic-adapter";
import type {
  RtiDocument,
  RtiOriginal,
  RtiStatus,
  RtiTypeSelected,
  SavedPlan,
  MobileToken,
} from "../rti-storage";
import type { DraftSummary, ManualDraft } from "../manual-drafts";

class StorageServiceManager implements IStorageProvider {
  private activeAdapter: IStorageProvider;
  public readonly name: StorageProviderType;

  constructor() {
    const envProvider = (
      import.meta.env.VITE_STORAGE_PROVIDER as string | undefined
    )?.toLowerCase();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
      string | undefined;
    const genericApiUrl = import.meta.env.VITE_GENERIC_API_URL as
      string | undefined;

    if (
      envProvider === "supabase" ||
      (!envProvider && supabaseUrl && supabaseKey)
    ) {
      this.activeAdapter = new SupabaseStorageAdapter();
      this.name = "supabase";
    } else if (envProvider === "generic" || (!envProvider && genericApiUrl)) {
      this.activeAdapter = new GenericDbStorageAdapter(genericApiUrl);
      this.name = "generic";
    } else {
      this.activeAdapter = new SupabaseStorageAdapter();
      this.name = "supabase";
    }
  }

  get provider(): IStorageProvider {
    return this.activeAdapter;
  }

  // Delegate all operations to active provider
  listDocuments(): Promise<RtiDocument[]> {
    return this.activeAdapter.listDocuments();
  }

  getDocument(id: string): Promise<RtiDocument> {
    return this.activeAdapter.getDocument(id);
  }

  createProjectWithOriginals(
    customerName: string,
    files: File[],
  ): Promise<RtiDocument> {
    return this.activeAdapter.createProjectWithOriginals(customerName, files);
  }

  updateDocument(
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
    return this.activeAdapter.updateDocument(id, patch);
  }

  deleteDocumentData(id: string): Promise<void> {
    return this.activeAdapter.deleteDocumentData(id);
  }

  listOriginals(docId: string): Promise<RtiOriginal[]> {
    return this.activeAdapter.listOriginals(docId);
  }

  uploadOriginalFile(docId: string, file: File): Promise<string> {
    return this.activeAdapter.uploadOriginalFile(docId, file);
  }

  uploadItemFile(
    docId: string,
    file: File,
    kind: "pdf" | "image",
  ): Promise<string> {
    return this.activeAdapter.uploadItemFile(docId, file, kind);
  }

  uploadEdited(docId: string, blob: Blob, finalName: string): Promise<string> {
    return this.activeAdapter.uploadEdited(docId, blob, finalName);
  }

  downloadFromPath(
    path: string,
    filename: string,
    mime: string,
  ): Promise<File> {
    return this.activeAdapter.downloadFromPath(path, filename, mime);
  }

  listDrafts(): Promise<DraftSummary[]> {
    return this.activeAdapter.listDrafts();
  }

  loadDraft(id: string): Promise<ManualDraft | null> {
    return this.activeAdapter.loadDraft(id);
  }

  saveDraft(draft: ManualDraft): Promise<void> {
    return this.activeAdapter.saveDraft(draft);
  }

  renameDraft(id: string, name: string): Promise<void> {
    return this.activeAdapter.renameDraft(id, name);
  }

  deleteDraft(id: string): Promise<void> {
    return this.activeAdapter.deleteDraft(id);
  }

  createMobileToken(docId: string, ttlMinutes?: number): Promise<MobileToken> {
    return this.activeAdapter.createMobileToken(docId, ttlMinutes);
  }

  getOrCreateActiveMobileToken(
    docId: string,
    ttlMinutes?: number,
  ): Promise<MobileToken> {
    return this.activeAdapter.getOrCreateActiveMobileToken(docId, ttlMinutes);
  }

  getTokenInfo(token: string): Promise<MobileToken | null> {
    return this.activeAdapter.getTokenInfo(token);
  }

  uploadMobileFile(docId: string, token: string, file: File): Promise<string> {
    return this.activeAdapter.uploadMobileFile(docId, token, file);
  }

  listMobileUploads(docId: string): Promise<{ name: string; path: string }[]> {
    return this.activeAdapter.listMobileUploads(docId);
  }
}

export const storageService = new StorageServiceManager();
