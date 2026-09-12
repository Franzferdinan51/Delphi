/**
 * Delphi pipeline — Research → Deliberate → Critic → Aggregate → Learn.
 *
 * Per question:
 *   1. Intake: validate + store the question.
 *   2. Research: budgeted web research with cache.
 *   3. Deliberation round 1: councilors forecast independently (parallel).
 *   4. Critic round 2: each sees peers' reasoning, may update.
 *   5. Aggregation: log opinion pool weighted by track record + extremization.
 *   6. Output: full readout stored; new runs append (belief tracking).
 *   7. Learn: resolution later grades everyone (see resolve.ts).
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AskInput,
  CouncilorOpinion,
  ForecastPayload,
  ForecastReadout,
  PipelineEvent,
  ProviderConfig,
  ResearchResult,
} from "./types.js";
import {
  getDb,
  getQuestion,
  insertQuestion,
  insertForecast,
  insertOpinion,
  nextRunNumber,
  councilorTrackRecords,
} from "./db.js";
import { defaultProviders, resolveProviders, providerById, councilorProviderOverrides, DELPHI } from "./config.js";
import { COUNCILORS, selectCouncilors } from "./council.js";
import { askLive, demoOpinion, type BriefInput } from "./providers.js";
import { buildQueries, runQuery, researchNotes } from "./research.js";
import {
  aggregate,
  confidenceFromSpread,
  confidenceRange,
} from "./aggregate.js";

export type Emit = (e: PipelineEvent) => void;

function validate(input: AskInput): void {
  if (!input.existingQuestionId && !input.question?.trim())
    throw new Error("Question is required.");
  if (!["binary", "timing", "numeric", "categorical"].includes(input.questionType)) {
    throw new Error(`Unknown question type: ${input.questionType}`);
  }
  if (!input.existingQuestionId && !input.deadline?.trim())
    throw new Error("Deadline is required.");
}

function centralAnswer(opinions: CouncilorOpinion[], questionType: string): string {
  const answers = opinions.map((o) => o.answer.trim()).filter(Boolean);
  if (answers.length) {
    const freq = new Map<string, number>();
    for (const a of answers) freq.set(a, (freq.get(a) || 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }
  return questionType === "binary" ? "Yes" : "No central answer returned";
}

function buildReadout(
  opinions: CouncilorOpinion[],
  probability: number,
  deadline: string,
  questionType: string,
  answer: string,
): ForecastReadout {
  const pick = (f: (o: CouncilorOpinion) => string[]) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const o of opinions) {
      for (const v of f(o)) {
        const t = v.trim();
        if (t && !seen.has(t.toLowerCase()) && out.length < 6) {
          seen.add(t.toLowerCase());
          out.push(t);
        }
      }
    }
    return out;
  };
  // Thesis: use the most confident non-error opinion's reasoning, else synthesize.
  const substantive = opinions.filter((o) => o.status !== "error");
  const thesis =
    substantive[0]?.reasoning ||
    `${probability}% aggregate likelihood before ${deadline}.`;
  return {
    thesis,
    drivers: pick((o) => driversOf(o)),
    counterSignals: pick((o) => o.status === "error" ? [] : counterSignalsOf(o)),
    updateTriggers: pick((o) => updateTriggersOf(o)),
    assumptions: pick((o) => assumptionsOf(o)),
    indicators: pick((o) => driversOf(o)).slice(0, 4),
  };
}

// Opinion extras live on the parsed shape; opinions carry reasoning only, so
// the readout pulls structured fields from a sidecar. We stash them on the
// opinion object at creation time (see below) via a WeakMap-free approach:
// pipeline keeps a parallel map.
type OpinionExtras = {
  drivers: string[];
  counterSignals: string[];
  updateTriggers: string[];
  assumptions: string[];
};
const extras = new Map<string, OpinionExtras>();
const driversOf = (o: CouncilorOpinion) => extras.get(keyOf(o))?.drivers || [];
const counterSignalsOf = (o: CouncilorOpinion) => extras.get(keyOf(o))?.counterSignals || [];
const updateTriggersOf = (o: CouncilorOpinion) => extras.get(keyOf(o))?.updateTriggers || [];
const assumptionsOf = (o: CouncilorOpinion) => extras.get(keyOf(o))?.assumptions || [];
const keyOf = (o: CouncilorOpinion) => `${o.councilorId}:${o.round}`;

export interface PipelineDeps {
  db?: DatabaseSync;
  providers?: ProviderConfig[];
  emit?: Emit;
}

/**
 * Run the full forecasting pipeline. Emits events for live UI streaming.
 * Returns the stored forecast payload.
 */
