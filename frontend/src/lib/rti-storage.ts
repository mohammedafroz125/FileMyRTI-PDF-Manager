import { storageService } from "./storage/storage-service";

export type RtiStatus = "pending" | "waiting_ack" | "completed";
export type RtiTypeSelected =
  "RTI Application" | "First Appeal" | "Second Appeal";

export const ALL_RTI_TYPES: RtiTypeSelected[] = [
  "RTI Application",
  "First Appeal",
  "Second Appeal",
];

export type RtiDocument = {
  id: string;
  customer_name: string;
  rti_type: string;
  status: RtiStatus;
  original_path: string;
  original_name: string;
  edited_path: string | null;
  final_name: string | null;
  plan_json: SavedPlan | null;
  rti_type_selected: RtiTypeSelected | null;
  deletion_scheduled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RtiOriginal = {
  id: string;
  document_id: string;
  path: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type SavedPlanItem = {
  id: string;
  name: string;
  kind: "pdf" | "image";
  path: string;
};

import type { PageSticker } from "./stickers";

export type SavedTimelineEntry =
  | {
      id: string;
      type: "original-page";
      originalId: string;
      pageIndex: number;
      rotation?: number;
      stickers?: PageSticker[];
    }
  | {
      id: string;
      type: "item";
      itemId: string;
      pageIndex?: number;
      rotation?: number;
      stickers?: PageSticker[];
    };

export type SavedPlan = {
  items: SavedPlanItem[];
  timeline: SavedTimelineEntry[];
};

export type MobileToken = {
  id: string;
  document_id: string;
  token: string;
  expires_at: string;
  created_at: string;
};

// Facade delegating to Storage Service Repository
export async function uploadOriginalFile(
  docId: string,
  file: File,
): Promise<string> {
  return storageService.uploadOriginalFile(docId, file);
}

export async function createProjectWithOriginals(
  customerName: string,
  files: File[],
): Promise<RtiDocument> {
  return storageService.createProjectWithOriginals(customerName, files);
}

export async function listOriginals(docId: string): Promise<RtiOriginal[]> {
  return storageService.listOriginals(docId);
}

export async function listDocuments(): Promise<RtiDocument[]> {
  return storageService.listDocuments();
}

export async function getDocument(id: string): Promise<RtiDocument> {
  return storageService.getDocument(id);
}

export async function downloadFromPath(
  path: string,
  filename: string,
  mime: string,
): Promise<File> {
  return storageService.downloadFromPath(path, filename, mime);
}

export async function uploadItemFile(
  docId: string,
  file: File,
  kind: "pdf" | "image",
): Promise<string> {
  return storageService.uploadItemFile(docId, file, kind);
}

export async function uploadEdited(
  docId: string,
  blob: Blob,
  finalName: string,
): Promise<string> {
  return storageService.uploadEdited(docId, blob, finalName);
}

export async function updateDocument(
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
  return storageService.updateDocument(id, patch);
}

export async function deleteDocumentData(id: string): Promise<void> {
  return storageService.deleteDocumentData(id);
}

export async function loadItemFile(item: SavedPlanItem): Promise<File> {
  const mime =
    item.kind === "pdf"
      ? "application/pdf"
      : item.name.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg";
  return storageService.downloadFromPath(item.path, item.name, mime);
}

export async function createMobileToken(
  docId: string,
  ttlMinutes = 120,
): Promise<MobileToken> {
  return storageService.createMobileToken(docId, ttlMinutes);
}

export async function getOrCreateActiveMobileToken(
  docId: string,
  ttlMinutes = 120,
): Promise<MobileToken> {
  return storageService.getOrCreateActiveMobileToken(docId, ttlMinutes);
}

export async function getTokenInfo(token: string): Promise<MobileToken | null> {
  return storageService.getTokenInfo(token);
}

export async function uploadMobileFile(
  docId: string,
  token: string,
  file: File,
): Promise<string> {
  return storageService.uploadMobileFile(docId, token, file);
}

export async function listMobileUploads(
  docId: string,
): Promise<{ name: string; path: string }[]> {
  return storageService.listMobileUploads(docId);
}
