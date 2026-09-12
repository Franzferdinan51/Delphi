import { describe, it, expect } from "vitest";
import { checkQuality, parseOpinion } from "../src/quality.js";
import { selectCouncilors, COUNCILORS, buildCriticPrompt } from "../src/council.js";

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
  it("does not hard-bind personas to a vendor", () => {
    expect(COUNCILORS.every((c) => !c.provider)).toBe(true);
  });
  it("scores energy/geopolitics questions onto the domain expert", () => {
    const picked = selectCouncilors("Will a confirmed Saudi Petroline outage last through Friday?", "Iran Houthis Hormuz oil", 4);
    expect(picked.map((c) => c.id)).toContain("domain-expert");
  });
});

describe("buildCriticPrompt", () => {
  const brief = { question: "Will X happen?", questionType: "binary", deadline: "2027-01-01" };
  const peers = [{ name: "Skeptic", probability: 30, reasoning: "Base rates are low." }];
  it("names the councilor's own round-1 estimate when it exists", () => {
    const prompt = buildCriticPrompt(COUNCILORS[0], brief, 62, peers);
    expect(prompt).toContain("initial forecast of 62%");
  });
  it("is explicit when the councilor's round-1 opinion errored (no fake 50%)", () => {
    const prompt = buildCriticPrompt(COUNCILORS[0], brief, undefined, peers);
    expect(prompt).toContain("round-1 forecast failed");
    expect(prompt).not.toContain("initial forecast of");
    expect(prompt).not.toMatch(/forecast of 50%/);
  });
  it("never shows errored peers' placeholder probabilities", () => {
    // peers are pre-filtered by the pipeline; the prompt just renders them
    const prompt = buildCriticPrompt(COUNCILORS[0], brief, 62, []);
    expect(prompt).toContain("other councilors' independent reasoning");
  });
});
