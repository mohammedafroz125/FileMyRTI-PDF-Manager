import React, { useState, useRef } from "react";
import {
  X,
  Stamp,
  RefreshCw,
  Trash2,
  Eye,
  RotateCcw,
  Upload,
  AlertCircle,
} from "lucide-react";
import {
  type StickerTemplate,
  saveStickerTemplate,
  deleteStickerTemplate,
  fileToBase64,
  DEFAULT_COURT_STAMP_POSITION,
} from "@/lib/stickers";
import { toast } from "sonner";

type Props = {
  isOpen: boolean;
  template: StickerTemplate | null;
  onClose: () => void;
  onUpdate: (template: StickerTemplate | null) => void;
};

export function CourtStampSettingsModal({
  isOpen,
  template,
  onClose,
  onUpdate,
}: Props) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !template) return null;

  const handleReplaceImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const b64 = await fileToBase64(file);
      const updated: StickerTemplate = {
        ...template,
        imageDataUrl: b64,
        updatedAt: new Date().toISOString(),
      };
      await saveStickerTemplate(updated);
      toast.success("Court Stamp image replaced!");
      onUpdate(updated);
      setIsReplacing(false);
    } catch {
      toast.error("Failed to update Court Stamp image.");
    }
  };

  const handleResetPosition = async () => {
    try {
      const updated: StickerTemplate = {
        ...template,
        defaultX: DEFAULT_COURT_STAMP_POSITION.defaultX,
        defaultY: DEFAULT_COURT_STAMP_POSITION.defaultY,
        defaultWidth: DEFAULT_COURT_STAMP_POSITION.defaultWidth,
        defaultHeight: DEFAULT_COURT_STAMP_POSITION.defaultHeight,
        updatedAt: new Date().toISOString(),
      };
      await saveStickerTemplate(updated);
      toast.success("Reset default position to Top Right Corner!");
      onUpdate(updated);
    } catch {
      toast.error("Failed to reset position.");
    }
  };

  const handleDeleteTemplate = async () => {
    if (
      !confirm(
        "Are you sure you want to delete the saved Court Stamp template? You can re-upload it anytime.",
      )
    )
      return;

    try {
      await deleteStickerTemplate("court_stamp");
      toast.success("Court Stamp template deleted from local storage.");
      onUpdate(null);
      onClose();
    } catch {
      toast.error("Failed to delete template.");
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/80 p-4 animate-fade-in">
        <div className="relative flex flex-col rounded-2xl bg-white p-6 shadow-2xl max-w-sm w-full">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                <Stamp className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">
                  Court Stamp Settings
                </h2>
                <p className="text-xs text-slate-500">
                  Manage saved template & position.
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

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={handleReplaceImage}
          />

          {/* Current Stamp Thumbnail */}
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 bg-white p-1 shadow-sm overflow-hidden flex items-center justify-center">
              <img
                src={template.imageDataUrl}
                alt="Court Stamp"
                className="h-full w-full object-contain"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-xs font-bold text-slate-800 truncate">
                {template.name}
              </p>
              <p className="text-[10px] text-slate-500">
                Default: Top-Right ({template.defaultX}%, {template.defaultY}%)
              </p>
              <p className="text-[9px] text-slate-400">
                Size: {template.defaultWidth}% × {template.defaultHeight}%
              </p>
            </div>
          </div>

          {/* Menu Options */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setIsPreviewOpen(true)}
              className="w-full flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <Eye className="h-4 w-4 text-blue-600" /> Preview Court Stamp
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className="h-4 w-4 text-blue-600" /> Replace Court
              Stamp
            </button>

            <button
              type="button"
              onClick={handleResetPosition}
              className="w-full flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <RotateCcw className="h-4 w-4 text-amber-600" /> Reset Default
              Position
            </button>

            <button
              type="button"
              onClick={handleDeleteTemplate}
              className="w-full flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50/50 px-3.5 py-2.5 text-xs font-semibold text-red-700 shadow-sm hover:bg-red-50 transition-colors"
            >
              <Trash2 className="h-4 w-4 text-red-600" /> Delete Court Stamp
            </button>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-3 text-right">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-800 px-4 py-1.5 text-xs font-bold text-white hover:bg-slate-900 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Full Preview Modal */}
      {isPreviewOpen && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/80 p-4 animate-fade-in"
          onClick={() => setIsPreviewOpen(false)}
        >
          <div
            className="relative rounded-2xl bg-white p-6 shadow-2xl max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-slate-800 mb-3">
              Court Stamp Template Preview
            </h3>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl mb-4 max-h-[300px] flex items-center justify-center">
              <img
                src={template.imageDataUrl}
                alt="Court Stamp Preview"
                className="max-h-[260px] object-contain"
              />
            </div>
            <button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="w-full rounded-lg bg-blue-600 py-2 text-xs font-bold text-white shadow hover:bg-blue-700 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
