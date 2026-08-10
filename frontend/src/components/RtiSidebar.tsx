import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Plus,
  FileText,
  RefreshCw,
  Trash2,
  Pencil,
  FileEdit,
  ChevronDown,
  ChevronRight,
  Search,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listDocuments,
  type RtiDocument,
} from "@/lib/rti-storage";
import type { DraftSummary } from "@/lib/manual-drafts";

type Props = {
  activeId?: string | null;
  onSelect: (doc: RtiDocument) => void;
  onDelete: (doc: RtiDocument) => Promise<void> | void;
  onDeleteAllPending?: () => Promise<void> | void;
  onManualEdit: () => void;
  drafts?: DraftSummary[];
  activeDraftId?: string | null;
  onSelectDraft?: (id: string) => void;
  onDeleteDraft?: (id: string) => void;
  onDeleteAllDrafts?: () => Promise<void> | void;
  onRenameDraft?: (id: string, name: string) => void;
};

export function RtiSidebar({
  activeId,
  onSelect,
  onDelete,
  onDeleteAllPending,
  onManualEdit,
  drafts = [],
  activeDraftId = null,
  onSelectDraft,
  onDeleteDraft,
  onDeleteAllDrafts,
  onRenameDraft,
}: Props) {
  const [docs, setDocs] = useState<RtiDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingExpanded, setPendingExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar_pending_expanded") !== "false";
    }
    return true;
  });
  const [draftsExpanded, setDraftsExpanded] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("sidebar_drafts_expanded") !== "false";
    }
    return true;
  });

  const togglePendingExpanded = () => {
    setPendingExpanded((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("sidebar_pending_expanded", String(next));
      }
      return next;
    });
  };

  const refresh = async () => {
    try {
      setDocs(await listDocuments());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("rti_documents_sidebar")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rti_documents" },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredDocs = docs.filter((d) =>
    d.customer_name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const filteredDrafts = drafts.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleDeleteAllPendingClick = async () => {
    if (filteredDocs.length === 0) return;
    if (
      confirm(
        `Delete ALL ${filteredDocs.length} project(s) in Pending Queue? This action cannot be undone.`,
      )
    ) {
      const docsToDelete = [...docs];
      setDocs([]);
      if (onDeleteAllPending) {
        await onDeleteAllPending();
      } else {
        for (const d of docsToDelete) {
          await onDelete(d);
        }
      }
      await refresh();
    }
  };

  const handleDeleteAllDraftsClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (filteredDrafts.length === 0) return;
    if (
      confirm(
        `Delete ALL ${filteredDrafts.length} draft(s) in Manual Drafts? This action cannot be undone.`,
      )
    ) {
      if (onDeleteAllDrafts) {
        await onDeleteAllDrafts();
      } else if (onDeleteDraft) {
        for (const d of filteredDrafts) {
          onDeleteDraft(d.id);
        }
      }
    }
  };

  return (
    <aside className="sticky top-0 flex h-full md:h-screen w-full md:w-72 shrink-0 flex-col border-r border-border bg-slate-50">
      {/* Sticky Header */}
      <div className="bg-white border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-sm font-bold text-slate-800 tracking-tight">
              FileMyRTI PDF Manager
            </h1>
            <p className="text-[11px] text-muted-foreground">
              Queue &amp; Drafts
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-slate-100 hover:text-slate-700 transition-colors"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Search Projects Box */}
        <div className="relative mt-2">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-muted-foreground">
            <Search className="h-4 w-4 text-slate-400" />
          </span>
          <input
            type="text"
            placeholder="Search projects or drafts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-input bg-slate-50 pl-9 pr-3 min-h-[44px] text-xs shadow-inner focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 transition-all"
          />
        </div>

        {/* Sticky Actions */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <Link
            to="/admin"
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 active:scale-95 transition-all text-center"
          >
            <Plus className="h-4 w-4" /> Admin Upload
          </Link>
          <button
            type="button"
            onClick={onManualEdit}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-95 transition-all"
          >
            <Pencil className="h-4 w-4" /> Manual Edit
          </button>
        </div>
      </div>

      {/* Scrollable Project List */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-4">
        {/* Pending Queue Category */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={togglePendingExpanded}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 transition-colors focus:outline-none cursor-pointer"
            >
              {pendingExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
              )}
              <span>Pending Queue ({filteredDocs.length})</span>
            </button>
            {filteredDocs.length > 0 && pendingExpanded && (
              <button
                type="button"
                onClick={handleDeleteAllPendingClick}
                className="text-[10px] font-bold text-red-600 hover:text-red-700 hover:underline px-1 py-0.5 transition-colors cursor-pointer"
                title="Delete all projects in Pending Queue"
              >
                Delete All
              </button>
            )}
          </div>

          {pendingExpanded &&
            (filteredDocs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-5 px-3 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200/80">
                <FileText className="h-5 w-5 text-slate-300 mb-1" />
                <p className="text-xs font-bold text-slate-700">
                  {searchQuery ? "No matching projects found" : "No projects in queue"}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                  {searchQuery ? "Try searching another term" : "Upload files to get started"}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {filteredDocs.map((d) => {
                  const active = d.id === activeId;
                  const isCompleted = d.status === "completed";
                  return (
                    <li key={d.id} className="group relative">
                      <div
                        className={`relative flex items-center justify-between rounded-xl p-2.5 transition-all duration-200 border ${
                          active
                            ? "bg-blue-50/90 border-blue-200/90 shadow-sm ring-1 ring-blue-500/20 before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-1 before:rounded-r-full before:bg-blue-600 pl-3.5"
                            : "bg-white border-slate-200/70 hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => onSelect(d)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex items-start gap-2.5">
                            <div
                              className={`p-1.5 rounded-lg ${active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}
                            >
                              <FileText className="h-4 w-4 shrink-0" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p
                                className={`truncate text-xs font-bold ${active ? "text-blue-950" : "text-slate-900"}`}
                              >
                                {d.customer_name}
                              </p>
                              <p className="truncate text-[10px] font-medium text-slate-500 mt-0.5">
                                {d.rti_type_selected ?? "RTI Application"}
                              </p>
                              <div className="mt-1 flex items-center justify-between gap-1">
                                <span
                                  className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold border ${
                                    isCompleted
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200/80"
                                      : "bg-amber-50 text-amber-700 border-amber-200/80"
                                  }`}
                                >
                                  <span
                                    className={`h-1.5 w-1.5 rounded-full ${
                                      isCompleted
                                        ? "bg-emerald-500"
                                        : "bg-amber-500 animate-pulse"
                                    }`}
                                  />
                                  {isCompleted ? "Completed" : "Pending"}
                                </span>
                                <span className="text-[9px] text-slate-400 font-medium">
                                  {(() => {
                                    const dObj = new Date(d.created_at);
                                    const now = new Date();
                                    const isToday =
                                      dObj.toDateString() === now.toDateString();
                                    const time = dObj.toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    });
                                    return isToday
                                      ? `Today ${time}`
                                      : `${dObj.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
                                  })()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (
                              !confirm(
                                `Delete project "${d.customer_name}"? This cannot be undone.`,
                              )
                            ) {
                              return;
                            }
                            setDocs((prev) => prev.filter((x) => x.id !== d.id));
                            void Promise.resolve(onDelete(d));
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 rounded-lg p-1.5 text-muted-foreground transition-all shrink-0 ml-1"
                          aria-label={`Delete ${d.customer_name}`}
                          title="Delete project"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>

        {/* Separator Line */}
        <div className="border-t border-slate-200 mx-1" />

        {/* Manual Drafts Category */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => {
                const next = !draftsExpanded;
                setDraftsExpanded(next);
                if (typeof window !== "undefined") {
                  localStorage.setItem("sidebar_drafts_expanded", String(next));
                }
              }}
              className="flex items-center gap-1.5 hover:bg-slate-200/50 rounded-md px-1 py-0.5 transition-colors text-left"
            >
              <FileEdit className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Manual Drafts ({filteredDrafts.length})
              </span>
              {draftsExpanded ? (
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>
            {filteredDrafts.length > 0 && (
              <button
                type="button"
                onClick={handleDeleteAllDraftsClick}
                className="text-[10px] font-bold text-red-600 hover:text-red-700 hover:underline px-1 py-0.5 transition-colors cursor-pointer"
                title="Delete all manual drafts"
              >
                Delete All
              </button>
            )}
          </div>

          {draftsExpanded && (
            <>
              {filteredDrafts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-5 px-3 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200/80">
                  <FileEdit className="h-5 w-5 text-slate-300 mb-1" />
                  <p className="text-xs font-bold text-slate-700">
                    {searchQuery ? "No matching drafts found" : "No manual drafts"}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                    {searchQuery ? "Try searching another term" : "Click 'Manual Edit' to create one"}
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {filteredDrafts.map((d) => {
                    const active = d.id === activeDraftId;
                    const isCompleted = d.status === "completed";
                    return (
                      <li key={d.id} className="group relative">
                        <div
                          className={`relative flex items-center justify-between rounded-xl p-2.5 transition-all duration-200 border ${
                            active
                              ? "bg-blue-50/90 border-blue-200/90 shadow-sm ring-1 ring-blue-500/20 before:absolute before:left-0 before:top-2.5 before:bottom-2.5 before:w-1 before:rounded-r-full before:bg-blue-600 pl-3.5"
                              : "bg-white border-slate-200/70 hover:border-slate-300 hover:shadow-md hover:-translate-y-0.5"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onSelectDraft?.(d.id)}
                            onDoubleClick={() => {
                              const name = prompt("Rename draft", d.name);
                              if (name && name.trim())
                                onRenameDraft?.(d.id, name.trim());
                            }}
                            className="min-w-0 flex-1 text-left"
                            title="Click to open · double-click to rename"
                          >
                            <div className="flex items-start gap-2.5">
                              <div
                                className={`p-1.5 rounded-lg ${active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}
                              >
                                <FileEdit className="h-4 w-4 shrink-0" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p
                                  className={`truncate text-xs font-bold ${active ? "text-blue-950" : "text-slate-900"}`}
                                >
                                  {d.name}
                                </p>
                                <p className="truncate text-[10px] font-medium text-slate-500 mt-0.5">
                                  Manual Draft
                                </p>
                                <div className="mt-1 flex items-center justify-between gap-1">
                                  <span
                                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[9px] font-bold border ${
                                      isCompleted
                                        ? "bg-emerald-50 text-emerald-700 border-emerald-200/60"
                                        : "bg-amber-50 text-amber-700 border-amber-200/60"
                                    }`}
                                  >
                                    {isCompleted ? (
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    ) : (
                                      <span className="relative flex h-1.5 w-1.5">
                                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                                      </span>
                                    )}
                                    {isCompleted ? "Completed" : "Pending"}
                                  </span>
                                  <span className="text-[9px] text-slate-400 font-medium truncate">
                                    {(() => {
                                      const dObj = new Date(d.updatedAt);
                                      if (isNaN(dObj.getTime())) return "";
                                      const isToday =
                                        dObj.toDateString() ===
                                        new Date().toDateString();
                                      const time = dObj.toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      });
                                      return isToday
                                        ? `Today ${time}`
                                        : `${dObj.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
                                    })()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!confirm(`Delete draft "${d.name}"?`)) return;
                              onDeleteDraft?.(d.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 rounded-lg p-1.5 text-muted-foreground transition-all shrink-0 ml-1"
                            aria-label={`Delete draft ${d.name}`}
                            title="Delete draft"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
