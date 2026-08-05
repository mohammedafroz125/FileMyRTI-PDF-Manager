import React, { useState, useRef, useEffect } from "react";
import { Move, Trash2, BookmarkCheck, RotateCw } from "lucide-react";
import {
  type PageSticker,
  saveStickerTemplate,
  getStickerTemplate,
} from "@/lib/stickers";
import { toast } from "sonner";

type Props = {
  sticker: PageSticker;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (updated: PageSticker) => void;
  onRemove: (stickerId: string) => void;
  readOnly?: boolean;
};

export function DraggableStickerOverlay({
  sticker,
  containerRef,
  onChange,
  onRemove,
  readOnly = false,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [isSelected, setIsSelected] = useState(false);

  const startPosRef = useRef<{
    mouseX: number;
    mouseY: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  }>({
    mouseX: 0,
    mouseY: 0,
    startX: sticker.x,
    startY: sticker.y,
    startW: sticker.width,
    startH: sticker.height,
  });

  // Handle Drag Start
  const handlePointerDownDrag = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    setIsSelected(true);
    setIsDragging(true);

    startPosRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: sticker.x,
      startY: sticker.y,
      startW: sticker.width,
      startH: sticker.height,
    };
  };

  // Handle Resize Start
  const handlePointerDownResize = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);

    startPosRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: sticker.x,
      startY: sticker.y,
      startW: sticker.width,
      startH: sticker.height,
    };
  };

  // Global pointer move & up listeners
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const deltaX =
        ((e.clientX - startPosRef.current.mouseX) / rect.width) * 100;
      const deltaY =
        ((e.clientY - startPosRef.current.mouseY) / rect.height) * 100;

      if (isDragging) {
        let newX = Math.max(
          0,
          Math.min(100 - sticker.width, startPosRef.current.startX + deltaX),
        );
        let newY = Math.max(
          0,
          Math.min(100 - sticker.height, startPosRef.current.startY + deltaY),
        );
        onChange({
          ...sticker,
          x: Math.round(newX * 10) / 10,
          y: Math.round(newY * 10) / 10,
        });
      } else if (isResizing) {
        let newW = Math.max(
          5,
          Math.min(100 - sticker.x, startPosRef.current.startW + deltaX),
        );
        let newH = Math.max(
          5,
          Math.min(100 - sticker.y, startPosRef.current.startH + deltaY),
        );
        onChange({
          ...sticker,
          width: Math.round(newW * 10) / 10,
          height: Math.round(newH * 10) / 10,
        });
      }
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [isDragging, isResizing, containerRef, sticker, onChange]);

  // Update default position in IndexedDB
  const handleUpdateDefault = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const t = await getStickerTemplate(sticker.type);
      if (t) {
        await saveStickerTemplate({
          ...t,
          defaultX: sticker.x,
          defaultY: sticker.y,
          defaultWidth: sticker.width,
          defaultHeight: sticker.height,
          updatedAt: new Date().toISOString(),
        });
        toast.success("Updated default Court Stamp position & size!");
      }
    } catch {
      toast.error("Failed to update default position.");
    }
  };

  return (
    <div
      style={{
        left: `${sticker.x}%`,
        top: `${sticker.y}%`,
        width: `${sticker.width}%`,
        height: `${sticker.height}%`,
      }}
      onClick={(e) => {
        e.stopPropagation();
        setIsSelected(true);
      }}
      className={`group absolute z-30 select-none transition-all ${
        readOnly
          ? "pointer-events-none"
          : "cursor-move border-2 " +
            (isSelected || isDragging || isResizing
              ? "border-blue-500 shadow-lg ring-2 ring-blue-500/20"
              : "border-transparent hover:border-blue-400/80")
      }`}
    >
      {/* Sticker Image */}
      <img
        src={sticker.imageDataUrl}
        alt="Court Stamp"
        className="h-full w-full object-contain pointer-events-none drop-shadow-md"
      />

      {/* Action Overlay Bar */}
      {!readOnly && (
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -top-8 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-md bg-slate-900/90 px-1.5 py-1 text-white shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-40"
        >
          <button
            type="button"
            onClick={handleUpdateDefault}
            title="Set current position & size as default"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            <BookmarkCheck className="h-3 w-3" /> Update Default
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(sticker.id);
            }}
            title="Remove from page"
            className="rounded p-1 hover:bg-red-600 text-slate-300 hover:text-white transition-colors"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Resize Handle */}
      {!readOnly && (
        <div
          onPointerDown={handlePointerDownResize}
          title="Drag to resize"
          className="absolute -bottom-1.5 -right-1.5 h-4 w-4 rounded-full bg-blue-600 border-2 border-white shadow cursor-nwse-resize hover:scale-125 transition-transform"
        />
      )}
    </div>
  );
}
