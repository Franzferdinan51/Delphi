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

/** Low-level OpenAI-compatible chat call. Exported for priors + question gate. */
export async function chatCompletion(
  provider: ProviderConfig,
  system: string,
  user: string,
  timeoutMs = 90000,
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
    // Upstream bodies may echo authorization headers or prompt content.
    await res.body?.cancel();
    throw new Error(`${provider.name} request failed (HTTP ${res.status}). Check provider credentials, model and quota.`);
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

/** Ask a live provider; one retry through the quality gate. */
export async function askLive(
  provider: ProviderConfig,
  councilor: CouncilorDef,
  brief: BriefInput,
  critic?: { ownProbability: number; peers: Array<{ name: string; probability: number; reasoning: string }> },
): Promise<LiveOpinion> {
  const user = critic
    ? buildCriticPrompt(councilor, brief, critic.ownProbability, critic.peers)
    : buildBriefPrompt(councilor, brief);
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await chatCompletion(provider, councilor.systemPrompt, user);
      const quality = checkQuality(text);
      if (!quality.passed) {
        lastError = `Quality gate failed: ${quality.issues.join("; ")}`;
        continue; // retry once
      }
      return { parsed: parseOpinion(text), status: "live" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt === 0) continue;
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
