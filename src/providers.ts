/**
 * Delphi providers — OpenAI-compatible chat completions against
 * LM Studio / MiniMax / Grok / OpenAI / NVIDIA NIM / OpenCode Zen / Meta Muse Spark, plus a deterministic demo mode
 * that needs zero credentials.
 */
import type { CouncilorDef } from "./types.js";
import type { ProviderConfig } from "./types.js";
import { buildBriefPrompt, buildCriticPrompt } from "./council.js";
import { checkQuality, parseOpinion, type ParsedOpinion } from "./quality.js";

export interface BriefInput {
  question: string;
  questionType: string;
  deadline: string;
  resolutionCriteria: string;
  context: string;
  researchNotes: string;
  /** Bayesian anchors from the priors phase (base rate + market). Optional. */
  priorNotes?: string;
  /** Fermi decomposition from the question gate. Optional. */
  decompositionNotes?: string;
}

function headers(p: ProviderConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(p.apiKey.trim() ? { Authorization: `Bearer ${p.apiKey.trim()}` } : {}),
  };
}

/**
 * Short, redacted diagnostic from an upstream error body.
 * Bodies can echo request content, so the provider's own API key and any
 * bearer tokens are scrubbed before anything is surfaced. LM Studio wraps
 * engine failures as {"error":{"code":...,"message":"..."}}, so the inner
 * message is surfaced when present.
 */
async function readErrorDetail(res: Response, p: ProviderConfig): Promise<string> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    return "";
  }
  const key = p.apiKey.trim();
  if (key) text = text.split(key).join("[redacted]");
  text = text.replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/gi, "Bearer [redacted]");
  text = text.replace(/\s+/g, " ").trim();
  const inner = text.match(/"message"\s*:\s*"([^"]{1,300})"/);
  const detail = (inner ? inner[1] : text).replace(/\\"/g, '"');
  return detail.length > 400 ? detail.slice(0, 400) + "…" : detail;
}

export type ProviderErrorKind = "transient" | "deterministic";

/**
 * Decide whether a failed provider call is worth retrying with backoff.
 *
 * Local inference servers (notably LM Studio) surface *transient* engine
 * crashes — e.g. speculative-decoding batching faults ("speculative batch
 * index … is not inside the current sub-batch") — as HTTP 400/500 with
 * server_error bodies, so a bare 400 is treated as transient unless the body
 * says otherwise. Deterministic failures (auth, context overflow, malformed
 * request shape) fail fast instead of burning retries.
 */
export function classifyProviderError(status: number | null, detail: string): ProviderErrorKind {
  const d = (detail || "").toLowerCase();
  if (status === 401 || status === 403 || status === 404) return "deterministic";
  if (/exceed[^.]{0,60}context|context[^.]{0,60}(size|length|window)|too many tokens/.test(d)) {
    return "deterministic";
  }
  if (status === 400 && /invalid_request|bad request|validation failed|model_?not_?found/.test(d)) {
    return "deterministic";
  }
  return "transient";
}

/** HTTP error from a provider call, carrying status + redacted detail + retry kind. */
export class ProviderHttpError extends Error {
  status: number;
  detail: string;
  kind: ProviderErrorKind;
  constructor(providerName: string, status: number, detail: string) {
    super(
      `${providerName} request failed (HTTP ${status}).` +
        (detail ? ` Upstream: ${detail}` : "") +
        ` Check provider credentials, model and quota.`,
    );
    this.name = "ProviderHttpError";
    this.status = status;
    this.detail = detail;
    this.kind = classifyProviderError(status, detail);
  }
}

/** Small sleep helper for retry backoff. Exported for tests. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Map with bounded parallelism. Local inference servers get flaky under
 * full parallel load (LM Studio's speculative-batching engine bug), so
 * council rounds go through this instead of unbounded Promise.all.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Math.max(1, Math.floor(limit) || 1), items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Low-level OpenAI-compatible chat call. Exported for priors + question gate. */
