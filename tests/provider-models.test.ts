import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listProviderModels,
  resolveProviders,
  readModelChoices,
  writeModelChoice,
  isProviderUsable,
} from "../src/config.js";
import type { ProviderConfig } from "../src/types.js";

const base: ProviderConfig = {
  id: "test",
  name: "Test",
  endpoint: "http://127.0.0.1:9/v1",
  model: "",
  apiKey: "",
  connected: false,
  availableModels: [],
};

function modelsResponse(ids: string[]) {
  return { ok: true, json: async () => ({ data: ids.map((id) => ({ id })) }) } as unknown as Response;
}

describe("listProviderModels", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("parses OpenAI-style {data:[{id}]} catalogs", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(modelsResponse(["b", "a", "a"]));
    expect(await listProviderModels(base)).toEqual(["a", "b"]);
  });

  it("parses bare-array catalogs", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => [{ id: "x" }],
    } as unknown as Response);
    expect(await listProviderModels(base)).toEqual(["x"]);
  });

  it("returns [] on non-ok responses and on fetch failure", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValue({ ok: false } as unknown as Response);
    expect(await listProviderModels(base)).toEqual([]);
    f.mockRejectedValue(new Error("down"));
    expect(await listProviderModels(base)).toEqual([]);
  });

  it("sends the API key when set", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    f.mockResolvedValue(modelsResponse([]));
    await listProviderModels({ ...base, apiKey: "sk-secret" });
    const headers = f.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-secret");
  });
});

describe("model resolution precedence", () => {
  const file = join(tmpdir(), `delphi-test-models-${process.pid}.json`);
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(modelsResponse(["m1", "m2"])),
    );
    process.env.DELPHI_PROVIDER_MODELS_FILE = file;
    delete process.env.TEST_MODEL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...OLD_ENV };
  });

  it("explicit env model wins", async () => {
    process.env.TEST_MODEL = "env-model";
    const [p] = await resolveProviders([{ ...base, model: process.env.TEST_MODEL }]);
    expect(p.model).toBe("env-model");
  });

  it("falls back to the saved choice", async () => {
    writeModelChoice("test", "saved-model");
    expect(readModelChoices()).toEqual({ test: "saved-model" });
    const [p] = await resolveProviders([base]);
    expect(p.model).toBe("saved-model");
  });

  it("auto-picks when the catalog has exactly one model", async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(modelsResponse(["only"]));
    const [p] = await resolveProviders([{ ...base, id: "solo" }]);
    expect(p.model).toBe("only");
  });

  it("leaves model unset when the catalog has several and nothing is chosen", async () => {
    const [p] = await resolveProviders([{ ...base, id: "multi" }]);
    expect(p.model).toBe("");
    expect(p.availableModels).toEqual(["m1", "m2"]);
    expect(isProviderUsable(p)).toBe(false);
  });

  it("marks keyed providers connected and keyless ones by probe", async () => {
    const f = fetch as unknown as ReturnType<typeof vi.fn>;
    const [keyed, keyless] = await resolveProviders([
      { ...base, id: "k1", apiKey: "sk-x" },
      { ...base, id: "k2" },
    ]);
    expect(keyed.connected).toBe(true);
    expect(keyless.connected).toBe(true);
    f.mockResolvedValue({ ok: false } as unknown as Response);
    const [down] = await resolveProviders([{ ...base, id: "k3" }]);
    expect(down.connected).toBe(false);
    expect(down.availableModels).toEqual([]);
  });
});

describe("isProviderUsable", () => {
  it("requires connectivity and a chosen model", () => {
    expect(isProviderUsable({ ...base, connected: true, model: "m" })).toBe(true);
    expect(isProviderUsable({ ...base, connected: true, model: "" })).toBe(false);
    expect(isProviderUsable({ ...base, connected: false, model: "m" })).toBe(false);
  });
});
