import { get, set, del } from "idb-keyval";
import { safeRandomUUID } from "./utils";

export type StickerType = "court_stamp" | string;

export type StickerTemplate = {
  id: string;
  type: StickerType;
  name: string;
  imageDataUrl: string;
  defaultX: number; // percentage (0 - 100)
  defaultY: number; // percentage (0 - 100)
  defaultWidth: number; // percentage (0 - 100)
  defaultHeight: number; // percentage (0 - 100)
  updatedAt: string;
};

export type PageSticker = {
  id: string;
  type: StickerType;
  templateId: string;
  imageDataUrl: string;
  x: number; // percentage (0 - 100)
  y: number; // percentage (0 - 100)
  width: number; // percentage (0 - 100)
  height: number; // percentage (0 - 100)
  rotation?: number;
};

const STICKER_TEMPLATE_PREFIX = "idb_sticker_template:";

export const DEFAULT_COURT_STAMP_POSITION = {
  defaultX: 74,
  defaultY: 2,
  defaultWidth: 24,
  defaultHeight: 18,
};

/** Fetch saved Court Stamp template from IndexedDB. */
export async function getCourtStampTemplate(): Promise<StickerTemplate | null> {
  return getStickerTemplate("court_stamp");
}

/** Fetch saved sticker template by type from IndexedDB. */
export async function getStickerTemplate(
  type: StickerType,
): Promise<StickerTemplate | null> {
  try {
    const template = await get<StickerTemplate>(STICKER_TEMPLATE_PREFIX + type);
    return template ?? null;
  } catch {
    return null;
  }
}

/** Save or update a sticker template in IndexedDB. */
export async function saveStickerTemplate(
  template: StickerTemplate,
): Promise<void> {
  await set(STICKER_TEMPLATE_PREFIX + template.type, template);
}

/** Delete a sticker template from IndexedDB. */
export async function deleteStickerTemplate(
  type: StickerType = "court_stamp",
): Promise<void> {
  await del(STICKER_TEMPLATE_PREFIX + type);
}

/** Helper: Convert File to Base64 Data URL for persistent storage in IndexedDB. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}
