/**
 * Delphi HTTP API (port 8790).
 *
 * REST:
 *   POST /api/ask            → SSE stream of pipeline events, ends with result
 *   POST /api/resolve        → { id, outcome }
 *   GET  /api/questions      → list
 *   GET  /api/questions/:id → detail + belief history
 *   GET  /api/leaderboard    → councilor + provider rankings
 *   GET  /api/calibration    → calibration buckets + Brier over time
 *   GET  /api/health         → status
 *
 * MCP (Streamable HTTP, stateless — for external agents):
 *   POST /mcp                → JSON-RPC 2.0: initialize, tools/list, tools/call
 *   GET/DELETE /mcp          → 405 (no SSE stream in stateless mode)
 *
 * Serves web/dist statically when present (single-port production).
 */
import http from "node:http";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db.js";
import { runPipeline } from "./pipeline.js";
import { parseAskInput } from "./validation.js";
import { seedIfEmpty } from "./seed.js";
import { handleMcpRequest } from "./mcp.js";
import {
  listQuestionsView,
  questionDetailView,
  leaderboardView,
  calibrationView,
  resolveQuestionView,
  forecastPayload,
  providersView,
  councilorsView,
} from "./service.js";
import { DELPHI, VERSION, defaultProviders, resolveProviders, writeModelChoice, writeCouncilorProvider } from "./config.js";
import { COUNCILORS } from "./council.js";
import { authorize, configuredApiKey, isLoopbackHost } from "./auth.js";
import type {
  AskInput,
  PipelineEvent,
  QuestionType,
} from "./types.js";

const MAX_BODY = 1024 * 1024;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

async function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk as string);
    if (bytes > MAX_BODY) throw Object.assign(new Error("Body too large"), { status: 413 });
    raw += chunk;
  }
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw Object.assign(new Error("Request body must be a valid JSON object."), { status: 400 });
  }
}

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);

function handleAsk(db: DatabaseSync, req: http.IncomingMessage, res: http.ServerResponse, payload: Record<string, unknown>): void {
  const input = parseAskInput(payload);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (e: PipelineEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  let closed = false;
  req.on("close", () => { closed = true; });
  runPipeline(input, {
    db,
    emit: (e) => {
      if (closed) return;
      if (e.type === "result") send({ type: "result", forecast: forecastPayload(e.forecast) });
      else send(e);
    },
  })
    .then(() => { if (!closed) res.end(); })
    .catch((e: unknown) => {
      if (!closed) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        res.end();
      }
    });
}

function handleResolve(db: DatabaseSync, res: http.ServerResponse, payload: Record<string, unknown>): void {
  try {
    json(res, 200, resolveQuestionView(db, str(payload["id"]), str(payload["outcome"])));
  } catch (e) {
    const status = (e as { status?: number }).status || 400;
    json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
}

async function handleHealth(res: http.ServerResponse): Promise<void> {
  json(res, 200, { ok: true, ...(await providersView()) });
}

async function handleSetProviderModel(
  res: http.ServerResponse,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const model = str(payload["model"]).trim();
    if (!model) return json(res, 400, { error: "model is required." });
    const providers = await resolveProviders(defaultProviders());
    const provider = providers.find((p) => p.id === id);
    if (!provider) return json(res, 404, { error: `Unknown provider: ${id}` });
    if (provider.availableModels.length > 0 && !provider.availableModels.includes(model)) {
      return json(res, 400, {
        error: `Unknown model "${model}" for ${provider.name}. Pick one from its live catalog.`,
      });
    }
    writeModelChoice(id, model);
    json(res, 200, { ok: true, ...(await providersView()) });
  } catch (e) {
    const status = (e as { status?: number }).status || 400;
    json(res, status, { error: e instanceof Error ? e.message : String(e) });
  }
}

// ─── Static UI (web/dist) ────────────────────────────────────────────────────
const WEB_DIST = new URL("../web/dist", import.meta.url).pathname;
const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!existsSync(WEB_DIST)) return false;
  const url = new URL(req.url || "/", "http://x");
  let path = normalize(join(WEB_DIST, url.pathname));
  if (!path.startsWith(WEB_DIST)) return false;
  if (url.pathname === "/" || !existsSync(path) || statSync(path).isDirectory()) {
    path = join(WEB_DIST, "index.html");
  }
  if (!existsSync(path)) return false;
  res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
  res.end(readFileSync(path));
  return true;
}

