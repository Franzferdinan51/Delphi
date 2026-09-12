import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  memoryDb,
  getForecasts,
  listQuestions,
  insertQuestion,
  insertForecast,
  insertOpinion,
  deleteQuestion,
  pruneOrphanQuestions,
} from "../src/db.js";
import { runPipeline } from "../src/pipeline.js";
import { defaultProviders } from "../src/config.js";
const input = { question: "Will evidence support this?", questionType: "binary" as const, deadline: "2027-01-01", demoMode: true };
const noWait = { retryDelaysMs: [0, 0, 0] };
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
      const result = await runPipeline({ ...input, demoMode: false }, { db, providers, ...noWait }).then(() => "published", e => e.message);
      expect(result).toMatch(/no usable/i);
      expect(db.prepare("SELECT COUNT(*) AS n FROM forecasts").get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it("rolls back the forecast and removes the orphan question if storing an opinion fails", async () => {
    const db = memoryDb();
    db.exec("CREATE TRIGGER fail_opinion BEFORE INSERT ON opinions BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;");
    try {
      await expect(runPipeline(input, { db })).rejects.toThrow("test storage failure");
      // No forecast was stored AND the orphan question row was cleaned up.
      expect(listQuestions(db)).toHaveLength(0);
    } finally { db.close(); }
  });
  it("never deletes an existing question when a rerun fails", async () => {
    const db = memoryDb();
    try {
      const first = await runPipeline(input, { db });
      const qid = first.questionId;
      db.exec("CREATE TRIGGER fail_opinion BEFORE INSERT ON opinions BEGIN SELECT RAISE(ABORT, 'test storage failure'); END;");
      await expect(
        runPipeline({ ...input, existingQuestionId: qid }, { db }),
      ).rejects.toThrow("test storage failure");
      // The original question and its first forecast survive the failed rerun.
      expect(listQuestions(db).map((q) => q.id)).toContain(qid);
      expect(getForecasts(db, qid)).toHaveLength(1);
    } finally { db.close(); }
  });
});

describe("orphan question cleanup", () => {
  const qrow = (id: string, question: string) => ({
    id,
    question,
    question_type: "binary" as const,
    deadline: "2027-01-01",
    resolution_criteria: "",
    context: "",
    created_at: "t",
  });
  const frow = (id: string, qid: string) => ({
    id,
    question_id: qid,
    run_number: 1,
    created_at: "t",
    probability: 50,
    confidence: "Low",
    answer: "n/a",
    confidence_lo: 0,
    confidence_hi: 100,
    summary: "s",
    timeline: "",
    best_case: "",
    worst_case: "",
    readout_json: "{}",
    weights_json: "{}",
    confidence_score: 10,
    priors_json: "{}",
  });
  const orow = (id: string, fid: string, qid: string) => ({
    id,
    forecast_id: fid,
    question_id: qid,
    councilor_id: "c",
    provider_id: "p",
    round: 1,
    probability: 50,
    confidence: "Low",
    answer: "n/a",
    reasoning: "r",
    status: "demo",
    created_at: "t",
  });
  it("deleteQuestion removes the question and its forecasts and opinions", () => {
    const db = memoryDb();
    try {
      const qid = randomUUID();
      insertQuestion(db, qrow(qid, "Orphan?"));
      insertForecast(db, frow("f1", qid));
      insertOpinion(db, orow("o1", "f1", qid));
      deleteQuestion(db, qid);
      expect(listQuestions(db)).toHaveLength(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM forecasts").get()?.n).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS n FROM opinions").get()?.n).toBe(0);
    } finally { db.close(); }
  });
  it("pruneOrphanQuestions deletes only open questions with no forecasts", () => {
    const db = memoryDb();
    try {
      const orphan = randomUUID();
      const healthy = randomUUID();
      insertQuestion(db, qrow(orphan, "Orphan?"));
      insertQuestion(db, qrow(healthy, "Healthy?"));
      insertForecast(db, frow("f1", healthy));
      const pruned = pruneOrphanQuestions(db);
      expect(pruned).toBe(1);
      expect(listQuestions(db).map((q) => q.id)).toEqual([healthy]);
    } finally { db.close(); }
  });
});