export async function runPipeline(
  input: AskInput,
  deps: PipelineDeps = {},
): Promise<ForecastPayload> {
  validate(input);
  const db = deps.db || getDb();
  const emit: Emit = deps.emit || (() => undefined);
  const demoMode = input.demoMode ?? DELPHI.demoDefault;
  const councilSize = input.councilSize ?? 4;

  const providers = await resolveProviders(deps.providers || defaultProviders());
  const liveProviders = providers.filter((p) => p.connected);
  // Optional per-councilor provider reassignment (custom endpoints included).
  const providerOverrides = councilorProviderOverrides();
  const providerIdFor = (councilorId: string, builtin: string): string =>
    providerOverrides[councilorId] || builtin;

  // ── 1. Intake ──────────────────────────────────────────────────────────
  const createdAt = new Date().toISOString();
  let questionId: string;
  let questionText = (input.question || "").trim();
  let questionType = input.questionType;
  let deadline = (input.deadline || "").trim();
  let resolutionCriteria = (input.resolutionCriteria || "").trim();
  let context = (input.context || "").trim();
  if (input.existingQuestionId) {
    const existing = getQuestion(db, input.existingQuestionId);
    if (!existing) throw new Error(`Unknown question: ${input.existingQuestionId}`);
    if (existing.status === "resolved") throw new Error("Question is already resolved; cannot re-run.");
    questionId = existing.id;
    if (!questionText) questionText = existing.question;
    if (!deadline) deadline = existing.deadline;
    if (!resolutionCriteria) resolutionCriteria = existing.resolution_criteria;
    if (!context) context = existing.context;
  } else {
    questionId = randomUUID();
    insertQuestion(db, {
      id: questionId,
      question: questionText,
      question_type: questionType,
      deadline,
      resolution_criteria: resolutionCriteria,
      context,
      created_at: createdAt,
    });
  }
  // Re-run keeps the stored type even if the caller passed a different one.
  if (input.existingQuestionId) {
    const existing = getQuestion(db, input.existingQuestionId)!;
    questionType = existing.question_type;
  }

  const councilors = selectCouncilors(
    questionText,
    context,
    councilSize,
  );
  emit({
    type: "started",
    questionId,
    councilors: councilors.map((c) => ({
      id: c.id,
      name: c.name,
      tagline: c.tagline,
      provider: c.provider,
    })),
  });

  // ── 2. Research ────────────────────────────────────────────────────────
  emit({ type: "phase", phase: "research" });
  const queries = buildQueries(questionText, deadline);
  const perQuery: Array<{ query: string; results: ResearchResult[] }> = [];
  for (const q of queries) {
    try {
      const results = await runQuery(db, q, demoMode);
      perQuery.push({ query: q, results });
      emit({ type: "research", query: q, results });
    } catch (e) {
      // Research is advisory, never fatal.
      const msg = e instanceof Error ? e.message : String(e);
      emit({ type: "research", query: q, results: [] });
      perQuery.push({ query: q, results: [] });
      void msg;
    }
  }
  const notes = researchNotes(perQuery);

  const brief: BriefInput = {
    question: questionText,
    questionType,
    deadline,
    resolutionCriteria,
    context,
    researchNotes: notes,
  };

  // ── 3. Deliberation, round 1 (independent) ─────────────────────────────
  emit({ type: "phase", phase: "deliberation" });
  const round1 = await Promise.all(
    councilors.map(async (c) => {
      const provider = providerById(providers, providerIdFor(c.id, c.provider));
      const useLive = !demoMode && liveProviders.some((p) => p.id === provider.id);
      if (demoMode) {
        const parsed = demoOpinion(c, questionText, questionType, 1);
        return { councilor: c, provider, parsed, status: "demo" as const, error: undefined as string | undefined };
      }
      if (!useLive) {
        return {
          councilor: c,
          provider,
          parsed: {
            probability: 50,
            confidence: "Low" as const,
            answer: "",
            reasoning: `${provider.name} is not connected, so this councilor sat out.`,
            drivers: [] as string[],
            counterSignals: [] as string[],
            updateTriggers: [] as string[],
            assumptions: [] as string[],
          },
          status: "error" as const,
          error: `${provider.name} not connected; no live forecast.` as string | undefined,
        };
      }
      const live = await askLive(provider, c, brief);
      return { councilor: c, provider, parsed: live.parsed, status: live.status, error: live.error };
    }),
  );

  const toOpinion = (
    r: (typeof round1)[number],
    round: 1 | 2,
  ): CouncilorOpinion => {
    const opinion: CouncilorOpinion = {
      councilorId: r.councilor.id,
      councilorName: r.councilor.name,
      tagline: r.councilor.tagline,
      provider: r.provider.id,
      providerName: r.provider.name,
      round,
      probability: r.parsed.probability,
      confidence: r.parsed.confidence,
      answer: r.parsed.answer,
      reasoning: r.parsed.reasoning,
      status: r.status,
      error: r.error,
      weight: 0, // filled after aggregation
    };
    extras.set(keyOf(opinion), {
      drivers: r.parsed.drivers,
      counterSignals: r.parsed.counterSignals,
      updateTriggers: r.parsed.updateTriggers,
      assumptions: r.parsed.assumptions,
    });
    return opinion;
  };

  const opinionsR1 = round1.map((r) => toOpinion(r, 1));
  for (const o of opinionsR1) emit({ type: "opinion", opinion: o });

  // ── 4. Critic round 2 (see peers, may update) ─────────────────────────
  emit({ type: "phase", phase: "critic" });
  const round1Mean =
    opinionsR1.reduce((s, o) => s + o.probability, 0) / opinionsR1.length;
  const round2 = await Promise.all(
    councilors.map(async (c, i) => {
      const provider = providerById(providers, providerIdFor(c.id, c.provider));
      const peers = opinionsR1
        .filter((o) => o.councilorId !== c.id)
        .map((o) => ({ name: o.councilorName, probability: o.probability, reasoning: o.reasoning }));
      if (demoMode) {
        const parsed = demoOpinion(c, questionText, questionType, 2, round1Mean);
        return { councilor: c, provider, parsed, status: "demo" as const, error: undefined as string | undefined };
      }
      const useLive = liveProviders.some((p) => p.id === provider.id);
      if (!useLive) {
        const r1 = round1[i];
        return { councilor: c, provider, parsed: r1.parsed, status: "error" as const, error: r1.error };
      }
      const live = await askLive(provider, c, brief, {
        ownProbability: opinionsR1[i].probability,
        peers,
      });
      return { councilor: c, provider, parsed: live.parsed, status: live.status, error: live.error };
    }),
  );
  const opinionsR2 = round2.map((r) => toOpinion(r, 2));
  for (const o of opinionsR2) emit({ type: "opinion", opinion: o });

  // ── 5. Aggregation ────────────────────────────────────────────────────
  emit({ type: "phase", phase: "aggregation" });
  const usable = opinionsR2.filter((o) => o.status !== "error");
  const pool = usable.length ? usable : opinionsR2; // never aggregate an empty set
  const records = councilorTrackRecords(db);
  const briers = pool.map((o) => {
    const rec = records.get(o.councilorId);
    return rec ? rec.sumSqErr / rec.n : null;
  });
  const counts = pool.map((o) => records.get(o.councilorId)?.n || 0);
  const { probability, weights } = aggregate({
    probs: pool.map((o) => o.probability),
    briers,
    resolvedCounts: counts,
    coldStartThreshold: DELPHI.coldStartThreshold,
  });
  pool.forEach((o, i) => {
    o.weight = weights[i];
  });
  // Error opinions get zero weight explicitly.
  for (const o of opinionsR2) {
    if (o.status === "error") o.weight = 0;
  }

  const answer = centralAnswer(pool, questionType);
  const confidence = confidenceFromSpread(pool.map((o) => o.probability));
  const [clo, chi] = confidenceRange(probability, confidence);
  const readout = buildReadout(pool, probability, deadline, questionType, answer);

  const spread = pool.length
    ? Math.max(...pool.map((o) => o.probability)) - Math.min(...pool.map((o) => o.probability))
    : 0;
  const summary =
    questionType === "binary"
      ? `${probability}% aggregate likelihood before ${deadline}. Council confidence is ${confidence.toLowerCase()}; round-2 estimates span ${spread} points.`
      : `${probability}% confidence in the central forecast: ${answer}. Council confidence is ${confidence.toLowerCase()}; round-2 estimates span ${spread} points.`;

  // ── 6. Output + store ─────────────────────────────────────────────────
  const runNumber = nextRunNumber(db, questionId);
  const forecastId = randomUUID();
  const weightsMap: Record<string, number> = {};
  pool.forEach((o, i) => {
    weightsMap[o.councilorId] = weights[i];
  });

  insertForecast(db, {
    id: forecastId,
    question_id: questionId,
    run_number: runNumber,
    created_at: new Date().toISOString(),
    probability,
    confidence,
    answer,
    confidence_lo: clo,
    confidence_hi: chi,
    summary,
    timeline: `Resolution by ${deadline}`,
    best_case: readout.drivers[0] || "Supporting evidence continues to accumulate.",
    worst_case: readout.counterSignals[0] || "A disconfirming signal invalidates the assumptions.",
    readout_json: JSON.stringify(readout),
    weights_json: JSON.stringify(weightsMap),
  });
  for (const o of opinionsR2) {
    insertOpinion(db, {
      id: randomUUID(),
      forecast_id: forecastId,
      question_id: questionId,
      councilor_id: o.councilorId,
      provider_id: o.provider,
      round: o.round,
      probability: o.probability,
      confidence: o.confidence,
      answer: o.answer,
      reasoning: o.reasoning,
      status: o.status,
      created_at: new Date().toISOString(),
    });
  }

  const forecast: ForecastPayload = {
    id: forecastId,
    questionId,
    runNumber,
    createdAt,
    question: questionText,
    questionType,
    deadline,
    resolutionCriteria,
    context,
    probability,
    confidence,
    answer,
    confidenceRange: [clo, chi],
    summary,
    timeline: `Resolution by ${deadline}`,
    bestCase: readout.drivers[0] || "Supporting evidence continues to accumulate.",
    worstCase: readout.counterSignals[0] || "A disconfirming signal invalidates the assumptions.",
    readout,
    opinions: opinionsR2,
    weights: weightsMap,
    method: "logarithmic-opinion-pool",
  };

  emit({ type: "phase", phase: "done" });
  emit({ type: "result", forecast });
  // Clear per-run extras to avoid leaking across runs in long-lived processes.
  for (const o of [...opinionsR1, ...opinionsR2]) extras.delete(keyOf(o));
  return forecast;
}

export { COUNCILORS };
