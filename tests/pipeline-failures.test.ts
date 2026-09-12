import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryDb, getForecasts, listQuestions } from "../src/db.js";
import { runPipeline } from "../src/pipeline.js";
import { defaultProviders } from "../src/config.js";
const input = { question: "Will evidence support this?", questionType: "binary" as const, deadline: "2027-01-01", demoMode: true };
afterEach(() => vi.unstubAllGlobals());
describe("pipeline failure boundaries", () => {
  it("demo forecasts never contact configured providers", async () => {
    const network = vi.fn(async () => new Response("offline", { status: 503 }));
    vi.stubGlobal("fetch", network);
    const db = memoryDb();
    try { await runPipeline(input, { db }); expect(network).not.toHaveBeenCalled(); }
    finally { db.close(); }
  });
  it("fails rather than publishing a confident 50% when every provider fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("offline", { status: 503 })));
    const db = memoryDb();
    const providers = defaultProviders().map(p => ({ ...p, apiKey: "", model: "" }));
    try {
      const result = await runPipeline({ ...input, demoMode: false }, { db, providers }).then(() => "published", e => e.message);
      expect(result).toMatch(/no usable/i);
      expect(db.prepare("SELECT COUNT(*) AS n FROM forecasts").get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it("rolls back the entire forecast if storing an opinion fails", async () => {
    const db = memoryDb();
    db.exec("CREATE TRIGGER fail_opinion BEFORE INSERT ON opinions BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;");
    try {
      await expect(runPipeline(input, { db })).rejects.toThrow("test storage failure");
      expect(getForecasts(db, listQuestions(db)[0].id)).toHaveLength(0);
    } finally { db.close(); }
  });
});
