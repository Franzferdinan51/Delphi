import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { once } from "node:events";
import { createServer } from "../src/api.js";
import { memoryDb } from "../src/db.js";

let db: ReturnType<typeof memoryDb>;
let server: ReturnType<typeof createServer>;
let base: string;
beforeEach(async () => {
  db = memoryDb();
  server = createServer(db);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  db.close();
});
const post = (body: string, headers = {}) => fetch(`${base}/api/ask`, {
  method: "POST", headers: { "Content-Type": "application/json", ...headers }, body,
  signal: AbortSignal.timeout(5000),
});

describe("HTTP boundaries", () => {
  it("returns 413 for an oversized body without resetting the connection", async () => {
    const response = await post(JSON.stringify({ question: "x".repeat(1024 * 1024) }));
    expect(response.status).toBe(413);
  });
  it("catches asynchronous health failures", async () => {
    vi.stubEnv("DELPHI_PROVIDERS", "[");
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    expect(response.status).toBe(500);
    expect(await response.json()).toHaveProperty("error");
  });
  it("rejects invalid forecast fields before opening SSE", async () => {
    const response = await post(JSON.stringify({ question: "Test?", deadline: "2027-02-30", demoMode: "false" }));
    expect(response.status).toBe(400);
  });
  it("accepts same-origin and explicitly allowed browser requests", async () => {
    const response = await fetch(`${base}/api/questions`, { headers: { Origin: base } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(base);
    vi.stubEnv("DELPHI_ALLOWED_ORIGINS", "https://trusted.example");
    const allowed = await fetch(`${base}/api/questions`, { headers: { Origin: "https://trusted.example" } });
    expect(allowed.status).toBe(200);
  });
  it.each(["{", "null", "[]", "42"])("returns 400 for invalid JSON object: %s", async (body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty("error");
  });
  it("rejects cross-origin browser mutations", async () => {
    const response = await post("{}", { Origin: "https://untrusted.example" });
    expect(response.status).toBe(403);
  });
  it("requires a bearer token when DELPHI_API_KEY is set", async () => {
    vi.stubEnv("DELPHI_API_KEY", "secret-token");
    const denied = await fetch(`${base}/api/questions`);
    expect(denied.status).toBe(401);
    const ok = await fetch(`${base}/api/questions`, { headers: { Authorization: "Bearer secret-token" } });
    expect(ok.status).toBe(200);
    const health = await fetch(`${base}/api/health`);
    expect(health.status).toBe(200);
  });
  it("streams the complete demo forecast after the request body ends", async () => {
    const response = await post(JSON.stringify({ question: "Will streaming complete?", questionType: "binary", deadline: "2027-01-01", demoMode: true }));
    expect(response.status).toBe(200);
    const events = (await response.text()).split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6)));
    expect(events[0].type).toBe("started");
    expect(events.at(-1).type).toBe("result");
    const id = events.at(-1).forecast.questionId;
    const detail = await (await fetch(`${base}/api/questions/${id}`)).json();
    expect(detail.latest.id).toBe(events.at(-1).forecast.id);
  });
});
