import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  );
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as {
      unhandled?: unknown;
      message?: unknown;
    };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

import { handleProjectsCreate } from "./api/projectsCreate";
import { handleMobileUpload } from "./api/mobileUpload";

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const pathname = url.pathname.toLowerCase();

      // OPTIONS preflight handler for mobile uploads
      if (
        request.method === "OPTIONS" &&
        (pathname.startsWith("/m/upload") ||
          pathname.startsWith("/api/"))
      ) {
        return await handleMobileUpload(request);
      }

      // POST /api/projects/create
      if (
        request.method === "POST" &&
        url.pathname === "/api/projects/create"
      ) {
        return await handleProjectsCreate(request);
      }

      // POST Mobile upload endpoints (handles both QR URL POSTs and API POSTs)
      if (
        request.method === "POST" &&
        (pathname.startsWith("/m/upload") ||
          pathname.startsWith("/api/m/upload") ||
          pathname === "/api/upload-mobile" ||
          pathname === "/api/mobile-upload" ||
          pathname === "/api/upload" ||
          pathname === "/api/mobile/upload")
      ) {
        return await handleMobileUpload(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
