/**
 * Delphi seed data — 2–3 resolved example questions so the leaderboard and
 * calibration dashboard aren't empty on first run. Clearly labeled demo
 * history; seeded opinions carry status "seed".
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  getDb,
  insertQuestion,
  insertForecast,
  insertOpinion,
  listQuestions,
  resolveQuestion,
} from "./db.js";
import { COUNCILORS } from "./council.js";
import { aggregate, confidenceFromSpread } from "./aggregate.js";

interface SeedOpinion {
  councilor: string;
  p: number;
}

interface SeedQuestion {
  question: string;
  type: "binary" | "timing" | "numeric" | "categorical";
  deadline: string;
  criteria: string;
  created: string;
  resolved: string;
  outcome: "yes" | "no";
  score: 0 | 1;
  thesis: string;
  opinions: SeedOpinion[];
}

const SEEDS: SeedQuestion[] = [
  {
    question: "Will the Federal Reserve cut interest rates at its September 2025 meeting?",
    type: "binary",
    deadline: "2025-09-18",
    criteria: "Resolves yes if the FOMC lowers the federal funds target range at the September 16–17, 2025 meeting.",
    created: "2025-08-20T12:00:00Z",
    resolved: "2025-09-18T12:00:00Z",
    outcome: "yes",
    score: 1,
    thesis:
      "Cooling inflation prints and a softening labor market made a September cut the base case; futures pricing and Fed communication both pointed the same way.",
    opinions: [
      { councilor: "base-rate-analyst", p: 68 },
      { councilor: "domain-expert", p: 76 },
      { councilor: "skeptic", p: 55 },
      { councilor: "superforecaster", p: 71 },
    ],
  },
  {
    question: "Will Bitcoin trade above $100,000 at any point in 2024?",
    type: "binary",
    deadline: "2024-12-31",
    criteria: "Resolves yes if BTC/USD prints above $100,000 on a major exchange during calendar 2024.",
    created: "2024-10-05T12:00:00Z",
    resolved: "2025-01-02T12:00:00Z",
    outcome: "yes",
    score: 1,
    thesis:
      "Post-halving supply dynamics plus spot ETF inflows created persistent buy pressure; the question was timing, and December's momentum carried it through $100k.",
    opinions: [
      { councilor: "base-rate-analyst", p: 52 },
      { councilor: "domain-expert", p: 64 },
      { councilor: "skeptic", p: 38 },
      { councilor: "superforecaster", p: 58 },
    ],
  },
  {
    question: "Will NVIDIA's market capitalization exceed $4 trillion before the end of 2025?",
    type: "binary",
    deadline: "2025-12-31",
    criteria: "Resolves yes if NVDA market cap exceeds $4T intraday before 2026.",
    created: "2025-06-10T12:00:00Z",
    resolved: "2025-07-10T12:00:00Z",
    outcome: "yes",
    score: 1,
    thesis:
      "AI capex momentum and Blackwell ramp made $4T a when-not-if question by mid-2025; it printed the level in July.",
    opinions: [
      { councilor: "base-rate-analyst", p: 61 },
      { councilor: "domain-expert", p: 73 },
      { councilor: "skeptic", p: 47 },
      { councilor: "superforecaster", p: 66 },
      { councilor: "quant", p: 69 },
    ],
  },
];

const REASONINGS: Record<string, string> = {
  "base-rate-analyst": "Seeded example: anchored on the reference-class base rate, adjusted modestly for case specifics.",
  "domain-expert": "Seeded example: read the causal mechanisms and key actors; the inside view pointed this way.",
  skeptic: "Seeded example: steelmanned the opposite case and priced in surprise; still below consensus.",
  superforecaster: "Seeded example: decomposed into sub-questions and updated from an explicit prior.",
  quant: "Seeded example: framed the outcome as a distribution and converted drivers to point adjustments.",
};

export function seedIfEmpty(db: DatabaseSync = getDb()): boolean {
  if (listQuestions(db).length > 0) return false;
  for (const s of SEEDS) {
    const qid = randomUUID();
    insertQuestion(db, {
      id: qid,
      question: s.question,
      question_type: s.type,
      deadline: s.deadline,
      resolution_criteria: s.criteria,
      context: "Seeded example question.",
      created_at: s.created,
    });
    // Cold start → equal weights; aggregate the seeded opinions.
    const probs = s.opinions.map((o) => o.p);
    const { probability, weights } = aggregate({
      probs,
      briers: probs.map(() => null),
      resolvedCounts: probs.map(() => 0),
    });
    const weightsMap: Record<string, number> = {};
    s.opinions.forEach((o, i) => {
      weightsMap[o.councilor] = weights[i];
    });
    const fid = randomUUID();
    const confidence = confidenceFromSpread(probs);
    insertForecast(db, {
      id: fid,
      question_id: qid,
      run_number: 1,
      created_at: s.created,
      probability,
      confidence,
      answer: "Yes",
      confidence_lo: Math.max(0, probability - 16),
      confidence_hi: Math.min(100, probability + 16),
      summary: `${probability}% aggregate likelihood. Seeded example.`,
      timeline: `Resolution by ${s.deadline}`,
      best_case: "Seeded example best case.",
      worst_case: "Seeded example worst case.",
      readout_json: JSON.stringify({
        thesis: s.thesis,
        drivers: ["Seeded example driver"],
        counterSignals: ["Seeded example counter-signal"],
        updateTriggers: ["Seeded example update trigger"],
        assumptions: ["Seeded example assumption"],
        indicators: ["Seeded example indicator"],
      }),
      weights_json: JSON.stringify(weightsMap),
    });
    for (const o of s.opinions) {
      const c = COUNCILORS.find((x) => x.id === o.councilor)!;
      insertOpinion(db, {
        id: randomUUID(),
        forecast_id: fid,
        question_id: qid,
        councilor_id: o.councilor,
        provider_id: c.provider,
        round: 2,
        probability: o.p,
        confidence: "Medium",
        answer: "Yes",
        reasoning: REASONINGS[o.councilor] || "Seeded example reasoning.",
        status: "seed",
        created_at: s.created,
      });
    }
    // Mark resolved with the real outcome.
    db.prepare(`UPDATE questions SET resolved_at = ? WHERE id = ?`).run(s.resolved, qid);
    resolveQuestion(db, qid, s.outcome, s.score);
  }
  return true;
}