export function createServer(db?: DatabaseSync): http.Server {
  const database = db || getDb();
  seedIfEmpty(database);
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://x");
      // Native/CLI clients have no Origin. Browser clients must be same-origin
      // (including Vite's proxy), or explicitly allowed by the operator.
      const origin = req.headers.origin;
      const allowed = (process.env.DELPHI_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
      if (origin) {
        let sameOrigin = false;
        try {
          const source = new URL(origin);
          sameOrigin = ["http:", "https:"].includes(source.protocol) && source.host === req.headers.host;
        } catch { /* malformed origins are rejected */ }
        if (!sameOrigin && !allowed.includes(origin)) return json(res, 403, { error: "Origin is not allowed." });
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("Cache-Control", "no-store");
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        });
        res.end();
        return;
      }
      // ── MCP: Streamable HTTP (stateless JSON-RPC) ──────────────────────────
      if (url.pathname === "/mcp") {
        if (!authorize(req)) return json(res, 401, { error: "Authorization required. Send Authorization: Bearer <DELPHI_API_KEY>." });
        if (req.method === "POST") {
          const payload = await body(req);
          return await handleMcpRequest(database, req, res, payload);
        }
        // Stateless mode: no SSE stream, no sessions.
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: {
              code: -32601,
              message:
                "Delphi's MCP endpoint is stateless: send JSON-RPC requests via POST. SSE streams and session DELETE are not supported.",
            },
          }),
        );
        return;
      }
      if (url.pathname === "/api/health" && req.method === "GET") return await handleHealth(res);
      if ((url.pathname.startsWith("/api/") || url.pathname === "/mcp") && !authorize(req)) {
        return json(res, 401, { error: "Authorization required. Send Authorization: Bearer <DELPHI_API_KEY>." });
      }
      if (url.pathname === "/api/ask" && req.method === "POST") {
        const payload = await body(req);
        return handleAsk(database, req, res, payload);
      }
      if (url.pathname === "/api/resolve" && req.method === "POST") {
        const payload = await body(req);
        return handleResolve(database, res, payload);
      }
      if (url.pathname === "/api/questions" && req.method === "GET")
        return json(res, 200, listQuestionsView(database));
      if (url.pathname.startsWith("/api/questions/") && req.method === "GET") {
        try {
          return json(
            res,
            200,
            questionDetailView(database, decodeURIComponent(url.pathname.slice("/api/questions/".length))),
          );
        } catch (e) {
          const status = (e as { status?: number }).status || 500;
          return json(res, status, { error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (url.pathname === "/api/leaderboard" && req.method === "GET")
        return json(res, 200, leaderboardView(database));
      if (url.pathname === "/api/calibration" && req.method === "GET")
        return json(res, 200, calibrationView(database));
      if (url.pathname === "/api/providers" && req.method === "GET")
        return json(res, 200, { ok: true, providers: (await providersView()).providers });
      if (url.pathname === "/api/councilors" && req.method === "GET")
        return json(res, 200, councilorsView());
      const councilorMatch = /^\/api\/councilors\/([^/]+)\/provider$/.exec(url.pathname);
      if (councilorMatch && req.method === "POST") {
        const payload = await body(req);
        const id = decodeURIComponent(councilorMatch[1]);
        if (!COUNCILORS.some((c) => c.id === id)) return json(res, 404, { error: `Unknown councilor: ${id}` });
        const providerId = str(payload["provider"]).trim();
        if (providerId && !defaultProviders().some((p) => p.id === providerId)) {
          return json(res, 400, { error: `Unknown provider: ${providerId}` });
        }
        writeCouncilorProvider(id, providerId);
        return json(res, 200, { ok: true, councilorId: id, provider: providerId || "auto" });
      }
      const modelMatch = /^\/api\/providers\/([^/]+)\/model$/.exec(url.pathname);
      if (modelMatch && req.method === "POST") {
        const payload = await body(req);
        return await handleSetProviderModel(res, decodeURIComponent(modelMatch[1]), payload);
      }
      if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found." });
      if (req.method === "GET" && serveStatic(req, res)) return;
      json(res, 404, { error: "Not found." });
    } catch (e) {
      const status = (e as { status?: number }).status || 500;
      json(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!isLoopbackHost(DELPHI.host) && !configuredApiKey()) {
    console.error("Refusing to bind a non-loopback address without DELPHI_API_KEY.");
    process.exit(1);
  }
  const server = createServer();
  server.listen(DELPHI.port, DELPHI.host, () => {
    const mode = DELPHI.demoDefault ? "demo" : "live";
    console.log(`Delphi API on http://${DELPHI.host}:${DELPHI.port} (v${VERSION}, ${mode})`);
    console.log(`   MCP: http://${DELPHI.host}:${DELPHI.port}/mcp`);
    if (configuredApiKey()) console.log("   Auth: Bearer DELPHI_API_KEY required on /api and /mcp (health is public).");
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
