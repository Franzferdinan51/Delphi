/**
 * Delphi service layer — shared read models for the REST API, the CLI,
 * and the MCP server. Every agent-facing surface returns these shapes.
 */
import type { DatabaseSync } from "node:sqlite";
import {
  getQuestion,
  listQuestions,
  getForecasts,
  getOpinions,
  councilorTrackRecords,
  providerTrackRecords,
  calibrationPairs,
} from "./db.js";
import { resolveForecast } from "./resolve.js";
import { COUNCILORS, councilorById } from "./council.js";
import { defaultProviders, resolveProviders, DELPHI, VERSION } from "./config.js";
import { brierScore, calibrationBuckets } from "./scoring.js";
import type {
  CouncilorOpinion,
  DecompositionStep,
  ForecastPayload,
  PriorSet,
  ProviderId,
  QuestionType,
} from "./types.js";

export interface ServiceError extends Error {
  status: number;
}
function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}

function opinionPayload(o: CouncilorOpinion) {
  return { ...o };
}

export function forecastPayload(f: ForecastPayload): ForecastPayload {
  return { ...f, opinions: f.opinions.map(opinionPayload) };
}

/** Rebuild the full forecast payload for a stored forecast row. */
export function storedForecast(
  db: DatabaseSync,
  forecastId: string,
): ForecastPayload | null {
  const f = db
    .prepare(`SELECT * FROM forecasts WHERE id = ?`)
    .get(forecastId) as Record<string, unknown> | undefined;
  if (!f) return null;
  const q = getQuestion(db, f["question_id"] as string);
  if (!q) return null;
  const weights: Record<string, number> = JSON.parse((f["weights_json"] as string) || "{}");
  const opinions = getOpinions(db, forecastId).map((o) => {
    let name = o.councilor_id;
    let tagline = "";
    try {
      const c = councilorById(o.councilor_id);
      name = c.name;
      tagline = c.tagline;
    } catch {
      /* keep id */
    }
    return {
      councilorId: o.councilor_id,
      councilorName: name,
      tagline,
      provider: o.provider_id as ProviderId,
      providerName: o.provider_id,
      round: o.round as 1 | 2,
      probability: o.probability,
      confidence: o.confidence as "High" | "Medium" | "Low",
      answer: o.answer,
      reasoning: o.reasoning,
      status: o.status as CouncilorOpinion["status"],
      weight: weights[o.councilor_id] || 0,
    } satisfies CouncilorOpinion;
  });
  return {
    id: f["id"] as string,
    questionId: f["question_id"] as string,
    runNumber: f["run_number"] as number,
    createdAt: f["created_at"] as string,
    question: q.question,
    questionType: q.question_type as QuestionType,
    deadline: q.deadline,
    resolutionCriteria: q.resolution_criteria,
    context: q.context,
    probability: f["probability"] as number,
    confidence: f["confidence"] as "High" | "Medium" | "Low",
    answer: f["answer"] as string,
    confidenceRange: [f["confidence_lo"] as number, f["confidence_hi"] as number],
    confidenceScore: (f["confidence_score"] as number) ?? 0,
    confidenceBreakdown: { agreement: 0, priorConvergence: 0, evidence: 0, trackRecord: 0, ...JSON.parse((f["confidence_breakdown_json"] as string) || "{}") },
    summary: f["summary"] as string,
    timeline: f["timeline"] as string,
    bestCase: f["best_case"] as string,
    worstCase: f["worst_case"] as string,
    readout: JSON.parse((f["readout_json"] as string) || "{}"),
    opinions,
    weights: JSON.parse((f["weights_json"] as string) || "{}"),
    method: "logarithmic-opinion-pool",
    priors: safeParsePriorSet(f["priors_json"]),
    sharpenedQuestion: (q.sharpened_question as string) || q.question,
    decomposition: safeParseGate(q.gate_json).decomposition,
    questionQuality: safeParseGate(q.gate_json).qualityScore,
  };
}

function safeParsePriorSet(raw: unknown): PriorSet {
  try {
    const p = JSON.parse((raw as string) || "{}") as Partial<PriorSet>;
    return {
      baseRate: p.baseRate ?? null,
      market: p.market ?? null,
    };
  } catch {
    return { baseRate: null, market: null };
  }
}

function safeParseGate(raw: unknown): { decomposition: DecompositionStep[]; qualityScore: number } {
  try {
    const g = JSON.parse((raw as string) || "{}") as {
      decomposition?: DecompositionStep[];
      qualityScore?: number;
    };
    return {
      decomposition: Array.isArray(g.decomposition) ? g.decomposition : [],
      qualityScore: typeof g.qualityScore === "number" ? g.qualityScore : 0,
    };
  } catch {
    return { decomposition: [], qualityScore: 0 };
  }
}

