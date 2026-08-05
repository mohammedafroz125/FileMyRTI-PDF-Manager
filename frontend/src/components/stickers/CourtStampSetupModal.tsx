import React, { useState, useRef } from "react";
import { X, Upload, Check, Stamp, AlertCircle } from "lucide-react";
import {
  type StickerTemplate,
  saveStickerTemplate,
  fileToBase64,
  DEFAULT_COURT_STAMP_POSITION,
} from "@/lib/stickers";
import { safeRandomUUID } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (template: StickerTemplate) => void;
};

export function CourtStampSetupModal({ isOpen, onClose, onSave }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default position state
  const [posX, setPosX] = useState(DEFAULT_COURT_STAMP_POSITION.defaultX);
  const [posY, setPosY] = useState(DEFAULT_COURT_STAMP_POSITION.defaultY);
  const [posW, setPosW] = useState(DEFAULT_COURT_STAMP_POSITION.defaultWidth);
  const [posH, setPosH] = useState(DEFAULT_COURT_STAMP_POSITION.defaultHeight);

  const previewBoxRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    if (!/\.(png|jpe?g|webp)$/i.test(f.name) && !f.type.startsWith("image/")) {
      setError("Please select a valid image file (.png or .jpg).");
      return;
    }

    setError(null);
    setFile(f);
    try {
      const b64 = await fileToBase64(f);
      setPreviewUrl(b64);
    } catch {
      setError("Failed to read image file.");
    }
  };

  const handleSave = async () => {
    if (!previewUrl) {
      setError("Please upload a Court Stamp image first.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const template: StickerTemplate = {
        id: `template_court_stamp_${safeRandomUUID()}`,
        type: "court_stamp",
        name: "Court Stamp",
        imageDataUrl: previewUrl,
        defaultX: posX,
        defaultY: posY,
        defaultWidth: posW,
        defaultHeight: posH,
        updatedAt: new Date().toISOString(),
      };

      await saveStickerTemplate(template);
      toast.success("Court Stamp template saved locally!");
      onSave(template);
      onClose();
    } catch (err) {
      setError(
        (err as Error).message ?? "Failed to save Court Stamp template.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 animate-fade-in">
      <div className="relative flex flex-col rounded-2xl bg-white p-6 shadow-2xl max-w-lg w-full">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Stamp className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800">
                Court Stamp First-Time Setup
              </h2>
              <p className="text-xs text-slate-500">
                Upload your Court Stamp once to add it to any RTI with 1 click.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Upload & Interactive Preview Area */}
        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />

          {!previewUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-blue-50/50 transition-all"
            >
              <Upload className="h-10 w-10 text-blue-500 mb-2 animate-bounce" />
              <p className="text-sm font-bold text-slate-700">
                Upload Court Stamp Image
              </p>
              <p className="text-xs text-slate-400 mt-1">
                PNG or JPG with transparent/white background
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Interactive Preview (Default Placement)</span>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-blue-600 hover:underline"
                >
                  Change Image
                </button>
              </div>

              {/* Simulated Page Box */}
              <div
                ref={previewBoxRef}
                className="relative aspect-[3/4] w-full max-h-[260px] rounded-xl border border-slate-300 bg-white p-2 shadow-inner overflow-hidden mx-auto"
              >
                <div className="absolute inset-0 p-3 opacity-20 pointer-events-none flex flex-col justify-between text-[10px]">
                  <p className="font-bold border-b pb-1">
                    Sample RTI Document Page
                  </p>
                  <p className="text-center">Page Body Content</p>
                  <p className="text-right">Page Footer</p>
                </div>

                {/* Stamp Graphic */}
                <div
                  style={{
                    left: `${posX}%`,
                    top: `${posY}%`,
                    width: `${posW}%`,
                    height: `${posH}%`,
                  }}
                  className="absolute border-2 border-blue-500 bg-blue-50/20 p-0.5 rounded shadow-md flex items-center justify-center pointer-events-none"
                >
                  <img
                    src={previewUrl}
                    alt="Court Stamp"
                    className="h-full w-full object-contain"
                  />
                  <span className="absolute -top-4 right-0 bg-blue-600 text-white text-[8px] font-bold px-1 rounded">
                    Top Right
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-700 font-medium">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!previewUrl || saving}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-bold text-white shadow hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            <Check className="h-4 w-4" /> Save as Default
          </button>
        </div>
      </div>
    </div>
  );
}
