import { useEffect, useState } from "react";
import { X, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

type Props = {
  src: string;
  alt?: string;
  onClose: () => void;
};

export function ImagePreviewModal({ src, alt, onClose }: Props) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z + 0.25));
      if (e.key === "-") setZoom((z) => Math.max(0.25, z - 0.25));
      if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="truncate text-sm font-medium">{alt ?? "Image preview"}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Zoom out"
            onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
            className="rounded-md p-2 text-white/80 hover:bg-white/10"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-14 text-center text-xs tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            title="Zoom in"
            onClick={() => setZoom((z) => Math.min(6, z + 0.25))}
            className="rounded-md p-2 text-white/80 hover:bg-white/10"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Fit to screen"
            onClick={() => setZoom(1)}
            className="rounded-md p-2 text-white/80 hover:bg-white/10"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="ml-2 rounded-md p-2 text-white/80 hover:bg-white/10"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div
        className="flex-1 overflow-auto p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-full items-center justify-center">
          <img
            src={src}
            alt={alt ?? ""}
            style={{
              transform: `scale(${zoom})`,
              transformOrigin: "center center",
              transition: "transform 0.15s ease-out",
              maxWidth: zoom <= 1 ? "100%" : "none",
              maxHeight: zoom <= 1 ? "calc(100vh - 8rem)" : "none",
            }}
            className="select-none"
            draggable={false}
          />
        </div>
      </div>
    </div>
  );
}
