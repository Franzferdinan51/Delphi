/**
 * Delphi persistence — node:sqlite storage for questions, forecasts,
 * opinions, research cache, and track-record scores.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DELPHI } from "./config.js";
import type { QuestionType } from "./types.js";

let db: DatabaseSync | null = null;

export function getDb(path = DELPHI.dbPath): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

/** For tests: throwaway in-memory database. */
export function memoryDb(): DatabaseSync {
  const mem = new DatabaseSync(":memory:");
  migrate(mem);
  return mem;
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      question_type TEXT NOT NULL,
      deadline TEXT NOT NULL,
      resolution_criteria TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      outcome TEXT,
      score REAL
    );
    CREATE TABLE IF NOT EXISTS forecasts (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL REFERENCES questions(id),
      run_number INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      probability REAL NOT NULL,
      confidence TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      confidence_lo REAL NOT NULL,
      confidence_hi REAL NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      timeline TEXT NOT NULL DEFAULT '',
      best_case TEXT NOT NULL DEFAULT '',
      worst_case TEXT NOT NULL DEFAULT '',
      readout_json TEXT NOT NULL DEFAULT '{}',
      weights_json TEXT NOT NULL DEFAULT '{}',
      UNIQUE(question_id, run_number)
    );
    CREATE TABLE IF NOT EXISTS opinions (
      id TEXT PRIMARY KEY,
      forecast_id TEXT NOT NULL REFERENCES forecasts(id),
      question_id TEXT NOT NULL,
      councilor_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      probability REAL NOT NULL,
      confidence TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      reasoning TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS research_cache (
      query_hash TEXT PRIMARY KEY,
      response_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_opinions_councilor ON opinions(councilor_id);
    CREATE INDEX IF NOT EXISTS idx_opinions_question ON opinions(question_id);
    CREATE INDEX IF NOT EXISTS idx_forecasts_question ON forecasts(question_id);
  `);
}

export interface QuestionRow {
  id: string;
  question: string;
  question_type: QuestionType;
  deadline: string;
  resolution_criteria: string;
  context: string;
  status: "open" | "resolved";
  created_at: string;
  resolved_at: string | null;
  outcome: string | null;
  score: number | null;
}

export function insertQuestion(
  d: DatabaseSync,
  row: Omit<QuestionRow, "status" | "resolved_at" | "outcome" | "score">,
): void {
  d.prepare(
    `INSERT INTO questions (id, question, question_type, deadline, resolution_criteria, context, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(
    row.id,
    row.question,
    row.question_type,
    row.deadline,
    row.resolution_criteria,
    row.context,
    row.created_at,
  );
}

export function getQuestion(d: DatabaseSync, id: string): QuestionRow | null {
  return (
    (d.prepare(`SELECT * FROM questions WHERE id = ?`).get(id) as unknown as QuestionRow) ||
    null
  );
}

export function listQuestions(d: DatabaseSync): QuestionRow[] {
  return d
    .prepare(`SELECT * FROM questions ORDER BY created_at DESC`)
    .all() as unknown as QuestionRow[];
}

export function resolveQuestion(
  d: DatabaseSync,
  id: string,
  outcome: string,
  score: number,
): void {
  d.prepare(
    `UPDATE questions SET status = 'resolved', resolved_at = ?, outcome = ?, score = ? WHERE id = ?`,
  ).run(new Date().toISOString(), outcome, score, id);
}

export function nextRunNumber(d: DatabaseSync, questionId: string): number {
  const row = d
    .prepare(`SELECT COALESCE(MAX(run_number), 0) AS m FROM forecasts WHERE question_id = ?`)
    .get(questionId) as { m: number };
  return row.m + 1;
}

export interface ForecastRow {
  id: string;
  question_id: string;
  run_number: number;
  created_at: string;
  probability: number;
  confidence: string;
  answer: string;
  confidence_lo: number;
  confidence_hi: number;
  summary: string;
  timeline: string;
  best_case: string;
  worst_case: string;
  readout_json: string;
  weights_json: string;
}

export function insertForecast(d: DatabaseSync, row: ForecastRow): void {
  d.prepare(
    `INSERT INTO forecasts (id, question_id, run_number, created_at, probability, confidence, answer,
      confidence_lo, confidence_hi, summary, timeline, best_case, worst_case, readout_json, weights_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.question_id,
    row.run_number,
    row.created_at,
    row.probability,
    row.confidence,
    row.answer,
    row.confidence_lo,
    row.confidence_hi,
    row.summary,
    row.timeline,
    row.best_case,
    row.worst_case,
    row.readout_json,
    row.weights_json,
  );
}

export function getForecasts(
  d: DatabaseSync,
  questionId: string,
): ForecastRow[] {
  return d
    .prepare(`SELECT * FROM forecasts WHERE question_id = ? ORDER BY run_number ASC`)
    .all(questionId) as unknown as ForecastRow[];
}

export interface OpinionRow {
  id: string;
  forecast_id: string;
  question_id: string;
  councilor_id: string;
  provider_id: string;
  round: number;
  probability: number;
  confidence: string;
  answer: string;
  reasoning: string;
  status: string;
  created_at: string;
}

export function insertOpinion(d: DatabaseSync, row: OpinionRow): void {
  d.prepare(
    `INSERT INTO opinions (id, forecast_id, question_id, councilor_id, provider_id, round,
      probability, confidence, answer, reasoning, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.forecast_id,
    row.question_id,
    row.councilor_id,
    row.provider_id,
    row.round,
    row.probability,
    row.confidence,
    row.answer,
    row.reasoning,
    row.status,
    row.created_at,
  );
}

export function getOpinions(
  d: DatabaseSync,
  forecastId: string,
): OpinionRow[] {
  return d
    .prepare(`SELECT * FROM opinions WHERE forecast_id = ? ORDER BY round ASC, councilor_id ASC`)
    .all(forecastId) as unknown as OpinionRow[];
}

/** Per-councilor resolved track record: { n, sumSqErr, sumLogScore }. */
export function councilorTrackRecords(
  d: DatabaseSync,
): Map<string, { n: number; sumSqErr: number; sumLogScore: number }> {
  const rows = d
    .prepare(
      `SELECT o.councilor_id AS cid, o.probability AS p, q.score AS s
       FROM opinions o JOIN questions q ON q.id = o.question_id
       WHERE q.status = 'resolved' AND o.round = 2 AND q.score IS NOT NULL`,
    )
    .all() as Array<{ cid: string; p: number; s: number }>;
  const map = new Map<string, { n: number; sumSqErr: number; sumLogScore: number }>();
  for (const r of rows) {
    const p = Math.min(0.999, Math.max(0.001, r.p / 100));
    const entry = map.get(r.cid) || { n: 0, sumSqErr: 0, sumLogScore: 0 };
    entry.n += 1;
    entry.sumSqErr += (p - r.s) ** 2;
    entry.sumLogScore += r.s * Math.log(p) + (1 - r.s) * Math.log(1 - p);
    map.set(r.cid, entry);
  }
  return map;
}

/** Same, grouped by provider. */
export function providerTrackRecords(
  d: DatabaseSync,
): Map<string, { n: number; sumSqErr: number }> {
  const rows = d
    .prepare(
      `SELECT o.provider_id AS pid, o.probability AS p, q.score AS s
       FROM opinions o JOIN questions q ON q.id = o.question_id
       WHERE q.status = 'resolved' AND o.round = 2 AND q.score IS NOT NULL`,
    )
    .all() as Array<{ pid: string; p: number; s: number }>;
  const map = new Map<string, { n: number; sumSqErr: number }>();
  for (const r of rows) {
    const p = Math.min(0.999, Math.max(0.001, r.p / 100));
    const entry = map.get(r.pid) || { n: 0, sumSqErr: 0 };
    entry.n += 1;
    entry.sumSqErr += (p - r.s) ** 2;
    map.set(r.pid, entry);
  }
  return map;
}

/** (probability, outcome) pairs from resolved questions for calibration. */
export function calibrationPairs(
  d: DatabaseSync,
): Array<{ probability: number; outcome: number; date: string }> {
  return d
    .prepare(
      `SELECT f.probability AS probability, q.score AS outcome, q.resolved_at AS date
       FROM forecasts f JOIN questions q ON q.id = f.question_id
       WHERE q.status = 'resolved' AND q.score IS NOT NULL AND f.run_number = 1
       ORDER BY q.resolved_at ASC`,
    )
    .all() as Array<{ probability: number; outcome: number; date: string }>;
}

export function getCachedResearch(
  d: DatabaseSync,
  queryHash: string,
  ttlMs: number,
): string | null {
  const row = d
    .prepare(`SELECT response_json, created_at FROM research_cache WHERE query_hash = ?`)
    .get(queryHash) as { response_json: string; created_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.created_at > ttlMs) {
    d.prepare(`DELETE FROM research_cache WHERE query_hash = ?`).run(queryHash);
    return null;
  }
  return row.response_json;
}

export function setCachedResearch(
  d: DatabaseSync,
  queryHash: string,
  responseJson: string,
): void {
  d.prepare(
    `INSERT OR REPLACE INTO research_cache (query_hash, response_json, created_at) VALUES (?, ?, ?)`,
  ).run(queryHash, responseJson, Date.now());
}
