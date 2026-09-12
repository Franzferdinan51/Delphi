import { afterEach, describe, expect, it, vi } from "vitest";
import { checkQuality, parseOpinion } from "../src/quality.js";
import {
  askLive,
  chatCompletion,
  classifyProviderError,
  mapWithConcurrency,
} from "../src/providers.js";
import { COUNCILORS } from "../src/council.js";
const provider = { id: "test", name: "Test", endpoint: "http://provider.invalid/v1", apiKey: "test-secret-never-real", model: "test", availableModels: [], connected: true };
const brief = { question: "Test?", questionType: "binary" as const, deadline: "2027-01-01", context: "", resolutionCriteria: "", researchNotes: "" };
const noWait = { retryDelaysMs: [0, 0, 0] };
// ≥120 chars so the quality gate passes on format.
const goodOpinion =
  `<probability>62</probability><reasoning>The base rate for comparable technology bans is low, but the resolution criteria are narrow and name LocalAI specifically, which keeps the tail risk real. Countervailing drivers include enforcement difficulty and the open-source precedent, so I land at sixty-two percent.</reasoning>`;
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
  it("classifies deterministic errors (auth, context overflow, bad shape)", () => {
    expect(classifyProviderError(401, "invalid api key")).toBe("deterministic");
    expect(classifyProviderError(403, "forbidden")).toBe("deterministic");
    expect(classifyProviderError(400, "This model's maximum context length is 8192 tokens, however you requested 12610 tokens")).toBe("deterministic");
    expect(classifyProviderError(400, "invalid_request: model_not_found")).toBe("deterministic");
  });
  it("classifies transient errors (5xx, rate limits, engine crashes, network)", () => {
    expect(classifyProviderError(500, "internal server error")).toBe("transient");
    expect(classifyProviderError(429, "rate limit exceeded")).toBe("transient");
    expect(classifyProviderError(null, "fetch failed")).toBe("transient");
    // LM Studio's speculative-decoding engine fault arrives as a 400 with a
    // server_error body — retrying is correct, failing fast is not.
    expect(classifyProviderError(400, "failed to generate: speculative batch index 8 is not inside the current sub-batch [0, 8)")).toBe("transient");
  });
  it("fails fast on deterministic context-overflow 400s instead of retry-storming", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: { message: "This model's maximum context length is 8192 tokens, however you requested 12610 tokens" } }),
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await askLive(provider, COUNCILORS[0], brief, undefined, noWait);
    expect(result.status).toBe("error");
    expect(result.error).toContain("maximum context length");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("retries transient 500s with backoff and recovers", async () => {
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: goodOpinion } }] }));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom", { status: 502 }))
      .mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch", fetchMock);
    const result = await askLive(provider, COUNCILORS[0], brief, undefined, noWait);
    expect(result.status).toBe("live");
    expect(result.parsed.probability).toBe(62);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("retries the LM Studio speculative-batching 400 and recovers", async () => {
    const engineFault = new Response(
      JSON.stringify({ error: { code: 500, message: "failed to generate: speculative batch index 8 is not inside the current sub-batch [0, 8)" } }),
      { status: 400 },
    );
    const ok = new Response(JSON.stringify({ choices: [{ message: { content: goodOpinion } }] }));
    const fetchMock = vi.fn().mockResolvedValueOnce(engineFault).mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch", fetchMock);
    const result = await askLive(provider, COUNCILORS[0], brief, undefined, noWait);
    expect(result.status).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("makes 4 total attempts (3 retries, 2s/6s/15s) on persistent transient failures", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await askLive(provider, COUNCILORS[0], brief, undefined, noWait);
    expect(result.status).toBe("error");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it("surfaces the redacted upstream detail on persistent failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "engine overloaded, try again" } }), { status: 503 })));
    const result = await askLive(provider, COUNCILORS[0], brief, undefined, noWait);
    expect(result.status).toBe("error");
    expect(result.error).toContain("engine overloaded");
    expect(result.error).not.toContain(provider.apiKey);
  });
});

describe("mapWithConcurrency", () => {
  it("caps in-flight work at the limit and preserves order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBeGreaterThan(1);
  });
  it("handles limits larger than the input and empty inputs", async () => {
    expect(await mapWithConcurrency([1, 2], 10, async (n) => n + 1)).toEqual([2, 3]);
    expect(await mapWithConcurrency([], 2, async (n: number) => n)).toEqual([]);
  });
});
