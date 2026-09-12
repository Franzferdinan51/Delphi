import { afterEach, describe, expect, it } from "vitest";
import { memoryDb, insertQuestion, councilorTrackRecords, providerTrackRecords, calibrationPairs } from "../src/db.js";
import { findQuestion, storedForecast } from "../src/service.js";
import { runPipeline } from "../src/pipeline.js";
import { resolveForecast } from "../src/resolve.js";
import { brierScore } from "../src/scoring.js";
const dbs: ReturnType<typeof memoryDb>[] = [];
const database = () => { const db = memoryDb(); dbs.push(db); return db; };
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
const input = { question: "Will this resolve?", questionType: "binary" as const, deadline: "2027-01-01", demoMode: true };
describe("forecast integrity", () => {
  it("Brier scores preserve exact endpoints rather than log-score clipping", () => {
    expect(brierScore(0, 0)).toBe(0);
    expect(brierScore(1, 0)).toBe(1);
  });
  it("rejects ambiguous and empty IDs; prefers exact IDs", () => {
    const db = database();
    for (const id of ["abc-one", "abc-two"]) insertQuestion(db, { id, question: "Q", question_type: "binary", deadline: "2027-01-01", resolution_criteria: "", context: "", created_at: "2026-01-01" });
    expect(() => findQuestion(db, "abc")).toThrow(/ambiguous/i);
    expect(() => findQuestion(db, "")).toThrow();
    expect(findQuestion(db, "abc-one").id).toBe("abc-one");
  });
  it("scores only the latest successful round-2 opinions once per question", async () => {
    const db = database();
    const first = await runPipeline(input, { db });
    const last = await runPipeline({ ...input, existingQuestionId: first.questionId }, { db });
    const failed = last.opinions[0].councilorId;
    db.prepare("UPDATE opinions SET status = 'error' WHERE forecast_id = ? AND councilor_id = ?").run(last.id, failed);
    const grades = resolveForecast(db, first.questionId, "yes");
    expect(grades.grades.some(g => g.councilorId === failed)).toBe(false);
    const records = councilorTrackRecords(db);
    expect(records.has(failed)).toBe(false);
    for (const grade of grades.grades) {
      expect(records.get(grade.councilorId)?.n).toBe(1);
      expect(records.get(grade.councilorId)?.sumSqErr).toBeCloseTo(grade.brier, 12);
    }
    expect([...providerTrackRecords(db).values()].reduce((n, r) => n + r.n, 0)).toBe(grades.grades.length);
    expect(calibrationPairs(db)[0].probability).toBe(last.probability);
  });
  it("preserves confidence components and opinion weights when reloading", async () => {
    const db = database();
    const result = await runPipeline(input, { db });
    const stored = storedForecast(db, result.id)!;
    expect(stored.confidenceBreakdown).toEqual(result.confidenceBreakdown);
    for (const opinion of stored.opinions) expect(opinion.weight).toBe(result.weights[opinion.councilorId]);
  });
});
