import { describe, it, expect } from "vitest";
import { confidenceScore, confidenceBreakdown } from "../src/confidence.js";

describe("confidence score", () => {
  it("is 100 for a perfect forecast setup", () => {
    const { score, breakdown } = confidenceScore({
      spread: 0,
      priorDistance: 0,
      researchResults: 10,
      resolvedTotal: 25,
    });
    expect(score).toBe(100);
    expect(breakdown.agreement).toBe(100);
    expect(breakdown.priorConvergence).toBe(100);
    expect(breakdown.evidence).toBe(100);
    expect(breakdown.trackRecord).toBe(100);
  });

  it("penalizes wide council disagreement", () => {
    const breakdown = confidenceBreakdown({
      spread: 60,
      priorDistance: 0,
      researchResults: 10,
      resolvedTotal: 25,
    });
    expect(breakdown.agreement).toBe(0);
  });

  it("is neutral (60) on prior convergence when no priors exist", () => {
    const breakdown = confidenceBreakdown({
      spread: 0,
      priorDistance: null,
      researchResults: 10,
      resolvedTotal: 25,
    });
    expect(breakdown.priorConvergence).toBe(60);
  });

  it("penalizes large moves away from the priors", () => {
    const breakdown = confidenceBreakdown({
      spread: 0,
      priorDistance: 40,
      researchResults: 10,
      resolvedTotal: 25,
    });
    expect(breakdown.priorConvergence).toBeLessThan(20);
  });

  it("scales evidence and track record with saturation", () => {
    const low = confidenceBreakdown({
      spread: 0,
      priorDistance: 0,
      researchResults: 0,
      resolvedTotal: 0,
    });
    expect(low.evidence).toBe(0);
    expect(low.trackRecord).toBe(0);
    const mid = confidenceBreakdown({
      spread: 0,
      priorDistance: 0,
      researchResults: 4,
      resolvedTotal: 10,
    });
    expect(mid.evidence).toBe(56);
    expect(mid.trackRecord).toBe(50);
  });

  it("blends components with the documented weights", () => {
    // agreement 0, prior 60, evidence 0, track 0 → 0.25*60 = 15
    const { score } = confidenceScore({
      spread: 60,
      priorDistance: null,
      researchResults: 0,
      resolvedTotal: 0,
    });
    expect(score).toBe(15);
  });

  it("always stays within 0-100", () => {
    const { score } = confidenceScore({
      spread: 500,
      priorDistance: 500,
      researchResults: -3,
      resolvedTotal: -3,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
