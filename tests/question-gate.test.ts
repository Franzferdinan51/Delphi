import { describe, it, expect } from "vitest";
import {
  sharpenQuestion,
  heuristicGate,
  decompositionNotes,
} from "../src/question-gate.js";

const crisp = {
  question: "Will the S&P 500 close above 7000 on December 31, 2026?",
  questionType: "binary" as const,
  deadline: "2026-12-31",
  resolutionCriteria: "Resolves YES if the S&P 500 closing price on 2026-12-31 exceeds 7000.",
  context: "",
};

describe("question gate", () => {
  it("scores a crisp question highly with no ambiguities", () => {
    const g = heuristicGate(crisp);
    expect(g.qualityScore).toBeGreaterThanOrEqual(80);
    expect(g.ambiguities).toHaveLength(0);
    expect(g.changed).toBe(false);
    expect(g.sharpened).toBe(crisp.question);
  });

  it("flags a vague question with ambiguities and a lower score", () => {
    const g = heuristicGate({
      question: "Will things go well soon",
      questionType: "binary",
      deadline: "",
      resolutionCriteria: "",
      context: "",
    });
    expect(g.qualityScore).toBeLessThan(60);
    expect(g.ambiguities.length).toBeGreaterThan(0);
    expect(g.ambiguities.join(" ")).toContain("resolution criteria");
    expect(g.criteria).toContain("YES");
    expect(g.changed).toBe(true);
    expect(g.sharpened.endsWith("?")).toBe(true);
  });

  it("always returns a 2-4 step Fermi decomposition", () => {
    for (const type of ["binary", "timing", "numeric", "categorical"] as const) {
      const g = heuristicGate({ ...crisp, questionType: type });
      expect(g.decomposition.length).toBeGreaterThanOrEqual(2);
      expect(g.decomposition.length).toBeLessThanOrEqual(4);
      expect(g.decomposition.every((d) => d.sub.trim().length > 0)).toBe(true);
    }
  });

  it("sharpenQuestion is deterministic in demo mode", async () => {
    const opts = { provider: null, demoMode: true };
    const a = await sharpenQuestion(crisp, opts);
    const b = await sharpenQuestion(crisp, opts);
    expect(a).toEqual(b);
  });

  it("sharpenQuestion falls back to heuristics when live fails", async () => {
    // provider null + demoMode false → heuristic path
    const g = await sharpenQuestion(crisp, { provider: null, demoMode: false });
    expect(g.sharpened).toBe(crisp.question);
    expect(g.decomposition.length).toBeGreaterThanOrEqual(2);
  });

  it("decompositionNotes renders numbered steps", () => {
    const g = heuristicGate(crisp);
    const notes = decompositionNotes(g);
    expect(notes).toContain("FERMI DECOMPOSITION");
    expect(notes).toContain("1.");
    expect(notes).toContain("2.");
  });
});
