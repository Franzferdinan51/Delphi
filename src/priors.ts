/**
 * Delphi priors — Bayesian anchors collected BEFORE the council deliberates.
 *
 * Two outside views feed every forecast:
 *   1. Base rate: the historical frequency of the reference class, estimated
 *      by a lightweight LLM call (or deterministic heuristics in demo mode).
 *   2. Market prior: the live implied probability from Polymarket when a
 *      sufficiently liquid related market exists (public read-only API).
 *
 * Both are advisory: they are injected into the council's brief as anchors
 * the councilors must explicitly argue for or against moving away from.
 * Priors never override deliberation — they discipline it.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { ProviderConfig, PriorSet, BaseRatePrior, MarketPrior } from "./types.js";
import { getCachedResearch, setCachedResearch } from "./db.js";
import { chatCompletion } from "./providers.js";

export type { PriorSet, BaseRatePrior, MarketPrior };

export const emptyPriors = (): PriorSet => ({ baseRate: null, market: null });

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const clampPct = (v: number): number => Math.max(1, Math.min(99, Math.round(v)));

/** Guess a reference class from keywords; used for demo + fallback labels. */
export function guessReferenceClass(question: string): string {
  const q = question.toLowerCase();
  if (/(election|vote|poll|senate|congress|president)/.test(q)) return "elections with similar polling margins";
  if (/(recession|gdp|fed|rate hike|inflation)/.test(q)) return "macroeconomic turning-point calls";
  if (/(stock|market|price|s&p|nasdaq)/.test(q)) return "asset-price directional calls";
  if (/(startup|launch|product release|ipo)/.test(q)) return "startup/product launch outcomes";
  if (/(bill|law|regulation|congress.*pass)/.test(q)) return "legislative outcomes";
  if (/(war|ceasefire|treaty|conflict)/.test(q)) return "geopolitical event forecasts";
  if (/(nfl|nba|super bowl|playoff|match|tournament)/.test(q)) return "sports outcome forecasts";
  if (/(ai|model release|llm|agi)/.test(q)) return "AI milestone forecasts";
  if (/(fda|drug|trial)/.test(q)) return "clinical-trial outcome forecasts";
  if (/(hurricane|earthquake|weather)/.test(q)) return "extreme-weather forecasts";
  return "comparable binary forecasts";
}

function demoBaseRate(question: string): BaseRatePrior {
  const h = hashStr(`baserate::${question}`);
  return {
    value: 40 + (h % 21), // 40-60, deliberately boring: the outside view
    referenceClass: guessReferenceClass(question),
    source: "demo",
  };
}

function demoMarket(question: string): MarketPrior {
  const h = hashStr(`market::${question}`);
  return {
    value: 42 + (h % 17), // 42-58
    market: `Demo market resembling: ${question.slice(0, 70)}`,
    url: "demo://polymarket",
    volumeUsd: 100000 + (h % 900000),
    source: "demo",
  };
}

const BASE_RATE_SYSTEM = `You are a reference-class forecasting assistant. Your only job is the OUTSIDE VIEW.
Given a forecasting question, identify the most relevant historical reference class and state how often events in that class resolved positively.
Reply with strict JSON only, no other text:
{"referenceClass": "<short label>", "baseRate": <0-100 integer>, "note": "<one sentence>"}`;

/** Ask a live provider for the outside-view base rate. Null on any failure. */
async function liveBaseRate(
  provider: ProviderConfig,
  question: string,
  deadline: string,
): Promise<BaseRatePrior | null> {
  try {
    const text = await chatCompletion(
      provider,
      BASE_RATE_SYSTEM,
      `Question: ${question}\nResolution deadline: ${deadline}\nReturn the JSON object only.`,
      30000,
    );
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as {
      referenceClass?: unknown;
      baseRate?: unknown;
      note?: unknown;
    };
    const value = Number(parsed.baseRate);
    if (!Number.isFinite(value)) return null;
    return {
      value: clampPct(value),
      referenceClass:
        typeof parsed.referenceClass === "string" && parsed.referenceClass.trim()
          ? parsed.referenceClass.trim().slice(0, 120)
          : guessReferenceClass(question),
      source: provider.name,
    };
  } catch {
    return null;
  }
}

// ─── Polymarket ─────────────────────────────────────────────────────────────
// Public read-only gamma API. No key needed. Best-effort: any failure → null.

const POLY_TTL_MS = 10 * 60 * 1000;
const POLY_MIN_VOLUME = 5000;

