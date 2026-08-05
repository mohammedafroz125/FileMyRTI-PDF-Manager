import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  FileText,
  Image as ImageIcon,
  X,
  RotateCw,
  Replace,
  Eye,
  Trash2,
} from "lucide-react";

import { type PageSticker } from "@/lib/stickers";
import { StickerLayerManager } from "./stickers/StickerLayerManager";

type Props = {
  id: string;
  label: string;
  sublabel?: string;
  thumbnail: string | null;
  loading?: boolean;
  kind: "original" | "pdf" | "image";
  rotation?: number;
  isSelected?: boolean;
  stickers?: PageSticker[];
  /** Lazy loader; called once when the thumb enters viewport if `thumbnail` is null. */
  getThumbnail?: () => Promise<string | null>;
  onDelete?: (id: string) => void;
  onRotate?: (id: string) => void;
  onReplace?: (id: string) => void;
  onExpand?: (id: string) => void;
  onUpdateStickers?: (entryId: string, updatedStickers: PageSticker[]) => void;
  onUpdateSticker?: (entryId: string, updatedSticker: PageSticker) => void;
  onRemoveSticker?: (entryId: string, stickerId: string) => void;
};

import React, { useEffect, useRef, useState } from "react";

export const PageThumb = React.memo(function PageThumb({
  id,
  label,
  sublabel,
  thumbnail,
  loading,
  kind,
  rotation = 0,
  isSelected = false,
  stickers = [],
  getThumbnail,
  onDelete,
  onRotate,
  onReplace,
  onExpand,
  onUpdateStickers,
  onUpdateSticker,
  onRemoveSticker,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const badgeColor =
    kind === "original"
      ? "bg-blue-600 text-white"
      : kind === "pdf"
        ? "bg-emerald-600 text-white"
        : "bg-amber-500 text-white";

  const badgeText =
    kind === "original" ? "Original" : kind === "pdf" ? "PDF" : "Image";
  const FallbackIcon = kind === "image" ? ImageIcon : FileText;

  // Lazy-load thumbnail on first visibility.
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [lazyThumb, setLazyThumb] = useState<string | null>(null);
  const [lazyLoading, setLazyLoading] = useState(false);
  const requestedRef = useRef(false);

  useEffect(() => {
    if (thumbnail || !getThumbnail || requestedRef.current) return;
    const el = outerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // Fallback: load immediately.
      requestedRef.current = true;
      setLazyLoading(true);
      getThumbnail()
        .then((u) => setLazyThumb(u))
        .finally(() => setLazyLoading(false));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !requestedRef.current) {
            requestedRef.current = true;
            setLazyLoading(true);
            getThumbnail()
              .then((u) => setLazyThumb(u))
              .finally(() => setLazyLoading(false));
            io.disconnect();
            break;
          }
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [thumbnail, getThumbnail]);

  const shownThumb = thumbnail ?? lazyThumb;
  const shownLoading = loading || (lazyLoading && !shownThumb);

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    outerRef.current = node;
  };

  return (
    <div
      ref={setRefs}
      style={style}
      {...attributes}
      {...listeners}
      onDoubleClick={() => onExpand?.(id)}
      className={`group relative flex cursor-grab touch-none flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg active:cursor-grabbing ${
        isSelected
          ? "border-blue-600 ring-2 ring-blue-500/40 shadow-md bg-blue-50/20"
          : "border-slate-200/90 hover:border-blue-400/80"
      }`}
    >
      <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden bg-slate-50/70">
        {shownThumb ? (
          <img
            src={shownThumb}
            alt={label}
            loading="lazy"
            className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]"
            style={{ transform: `rotate(${rotation}deg)` }}
          />
        ) : shownLoading ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        ) : (
          <FallbackIcon className="h-8 w-8 text-slate-300" />
        )}
        <span
          className={`absolute left-2 top-2 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-sm ${badgeColor}`}
        >
          {badgeText}
        </span>

        {/* Extensible Sticker Layer Manager (Court Stamp, Seals, etc.) */}
        <StickerLayerManager
          stickers={stickers}
          containerRef={outerRef}
          onChange={(updatedStickers) =>
            onUpdateStickers?.(id, updatedStickers)
          }
        />

        <div className="absolute right-1.5 top-1.5 flex flex-col gap-1.5 opacity-100 md:opacity-0 transition-opacity duration-200 md:group-hover:opacity-100 z-40">
          {onExpand && (
            <IconBtn
              onClick={() => onExpand(id)}
              onPointerDown={stop}
              title="View full screen"
            >
              <Eye className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {onRotate && (
            <IconBtn
              onClick={() => onRotate(id)}
              onPointerDown={stop}
              title="Rotate 90°"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {onReplace && (
            <IconBtn
              onClick={() => onReplace(id)}
              onPointerDown={stop}
              title="Replace page"
            >
              <Replace className="h-3.5 w-3.5" />
            </IconBtn>
          )}
          {onDelete && (
            <IconBtn
              onClick={() => onDelete(id)}
              onPointerDown={stop}
              title="Delete page"
              danger
            >
              <Trash2 className="h-3.5 w-3.5" />
            </IconBtn>
          )}
        </div>
      </div>
      <div className="border-t border-slate-100 bg-white px-2.5 py-2">
        <p className="truncate text-[11px] font-bold text-slate-800 tracking-tight">
          {label}
        </p>
        {sublabel && (
          <p className="truncate text-[10px] font-medium text-slate-400 mt-0.5">
            {sublabel}
          </p>
        )}
      </div>
    </div>
  );
});

function IconBtn({
  children,
  onClick,
  onPointerDown,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`flex min-h-[32px] min-w-[32px] items-center justify-center rounded-xl bg-white/95 backdrop-blur-md p-1.5 shadow-md border border-slate-200/60 transition-all active:scale-90 ${
        danger
          ? "text-red-600 hover:bg-red-50 hover:border-red-200"
          : "text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200"
      }`}
    >
      {children}
    </button>
  );
}
