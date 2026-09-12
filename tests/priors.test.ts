import { describe, it, expect } from "vitest";
import {
  blendPriors,
  priorsNotes,
  collectPriors,
  guessReferenceClass,
  emptyPriors,
  type PriorSet,
} from "../src/priors.js";
import { memoryDb } from "../src/db.js";

describe("priors", () => {
  it("blendPriors returns null when no priors exist", () => {
    expect(blendPriors(emptyPriors())).toBeNull();
  });

  it("blendPriors of identical priors returns that value", () => {
    const priors: PriorSet = {
      baseRate: { value: 60, referenceClass: "x", source: "t" },
      market: { value: 60, market: "m", url: "u", volumeUsd: 1, source: "polymarket" },
    };
    expect(blendPriors(priors)).toBe(60);
  });

  it("blendPriors lands between disagreeing priors", () => {
    const priors: PriorSet = {
      baseRate: { value: 70, referenceClass: "x", source: "t" },
      market: { value: 50, market: "m", url: "u", volumeUsd: 1, source: "polymarket" },
    };
    const blended = blendPriors(priors)!;
    expect(blended).toBeGreaterThan(50);
    expect(blended).toBeLessThan(70);
  });

  it("blendPriors works with a single prior", () => {
    const priors: PriorSet = {
      baseRate: { value: 30, referenceClass: "x", source: "t" },
      market: null,
    };
    expect(blendPriors(priors)).toBe(30);
  });

  it("priorsNotes renders anchors and the argue-against instruction", () => {
    const priors: PriorSet = {
      baseRate: { value: 45, referenceClass: "elections", source: "demo" },
      market: null,
    };
    const notes = priorsNotes(priors);
    expect(notes).toContain("45%");
    expect(notes).toContain("elections");
    expect(notes).toContain("Bayesian anchors");
  });

  it("priorsNotes is empty when there are no priors", () => {
    expect(priorsNotes(emptyPriors())).toBe("");
  });

  it("collectPriors is deterministic in demo mode", async () => {
    const db = memoryDb();
    const a = await collectPriors("Will the test pass?", "2026-12-31", {
      db,
      provider: null,
      demoMode: true,
    });
    const b = await collectPriors("Will the test pass?", "2026-12-31", {
      db,
      provider: null,
      demoMode: true,
    });
    expect(a).toEqual(b);
    expect(a.baseRate).not.toBeNull();
    expect(a.market).not.toBeNull();
    expect(a.baseRate!.value).toBeGreaterThanOrEqual(1);
    expect(a.baseRate!.value).toBeLessThanOrEqual(99);
  });

  it("collectPriors degrades gracefully with no provider and no network", async () => {
    const db = memoryDb();
    // Non-demo, no provider: base rate null; market lookup may fail offline → null.
    // Must never throw.
    const priors = await collectPriors("zzq unique nonsense query 9x8z", "2026-12-31", {
      db,
      provider: null,
      demoMode: false,
    });
    expect(priors.baseRate).toBeNull();
    expect(priors.market === null || typeof priors.market.value === "number").toBe(true);
  });

  it("guessReferenceClass matches obvious domains", () => {
    expect(guessReferenceClass("Will she win the election?")).toContain("election");
    expect(guessReferenceClass("Will the stock double?")).toContain("asset-price");
    expect(guessReferenceClass("Something random happens")).toContain("binary");
  });
});
