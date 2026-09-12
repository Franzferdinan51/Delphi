import { describe, it, expect } from "vitest";
import { confidenceScore, confidenceBreakdown } from "../src/confidence.js";

// Full council participating (4/4) unless a test overrides it.
const base = {
  spread: 0,
  priorDistance: 0 as number | null,
  researchResults: 10,
  resolvedTotal: 25,
  usableCouncilors: 4,
  councilSize: 4,
};

describe("confidence score", () => {
  it("is 100 for a perfect forecast setup", () => {
    const { score, breakdown } = confidenceScore({ ...base });
    expect(score).toBe(100);
    expect(breakdown.agreement).toBe(100);
    expect(breakdown.priorConvergence).toBe(100);
    expect(breakdown.evidence).toBe(100);
    expect(breakdown.trackRecord).toBe(100);
  });

  it("penalizes wide council disagreement", () => {
    const breakdown = confidenceBreakdown({ ...base, spread: 60 });
    expect(breakdown.agreement).toBe(0);
  });

  it("scales agreement down when councilors error out", () => {
    const full = confidenceBreakdown({ ...base });
    expect(full.agreement).toBe(100);
    const half = confidenceBreakdown({ ...base, usableCouncilors: 2 });
    expect(half.agreement).toBe(50);
    const quarter = confidenceBreakdown({ ...base, usableCouncilors: 1 });
    expect(quarter.agreement).toBe(25);
  });

  it("is neutral (60) on prior convergence when no priors exist", () => {
    const breakdown = confidenceBreakdown({ ...base, priorDistance: null });
    expect(breakdown.priorConvergence).toBe(60);
  });

  it("penalizes large moves away from the priors", () => {
    const breakdown = confidenceBreakdown({ ...base, priorDistance: 40 });
    expect(breakdown.priorConvergence).toBeLessThan(20);
  });

  it("scales evidence and track record with saturation", () => {
    const low = confidenceBreakdown({ ...base, researchResults: 0, resolvedTotal: 0 });
    expect(low.evidence).toBe(0);
    expect(low.trackRecord).toBe(0);
    const mid = confidenceBreakdown({ ...base, researchResults: 4, resolvedTotal: 10 });
    expect(mid.evidence).toBe(56);
    expect(mid.trackRecord).toBe(50);
  });

  it("blends components with the documented weights", () => {
    // agreement 0, prior 60, evidence 0, track 0 → 0.25*60 = 15
    const { score } = confidenceScore({
      ...base,
      spread: 60,
      priorDistance: null,
      researchResults: 0,
      resolvedTotal: 0,
    });
    expect(score).toBe(15);
  });

  it("always stays within 0-100", () => {
    const { score } = confidenceScore({
      ...base,
      spread: 500,
      priorDistance: 500,
      researchResults: -3,
      resolvedTotal: -3,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
