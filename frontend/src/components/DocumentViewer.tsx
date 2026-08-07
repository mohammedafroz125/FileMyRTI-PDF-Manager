import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  RotateCw,
  Download,
  Stamp,
} from "lucide-react";
import { renderPdfPage } from "@/lib/pdf-thumbnails";

import type { PageSticker } from "@/lib/stickers";
import { StickerLayerManager } from "./stickers/StickerLayerManager";

export type ViewerTimelineItem = {
  id: string;
  name: string;
  file: File;
  kind: "pdf" | "image";
  pageIndex: number;
  totalPages: number;
  rotation?: number;
  stickers?: PageSticker[];
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  items: ViewerTimelineItem[];
  initialIndex: number;
  onRotateItem?: (entryId: string) => void;
  onUpdateStickers?: (entryId: string, updatedStickers: PageSticker[]) => void;
  onAddCourtStamp?: (entryId: string) => void;
};

export function DocumentViewer({
  isOpen,
  onClose,
  items,
  initialIndex,
  onRotateItem,
  onUpdateStickers,
  onAddCourtStamp,
}: Props) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1.0);
  const [extraRotation, setExtraRotation] = useState(0);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageWrapperRef = useRef<HTMLDivElement | null>(null);

  // Sync index when initialIndex changes or modal opens
  useEffect(() => {
    setCurrentIndex(initialIndex);
    setExtraRotation(0);
  }, [initialIndex, isOpen]);

  const activeItem = items[currentIndex];
  const effectiveRotation = (activeItem?.rotation ?? 0) % 360;

  // Generate URL for image or render PDF page
  useEffect(() => {
    if (!activeItem) return;

    if (activeItem.kind === "image") {
      setPdfUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    // PDF page rendering
    let active = true;
    setLoading(true);
    setPdfUrl(null);
    setError(null);

    // Render page at scale = 1.5 for high resolution full-screen viewing
    renderPdfPage(
      `viewer-${activeItem.id}-${activeItem.pageIndex}`,
      activeItem.file,
      activeItem.pageIndex,
      1.5,
    )
      .then((url) => {
        if (!active) return;
        if (url) {
          setPdfUrl(url);
        } else {
          setError("Failed to render PDF page.");
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message ?? "Failed to load PDF.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    activeItem?.id,
    activeItem?.kind,
    activeItem?.pageIndex,
    activeItem?.file,
  ]);

  // Object URL for image files
  const imageUrl = useMemo(() => {
    if (!activeItem || activeItem.kind !== "image") return null;
    return URL.createObjectURL(activeItem.file);
  }, [activeItem]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  // Navigation handlers
  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setExtraRotation(0);
    }
  };

  const handleNext = () => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex((i) => i + 1);
      setExtraRotation(0);
    }
  };

  // Rotate handler
  const handleRotate = () => {
    if (!activeItem) return;
    if (onRotateItem) {
      onRotateItem(activeItem.id);
    }
  };

  // Download active item handler
  const handleDownloadCurrent = () => {
    if (!activeItem) return;
    const url =
      activeItem.kind === "image" && imageUrl
        ? imageUrl
        : URL.createObjectURL(activeItem.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeItem.name || `document_page_${currentIndex + 1}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (activeItem.kind !== "image") {
      URL.revokeObjectURL(url);
    }
  };

  // Keyboard navigation & zoom controls
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft" || e.key === "Left") {
        handlePrev();
      } else if (e.key === "ArrowRight" || e.key === "Right") {
        handleNext();
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(5, z + 0.25));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(0.25, z - 0.25));
      } else if (e.key === "0") {
        setZoom(1.0);
      } else if (e.key.toLowerCase() === "r") {
        handleRotate();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, currentIndex, items.length]);

  if (!isOpen || !activeItem) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-slate-950/90 backdrop-blur-md text-white animate-in fade-in zoom-in-95 duration-200"
      role="dialog"
      aria-modal="true"
      ref={containerRef}
    >
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-slate-900/80 backdrop-blur-lg">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs font-bold text-blue-400 border border-blue-500/30">
              {currentIndex + 1} of {items.length}
            </span>
            <p className="truncate text-sm font-bold text-white">
              {activeItem.name}
            </p>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {activeItem.kind === "pdf"
              ? `Page ${activeItem.pageIndex + 1} of ${activeItem.totalPages}`
              : "Image File"}
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {/* 📑 Court Stamp Quick Action Button */}
          <button
            type="button"
            title="Insert Court Stamp onto this page"
            onClick={() => onAddCourtStamp?.(activeItem.id)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white shadow-md hover:bg-blue-700 active:scale-95 transition-all cursor-pointer"
          >
            <Stamp className="h-4 w-4" /> 📑 Court Stamp
          </button>

          <div className="mx-1 h-5 w-px bg-white/15" />

          {/* Rotate */}
          <button
            type="button"
            title="Rotate 90° (R)"
            onClick={handleRotate}
            className="rounded-xl p-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <RotateCw className="h-4 w-4" />
          </button>

          {/* Download Current File */}
          <button
            type="button"
            title="Download current page"
            onClick={handleDownloadCurrent}
            className="rounded-xl p-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <Download className="h-4 w-4" />
          </button>

          {/* Divider */}
          <div className="mx-1 h-5 w-px bg-white/15" />

          {/* Zoom controls */}
          <button
            type="button"
            title="Zoom Out (-)"
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="rounded-xl p-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-12 text-center text-xs font-bold text-slate-300 select-none tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            title="Zoom In (+)"
            onClick={() => setZoom((z) => Math.min(5, z + 0.25))}
            className="rounded-xl p-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Fit to Screen (100%)"
            onClick={() => setZoom(1.0)}
            className="rounded-xl p-2.5 hover:bg-white/10 text-white/80 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <Maximize2 className="h-4 w-4" />
          </button>

          {/* Divider */}
          <div className="mx-1 h-5 w-px bg-white/15" />

          {/* Close */}
          <button
            type="button"
            title="Close Viewer (Esc)"
            onClick={onClose}
            className="rounded-xl bg-white/10 p-2.5 text-white/90 hover:bg-red-600 hover:text-white transition-all active:scale-95 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="relative flex-1 flex items-center justify-between overflow-hidden p-4">
        {/* Left Nav Button */}
        <button
          type="button"
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="absolute left-5 z-20 rounded-full bg-slate-900/80 p-3.5 text-white/90 hover:bg-slate-800 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed border border-white/10 shadow-xl backdrop-blur-md transition-all active:scale-95"
          title="Previous item (←)"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>

        {/* Rendered Document Container */}
        <div className="flex-1 h-full w-full overflow-auto flex items-center justify-center">
          <div
            style={{
              transform: `scale(${zoom}) rotate(${effectiveRotation}deg)`,
              transformOrigin: "center center",
              transition: "transform 0.15s ease-out",
            }}
            className="flex items-center justify-center p-4 max-w-full max-h-full"
          >
            <div
              ref={pageWrapperRef}
              className="relative flex items-center justify-center max-w-full max-h-full"
            >
              {activeItem.kind === "image" ? (
                imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={activeItem.name}
                    className="max-h-[80vh] max-w-[85vw] object-contain select-none shadow-2xl rounded bg-white"
                    draggable={false}
                  />
                ) : null
              ) : loading ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                  <span className="text-sm text-slate-400">
                    Rendering PDF page...
                  </span>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 p-6 max-w-sm text-center">
                  <AlertCircle className="h-6 w-6 text-red-500" />
                  <p className="text-xs text-red-400">{error}</p>
                </div>
              ) : pdfUrl ? (
                <img
                  src={pdfUrl}
                  alt={`PDF Page ${activeItem.pageIndex + 1}`}
                  className="max-h-[80vh] max-w-[85vw] object-contain shadow-2xl rounded bg-white"
                  draggable={false}
                />
              ) : null}

              {/* Interactive Sticker Layer Manager on Full-Screen Document Viewer */}
              <StickerLayerManager
                stickers={activeItem.stickers ?? []}
                containerRef={pageWrapperRef}
                onChange={(updated) =>
                  onUpdateStickers?.(activeItem.id, updated)
                }
                readOnly={false}
              />
            </div>
          </div>
        </div>

        {/* Right Nav Button */}
        <button
          type="button"
          onClick={handleNext}
          disabled={currentIndex === items.length - 1}
          className="absolute right-5 z-20 rounded-full bg-slate-900/80 p-3.5 text-white/90 hover:bg-slate-800 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed border border-white/10 shadow-xl backdrop-blur-md transition-all active:scale-95"
          title="Next item (→)"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Bottom Status / Indicator bar */}
      <footer className="text-center py-2 bg-slate-900/90 border-t border-white/10 text-[11px] text-slate-400 select-none">
        Navigate: <b>←</b> / <b>→</b> Arrow keys · Zoom: <b>+</b> / <b>-</b> ·
        Rotate: <b>R</b> · Close: <b>Esc</b>
      </footer>
    </div>
  );
}
