import React, { useState, useRef, useEffect, useCallback } from "react";
import { BookmarkCheck, Copy, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import {
  type PageSticker,
  saveStickerTemplate,
  getStickerTemplate,
} from "@/lib/stickers";
import { safeRandomUUID } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  stickers: PageSticker[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (updatedStickers: PageSticker[]) => void;
  readOnly?: boolean;
};

type ResizeHandle = "tl" | "tr" | "bl" | "br";

export function StickerLayerManager({
  stickers,
  containerRef,
  onChange,
  readOnly = false,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Deselect sticker when clicking outside container
  useEffect(() => {
    if (readOnly) return;
    const handleGlobalClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setSelectedId(null);
      }
    };
    window.addEventListener("mousedown", handleGlobalClick);
    return () => window.removeEventListener("mousedown", handleGlobalClick);
  }, [containerRef, readOnly]);

  const handleUpdateSticker = useCallback(
    (updated: PageSticker) => {
      onChange(stickers.map((s) => (s.id === updated.id ? updated : s)));
    },
    [stickers, onChange],
  );

  const handleRemoveSticker = useCallback(
    (stickerId: string) => {
      onChange(stickers.filter((s) => s.id !== stickerId));
      if (selectedId === stickerId) setSelectedId(null);
    },
    [stickers, onChange, selectedId],
  );

  const handleDuplicateSticker = useCallback(
    (sticker: PageSticker) => {
      const clone: PageSticker = {
        ...sticker,
        id: `sticker_${safeRandomUUID()}`,
        x: Math.min(80, sticker.x + 4),
        y: Math.min(80, sticker.y + 4),
      };
      onChange([...stickers, clone]);
      setSelectedId(clone.id);
      toast.success("Sticker duplicated!");
    },
    [stickers, onChange],
  );

  const handleBringForward = useCallback(
    (stickerId: string) => {
      const idx = stickers.findIndex((s) => s.id === stickerId);
      if (idx < stickers.length - 1) {
        const next = [...stickers];
        const [moved] = next.splice(idx, 1);
        next.push(moved);
        onChange(next);
      }
    },
    [stickers, onChange],
  );

  const handleSendBackward = useCallback(
    (stickerId: string) => {
      const idx = stickers.findIndex((s) => s.id === stickerId);
      if (idx > 0) {
        const next = [...stickers];
        const [moved] = next.splice(idx, 1);
        next.unshift(moved);
        onChange(next);
      }
    },
    [stickers, onChange],
  );

  const handleUpdateDefaultPosition = useCallback(
    async (sticker: PageSticker) => {
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
          toast.success("Updated default Court Stamp placement & size!");
        }
      } catch {
        toast.error("Failed to update default position.");
      }
    },
    [],
  );

  return (
    <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
      {stickers.map((sticker, index) => (
        <SingleStickerItem
          key={sticker.id}
          sticker={sticker}
          zIndex={index + 1}
          isSelected={selectedId === sticker.id}
          onSelect={() => setSelectedId(sticker.id)}
          containerRef={containerRef}
          onChange={handleUpdateSticker}
          onRemove={() => handleRemoveSticker(sticker.id)}
          onDuplicate={() => handleDuplicateSticker(sticker)}
          onBringForward={() => handleBringForward(sticker.id)}
          onSendBackward={() => handleSendBackward(sticker.id)}
          onUpdateDefault={() => handleUpdateDefaultPosition(sticker)}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function SingleStickerItem({
  sticker,
  zIndex,
  isSelected,
  onSelect,
  containerRef,
  onChange,
  onRemove,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onUpdateDefault,
  readOnly,
}: {
  sticker: PageSticker;
  zIndex: number;
  isSelected: boolean;
  onSelect: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (updated: PageSticker) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onUpdateDefault: () => void;
  readOnly: boolean;
}) {
  // High-performance local position state (does not trigger parent re-renders while dragging)
  const [pos, setPos] = useState({
    x: sticker.x,
    y: sticker.y,
    width: sticker.width,
    height: sticker.height,
  });

  const isInteractingRef = useRef(false);

  // Sync with prop changes from outside (e.g., initial load, reset)
  useEffect(() => {
    if (!isInteractingRef.current) {
      setPos({
        x: sticker.x,
        y: sticker.y,
        width: sticker.width,
        height: sticker.height,
      });
    }
  }, [sticker.x, sticker.y, sticker.width, sticker.height]);

  const [isDragging, setIsDragging] = useState(false);
  const [activeResizeHandle, setActiveResizeHandle] =
    useState<ResizeHandle | null>(null);

  const posRef = useRef(pos);
  posRef.current = pos;

  const startRef = useRef<{
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

  const animFrameRef = useRef<number | null>(null);

  // Drag Start
  const handleDragStart = (e: React.PointerEvent) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    setIsDragging(true);
    isInteractingRef.current = true;

    startRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: posRef.current.x,
      startY: posRef.current.y,
      startW: posRef.current.width,
      startH: posRef.current.height,
    };
  };

  // Resize Start (Corner Handles)
  const handleResizeStart = (e: React.PointerEvent, handle: ResizeHandle) => {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    setActiveResizeHandle(handle);
    isInteractingRef.current = true;

    startRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: posRef.current.x,
      startY: posRef.current.y,
      startW: posRef.current.width,
      startH: posRef.current.height,
    };
  };

  // Global Pointer Listeners for 60 FPS GPU-Accelerated Movement
  useEffect(() => {
    if (!isDragging && !activeResizeHandle) return;

    const handlePointerMove = (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      animFrameRef.current = requestAnimationFrame(() => {
        const deltaX =
          ((e.clientX - startRef.current.mouseX) / rect.width) * 100;
        const deltaY =
          ((e.clientY - startRef.current.mouseY) / rect.height) * 100;

        let { startX, startY, startW, startH } = startRef.current;
        let nextX = startX;
        let nextY = startY;
        let nextW = startW;
        let nextH = startH;

        if (isDragging) {
          nextX = Math.max(0, Math.min(100 - startW, startX + deltaX));
          nextY = Math.max(0, Math.min(100 - startH, startY + deltaY));
        } else if (activeResizeHandle) {
          switch (activeResizeHandle) {
            case "br":
              nextW = Math.max(4, Math.min(100 - startX, startW + deltaX));
              nextH = Math.max(4, Math.min(100 - startY, startH + deltaY));
              break;
            case "bl":
              nextW = Math.max(4, startW - deltaX);
              nextX = Math.max(0, startX + (startW - nextW));
              nextH = Math.max(4, Math.min(100 - startY, startH + deltaY));
              break;
            case "tr":
              nextW = Math.max(4, Math.min(100 - startX, startW + deltaX));
              nextH = Math.max(4, startH - deltaY);
              nextY = Math.max(0, startY + (startH - nextH));
              break;
            case "tl":
              nextW = Math.max(4, startW - deltaX);
              nextX = Math.max(0, startX + (startW - nextW));
              nextH = Math.max(4, startH - deltaY);
              nextY = Math.max(0, startY + (startH - nextH));
              break;
          }
        }

        setPos({
          x: Math.round(nextX * 10) / 10,
          y: Math.round(nextY * 10) / 10,
          width: Math.round(nextW * 10) / 10,
          height: Math.round(nextH * 10) / 10,
        });
      });
    };

    const handlePointerUp = () => {
      setIsDragging(false);
      setActiveResizeHandle(null);
      isInteractingRef.current = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      // Commit final position to document plan when interaction finishes
      onChange({
        ...sticker,
        x: posRef.current.x,
        y: posRef.current.y,
        width: posRef.current.width,
        height: posRef.current.height,
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isDragging, activeResizeHandle, containerRef, sticker, onChange]);

  return (
    <div
      style={{
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        width: `${pos.width}%`,
        height: `${pos.height}%`,
        zIndex,
      }}
      onClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        onSelect();
      }}
      className={`absolute select-none pointer-events-auto transition-shadow ${
        readOnly
          ? "pointer-events-none"
          : isSelected || isDragging || activeResizeHandle
            ? "cursor-move ring-1 ring-blue-500 border border-blue-600"
            : "hover:border hover:border-blue-400/60 border border-transparent"
      }`}
    >
      {/* Real Scanned Stamp Image (Transparent Multiply Blending, No Shadow/Border) */}
      <img
        src={sticker.imageDataUrl}
        alt="Court Stamp"
        style={{ mixBlendMode: "multiply" }}
        className="h-full w-full object-contain pointer-events-none select-none"
      />

      {/* Canva/Figma-Style Selection Controls (Only Visible When Selected) */}
      {!readOnly && (isSelected || isDragging || activeResizeHandle) && (
        <>
          {/* Floating Figma-Style Context Toolbar */}
          <div
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute -top-9 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-lg bg-slate-900/95 p-1 text-white shadow-xl whitespace-nowrap z-50 animate-in fade-in zoom-in-95 duration-100"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUpdateDefault();
              }}
              title="Set current position & size as default"
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              <BookmarkCheck className="h-3 w-3" /> Save Default
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              title="Duplicate"
              className="rounded p-1 hover:bg-white/20 text-slate-200 transition-colors"
            >
              <Copy className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBringForward();
              }}
              title="Bring Forward"
              className="rounded p-1 hover:bg-white/20 text-slate-200 transition-colors"
            >
              <ArrowUp className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSendBackward();
              }}
              title="Send Backward"
              className="rounded p-1 hover:bg-white/20 text-slate-200 transition-colors"
            >
              <ArrowDown className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              title="Delete"
              className="rounded p-1 hover:bg-red-600 text-slate-200 hover:text-white transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>

          {/* 4 Corner Resize Handles (Top-Left, Top-Right, Bottom-Left, Bottom-Right) */}
          <div
            onPointerDown={(e) => handleResizeStart(e, "tl")}
            className="absolute -top-1.5 -left-1.5 h-3 w-3 bg-white border-1.5 border-blue-600 shadow-sm rounded-sm cursor-nwse-resize hover:scale-125 z-40"
          />
          <div
            onPointerDown={(e) => handleResizeStart(e, "tr")}
            className="absolute -top-1.5 -right-1.5 h-3 w-3 bg-white border-1.5 border-blue-600 shadow-sm rounded-sm cursor-nesw-resize hover:scale-125 z-40"
          />
          <div
            onPointerDown={(e) => handleResizeStart(e, "bl")}
            className="absolute -bottom-1.5 -left-1.5 h-3 w-3 bg-white border-1.5 border-blue-600 shadow-sm rounded-sm cursor-nesw-resize hover:scale-125 z-40"
          />
          <div
            onPointerDown={(e) => handleResizeStart(e, "br")}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 bg-white border-1.5 border-blue-600 shadow-sm rounded-sm cursor-nwse-resize hover:scale-125 z-40"
          />

          {/* Drag Overlay Handle */}
          <div
            onPointerDown={handleDragStart}
            className="absolute inset-0 cursor-move"
          />
        </>
      )}
    </div>
  );
}
