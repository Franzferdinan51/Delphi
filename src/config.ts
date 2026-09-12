/**
 * Delphi configuration — env vars with sane local-first defaults.
 */
import type { ProviderConfig } from "./types.js";
import { BUILTIN_PROVIDER_IDS } from "./types.js";

export const VERSION = "0.1.0";
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
      model: process.env[envKey("MODEL")] || String(s.model || "default"),
      apiKey: process.env[envKey("API_KEY")] || String(s.apiKey || ""),
      connected: false,
    } satisfies ProviderConfig;
  });
}

export function defaultProviders(): ProviderConfig[] {
  return [
    {
      id: "lmstudio",
      name: "LM Studio",
      endpoint: process.env.LMSTUDIO_URL || "http://127.0.0.1:1234/v1",
      model: process.env.LMSTUDIO_MODEL || "local-model",
      apiKey: process.env.LM_API_TOKEN || "",
      connected: false,
    },
    {
      id: "minimax",
      name: "MiniMax",
      endpoint: process.env.MINIMAX_ENDPOINT || "https://api.minimax.io/v1",
      model: process.env.MINIMAX_MODEL || "MiniMax-M2.7",
      apiKey: process.env.MINIMAX_API_KEY || "",
      connected: false,
    },
    {
      id: "grok",
      name: "Grok",
      endpoint: process.env.GROK_ENDPOINT || "https://api.x.ai/v1",
      model: process.env.GROK_MODEL || "grok-4.5",
      apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY || "",
      connected: false,
    },
    {
      id: "openai",
      name: "OpenAI",
      endpoint: process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1",
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY || "",
      connected: false,
    },
    // Arbitrary custom OpenAI-compatible endpoints (DELPHI_PROVIDERS).
    ...customProviders(),
  ];
}

/** Councilor → provider reassignment, e.g. DELPHI_COUNCILOR_PROVIDER_SKEPTIC=deepseek */
export function councilorProviderOverrides(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    const m = /^DELPHI_COUNCILOR_PROVIDER_(.+)$/.exec(k);
    if (m && v?.trim()) out[m[1].toLowerCase().replace(/_/g, "-")] = v.trim();
  }
  return out;
}

/**
 * Mark providers connected: probe local/keyless endpoints, otherwise trust
 * an API key's presence. LM Studio is probed first because it's the
 * default local engine.
 */
export async function resolveProviders(
  providers: ProviderConfig[],
): Promise<ProviderConfig[]> {
  return Promise.all(
    providers.map(async (p) => {
      if (p.apiKey.trim()) return { ...p, connected: true };
      // Keyless local servers (LM Studio, Ollama, vLLM, …) allow probing.
      try {
        const res = await fetch(
          `${p.endpoint.replace(/\/$/, "")}/models`,
          {
            headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
            signal: AbortSignal.timeout(5000),
          },
        );
        return { ...p, connected: res.ok };
      } catch {
        return { ...p, connected: false };
      }
    }),
  );
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
  /** Demo mode works with zero credentials. */
  demoDefault: (process.env.DELPHI_DEMO || "true").toLowerCase() !== "false",
  /** Councilors need this many resolved forecasts before track-record weights kick in. */
  coldStartThreshold: 5,
};
