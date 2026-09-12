/**
 * Delphi scoring — Brier scores, log scores, and calibration buckets.
 * This is the self-grading loop: every resolved forecast grades every
 * councilor and provider, and the grades drive future aggregation weights.
 */

export const clampP = (p: number): number => Math.min(0.999, Math.max(0.001, p));

/** Brier score for one forecast: (p - outcome)^2. Lower is better. */
export function brierScore(probability: number, outcome: 0 | 1): number {
  const p = Math.min(1, Math.max(0, probability));
  return (p - outcome) ** 2;
}

/** Mean Brier score over a set of (p, outcome) pairs. */
export function meanBrier(pairs: Array<{ p: number; o: 0 | 1 }>): number {
  if (!pairs.length) return NaN;
  return pairs.reduce((s, x) => s + brierScore(x.p, x.o), 0) / pairs.length;
}

/** Logarithmic score for one forecast. Higher (closer to 0) is better. */
export function logScore(probability: number, outcome: 0 | 1): number {
  const p = clampP(probability);
  return outcome * Math.log(p) + (1 - outcome) * Math.log(1 - p);
}

export function meanLogScore(pairs: Array<{ p: number; o: 0 | 1 }>): number {
  if (!pairs.length) return NaN;
  return pairs.reduce((s, x) => s + logScore(x.p, x.o), 0) / pairs.length;
}

export interface BucketInput {
  probability: number; // 0-1
  outcome: 0 | 1;
}

export interface BucketResult {
  label: string;
  lo: number;
  hi: number;
  n: number;
  avgForecast: number;
  hitRate: number;
}

/** 10 calibration buckets: for forecasts made at X%, how often did they hit? */
export function calibrationBuckets(pairs: BucketInput[]): BucketResult[] {
  const buckets: BucketResult[] = [];
  for (let i = 0; i < 10; i++) {
    const lo = i / 10;
    const hi = (i + 1) / 10;
    const inBucket = pairs.filter(
      (x) => x.probability >= lo && (i === 9 ? x.probability <= hi : x.probability < hi),
    );
    buckets.push({
      label: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`,
      lo,
      hi,
      n: inBucket.length,
      avgForecast: inBucket.length
        ? inBucket.reduce((s, x) => s + x.probability, 0) / inBucket.length
        : 0,
      hitRate: inBucket.length
        ? inBucket.reduce((s, x) => s + x.outcome, 0) / inBucket.length
        : 0,
    });
  }
  return buckets;
}

/**
 * Parse a human resolution outcome into a 0/1 score.
 * Binary: yes/no/true/false/1/0. Other types: correct/incorrect (or 1/0) —
 * i.e. "was the central answer right?"
 */
export function parseOutcome(
  outcome: string,
  questionType: string,
): { score: 0 | 1; normalized: string } {
  const t = outcome.trim().toLowerCase();
  const yes = ["yes", "y", "true", "1", "correct"];
  const no = ["no", "n", "false", "0", "incorrect"];
  if (yes.includes(t)) return { score: 1, normalized: questionType === "binary" ? "yes" : "correct" };
  if (no.includes(t)) return { score: 0, normalized: questionType === "binary" ? "no" : "incorrect" };
  throw new Error(
    `Cannot parse outcome "${outcome}". Use yes/no for binary questions, correct/incorrect otherwise.`,
  );
}