export async function chatCompletion(
  provider: ProviderConfig,
  system: string,
  user: string,
  timeoutMs = 300000,
): Promise<string> {
  const res = await fetch(`${provider.endpoint.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: headers(provider),
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: provider.model,
      temperature: 0.25,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await readErrorDetail(res, provider);
    throw new ProviderHttpError(provider.name, res.status, detail);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };
  const text =
    data.choices?.[0]?.message?.content ||
    data.choices?.[0]?.message?.reasoning_content ||
    "";
  if (!text.trim()) throw new Error(`${provider.name} returned an empty response.`);
  return text;
}

export interface LiveOpinion {
  parsed: ParsedOpinion;
  status: "live" | "error";
  error?: string;
}

export interface AskLiveOptions {
  /**
   * Backoff (ms) between transient-error retries. Defaults to
   * [2000, 6000, 15000]. Pass [0, 0, 0] in tests to skip waiting.
   */
  retryDelaysMs?: number[];
}

const DEFAULT_RETRY_DELAYS_MS = [2000, 6000, 15000];

/** Classify a non-HTTP throw (network failure, timeout, abort) for retry. */
function kindOfThrown(e: unknown): ProviderErrorKind {
  if (e instanceof ProviderHttpError) return e.kind;
  // Network/timeout/abort failures are transient by nature.
  return "transient";
}

/**
 * Ask a live provider. When the quality gate rejects a response (usually a
 * format miss from a smaller local model), retry with a format-repair nudge
 * that names exactly what was wrong instead of just resending the prompt.
 *
 * Transient provider failures (5xx, timeouts, and local-engine crashes that
 * surface as 400s) are retried up to 3 times with 2s/6s/15s backoff
 * (4 total attempts); deterministic failures (auth, context overflow,
 * malformed requests) fail fast.
 */
export async function askLive(
  provider: ProviderConfig,
  councilor: CouncilorDef,
  brief: BriefInput,
  critic?: { ownProbability: number | undefined; peers: Array<{ name: string; probability: number; reasoning: string }> },
  opts: AskLiveOptions = {},
): Promise<LiveOpinion> {
  const user = critic
    ? buildCriticPrompt(councilor, brief, critic.ownProbability, critic.peers)
    : buildBriefPrompt(councilor, brief);
  let userPrompt = user;
  let lastError = "";
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  let delayIdx = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const text = await chatCompletion(provider, councilor.systemPrompt, userPrompt);
      const quality = checkQuality(text);
      if (!quality.passed) {
        lastError = `Quality gate failed: ${quality.issues.join("; ")}`;
        // Format-repair retry: tell the model exactly what was missing.
        userPrompt =
          `${user}\n\nYour previous response was rejected for: ${quality.issues.join("; ")}. ` +
          `Respond again with XML ONLY - no prose, no preamble, no markdown fences - using exactly these tags: ` +
          `<forecast_answer>, <probability>, <confidence>, <reasoning>, <drivers>, <counter_signals>, <update_triggers>, <assumptions>.`;
        continue;
      }
      return { parsed: parseOpinion(text), status: "live" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      const kind = kindOfThrown(e);
      if (kind === "deterministic" || attempt >= 3) break;
      const wait = delays[Math.min(delayIdx++, delays.length - 1)] ?? 0;
      if (wait > 0) await sleep(wait);
    }
  }
  return {
    parsed: {
      probability: 50,
      confidence: "Low",
      answer: "",
      reasoning: `Provider failed: ${lastError}`,
      drivers: [],
      counterSignals: [],
      updateTriggers: [],
      assumptions: [],
    },
    status: "error",
    error: lastError,
  };
}

// ─── Demo mode ──────────────────────────────────────────────────────────────
// Deterministic per (question, councilor): hash → persona-flavored opinion.
// No credentials, no network, stable across runs (good for tests).

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const DEMO_BASE: Record<string, [number, number]> = {
  "base-rate-analyst": [46, 60],
  "domain-expert": [56, 74],
  skeptic: [30, 46],
  superforecaster: [55, 70],
  quant: [50, 66],
};

const DEMO_VOICE: Record<string, string> = {
  "base-rate-analyst":
    "Starting from the reference class, the historical base rate here is in the 40s. The specifics of this case nudge modestly upward, but I refuse to let narrative override the outside view.",
  "domain-expert":
    "Walking the causal chain: the key actors' incentives align with this outcome, and the binding constraints are looser than they look. Two of my three critical variables point the same way.",
  skeptic:
    "The consensus case leans on a fragile assumption — that current trends continue without a shock. Steelman the opposite: a single disconfirming event flips this. I'm pricing in surprise.",
  superforecaster:
    "Decomposed into three sub-questions and Fermi-estimated each. My prior was 50%; the two strongest evidence clusters update me upward. Shown my rough math, this is where Bayes lands.",
  quant:
    "Framed as a distribution, the mass sits above 50 but with fat tails. Converted the qualitative drivers to explicit point adjustments and sanity-checked against comparable historical frequencies.",
};

function demoAnswer(questionType: string): string {
  if (questionType === "timing") return "Q3–Q4 2027 (demo window)";
  if (questionType === "numeric") return "45–55 (demo range)";
  if (questionType === "categorical") return "Base-case scenario (demo)";
  return "Yes";
}

export function demoOpinion(
  councilor: CouncilorDef,
  question: string,
  questionType: string,
  round: 1 | 2,
  round1Mean?: number,
): ParsedOpinion & { status: "demo" } {
  const [lo, hi] = DEMO_BASE[councilor.id] || [45, 65];
  const jitter = hashStr(`${question}::${councilor.id}`) % (hi - lo);
  let p = lo + jitter;
  if (round === 2 && round1Mean !== undefined) {
    // Critic phase: partial update toward the round-1 mean (no herding to it).
    p = Math.round(p * 0.75 + round1Mean * 0.25);
  }
  return {
    probability: Math.max(1, Math.min(99, p)),
    confidence: "Medium",
    answer: demoAnswer(questionType),
    reasoning: `${DEMO_VOICE[councilor.id] || "Demo reasoning."}${round === 2 ? " After seeing the other councilors' reasoning, I adjusted modestly where their evidence was genuinely new." : ""} (demo forecast — no live model was queried)`,
    drivers: ["Demo driver: reference-class base rates", "Demo driver: current evidence in the brief"],
    counterSignals: ["Demo counter-signal: a surprise would invalidate the thesis"],
    updateTriggers: ["Demo trigger: material new evidence on the key variables"],
    assumptions: ["Demo assumption: the question resolves as worded"],
    status: "demo",
  };
}
