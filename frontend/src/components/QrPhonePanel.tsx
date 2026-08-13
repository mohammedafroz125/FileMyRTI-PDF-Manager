import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { QrCode, Copy, Check, AlertCircle, RefreshCw } from "lucide-react";
import {
  createMobileToken,
  getOrCreateActiveMobileToken,
  type MobileToken,
} from "@/lib/rti-storage";
import { getBackendUrl } from "@/lib/pdf-optimizer-client";

type Props = { docId: string; sessionId?: string };

export function QrPhonePanel({ docId, sessionId }: Props) {
  const effectiveId =
    sessionId && sessionId.trim()
      ? sessionId.trim()
      : docId && docId.trim()
        ? docId.trim()
        : "";

  const [token, setToken] = useState<MobileToken | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [customOrigin, setCustomOrigin] = useState<string | null>(null);

  const url = token && token.token
    ? `${customOrigin ?? (typeof window !== "undefined" ? window.location.origin : "https://pdffilemyrti.vercel.app")}/m/upload/${token.token}`
    : "";

  const generate = async (forceRefresh = false) => {
    if (!effectiveId) return;
    setBusy(true);
    setGenError(null);
    try {
      const t = forceRefresh
        ? await createMobileToken(effectiveId, 120)
        : await getOrCreateActiveMobileToken(effectiveId, 120);

      if (!t || !t.token) {
        throw new Error("Failed to generate a valid mobile session token.");
      }

      setToken(t);

      let effectiveOrigin =
        typeof window !== "undefined"
          ? window.location.origin
          : "https://pdffilemyrti.vercel.app";

      if (
        typeof window !== "undefined" &&
        (window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1")
      ) {
        try {
          const backendUrl = getBackendUrl();
          if (backendUrl) {
            const res = await fetch(`${backendUrl}/api/health`);
            if (res.ok) {
              const data = await res.json();
              if (data?.lanIp) {
                effectiveOrigin = `${window.location.protocol}//${data.lanIp}:${window.location.port || "8080"}`;
              }
            }
          }
        } catch {
          /* fallback to window.location.origin */
        }
      }
      setCustomOrigin(effectiveOrigin);

      const u = `${effectiveOrigin}/m/upload/${t.token}`;
      console.log(`[QR Generation] Final URL: ${u}`);
      const png = await QRCode.toDataURL(u, { margin: 1, width: 280 });
      setDataUrl(png);
    } catch (err) {
      console.error("[QR Generation Error]:", err);
      setGenError((err as Error).message ?? "Failed to generate QR");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    setToken(null);
    setDataUrl(null);
    setGenError(null);
    void generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveId]);

  const [qrModalOpen, setQrModalOpen] = useState(false);

  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <section className="rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-sm">
        <div className="flex items-center gap-4">
          {/* Clickable QR Code Container */}
          <div
            onClick={() => dataUrl && setQrModalOpen(true)}
            className="group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-inner hover:border-blue-400 hover:shadow-md transition-all"
            title="Click to enlarge QR Code"
          >
            {dataUrl ? (
              <>
                <img
                  src={dataUrl}
                  alt="Phone Upload QR"
                  className="h-full w-full object-contain"
                />
                <div className="absolute inset-0 bg-slate-900/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-lg">
                  <span className="bg-slate-900/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow">
                    Enlarge
                  </span>
                </div>
              </>
            ) : genError ? (
              <div className="text-center p-1">
                <AlertCircle className="h-4 w-4 text-red-500 mx-auto mb-1" />
                <p className="text-[9px] text-red-600 font-medium">Error</p>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-500" />
              </div>
            )}
          </div>

          {/* Info & Link */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <QrCode className="h-3.5 w-3.5 text-blue-600" /> Phone Upload /
                Scanner
              </h3>
            </div>

            <p className="text-[11px] text-slate-500 leading-tight">
              Scan with your phone to upload ACK, envelope, court fee, or images
              straight into this project.
            </p>

            {token && (
              <div className="pt-1 flex items-center gap-2">
                <div className="min-w-0 flex-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 flex items-center justify-between">
                  <span className="truncate font-mono text-[10px] text-slate-600">
                    {url}
                  </span>
                  <button
                    type="button"
                    onClick={copy}
                    className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold text-blue-600 hover:text-blue-700 shrink-0"
                    title="Copy upload link"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Enlarged QR Code Modal */}
      {qrModalOpen && dataUrl && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/80 p-4 animate-fade-in"
          onClick={() => setQrModalOpen(false)}
        >
          <div
            className="relative flex flex-col items-center rounded-2xl bg-white p-6 shadow-2xl max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-bold text-slate-800 mb-1 flex items-center gap-2">
              <QrCode className="h-4 w-4 text-blue-600" /> Scan QR Code
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Point your phone camera to upload document photos directly.
            </p>

            <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-inner mb-4">
              <img
                src={dataUrl}
                alt="Enlarged QR Code"
                className="h-64 w-64 object-contain"
              />
            </div>

            <p className="text-[11px] text-slate-400 font-mono break-all mb-4 bg-slate-50 p-2 rounded border border-slate-200 w-full">
              {url}
            </p>

            <button
              type="button"
              onClick={() => setQrModalOpen(false)}
              className="w-full rounded-lg bg-blue-600 py-2 text-xs font-bold text-white shadow hover:bg-blue-700 transition-colors"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </>
  );
}
