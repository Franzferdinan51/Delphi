import { describe, it, expect } from "vitest";
import {
  brierScore,
  meanBrier,
  logScore,
  calibrationBuckets,
  parseOutcome,
} from "../src/scoring.js";

describe("brierScore", () => {
  it("is ~0 for a near-perfect forecast, ~1 for perfectly wrong", () => {
    // probabilities are clamped to [0.001, 0.999] for log-score safety
    expect(brierScore(1, 1)).toBeLessThan(1e-5);
    expect(brierScore(0, 1)).toBeGreaterThan(0.99);
  });
  it("scores 0.25 for always saying 50%", () => {
    expect(brierScore(0.5, 1)).toBeCloseTo(0.25, 10);
    expect(brierScore(0.5, 0)).toBeCloseTo(0.25, 10);
  });
  it("clamps extreme probabilities", () => {
    expect(Number.isFinite(brierScore(0, 0))).toBe(true);
    expect(Number.isFinite(brierScore(1, 0))).toBe(true);
  });
});

describe("meanBrier", () => {
  it("averages correctly and NaNs on empty", () => {
    expect(meanBrier([{ p: 1, o: 1 }, { p: 0, o: 1 }])).toBeCloseTo(0.5, 2);
    expect(Number.isNaN(meanBrier([]))).toBe(true);
  });
});

describe("logScore", () => {
  it("is 0 for perfect certainty on the truth, negative otherwise", () => {
    expect(logScore(0.999, 1)).toBeCloseTo(Math.log(0.999), 6);
    expect(logScore(0.5, 1)).toBeCloseTo(Math.log(0.5), 10);
    expect(logScore(0.1, 1)).toBeLessThan(logScore(0.5, 1));
  });
});

describe("calibrationBuckets", () => {
  it("computes hit rates per bucket", () => {
    const buckets = calibrationBuckets([
      { probability: 0.05, outcome: 0 },
      { probability: 0.08, outcome: 0 },
      { probability: 0.85, outcome: 1 },
      { probability: 0.92, outcome: 1 },
    ]);
    expect(buckets).toHaveLength(10);
    expect(buckets[0].n).toBe(2);
    expect(buckets[0].hitRate).toBe(0);
    expect(buckets[8].n).toBe(1); // 0.85
    expect(buckets[8].hitRate).toBe(1);
    expect(buckets[9].n).toBe(1); // 0.92
    expect(buckets[9].hitRate).toBe(1);
    expect(buckets[5].n).toBe(0);
  });
});

describe("parseOutcome", () => {
  it("parses binary yes/no variants", () => {
    expect(parseOutcome("yes", "binary")).toEqual({ score: 1, normalized: "yes" });
    expect(parseOutcome("No", "binary")).toEqual({ score: 0, normalized: "no" });
    expect(parseOutcome("1", "binary").score).toBe(1);
  });
  it("parses correct/incorrect for non-binary", () => {
    expect(parseOutcome("correct", "numeric")).toEqual({ score: 1, normalized: "correct" });
    expect(parseOutcome("incorrect", "timing").score).toBe(0);
  });
  it("rejects garbage", () => {
    expect(() => parseOutcome("maybe", "binary")).toThrow();
  });
});
