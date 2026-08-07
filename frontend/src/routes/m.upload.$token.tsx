import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ScanLine,
  Image as ImageIcon,
  CheckCircle2,
  AlertCircle,
  Upload,
  FolderOpen,
} from "lucide-react";
import {
  getTokenInfo,
  uploadMobileFile,
  type MobileToken,
} from "@/lib/rti-storage";
import {
  convertWordToPdfOnServer,
  optimizePdfBlob,
} from "@/lib/pdf-optimizer-client";

async function optimizeImage(file: File): Promise<File> {
  const lower = file.name.toLowerCase();
  if (!/\.(jpe?g|png|webp)$/.test(lower) && !file.type.startsWith("image/"))
    return file;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        const maxDim = 2000;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              const name = file.name.replace(/\.[^/.]+$/, "") + ".jpg";
              resolve(new File([blob], name, { type: "image/jpeg" }));
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          0.82,
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

export const Route = createFileRoute("/m/upload/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Mobile Upload — RTI PDF Manager" },
      { name: "robots", content: "noindex" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, maximum-scale=1",
      },
    ],
  }),
  component: MobileUploadPage,
});

function MobileUploadPage() {
  const { token } = Route.useParams();
  const [info, setInfo] = useState<MobileToken | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "invalid" | "expired"
  >("loading");
  const [uploading, setUploading] = useState(false);
  const [selectedCount, setSelectedCount] = useState<number | null>(null);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getTokenInfo(token)
      .then((t) => {
        if (!t) return setState("invalid");
        setInfo(t);
        setState("ready");
      })
      .catch(() => setState("invalid"));
  }, [token]);

  const handleFiles = async (files: File[]) => {
    if (!info) return;
    setError(null);
    setSelectedCount(files.length);
    setUploading(true);
    try {
      for (const f of files) {
        let fileToUpload = f;
        const lower = f.name.toLowerCase();
        const isWord =
          lower.endsWith(".doc") ||
          lower.endsWith(".docx") ||
          f.type.includes("word");
        const isPdf =
          lower.endsWith(".pdf") || f.type === "application/pdf";
        const isImage =
          /\.(jpe?g|png|webp)$/.test(lower) || f.type.startsWith("image/");

        if (isWord) {
          try {
            fileToUpload = await convertWordToPdfOnServer(f);
          } catch (convErr) {
            console.warn("Word document fallback on mobile upload:", convErr);
          }
        } else if (isPdf) {
          try {
            console.log("CALLING optimizePdfBlob");
            const blob = await optimizePdfBlob(f, f.name);
            fileToUpload = new File([blob], f.name, { type: "application/pdf" });
          } catch (optErr) {
            console.warn("PDF optimization fallback on mobile upload:", optErr);
          }
        } else if (isImage) {
          fileToUpload = await optimizeImage(f);
        }

        await uploadMobileFile(info.document_id, token, fileToUpload);
        setUploaded((prev) => [fileToUpload.name, ...prev]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  if (state === "loading") {
    return (
      <Centered>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </Centered>
    );
  }
  if (state === "invalid") {
    return (
      <Centered>
        <p className="text-sm text-red-700">This upload link is invalid.</p>
      </Centered>
    );
  }
  if (state === "expired") {
    return (
      <Centered>
        <p className="text-sm text-red-700">This upload link has expired.</p>
      </Centered>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        {/* Header */}
        <div className="mb-4 rounded-xl bg-blue-600 px-4 py-4 text-white shadow-sm">
          <h1 className="text-lg font-bold">Upload Files</h1>
          <p className="text-xs opacity-90 mt-0.5">
            Select PDFs, Word documents (.doc/.docx), or images to add directly
            to this project.
          </p>
        </div>

        <div className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              if (fs.length) handleFiles(fs);
              e.target.value = "";
            }}
          />
          <input
            ref={filesRef}
            type="file"
            accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              if (fs.length) handleFiles(fs);
              e.target.value = "";
            }}
          />

          {/* Identical Button Sizes & Styling */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={uploading}
              onClick={() => galleryRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 hover:border-blue-400 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              <ImageIcon className="h-5 w-5 text-blue-600 shrink-0" /> Gallery
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => filesRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 hover:border-blue-400 active:scale-[0.99] transition-all disabled:opacity-50"
            >
              <FolderOpen className="h-5 w-5 text-blue-600 shrink-0" /> Files
            </button>
          </div>

          <p className="text-center text-xs font-semibold text-slate-500 tracking-wide pt-1">
            PDF, Word (.doc/.docx), Image
          </p>

          {/* Selection Confirmation */}
          {selectedCount !== null && (
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-50/80 border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700">
              <span>
                ✓ {selectedCount} {selectedCount === 1 ? "file" : "files"}{" "}
                selected
              </span>
            </div>
          )}

          {uploading && (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
              <Upload className="h-4 w-4 animate-pulse text-blue-600" />{" "}
              Uploading to project…
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" /> {error}
            </div>
          )}

          {uploaded.length > 0 && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200/60 p-3 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />{" "}
                Uploaded ({uploaded.length})
              </div>
              <ul className="space-y-0.5 text-xs text-emerald-900/90 pl-1">
                {uploaded.map((n, i) => (
                  <li key={i} className="truncate">
                    • {n}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="rounded-xl border border-border bg-white p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}
