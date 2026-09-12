import { describe, it, expect } from "vitest";
import { memoryDb, listQuestions, getForecasts } from "../src/db.js";
import { runPipeline } from "../src/pipeline.js";
import { resolveForecast } from "../src/resolve.js";
import { seedIfEmpty } from "../src/seed.js";
import type { PipelineEvent } from "../src/types.js";

describe("pipeline (demo mode)", () => {
  it("runs ask end-to-end and emits a full event stream", async () => {
    const db = memoryDb();
    const events: PipelineEvent[] = [];
    const forecast = await runPipeline(
      {
        question: "Will the test suite pass on the first try?",
        questionType: "binary",
        deadline: "2026-12-31",
        demoMode: true,
        councilSize: 4,
      },
      { db, emit: (e) => events.push(e) },
    );

    expect(forecast.questionId).toBeTruthy();
    expect(forecast.probability).toBeGreaterThanOrEqual(0);
    expect(forecast.probability).toBeLessThanOrEqual(100);
    expect(forecast.opinions).toHaveLength(4);
    expect(forecast.opinions.every((o) => o.round === 2)).toBe(true);
    expect(forecast.opinions.every((o) => o.status === "demo")).toBe(true);
    expect(forecast.readout.thesis.length).toBeGreaterThan(0);

    // Priors, gate, and confidence score
    expect(forecast.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(forecast.confidenceScore).toBeLessThanOrEqual(100);
    expect(forecast.confidenceBreakdown.agreement).toBeGreaterThanOrEqual(0);
    expect(forecast.priors.baseRate).not.toBeNull();
    expect(forecast.priors.baseRate!.value).toBeGreaterThanOrEqual(1);
    expect(forecast.decomposition.length).toBeGreaterThanOrEqual(2);
    expect(forecast.questionQuality).toBeGreaterThan(0);
    expect(forecast.sharpenedQuestion.length).toBeGreaterThan(0);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("started");
    expect(types).toContain("phase");
    expect(types).toContain("gate");
    expect(types).toContain("priors");
    const phases = events
      .filter((e) => e.type === "phase")
      .map((e) => (e as { phase: string }).phase);
    expect(phases).toContain("gate");
    expect(phases).toContain("priors");
    expect(types.filter((t) => t === "opinion")).toHaveLength(8); // 4 councilors × 2 rounds
    expect(types[types.length - 1]).toBe("result");

    // persisted
    expect(listQuestions(db)).toHaveLength(1);
    expect(getForecasts(db, forecast.questionId)).toHaveLength(1);
  });

  it("is deterministic in demo mode", async () => {
    const mk = () => memoryDb();
    const run = () =>
      runPipeline(
        { question: "Deterministic?", questionType: "binary", deadline: "2027-01-01", demoMode: true, councilSize: 5 },
        { db: mk() },
      );
    const a = await run();
    const b = await run();
    expect(a.probability).toBe(b.probability);
    expect(a.confidenceScore).toBe(b.confidenceScore);
    expect(a.priors).toEqual(b.priors);
    expect(a.decomposition).toEqual(b.decomposition);
    expect(a.opinions.map((o) => o.probability)).toEqual(b.opinions.map((o) => o.probability));
  });

  it("re-running a question appends a new forecast (belief tracking)", async () => {
    const db = memoryDb();
    const input = {
      question: "Will it rain?",
      questionType: "binary" as const,
      deadline: "2026-12-31",
      demoMode: true,
    };
    const first = await runPipeline(input, { db });
    const second = await runPipeline(
      { ...input, existingQuestionId: first.questionId },
      { db },
    );
    expect(second.questionId).toBe(first.questionId);
    expect(second.runNumber).toBe(2);
    const runs = getForecasts(db, first.questionId);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.run_number)).toEqual([1, 2]);
  });

  it("resolve grades every councilor", async () => {
    const db = memoryDb();
    const f = await runPipeline(
      { question: "Will demos work?", questionType: "binary", deadline: "2026-12-31", demoMode: true, councilSize: 3 },
      { db },
    );
    const result = resolveForecast(db, f.questionId, "yes");
    expect(result.score).toBe(1);
    expect(result.grades).toHaveLength(3);
    for (const g of result.grades) {
      expect(g.brier).toBeGreaterThanOrEqual(0);
      expect(g.brier).toBeLessThanOrEqual(1);
      expect(Number.isFinite(g.logScore)).toBe(true);
    }
    expect(listQuestions(db)[0].status).toBe("resolved");
  });

  it("rejects double resolution and bad outcomes", async () => {
    const db = memoryDb();
    const f = await runPipeline(
      { question: "Double resolve?", questionType: "binary", deadline: "2026-12-31", demoMode: true },
      { db },
    );
    expect(() => resolveForecast(db, f.questionId, "maybe")).toThrow();
    resolveForecast(db, f.questionId, "no");
    expect(() => resolveForecast(db, f.questionId, "yes")).toThrow();
  });
});

describe("seed", () => {
  it("seeds exactly once and produces a non-empty leaderboard", async () => {
    const db = memoryDb();
    expect(seedIfEmpty(db)).toBe(true);
    expect(seedIfEmpty(db)).toBe(false);
    expect(listQuestions(db)).toHaveLength(3);
    const { councilorTrackRecords } = await import("../src/db.js");
    const records = councilorTrackRecords(db);
    expect(records.size).toBeGreaterThan(0);
    for (const [, r] of records) expect(r.n).toBeGreaterThan(0);
  });
});
