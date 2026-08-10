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
  Sparkles,
  ChevronUp,
  ChevronDown,
  FileText,
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
  status: "idle" | "uploading" | "done" | "error";
  errorMsg?: string;
};

const ALLOWED_ACCEPT =
  "application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/jpg,image/webp,.jpg,.jpeg,.png,.webp";

function AdminUpload() {
  useEffect(() => {
    document.title = "FileMyRTI PDF Manager";
  }, []);

  const [slots, setSlots] = useState<UploadSlot[]>([
    { id: safeRandomUUID(), files: [], customerName: "", status: "idle" },
  ]);
  const [createSeparateProjects, setCreateSeparateProjects] = useState(false);
  const [isUploadingAll, setIsUploadingAll] = useState(false);

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      { id: safeRandomUUID(), files: [], customerName: "", status: "idle" },
    ]);
  };

  const removeSlot = (id: string) => {
    setSlots((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSlot = (id: string, patch: Partial<UploadSlot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const splitSlotsForSeparatePdfs = (
    currentSlots: UploadSlot[],
  ): UploadSlot[] => {
    const result: UploadSlot[] = [];
    for (const slot of currentSlots) {
      if (slot.files.length === 0) {
        result.push(slot);
        continue;
      }
      const pdfs = slot.files.filter(
        (f) =>
          f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf",
      );
      const nonPdfs = slot.files.filter(
        (f) =>
          !f.name.toLowerCase().endsWith(".pdf") &&
          f.type !== "application/pdf",
      );

      if (pdfs.length > 1) {
        // First PDF stays in this slot
        const firstPdf = pdfs[0];
        const name1 =
          slot.customerName.trim() || firstPdf.name.replace(/\.[^/.]+$/, "");
        result.push({
          ...slot,
          files: [firstPdf, ...nonPdfs],
          customerName: name1,
        });

        // Each subsequent PDF gets a separate project slot
        for (let i = 1; i < pdfs.length; i++) {
          const p = pdfs[i];
          const nameI = p.name.replace(/\.[^/.]+$/, "");
          result.push({
            id: safeRandomUUID(),
            files: [p],
            customerName: nameI,
            status: "idle",
          });
        }
      } else {
        result.push(slot);
      }
    }
    return result;
  };

  const handleToggleSeparateProjects = (checked: boolean) => {
    setCreateSeparateProjects(checked);
    if (checked) {
      setSlots((prev) => splitSlotsForSeparatePdfs(prev));
    }
  };

  const handleFiles = (targetSlotId: string, files: File[]) => {
    if (!files.length) return;

    const pdfs = files.filter(
      (f) =>
        f.name.toLowerCase().endsWith(".pdf") || f.type === "application/pdf",
    );
    const nonPdfs = files.filter(
      (f) =>
        !f.name.toLowerCase().endsWith(".pdf") && f.type !== "application/pdf",
    );

    if (createSeparateProjects && (pdfs.length > 0 || nonPdfs.length > 0)) {
      setSlots((prev) => {
        const targetIndex = prev.findIndex((s) => s.id === targetSlotId);
        if (targetIndex < 0) return prev;

        const updated = [...prev];
        const targetSlot = updated[targetIndex];
        const combinedFiles = [...targetSlot.files, ...files];

        const allPdfs = combinedFiles.filter(
          (f) =>
            f.name.toLowerCase().endsWith(".pdf") ||
            f.type === "application/pdf",
        );
        const allNonPdfs = combinedFiles.filter(
          (f) =>
            !f.name.toLowerCase().endsWith(".pdf") &&
            f.type !== "application/pdf",
        );

        if (allPdfs.length > 1) {
          const firstPdf = allPdfs[0];
          const name1 =
            targetSlot.customerName.trim() ||
            firstPdf.name.replace(/\.[^/.]+$/, "");
          updated[targetIndex] = {
            ...targetSlot,
            files: [firstPdf, ...allNonPdfs],
            customerName: name1,
            status: "idle",
            errorMsg: "",
          };

          const newSlots: UploadSlot[] = [];
          for (let i = 1; i < allPdfs.length; i++) {
            const p = allPdfs[i];
            const nameI = p.name.replace(/\.[^/.]+$/, "");
            newSlots.push({
              id: safeRandomUUID(),
              files: [p],
              customerName: nameI,
              status: "idle",
            });
          }
          updated.splice(targetIndex + 1, 0, ...newSlots);
          return updated;
        } else {
          let name = targetSlot.customerName;
          if (!name.trim() && combinedFiles.length > 0) {
            name = combinedFiles[0].name.replace(/\.[^/.]+$/, "");
          }
          updated[targetIndex] = {
            ...targetSlot,
            files: combinedFiles,
            customerName: name,
            errorMsg: "",
            status: "idle",
          };
          return updated;
        }
      });
      return;
    }

    // Default mode (unchecked): append all selected files to target slot
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

  const uploadProject = async (slot: UploadSlot) => {
    if (slot.files.length === 0) return;
    updateSlot(slot.id, { status: "uploading", errorMsg: "" });
    try {
      // Process all files concurrently
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
      updateSlot(slot.id, { errorMsg: "Saving project..." });
      const nameToUse =
        slot.customerName.trim() || slot.files[0].name.replace(/\.[^/.]+$/, "");
      await createProjectWithOriginals(nameToUse, processedFiles);
      updateSlot(slot.id, { status: "done" });
    } catch (err) {
      updateSlot(slot.id, {
        status: "error",
        errorMsg: (err as Error).message,
      });
    }
  };

  const readySlots = slots.filter(
    (s) => s.files.length > 0 && s.status !== "done",
  );
  const readyCount = readySlots.length;

  const createProjectsButtonText = isUploadingAll
    ? readyCount > 1
      ? "Creating Projects..."
      : "Creating Project..."
    : !createSeparateProjects
      ? "Create 1 Project"
      : readyCount <= 1
        ? "Create 1 Project"
        : `Create ${readyCount} Projects`;

  const uploadAllReady = async () => {
    if (readyCount === 0 || isUploadingAll) return;
    setIsUploadingAll(true);
    await Promise.all(readySlots.map((slot) => uploadProject(slot)));
    setIsUploadingAll(false);
  };

  const navigate = useNavigate();

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

          {/* Controls: Separate Projects Toggle + Progress & Dynamic Create Button */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Checkbox with Exact User Required Label */}
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors select-none">
              <input
                type="checkbox"
                checked={createSeparateProjects}
                onChange={(e) => handleToggleSeparateProjects(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 accent-blue-600 cursor-pointer"
              />
              <span className="flex items-center gap-1.5 leading-tight font-semibold">
                <Layers className="h-4 w-4 text-blue-600 shrink-0" />
                Create a separate project for each PDF
              </span>
            </label>

            {/* Ready Progress Indicator */}
            {slots.length > 0 && (
              <span className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 border border-blue-200/60">
                <Sparkles className="h-3.5 w-3.5" />
                {readyCount} of {slots.length} Projects Ready
              </span>
            )}

            {/* Dynamic Bulk Create Button */}
            {readyCount > 0 && (
              <button
                type="button"
                onClick={uploadAllReady}
                disabled={isUploadingAll}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-xs sm:text-sm font-bold text-white shadow hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {isUploadingAll ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Creating
                    Projects...
                  </>
                ) : (
                  createProjectsButtonText
                )}
              </button>
            )}
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
                        PDF, JPG, JPEG, PNG, WEBP
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
                    <span>Project Created!</span>
                  </div>
                )}
              </div>

              {/* Card Footer Action */}
              <div className="border-t border-slate-100 p-3 bg-slate-50/30 rounded-b-xl">
                {slot.status === "done" ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateSlot(slot.id, {
                        status: "idle",
                        files: [],
                        customerName: "",
                      })
                    }
                    className="w-full rounded-lg bg-slate-100 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200 transition-colors"
                  >
                    Reset Slot
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (createSeparateProjects && readyCount > 1) {
                        uploadAllReady();
                      } else {
                        uploadProject(slot);
                      }
                    }}
                    disabled={
                      slot.files.length === 0 || slot.status === "uploading"
                    }
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {slot.status === "uploading" ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
                        Creating...
                      </>
                    ) : (
                      createProjectsButtonText
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
