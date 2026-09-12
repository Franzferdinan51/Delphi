/**
 * Delphi configuration — env vars with sane local-first defaults.
 */
import type { ProviderConfig } from "./types.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILTIN_PROVIDER_IDS } from "./types.js";

export const VERSION = "0.2.0";
export const DEFAULT_PORT = 8790;

/**
 * Custom OpenAI-compatible endpoints, from the DELPHI_PROVIDERS env var.
 *
 * A JSON array of objects: { id, endpoint, name?, model?, apiKey? }.
 * Example:
 *   DELPHI_PROVIDERS='[{"id":"deepseek","name":"DeepSeek","endpoint":"https://api.deepseek.com/v1","model":"deepseek-chat","apiKey":"sk-..."}]'
 *
 * Keys may also be supplied via DELPHI_PROVIDER_<ID>_API_KEY (and
 * _ENDPOINT / _MODEL overrides), so secrets don't have to live in the JSON.
 */
export function customProviders(): ProviderConfig[] {
  const raw = (process.env.DELPHI_PROVIDERS || "").trim();
  if (!raw) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new Error("DELPHI_PROVIDERS is not valid JSON.");
  }
  if (!Array.isArray(arr)) {
    throw new Error("DELPHI_PROVIDERS must be a JSON array of provider objects.");
  }
  const builtins = new Set<string>(BUILTIN_PROVIDER_IDS);
  return arr.map((spec, i) => {
    const s = (spec || {}) as Record<string, unknown>;
    const id = String(s.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!id) throw new Error(`DELPHI_PROVIDERS[${i}]: "id" is required.`);
    if (builtins.has(id)) {
      throw new Error(
        `DELPHI_PROVIDERS[${i}]: id "${id}" collides with a built-in provider. Built-ins are tuned via their own env vars (e.g. LMSTUDIO_URL, MINIMAX_MODEL, MINIMAX_API_KEY).`,
      );
    }
    const endpoint = String(s.endpoint || "").trim().replace(/\/$/, "");
    if (!endpoint) throw new Error(`DELPHI_PROVIDERS[${i}]: "endpoint" is required.`);
    const envKey = (field: string) => `DELPHI_PROVIDER_${id.toUpperCase().replace(/-/g, "_")}_${field}`;
    return {
      id,
      name: String(s.name || id),
      endpoint: process.env[envKey("ENDPOINT")] || endpoint,
      model: process.env[envKey("MODEL")] || String(s.model || ""),
      apiKey: process.env[envKey("API_KEY")] || String(s.apiKey || ""),
      connected: false,
      availableModels: [],
    } satisfies ProviderConfig;
  });
}

export function defaultProviders(): ProviderConfig[] {
  return [
    {
      id: "lmstudio",
      name: "LM Studio",
      endpoint: process.env.LMSTUDIO_URL || "http://127.0.0.1:1234/v1",
      model: process.env.LMSTUDIO_MODEL || "",
      apiKey: process.env.LM_API_TOKEN || "",
      connected: false,
      availableModels: [],
    },
    {
      id: "minimax",
      name: "MiniMax",
      endpoint: process.env.MINIMAX_ENDPOINT || "https://api.minimax.io/v1",
      model: process.env.MINIMAX_MODEL || "",
      apiKey: process.env.MINIMAX_API_KEY || "",
      connected: false,
      availableModels: [],
    },
    {
      id: "grok",
      name: "Grok",
      endpoint: process.env.GROK_ENDPOINT || "https://api.x.ai/v1",
      model: process.env.GROK_MODEL || "",
      apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY || "",
      connected: false,
      availableModels: [],
    },
    {
      id: "openai",
      name: "OpenAI",
      endpoint: process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "",
      apiKey: process.env.OPENAI_API_KEY || "",
      connected: false,
      availableModels: [],
    },
    {
      id: "nvidia",
      name: "NVIDIA NIM",
      endpoint: process.env.NVIDIA_ENDPOINT || "https://integrate.api.nvidia.com/v1",
      model: process.env.NVIDIA_MODEL || "",
      apiKey: process.env.NVIDIA_API_KEY || "",
      connected: false,
      availableModels: [],
    },
    {
      id: "opencode",
      name: "OpenCode Zen (free)",
      endpoint: process.env.OPENCODE_ENDPOINT || "https://opencode.ai/zen/v1",
      model: process.env.OPENCODE_MODEL || "",
      apiKey: process.env.OPENCODE_API_KEY || "",
      connected: false,
      availableModels: [],
    },
    {
      id: "meta",
      name: "Meta Muse Spark",
      endpoint: process.env.META_ENDPOINT || "https://api.meta.ai/v1",
      model: process.env.META_MODEL || "",
      apiKey: process.env.META_API_KEY || process.env.MODEL_API_KEY || "",
      connected: false,
      availableModels: [],
    },
    // Arbitrary custom OpenAI-compatible endpoints (DELPHI_PROVIDERS).
    ...customProviders(),
  ];
}

