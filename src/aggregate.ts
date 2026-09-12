/**
 * Delphi aggregation — logarithmic opinion pool with track-record weights
 * and extremization. Deliberately NOT naive averaging:
 *
 * - Log pool: the geometric-mean consensus of independent judgments. It
 *   rewards agreement near the extremes less than arithmetic averaging does,
 *   which matches how independent evidence should combine.
 * - Weights come from each councilor's resolved Brier history (skill =
 *   improvement over the always-say-50% baseline of 0.25). Cold start:
 *   equal weights until every councilor has 5+ resolved forecasts.
 * - Extremization: groups of forecasters are systematically underconfident,
 *   so we push the aggregate away from 50% (Satopää et al.).
 */

export const logit = (p: number): number => {
  const c = Math.min(0.999, Math.max(0.001, p));
  return Math.log(c / (1 - c));
};

export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export function normalize(weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || !Number.isFinite(sum)) return weights.map(() => 1 / weights.length);
  return weights.map((w) => w / sum);
}

/**
 * Track-record weights from per-councilor Brier means.
 * briers: mean Brier per councilor (null = no history). resolvedCounts:
 * number of resolved forecasts each. Returns weights summing to 1.
 */
export function trackRecordWeights(
  briers: Array<number | null>,
  resolvedCounts: number[],
  coldStartThreshold = 5,
): number[] {
  const n = briers.length;
  if (n === 0) return [];
  // Cold start: equal weights until everyone has enough history.
  if (resolvedCounts.some((c) => c < coldStartThreshold)) {
    return briers.map(() => 1 / n);
  }
  const skills = briers.map((b) =>
    Math.max(0.01, 0.25 - (b ?? 0.25)),
  );
  return normalize(skills);
}

/**
 * Logarithmic opinion pool for probabilities (0-1 scale).
 * Equivalent to the normalized geometric mean of the individual odds.
 */
export function logarithmicPool(probs: number[], weights: number[]): number {
  const w = normalize(weights);
  let aggLogit = 0;
  for (let i = 0; i < probs.length; i++) {
    aggLogit += w[i] * logit(probs[i]);
  }
  return sigmoid(aggLogit);
}

/** Push an aggregate probability away from 0.5 (extremization). */
export function extremize(p: number, nForecasters: number): number {
  const e = nForecasters >= 3 ? 0.15 : 0.08;
  const out = sigmoid(logit(p) * (1 + e));
  return Math.min(0.99, Math.max(0.01, out));
}

/** Weighted median for picking a central answer among numeric estimates. */
export function weightedMedian(values: number[], weights: number[]): number {
  const pairs = values
    .map((v, i) => ({ v, w: weights[i] ?? 0 }))
    .sort((a, b) => a.v - b.v);
  const total = pairs.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const { v, w } of pairs) {
    acc += w;
    if (acc >= total / 2) return v;
  }
  return pairs[pairs.length - 1]?.v ?? 0;
}

export interface AggregateInput {
  probs: number[]; // 0-100
  briers: Array<number | null>;
  resolvedCounts: number[];
  coldStartThreshold?: number;
}

export interface AggregateResult {
  probability: number; // 0-100
  weights: number[];
  rawPool: number; // 0-100, before extremization
}

/** Full aggregation: weights → log pool → extremization. */
export function aggregate(input: AggregateInput): AggregateResult {
  const { probs, briers, resolvedCounts } = input;
  const weights = trackRecordWeights(
    briers,
    resolvedCounts,
    input.coldStartThreshold ?? 5,
  );
  const rawPool =
    logarithmicPool(
      probs.map((p) => p / 100),
      weights,
    ) * 100;
  const probability = Math.round(extremize(rawPool / 100, probs.length) * 100);
  return { probability, weights, rawPool: Math.round(rawPool) };
}

/** Confidence label from the spread of round-2 probabilities. */
export function confidenceFromSpread(probs: number[]): "High" | "Medium" | "Low" {
  if (!probs.length) return "Low";
  const spread = Math.max(...probs) - Math.min(...probs);
  return spread <= 10 ? "High" : spread <= 22 ? "Medium" : "Low";
}

/** Confidence interval width from the confidence label. */
export function confidenceRange(
  probability: number,
  confidence: "High" | "Medium" | "Low",
): [number, number] {
  const half = confidence === "High" ? 10 : confidence === "Medium" ? 16 : 24;
  return [
    Math.max(0, probability - half),
    Math.min(100, probability + half),
  ];
}
