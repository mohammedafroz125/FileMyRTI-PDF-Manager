import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import {
  Plus,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
  ArrowLeft,
  Layers,
  ChevronUp,
  ChevronDown,
  FileText,
  Copy,
  Image as ImageIcon,
} from "lucide-react";
import { createProjectWithOriginals } from "@/lib/rti-storage";
import {
  convertWordToPdfOnServer,
  optimizePdfBlob,
} from "@/lib/pdf-optimizer-client";
import { safeRandomUUID } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "FileMyRTI PDF Manager" }],
  }),
  component: AdminUpload,
});

type UploadSlot = {
  id: string;
  files: File[];
  customerName: string;
  duplicateCount: number;
  status: "idle" | "uploading" | "done" | "error";
  errorMsg?: string;
};

const ALLOWED_ACCEPT =
  "application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/jpg,image/webp,.jpg,.jpeg,.png,.webp";

function isSupportedFile(f: File): boolean {
  const lower = f.name.toLowerCase();
  return (
    lower.endsWith(".pdf") ||
    lower.endsWith(".doc") ||
    lower.endsWith(".docx") ||
    f.type === "application/pdf" ||
    f.type.includes("word") ||
    f.type.startsWith("image/")
  );
}

function AdminUpload() {
  useEffect(() => {
    document.title = "FileMyRTI PDF Manager";
  }, []);

  const [slots, setSlots] = useState<UploadSlot[]>([
    {
      id: safeRandomUUID(),
      files: [],
      customerName: "",
      duplicateCount: 1,
      status: "idle",
    },
  ]);
  const [createSeparateProjects, setCreateSeparateProjects] = useState(false);
  const [isUploadingAll, setIsUploadingAll] = useState(false);

  const navigate = useNavigate();

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
        id: safeRandomUUID(),
        files: [],
        customerName: "",
        duplicateCount: 1,
        status: "idle",
      },
    ]);
  };

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSlot = (id: string, patch: Partial<UploadSlot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const handleFiles = (targetSlotId: string, files: File[]) => {
    if (!files.length) return;
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== targetSlotId) return s;
        const newFiles = [...s.files, ...files];
        let newCustomerName = s.customerName;
        if (!newCustomerName.trim() && newFiles.length > 0) {
          newCustomerName = newFiles[0].name.replace(/\.[^/.]+$/, "");
        }
        return {
          ...s,
          files: newFiles,
          customerName: newCustomerName,
          errorMsg: "",
          status: "idle",
        };
      }),
    );
  };

  const removeFile = (id: string, index: number) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const newFiles = [...s.files];
        newFiles.splice(index, 1);
        return { ...s, files: newFiles };
      }),
    );
  };

  const moveFile = (
    slotId: string,
    index: number,
    direction: "up" | "down",
  ) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const newFiles = [...s.files];
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= newFiles.length) return s;
        const [moved] = newFiles.splice(index, 1);
        newFiles.splice(targetIndex, 0, moved);
        return { ...s, files: newFiles };
      }),
    );
  };

  // Normal creation logic: Creates N duplicate project records (each with independent ID and storage)
  const uploadProject = async (slot: UploadSlot) => {
    if (slot.files.length === 0) return;
    updateSlot(slot.id, { status: "uploading", errorMsg: "Processing files..." });
    try {
      const processedFiles = await Promise.all(
        slot.files.map(async (f) => {
          const lower = f.name.toLowerCase();
          const isWord =
            lower.endsWith(".doc") ||
            lower.endsWith(".docx") ||
            f.type.includes("word");
          const isPdf = lower.endsWith(".pdf") || f.type === "application/pdf";

          if (isWord) {
            return await convertWordToPdfOnServer(f, (stage) => {
              updateSlot(slot.id, { errorMsg: stage });
            });
          }

          if (isPdf) {
            console.log("CALLING optimizePdfBlob");
            updateSlot(slot.id, { errorMsg: "Optimizing PDF..." });
            const blob = await optimizePdfBlob(f, f.name);
            return new File([blob], f.name, { type: "application/pdf" });
          }

          return f;
        }),
      );

      const count = Math.max(1, slot.duplicateCount || 1);
      const baseName =
        slot.customerName.trim() || slot.files[0].name.replace(/\.[^/.]+$/, "");

      for (let i = 1; i <= count; i++) {
        const label =
          count > 1
            ? `Creating duplicate project ${i} of ${count}...`
            : "Saving project...";
        updateSlot(slot.id, { errorMsg: label });
        const projName = count > 1 ? `${baseName} (${i})` : baseName;
        // Each call creates a completely independent project with unique ID & file copies
        await createProjectWithOriginals(projName, processedFiles);
      }

      updateSlot(slot.id, { status: "done" });
    } catch (err) {
      updateSlot(slot.id, {
        status: "error",
        errorMsg: (err as Error).message,
      });
    }
  };

  // Extract all supported files (.pdf, .doc, .docx, images) across all slots
  const allAttachedFiles: { file: File; slotId: string }[] = [];
  for (const s of slots) {
    for (const f of s.files) {
      if (isSupportedFile(f)) {
        allAttachedFiles.push({ file: f, slotId: s.id });
      }
    }
  }
  const supportedFileCount = allAttachedFiles.length;

  // Multiple project creation logic: Creates ONE independent project for EACH file using its OWN filename
  const createMultipleProjects = async () => {
    if (!createSeparateProjects || supportedFileCount === 0 || isUploadingAll)
      return;
    setIsUploadingAll(true);
    try {
      const affectedSlotIds = new Set(allAttachedFiles.map((p) => p.slotId));
      for (const slotId of affectedSlotIds) {
        updateSlot(slotId, {
          status: "uploading",
          errorMsg: "Creating multiple projects...",
        });
      }

      for (let i = 0; i < allAttachedFiles.length; i++) {
        const item = allAttachedFiles[i];
        const f = item.file;
        const lower = f.name.toLowerCase();
        const isWord =
          lower.endsWith(".doc") ||
          lower.endsWith(".docx") ||
          f.type.includes("word");
        const isPdf = lower.endsWith(".pdf") || f.type === "application/pdf";

        let processedFile: File = f;
        if (isWord) {
          processedFile = await convertWordToPdfOnServer(f, () => {});
        } else if (isPdf) {
          console.log("CALLING optimizePdfBlob");
          const blob = await optimizePdfBlob(f, f.name);
          processedFile = new File([blob], f.name, { type: "application/pdf" });
        }

        // Each generated project gets its OWN corresponding file name (without extension)
        const projectName = f.name.replace(/\.[^/.]+$/, "");
        await createProjectWithOriginals(projectName, [processedFile]);
      }

      for (const slotId of affectedSlotIds) {
        updateSlot(slotId, { status: "done", errorMsg: "" });
      }
      navigate({ to: "/" });
    } catch (err) {
      for (const slot of slots) {
        if (slot.files.some(isSupportedFile)) {
          updateSlot(slot.id, {
            status: "error",
            errorMsg: (err as Error).message,
          });
        }
      }
    } finally {
      setIsUploadingAll(false);
    }
  };

  const isMultipleProjectsEnabled =
    createSeparateProjects && supportedFileCount > 0 && !isUploadingAll;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto max-w-7xl">
        {/* Top Navigation & Actions Bar */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate({ to: "/" })}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Dashboard
            </button>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                Admin Upload
              </h1>
              <p className="text-xs text-slate-500">
                Create new FileMyRTI projects for processing
              </p>
            </div>
          </div>

          {/* Controls: Checkbox & Create Multiple Projects Button */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Checkbox with Exact Required Label */}
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors select-none">
              <input
                type="checkbox"
                checked={createSeparateProjects}
                onChange={(e) => setCreateSeparateProjects(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 accent-blue-600 cursor-pointer"
              />
              <span className="flex items-center gap-1.5 leading-tight font-semibold">
                <Layers className="h-4 w-4 text-blue-600 shrink-0" />
                Create a separate project for each file
              </span>
            </label>

            {/* Top-Right Create Multiple Projects Button */}
            <button
              type="button"
              onClick={createMultipleProjects}
              disabled={!isMultipleProjectsEnabled}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploadingAll ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Creating
                  Projects...
                </>
              ) : (
                "Create Multiple Projects"
              )}
            </button>
          </div>
        </div>

        {/* Responsive Grid for Project Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 items-start">
          {slots.map((slot, index) => (
            <div
              key={slot.id}
              className="relative flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md animate-in fade-in"
            >
              {/* Card Header: Project Numbering & Delete Button */}
              <div className="flex items-center justify-between border-b border-slate-100 px-3.5 py-2.5 bg-slate-50/50 rounded-t-xl">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-[10px] font-extrabold text-blue-700">
                    {index + 1}
                  </span>
                  Project {index + 1}
                </span>

                {slots.length > 1 && slot.status !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => removeSlot(slot.id)}
                    className="rounded-md p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    title="Remove project card"
                    aria-label={`Remove Project ${index + 1}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Card Body */}
              <div className="p-3.5 flex-1 space-y-3">
                {/* Customer Name Input */}
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-slate-700">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    placeholder={
                      slot.files.length > 0
                        ? slot.files[0].name.replace(/\.[^/.]+$/, "")
                        : "Auto-extracted from file"
                    }
                    value={slot.customerName}
                    onChange={(e) =>
                      updateSlot(slot.id, { customerName: e.target.value })
                    }
                    disabled={
                      slot.status === "uploading" || slot.status === "done"
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-sm transition-colors focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                {/* Duplicate Count Input */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <label className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Copy className="h-3.5 w-3.5 text-slate-400" />
                    Duplicate Copies:
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={slot.duplicateCount || 1}
                    onChange={(e) => {
                      const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                      updateSlot(slot.id, { duplicateCount: val });
                    }}
                    disabled={
                      slot.status === "uploading" || slot.status === "done"
                    }
                    className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-800 text-center shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                  />
                </div>

                {/* File Dropzone or Files List */}
                <div>
                  {slot.files.length === 0 ? (
                    <div className="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 p-4 text-center hover:border-blue-400 hover:bg-blue-50/50 transition-colors">
                      <input
                        type="file"
                        multiple
                        accept={ALLOWED_ACCEPT}
                        onChange={(e) => {
                          const fs = Array.from(e.target.files ?? []);
                          if (fs.length) handleFiles(slot.id, fs);
                          e.target.value = "";
                        }}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                      <UploadCloud className="mb-1 h-5 w-5 text-blue-500" />
                      <p className="text-xs font-bold text-slate-700">
                        Click or drop PDFs & Images
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        PDF, DOC, DOCX, JPG, PNG
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-700">
                          {slot.files.length} File
                          {slot.files.length === 1 ? "" : "s"} attached
                        </span>
                        {slot.status === "idle" && (
                          <div className="relative cursor-pointer text-[10px] font-bold text-blue-600 hover:underline">
                            + Add more
                            <input
                              type="file"
                              multiple
                              accept={ALLOWED_ACCEPT}
                              onChange={(e) => {
                                const fs = Array.from(e.target.files ?? []);
                                if (fs.length) handleFiles(slot.id, fs);
                                e.target.value = "";
                              }}
                              className="absolute inset-0 cursor-pointer opacity-0"
                            />
                          </div>
                        )}
                      </div>
                      <ul className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                        {slot.files.map((f, i) => {
                          const isImage = f.type.startsWith("image/");
                          const isPdf =
                            f.type === "application/pdf" ||
                            f.name.toLowerCase().endsWith(".pdf");
                          return (
                            <li
                              key={i}
                              className="flex items-center justify-between gap-1 rounded-md bg-white border border-slate-100 px-2 py-1 text-[11px] shadow-2xs"
                            >
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                {isImage ? (
                                  <ImageIcon className="h-3 w-3 text-amber-500 shrink-0" />
                                ) : isPdf ? (
                                  <FileText className="h-3 w-3 text-emerald-600 shrink-0" />
                                ) : (
                                  <FileText className="h-3 w-3 text-blue-500 shrink-0" />
                                )}
                                <span
                                  className="truncate font-medium text-slate-700"
                                  title={f.name}
                                >
                                  {f.name}
                                </span>
                              </div>

                              {slot.status === "idle" && (
                                <div className="flex items-center gap-0.5 shrink-0">
                                  {i > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => moveFile(slot.id, i, "up")}
                                      className="p-0.5 text-slate-400 hover:text-slate-700 transition-colors"
                                      title="Move up"
                                    >
                                      <ChevronUp className="h-3 w-3" />
                                    </button>
                                  )}
                                  {i < slot.files.length - 1 && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        moveFile(slot.id, i, "down")
                                      }
                                      className="p-0.5 text-slate-400 hover:text-slate-700 transition-colors"
                                      title="Move down"
                                    >
                                      <ChevronDown className="h-3 w-3" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => removeFile(slot.id, i)}
                                    className="p-0.5 text-slate-400 hover:text-red-600 transition-colors ml-0.5"
                                    title="Remove file"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>

                {slot.status === "error" && (
                  <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{slot.errorMsg}</span>
                  </div>
                )}
                {slot.status === "done" && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {slot.duplicateCount > 1
                        ? `${slot.duplicateCount} Projects Created!`
                        : "Project Created!"}
                    </span>
                  </div>
                )}
              </div>

              {/* Card Footer Action: Create Single or Duplicate Projects */}
              <div className="border-t border-slate-100 p-3 bg-slate-50/30 rounded-b-xl">
                {slot.status === "done" ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateSlot(slot.id, {
                        status: "idle",
                        files: [],
                        customerName: "",
                        duplicateCount: 1,
                      })
                    }
                    className="w-full rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    Reset Slot
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => uploadProject(slot)}
                    disabled={
                      slot.files.length === 0 || slot.status === "uploading"
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {slot.status === "uploading" ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
                        Creating...
                      </>
                    ) : slot.duplicateCount > 1 ? (
                      `Create ${slot.duplicateCount} Duplicate Projects`
                    ) : (
                      "Create Project"
                    )}
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Compact Add Slot Card */}
          <button
            type="button"
            onClick={addSlot}
            className="group flex min-h-[160px] flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-200 bg-white p-4 text-slate-500 transition-all hover:border-blue-400 hover:bg-blue-50/40 hover:text-blue-600 shadow-sm"
          >
            <div className="p-2 rounded-full bg-slate-100 group-hover:bg-blue-100 text-slate-600 group-hover:text-blue-600 transition-colors mb-1.5">
              <Plus className="h-5 w-5 transition-transform group-hover:scale-110" />
            </div>
            <span className="text-xs font-bold">Add Another Project</span>
          </button>
        </div>
      </div>
    </div>
  );
}