/** Councilor → provider reassignment. Env wins over the saved file. Empty persona default = auto. */
export function councilorProviderOverrides(): Record<string, string> {
  const out: Record<string, string> = { ...readCouncilorProviders() };
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^DELPHI_COUNCILOR_PROVIDER_(.+)$/.exec(k);
    if (m && v?.trim()) out[m[1].toLowerCase().replace(/_/g, "-")] = v.trim();
  }
  return out;
}

function councilorProvidersPath(): string {
  return process.env.DELPHI_COUNCILOR_PROVIDERS_FILE || join(dirname(DELPHI.dbPath), "councilor-providers.json");
}

export function readCouncilorProviders(): Record<string, string> {
  try {
    const data = JSON.parse(readFileSync(councilorProvidersPath(), "utf8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function writeCouncilorProvider(councilorId: string, providerId: string): void {
  const choices = readCouncilorProviders();
  if (providerId.trim()) choices[councilorId] = providerId.trim();
  else delete choices[councilorId];
  mkdirSync(dirname(councilorProvidersPath()), { recursive: true });
  writeFileSync(councilorProvidersPath(), JSON.stringify(choices, null, 2) + "\n");
}

/** Pick a provider for a persona: saved/env pin, else round-robin across usable (or all, in demo). */
export function assignProviderId(
  councilorId: string,
  providers: ProviderConfig[],
  opts: { demoMode: boolean; index: number },
): string {
  const pinned = councilorProviderOverrides()[councilorId];
  const pool = opts.demoMode ? providers : providers.filter(isProviderUsable);
  if (pinned) {
    const hit = pool.find((p) => p.id === pinned) || providers.find((p) => p.id === pinned);
    if (hit) return hit.id;
  }
  if (!pool.length) {
    throw new Error("No usable providers. Connect one provider and pick a model, or run with demo mode.");
  }
  return pool[opts.index % pool.length].id;
}

/**
 * Parse an OpenAI-style model catalog (`{data:[{id}]}` or a bare array)
 * into sorted unique model IDs.
 */
function parseModelCatalog(data: unknown): string[] {
  const raw = Array.isArray(data) ? data : (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(raw)) return [];
  const ids = raw
    .map((m) => {
      const id = (m as { id?: unknown } | null)?.id;
      return typeof id === "string" ? id.trim() : "";
    })
    .filter((id) => id.length > 0);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * Pull the live model catalog from a provider's OpenAI-compatible /models
 * endpoint. Delphi never hardcodes model IDs -- this is the source of truth
 * for what a provider can run. Returns [] when unreachable.
 */
export async function listProviderModels(p: ProviderConfig, timeoutMs = 8000): Promise<string[]> {
  try {
    const res = await fetch(`${p.endpoint.replace(/\/$/, "")}/models`, {
      headers: p.apiKey.trim() ? { Authorization: `Bearer ${p.apiKey.trim()}` } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return [];
    return parseModelCatalog(await res.json());
  } catch {
    return [];
  }
}

/** Where the user's chosen provider models persist (next to the SQLite db). */
function modelChoicesPath(): string {
  return (
    process.env.DELPHI_PROVIDER_MODELS_FILE || join(dirname(DELPHI.dbPath), "provider-models.json")
  );
}

/** Provider id -> chosen model id, as saved by the user. */
export function readModelChoices(): Record<string, string> {
  try {
    const data = JSON.parse(readFileSync(modelChoicesPath(), "utf8")) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the user's model choice for a provider. */
export function writeModelChoice(id: string, model: string): void {
  const choices = readModelChoices();
  choices[id] = model;
  mkdirSync(dirname(modelChoicesPath()), { recursive: true });
  writeFileSync(modelChoicesPath(), JSON.stringify(choices, null, 2) + "\n");
}

/**
 * Resolve providers: connectivity plus the live model catalog pulled from
 * each provider's /models API. Model precedence: explicit env var, then the
 * saved user choice, then auto-pick when the provider exposes exactly one
 * model, otherwise unset ("").
 */
export async function resolveProviders(
  providers: ProviderConfig[],
): Promise<ProviderConfig[]> {
  const choices = readModelChoices();
  return Promise.all(
    providers.map(async (p) => {
      const availableModels = await listProviderModels(p);
      // Keyed providers are trusted even if /models is unhappy; keyless
      // local servers (LM Studio, Ollama, vLLM, etc.) must answer the probe.
      const connected = p.apiKey.trim().length > 0 ? true : availableModels.length > 0;
      let model = p.model.trim();
      if (!model && choices[p.id]) model = choices[p.id];
      if (!model && availableModels.length === 1) model = availableModels[0];
      return { ...p, connected, model, availableModels };
    }),
  );
}

/** A provider can run live forecasts only when reachable AND a model is chosen. */
export function isProviderUsable(p: ProviderConfig): boolean {
  return p.connected && p.model.trim().length > 0;
}

export function providerById(
  providers: ProviderConfig[],
  id: string,
): ProviderConfig {
  const found = providers.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown provider: ${id}`);
  return found;
}

export const SEARCH = {
  searxngUrl: (process.env.SEARXNG_URL || "http://127.0.0.1:8080").replace(
    /\/$/,
    "",
  ),
  tavilyApiKey: process.env.TAVILY_API_KEY || "",
  braveApiKey: process.env.BRAVE_API_KEY || "",
  /** Cache TTL for research queries (5 minutes). */
  cacheTtlMs: 5 * 60 * 1000,
  /** Max search queries per question and results per query. */
  maxQueries: 2,
  maxResults: 6,
};

export const DELPHI = {
  port: Number(process.env.DELPHI_PORT || DEFAULT_PORT),
  host: process.env.DELPHI_HOST || "127.0.0.1",
  dbPath:
    process.env.DELPHI_DB ||
    new URL("../data/delphi.db", import.meta.url).pathname,
  production: process.env.NODE_ENV === "production",
  /** Live forecasts are the default in production. Local/dev still demo unless DELPHI_DEMO=false. */
  demoDefault: (process.env.DELPHI_DEMO || (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() !== "false",
  /** Fake resolved examples — off in production unless DELPHI_SEED=true. */
  seed: (process.env.DELPHI_SEED || (process.env.NODE_ENV === "production" ? "false" : "true")).toLowerCase() === "true",
  /** Councilors need this many resolved forecasts before track-record weights kick in. */
  coldStartThreshold: 5,
  /**
   * Max parallel councilor requests per deliberation round. Local inference
   * servers get flaky under full parallel load (LM Studio's
   * speculative-batching engine bug), so rounds are staggered. Override with
   * DELPHI_CONCURRENCY.
   */
  councilConcurrency: Math.max(1, Number(process.env.DELPHI_CONCURRENCY) || 2),
};
