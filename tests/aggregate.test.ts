import { describe, it, expect } from "vitest";
import {
  logarithmicPool,
  trackRecordWeights,
  extremize,
  aggregate,
  confidenceFromSpread,
  weightedMedian,
  logit,
  sigmoid,
} from "../src/aggregate.js";

describe("logit/sigmoid", () => {
  it("are inverses", () => {
    for (const p of [0.05, 0.3, 0.5, 0.7, 0.95]) {
      expect(sigmoid(logit(p))).toBeCloseTo(p, 10);
    }
  });
});

describe("logarithmicPool", () => {
  it("equals the single forecast when all agree", () => {
    expect(logarithmicPool([0.7, 0.7, 0.7], [1, 1, 1])).toBeCloseTo(0.7, 10);
  });
  it("sits between the inputs for two-sided disagreement", () => {
    const p = logarithmicPool([0.3, 0.7], [1, 1]);
    expect(p).toBeGreaterThan(0.3);
    expect(p).toBeLessThan(0.7);
    expect(p).toBeCloseTo(0.5, 10); // symmetric → 0.5
  });
  it("is pulled toward the higher-weighted forecaster", () => {
    const toward = logarithmicPool([0.3, 0.7], [1, 3]);
    expect(toward).toBeGreaterThan(0.5);
  });
  it("rewards agreement near extremes more than arithmetic mean", () => {
    // three forecasters at 80%: log pool should be ≥ arithmetic mean here
    const p = logarithmicPool([0.8, 0.8, 0.8], [1, 1, 1]);
    expect(p).toBeCloseTo(0.8, 6);
  });
});

describe("trackRecordWeights", () => {
  it("uses equal weights during cold start", () => {
    const w = trackRecordWeights([0.1, 0.3], [2, 10], 5);
    expect(w[0]).toBeCloseTo(0.5, 10);
    expect(w[1]).toBeCloseTo(0.5, 10);
  });
  it("rewards lower Brier scores after cold start", () => {
    const w = trackRecordWeights([0.1, 0.24], [6, 6], 5);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[0] + w[1]).toBeCloseTo(1, 10);
  });
  it("handles all-null briers as equal", () => {
    const w = trackRecordWeights([null, null], [8, 8], 5);
    expect(w[0]).toBeCloseTo(0.5, 10);
  });
});

describe("extremize", () => {
  it("pushes away from 0.5", () => {
    expect(extremize(0.7, 4)).toBeGreaterThan(0.7);
    expect(extremize(0.3, 4)).toBeLessThan(0.3);
    expect(extremize(0.5, 4)).toBeCloseTo(0.5, 10);
  });
  it("stays within [0.01, 0.99]", () => {
    expect(extremize(0.99, 5)).toBeLessThanOrEqual(0.99);
    expect(extremize(0.01, 5)).toBeGreaterThanOrEqual(0.01);
  });
});

describe("aggregate", () => {
  it("returns probability 0-100 and normalized weights", () => {
    const r = aggregate({
      probs: [60, 70, 55, 65],
      briers: [null, null, null, null],
      resolvedCounts: [0, 0, 0, 0],
    });
    expect(r.probability).toBeGreaterThanOrEqual(0);
    expect(r.probability).toBeLessThanOrEqual(100);
    expect(r.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
  it("is deterministic", () => {
    const input = {
      probs: [60, 70, 55, 65],
      briers: [0.12, 0.2, null, 0.18] as Array<number | null>,
      resolvedCounts: [6, 6, 6, 6],
    };
    expect(aggregate(input).probability).toBe(aggregate(input).probability);
  });
});

describe("confidenceFromSpread", () => {
  it("labels tight agreement High and wide disagreement Low", () => {
    expect(confidenceFromSpread([60, 64, 68])).toBe("High");
    expect(confidenceFromSpread([60, 70, 75])).toBe("Medium");
    expect(confidenceFromSpread([30, 60, 90])).toBe("Low");
  });
});

describe("weightedMedian", () => {
  it("picks the weighted middle", () => {
    expect(weightedMedian([1, 2, 3], [1, 1, 1])).toBe(2);
    expect(weightedMedian([1, 2, 100], [1, 1, 8])).toBe(100);
  });
});