interface PolyMarket {
  question?: string;
  lastTradePrice?: string;
  volume?: string;
  outcomes?: string;
}

async function polymarketLookup(question: string, db: DatabaseSync): Promise<MarketPrior | null> {
  const cacheKey = `poly:${createHash("sha256").update(question).digest("hex").slice(0, 32)}`;
  try {
    const cached = getCachedResearch(db, cacheKey, POLY_TTL_MS);
    if (cached) return JSON.parse(cached) as MarketPrior;
  } catch {
    /* fall through to live lookup */
  }
  try {
    const short = question.slice(0, 120);
    const res = await fetch(
      `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(short)}`,
      { signal: AbortSignal.timeout(10000), headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const hits = (await res.json()) as Array<{
      events?: Array<{ title?: string; slug?: string; markets?: PolyMarket[] }>;
    }>;
    let best: MarketPrior | null = null;
    for (const hit of hits || []) {
      for (const ev of hit.events || []) {
        for (const m of ev.markets || []) {
          const volume = Number(m.volume || 0);
          if (!Number.isFinite(volume) || volume < POLY_MIN_VOLUME) continue;
          const outcomes = String(m.outcomes || "");
          // Prefer binary Yes/No markets; lastTradePrice is the first outcome's price.
          if (!/yes/i.test(outcomes)) continue;
          const price = Number(m.lastTradePrice);
          if (!Number.isFinite(price) || price <= 0 || price >= 1) continue;
          const candidate: MarketPrior = {
            value: clampPct(price * 100),
            market: String(m.question || ev.title || "Polymarket market").slice(0, 160),
            url: ev.slug ? `https://polymarket.com/event/${ev.slug}` : "https://polymarket.com",
            volumeUsd: Math.round(volume),
            source: "polymarket",
          };
          if (!best || candidate.volumeUsd > best.volumeUsd) best = candidate;
        }
      }
      if (best) break;
    }
    if (best) {
      try {
        setCachedResearch(db, cacheKey, JSON.stringify(best));
      } catch {
        /* cache is advisory */
      }
    }
    return best;
  } catch {
    return null;
  }
}

export interface CollectPriorsOpts {
  db: DatabaseSync;
  /** First usable live provider, for the base-rate call. Null in demo / offline. */
  provider: ProviderConfig | null;
  demoMode: boolean;
}

/** Collect both priors. Never throws — failures degrade to nulls. */
export async function collectPriors(
  question: string,
  deadline: string,
  opts: CollectPriorsOpts,
): Promise<PriorSet> {
  if (opts.demoMode) {
    return { baseRate: demoBaseRate(question), market: demoMarket(question) };
  }
  const [baseRate, market] = await Promise.all([
    opts.provider ? liveBaseRate(opts.provider, question, deadline) : Promise.resolve(null),
    polymarketLookup(question, opts.db),
  ]);
  return { baseRate, market };
}

/**
 * Combine available priors into a single anchor via geometric mean of odds.
 * Returns null when no prior is available.
 */
export function blendPriors(priors: PriorSet): number | null {
  const values: number[] = [];
  if (priors.baseRate) values.push(priors.baseRate.value);
  if (priors.market) values.push(priors.market.value);
  if (!values.length) return null;
  const logit = (p: number) => {
    const c = Math.min(0.99, Math.max(0.01, p / 100));
    return Math.log(c / (1 - c));
  };
  const mean = values.reduce((s, v) => s + logit(v), 0) / values.length;
  return clampPct((1 / (1 + Math.exp(-mean))) * 100);
}

/** Render priors as a prompt block: anchors the council must argue against. */
export function priorsNotes(priors: PriorSet): string {
  const lines: string[] = [];
  if (priors.baseRate) {
    lines.push(
      `OUTSIDE-VIEW BASE RATE: ${priors.baseRate.value}% — reference class "${priors.baseRate.referenceClass}" (source: ${priors.baseRate.source}).`,
    );
  }
  if (priors.market) {
    const m = priors.market;
    lines.push(
      `PREDICTION-MARKET PRIOR: ${m.value}% — "${m.market}" (source: ${m.source}, ~$${m.volumeUsd.toLocaleString("en-US")} volume).`,
    );
  }
  if (!lines.length) return "";
  lines.push(
    "Treat the above as Bayesian anchors, not answers. Start your reasoning from them and state explicitly, with evidence, why you move up or down from each anchor. Ignoring an anchor without justification is a reasoning failure.",
  );
  return lines.join("\n");
}