/** Resolve a question by full id or unambiguous id prefix. */
export function findQuestion(db: DatabaseSync, id: string) {
  if (!id.trim()) fail(400, "Question id is required.");
  const exact = getQuestion(db, id);
  if (exact) return exact;
  const matches = listQuestions(db).filter(q => q.id.startsWith(id));
  if (!matches.length) fail(404, "Question not found.");
  if (matches.length > 1) fail(409, "Ambiguous question id; use a longer prefix.");
  return matches[0];
}

export function listQuestionsView(db: DatabaseSync) {
  const questions = listQuestions(db).map((q) => {
    const forecasts = getForecasts(db, q.id);
    const latest = forecasts[forecasts.length - 1];
    return {
      id: q.id,
      question: q.question,
      questionType: q.question_type,
      deadline: q.deadline,
      status: q.status,
      probability: latest ? Math.round(latest.probability) : null,
      createdAt: q.created_at,
      resolvedAt: q.resolved_at,
      outcome: q.outcome,
    };
  });
  return { questions };
}

export function questionDetailView(db: DatabaseSync, id: string) {
  const q = findQuestion(db, id);
  const forecasts = getForecasts(db, q.id);
  const latest = forecasts[forecasts.length - 1];
  return {
    question: {
      id: q.id,
      question: q.question,
      questionType: q.question_type,
      deadline: q.deadline,
      resolutionCriteria: q.resolution_criteria,
      context: q.context,
      status: q.status,
      createdAt: q.created_at,
      resolvedAt: q.resolved_at,
      outcome: q.outcome,
    },
    forecasts: forecasts.map((f) => ({
      runNumber: f.run_number,
      createdAt: f.created_at,
      probability: Math.round(f.probability),
      confidence: f.confidence,
    })),
    latest: latest ? storedForecast(db, latest.id) : null,
    resolution:
      q.status === "resolved"
        ? { outcome: q.outcome, resolvedAt: q.resolved_at, score: q.score }
        : null,
  };
}

export function leaderboardView(db: DatabaseSync) {
  const records = councilorTrackRecords(db);
  const councilors = COUNCILORS.map((c) => {
    const r = records.get(c.id);
    return {
      id: c.id,
      name: c.name,
      tagline: c.tagline,
      n: r?.n || 0,
      brier: r ? r.sumSqErr / r.n : null,
      logScore: r ? r.sumLogScore / r.n : null,
    };
  }).sort((a, b) => (a.brier ?? Infinity) - (b.brier ?? Infinity));
  const precords = providerTrackRecords(db);
  const providers = [...precords.entries()]
    .map(([id, r]) => ({ id, name: id, n: r.n, brier: r.sumSqErr / r.n }))
    .sort((a, b) => a.brier - b.brier);
  return { councilors, providers };
}

export function calibrationView(db: DatabaseSync) {
  const pairs = calibrationPairs(db);
  const buckets = calibrationBuckets(
    pairs.map((p) => ({ probability: p.probability / 100, outcome: p.outcome as 0 | 1 })),
  );
  // Brier over time: cumulative mean Brier after each resolution.
  let sumSq = 0;
  const brierOverTime = pairs.map((p, i) => {
    sumSq += brierScore(p.probability / 100, p.outcome as 0 | 1);
    return { date: (p.date || "").slice(0, 10), brier: sumSq / (i + 1), n: i + 1 };
  });
  return { buckets, brierOverTime };
}

export function resolveQuestionView(db: DatabaseSync, id: string, outcome: string) {
  if (!id || !outcome) fail(400, "id and outcome are required.");
  const match = findQuestion(db, id);
  const result = resolveForecast(db, match.id, outcome);
  const scores = result.grades.map((g) => {
    let councilorName = g.councilorId;
    try {
      councilorName = councilorById(g.councilorId).name;
    } catch {
      /* keep */
    }
    return { ...g, councilorName };
  });
  return {
    ok: true,
    resolution: { outcome: result.outcome, score: result.score, resolvedAt: result.resolvedAt },
    scores,
  };
}

export function councilorsView() {
  return {
    councilors: COUNCILORS.map((c) => ({
      id: c.id,
      name: c.name,
      tagline: c.tagline,
      role: c.role,
      topics: c.topics,
      provider: c.provider,
    })),
  };
}

export async function providersView() {
  const providers = await resolveProviders(defaultProviders());
  return {
    version: VERSION,
    demoMode: DELPHI.demoDefault,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      endpoint: p.endpoint,
      model: p.model,
      connected: p.connected,
      availableModels: p.availableModels,
    })),
  };
}
