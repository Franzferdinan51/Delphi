import { describe, it, expect } from "vitest";
import { checkQuality, parseOpinion } from "../src/quality.js";
import { selectCouncilors, COUNCILORS } from "../src/council.js";

describe("checkQuality", () => {
  const good = `<probability>67</probability><confidence>Medium</confidence>
<reasoning>${"A well-formed councilor response with enough substance to pass the gate. ".repeat(6)}</reasoning>`;
  it("passes a well-formed response", () => {
    const r = checkQuality(good);
    expect(r.passed).toBe(true);
  });
  it("fails short responses", () => {
    const r = checkQuality("<probability>50</probability>");
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.includes("Too short"))).toBe(true);
  });
  it("fails missing tags", () => {
    const r = checkQuality("x".repeat(200));
    expect(r.passed).toBe(false);
    expect(r.issues.some((i) => i.includes("Missing tag"))).toBe(true);
  });
  it("fails forbidden patterns", () => {
    const r = checkQuality(`${good} As an AI, I cannot predict the future.`);
    expect(r.passed).toBe(false);
  });
});

describe("parseOpinion", () => {
  it("extracts XML tags", () => {
    const p = parseOpinion(
      `<probability>72</probability><confidence>High</confidence>` +
        `<forecast_answer>Yes</forecast_answer>` +
        `<reasoning>${"Solid reasoning. ".repeat(10)}</reasoning>` +
        `<drivers>a; b</drivers>`,
    );
    expect(p.probability).toBe(72);
    expect(p.confidence).toBe("High");
    expect(p.answer).toBe("Yes");
    expect(p.drivers).toEqual(["a", "b"]);
  });
  it("falls back to prose percentages", () => {
    const p = parseOpinion(`I think there is a 63% chance of this happening. ${"x ".repeat(60)}`);
    expect(p.probability).toBe(63);
  });
  it("clamps to 0-100", () => {
    const p = parseOpinion("<probability>150</probability>" + "x ".repeat(60));
    expect(p.probability).toBe(100);
  });
});

describe("selectCouncilors", () => {
  it("returns the requested count", () => {
    expect(selectCouncilors("Will the Fed cut rates?", "", 3)).toHaveLength(3);
    expect(selectCouncilors("Will the Fed cut rates?", "", 5)).toHaveLength(5);
  });
  it("prefers domain-relevant personae", () => {
    const picked = selectCouncilors("Will Bitcoin exceed $200k as crypto markets rally?", "", 4);
    const ids = picked.map((c) => c.id);
    expect(ids).toContain("domain-expert");
  });
  it("always has the full roster available", () => {
    expect(COUNCILORS.map((c) => c.id)).toEqual([
      "base-rate-analyst",
      "domain-expert",
      "skeptic",
      "superforecaster",
      "quant",
    ]);
  });
});
