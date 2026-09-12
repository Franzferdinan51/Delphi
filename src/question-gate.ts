/**
 * Delphi question gate — phase 0, before research.
 *
 * Garbage questions produce garbage probabilities. The gate:
 *   1. Sharpens vague wording into a falsifiable question.
 *   2. Tightens (or drafts) resolution criteria.
 *   3. Fermi-decomposes the question into 2-4 estimable sub-questions.
 *   4. Flags ambiguities instead of silently guessing through them.
 *   5. Scores overall question quality (0-100).
 *
 * The sharpened question drives research + deliberation; the original is
 * always preserved. In demo mode everything is deterministic heuristics.
 */
import type { ProviderConfig, QuestionType } from "./types.js";
import { chatCompletion } from "./providers.js";

export interface DecompositionStep {
  sub: string;
  estimate: string;
}

export interface GateResult {
  sharpened: string;
  criteria: string;
  decomposition: DecompositionStep[];
  ambiguities: string[];
  /** 0-100 */
  qualityScore: number;
  /** true when sharpening materially changed the question or criteria */
  changed: boolean;
}

export interface GateInput {
  question: string;
  questionType: QuestionType;
  deadline: string;
  resolutionCriteria: string;
  context: string;
}

const VAGUE_WORDS = [
  "things",
  "stuff",
  "major",
  "significant",
  "soon",
  "eventually",
  "somewhat",
  "relatively",
  "dramatically",
  "massive",
];

function normalizeQuestion(q: string): string {
  let s = q.trim().replace(/\s+/g, " ");
  if (s && !/[?._!]$/.test(s)) s += "?";
  return s;
}

/** Deterministic heuristic gate — demo mode and live-call fallback. */
export function heuristicGate(input: GateInput): GateResult {
  const question = normalizeQuestion(input.question);
  const ambiguities: string[] = [];
  let score = 55;

  if (input.resolutionCriteria.trim()) score += 20;
  else ambiguities.push("No resolution criteria supplied — the forecast assumes the question resolves as literally worded.");

  if (/\b(20\d\d)\b/.test(input.deadline)) score += 10;
  else ambiguities.push("Deadline is vague — resolution timing may be ambiguous.");

  for (const w of VAGUE_WORDS) {
    if (new RegExp(`\\b${w}\\b`, "i").test(question)) {
      score -= 6;
      ambiguities.push(`Vague term "${w}" leaves the resolution open to interpretation.`);
    }
  }
  if (question.length > 280) {
    score -= 8;
    ambiguities.push("Question is long — consider splitting into smaller forecastable questions.");
  }
  if (/^(will|is|are|does|do|can|has|have|should)\b/i.test(question)) score += 5;

  const criteria =
    input.resolutionCriteria.trim() ||
    `Resolves YES if the event described occurs on or before ${input.deadline || "the deadline"}; NO otherwise. (Drafted by the question gate — tighten before relying on this forecast.)`;
  const changed = !input.resolutionCriteria.trim();

  const decomposition = demoDecomposition(input);

  return {
    sharpened: question,
    criteria,
    decomposition,
    ambiguities: ambiguities.slice(0, 5),
    qualityScore: Math.max(5, Math.min(98, Math.round(score))),
    changed,
  };
}

function demoDecomposition(input: GateInput): DecompositionStep[] {
  const q = input.question.toLowerCase();
  if (input.questionType === "numeric" || input.questionType === "timing") {
    return [
      { sub: "Reference-class base rate for this quantity", estimate: "start from the historical median" },
      { sub: "Directional push from current conditions", estimate: "case-specific, see research notes" },
      { sub: "Tail scenarios that break the trend", estimate: "priced as explicit downside/upside mass" },
    ];
  }
  if (input.questionType === "categorical") {
    return [
      { sub: "Enumerate the plausible outcome set", estimate: "2-4 scenarios cover most mass" },
      { sub: "Eliminate the weakest scenario first", estimate: "falsification before selection" },
      { sub: "Compare the survivors head-to-head", estimate: "pick the max-likelihood survivor" },
    ];
  }
  if (/(election|vote)/.test(q)) {
    return [
      { sub: "Polling average vs. the threshold needed", estimate: "polls ± historical error" },
      { sub: "Turnout / structural factors", estimate: "adjust for known biases" },
      { sub: "Late-breaking surprise probability", estimate: "October-surprise base rate" },
    ];
  }
  return [
    { sub: "Outside view: how often do comparable events resolve YES?", estimate: "anchor on the base rate" },
    { sub: "Inside view: what must concretely happen for YES?", estimate: "causal chain, 2-3 key variables" },
    { sub: "What breaks the YES case?", estimate: "strongest disconfirming scenario" },
  ];
}

