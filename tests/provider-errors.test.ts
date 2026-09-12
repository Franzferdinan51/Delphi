import { afterEach, describe, expect, it, vi } from "vitest";
import { checkQuality, parseOpinion } from "../src/quality.js";
import { askLive, chatCompletion } from "../src/providers.js";
import { COUNCILORS } from "../src/council.js";
const provider = { id: "test", name: "Test", endpoint: "http://provider.invalid/v1", apiKey: "test-secret-never-real", model: "test", availableModels: [], connected: true };
afterEach(() => vi.unstubAllGlobals());
describe("provider output reliability", () => {
  it.each(["", "unknown", "NaN", "101", "-5"])("rejects unusable probability %s even with fluent reasoning", (probability) => {
    const text = `<probability>${probability}</probability><reasoning>The event depends on several independent drivers including regulatory approval, funding, political support, technical feasibility and the availability of resources before the stated deadline.</reasoning>`;
    expect(checkQuality(text).passed).toBe(false);
  });
  it.each([0, 0.5, 63.75, 100])("preserves probability %s", (p) => {
    expect(parseOpinion(`<probability>${p}%</probability>`).probability).toBe(p);
  });
  it("does not accept a second quality-gate failure as live", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "No usable forecast." } }] }))));
    const result = await askLive(provider, COUNCILORS[0], { question: "Test?", questionType: "binary", deadline: "2027-01-01", context: "", resolutionCriteria: "", researchNotes: "" });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Quality gate failed");
  });
  it("does not relay upstream error bodies that may echo credentials", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(provider.apiKey, { status: 401 })));
    await expect(chatCompletion(provider, "", "")).rejects.not.toThrow(provider.apiKey);
  });
});
