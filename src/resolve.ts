/**
 * Delphi resolution & grading — the self-grading loop.
 * Records an outcome, computes Brier + log scores per councilor/provider
 * from their round-2 probabilities, and stores the result on the question.
 * Future aggregations automatically weight by these track records.
 */
import type { DatabaseSync } from "node:sqlite";
import { getDb, getQuestion, resolveQuestion } from "./db.js";
import { parseOutcome, brierScore, logScore } from "./scoring.js";

export interface GradeResult {
  questionId: string;
  outcome: string;
  score: 0 | 1;
  resolvedAt: string;
  grades: Array<{
    councilorId: string;
    providerId: string;
    probability: number;
    brier: number;
    logScore: number;
  }>;
}

export function resolveForecast(
  db: DatabaseSync,
  questionId: string,
  outcome: string,
): GradeResult {
  const q = getQuestion(db, questionId);
  if (!q) throw new Error(`Unknown question: ${questionId}`);
  if (q.status === "resolved") throw new Error(`Question ${questionId} is already resolved.`);
  const { score, normalized } = parseOutcome(outcome, q.question_type);

  // Grade each councilor's LATEST round-2 opinion (final belief at resolve time).
  const rows = db
    .prepare(
      `SELECT o.councilor_id AS councilorId, o.provider_id AS providerId, o.probability AS probability
       FROM opinions o
       JOIN forecasts f ON f.id = o.forecast_id
       WHERE o.question_id = ?
         AND o.round = 2
         AND f.run_number = (SELECT MAX(run_number) FROM forecasts WHERE question_id = ?)`,
    )
    .all(questionId, questionId) as Array<{
    councilorId: string;
    providerId: string;
    probability: number;
  }>;

  const grades = rows.map((r) => ({
    councilorId: r.councilorId,
    providerId: r.providerId,
    probability: r.probability,
    brier: brierScore(r.probability / 100, score),
    logScore: logScore(r.probability / 100, score),
  }));

  const resolvedAt = new Date().toISOString();
  resolveQuestion(db, questionId, normalized, score);
  return { questionId, outcome: normalized, score, resolvedAt, grades };
}

export function resolveForecastDefault(questionId: string, outcome: string): GradeResult {
  return resolveForecast(getDb(), questionId, outcome);
}