const GATE_SYSTEM = `You are the question gate for a forecasting engine. Your job is to make questions forecastable.
Reply with strict JSON only, no other text, in exactly this shape:
{
  "sharpened": "<the question rewritten to be falsifiable and precise, keeping the asker's intent>",
  "criteria": "<tightened resolution criteria: what observable fact settles YES vs NO, and by when>",
  "decomposition": [{"sub": "<sub-question>", "estimate": "<how to estimate it>"}, ... 2 to 4 items],
  "ambiguities": ["<each remaining ambiguity, or empty array>"],
  "qualityScore": <0-100 integer for the ORIGINAL question>
}
Rules: never change what is being asked, only clarify it. If the original is already crisp, return it nearly verbatim with a high qualityScore.`;

async function liveGate(
  provider: ProviderConfig,
  input: GateInput,
): Promise<GateResult | null> {
  try {
    const text = await chatCompletion(
      provider,
      GATE_SYSTEM,
      [
        `Question: ${input.question}`,
        `Type: ${input.questionType}`,
        `Deadline: ${input.deadline || "(none given)"}`,
        `Resolution criteria: ${input.resolutionCriteria || "(none given)"}`,
        input.context ? `Context: ${input.context}` : "",
        "Return the JSON object only.",
      ]
        .filter(Boolean)
        .join("\n"),
      45000,
    );
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) return null;
    const p = JSON.parse(m[0]) as {
      sharpened?: unknown;
      criteria?: unknown;
      decomposition?: unknown;
      ambiguities?: unknown;
      qualityScore?: unknown;
    };
    const sharpened =
      typeof p.sharpened === "string" && p.sharpened.trim()
        ? p.sharpened.trim()
        : normalizeQuestion(input.question);
    const criteria =
      typeof p.criteria === "string" && p.criteria.trim()
        ? p.criteria.trim()
        : input.resolutionCriteria.trim();
    const decomposition = Array.isArray(p.decomposition)
      ? p.decomposition
          .filter(
            (d): d is { sub?: unknown; estimate?: unknown } =>
              !!d && typeof d === "object",
          )
          .map((d) => ({
            sub: String(d.sub || "").trim(),
            estimate: String(d.estimate || "").trim(),
          }))
          .filter((d) => d.sub)
          .slice(0, 4)
      : [];
    const ambiguities = Array.isArray(p.ambiguities)
      ? p.ambiguities
          .map((a) => String(a || "").trim())
          .filter(Boolean)
          .slice(0, 5)
      : [];
    const qualityScore = Number(p.qualityScore);
    return {
      sharpened,
      criteria,
      decomposition: decomposition.length ? decomposition : demoDecomposition(input),
      ambiguities,
      qualityScore: Number.isFinite(qualityScore)
        ? Math.max(1, Math.min(100, Math.round(qualityScore)))
        : 60,
      changed:
        sharpened !== normalizeQuestion(input.question) ||
        (!!criteria && criteria !== input.resolutionCriteria.trim()),
    };
  } catch {
    return null;
  }
}

export interface SharpenOpts {
  /** First usable live provider. Null in demo / offline. */
  provider: ProviderConfig | null;
  demoMode: boolean;
}

/**
 * Run the question gate. Live mode tries one LLM call and falls back to
 * deterministic heuristics on any failure — the gate never blocks the run.
 */
export async function sharpenQuestion(
  input: GateInput,
  opts: SharpenOpts,
): Promise<GateResult> {
  if (!opts.demoMode && opts.provider) {
    const live = await liveGate(opts.provider, input);
    if (live) return live;
  }
  return heuristicGate(input);
}

/** Render the Fermi decomposition as a prompt block for the brief. */
export function decompositionNotes(gate: GateResult): string {
  if (!gate.decomposition.length) return "";
  const lines = gate.decomposition.map(
    (d, i) => `${i + 1}. ${d.sub}${d.estimate ? ` — estimate via: ${d.estimate}` : ""}`,
  );
  return [
    "FERMI DECOMPOSITION (from the question gate — use it to structure your estimate):",
    ...lines,
  ].join("\n");
}
