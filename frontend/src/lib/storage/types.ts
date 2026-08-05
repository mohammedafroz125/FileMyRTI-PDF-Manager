import type {
  RtiDocument,
  RtiOriginal,
  RtiStatus,
  RtiTypeSelected,
  SavedPlan,
  MobileToken,
} from "../rti-storage";
import type { DraftSummary, ManualDraft } from "../manual-drafts";

export type StorageProviderType =
  "indexeddb" | "supabase" | "hybrid" | "generic";

export interface IStorageProvider {
  name: StorageProviderType;

  // Documents & Projects
  listDocuments(): Promise<RtiDocument[]>;
  getDocument(id: string): Promise<RtiDocument>;
  createProjectWithOriginals(
    customerName: string,
    files: File[],
  ): Promise<RtiDocument>;
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
  ): Promise<RtiDocument>;
  deleteDocumentData(id: string): Promise<void>;
  listOriginals(docId: string): Promise<RtiOriginal[]>;

  // Storage File Operations
  uploadOriginalFile(docId: string, file: File): Promise<string>;
  uploadItemFile(
    docId: string,
    file: File,
    kind: "pdf" | "image",
  ): Promise<string>;
  uploadEdited(docId: string, blob: Blob, finalName: string): Promise<string>;
  downloadFromPath(path: string, filename: string, mime: string): Promise<File>;

  // Drafts Operations
  listDrafts(): Promise<DraftSummary[]>;
  loadDraft(id: string): Promise<ManualDraft | null>;
  saveDraft(draft: ManualDraft): Promise<void>;
  renameDraft(id: string, name: string): Promise<void>;
  deleteDraft(id: string): Promise<void>;

  // Mobile Token & QR Uploads
  createMobileToken(docId: string, ttlMinutes?: number): Promise<MobileToken>;
  getOrCreateActiveMobileToken(
    docId: string,
    ttlMinutes?: number,
  ): Promise<MobileToken>;
  getTokenInfo(token: string): Promise<MobileToken | null>;
  uploadMobileFile(docId: string, token: string, file: File): Promise<string>;
  listMobileUploads(docId: string): Promise<{ name: string; path: string }[]>;
}
