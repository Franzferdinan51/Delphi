/**
 * Delphi confidence score — a 0-100 numeric score for the aggregate forecast.
 *
 * This complements the coarse High/Medium/Low label (which comes from council
 * spread alone). The score blends four signals:
 *
 *   agreement        — how tightly the council converged (round-2 spread)
 *   priorConvergence — how far the aggregate moved from the outside-view priors
 *   evidence         — volume of research behind the forecast
 *   trackRecord      — how much resolved history backs the council's weights
 *
 * Every component is 0-100 and the weights are fixed and documented, so the
 * score is explainable: the breakdown ships with every forecast.
 */

export interface ConfidenceInputs {
  /** max - min of round-2 probabilities (0-100) */
  spread: number;
  /** |aggregate - blended prior| in points, null when no priors exist */
  priorDistance: number | null;
  /** number of research results feeding the brief */
  researchResults: number;
  /** total resolved forecasts across the council (for weight credibility) */
  resolvedTotal: number;
}

export interface ConfidenceBreakdown {
  agreement: number;
  priorConvergence: number;
  evidence: number;
  trackRecord: number;
}

const clamp = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));

export function confidenceBreakdown(i: ConfidenceInputs): ConfidenceBreakdown {
  return {
    // Tight council consensus → high. A 55-point spread means no agreement.
    agreement: clamp(100 - Math.max(0, i.spread) * 1.8),
    // Small moves from the outside view → the evidence confirmed the priors.
    // No priors → neutral 60 rather than penalizing.
    priorConvergence:
      i.priorDistance == null ? 60 : clamp(100 - Math.max(0, i.priorDistance) * 2.2),
    // ~7+ solid sources saturates.
    evidence: clamp(Math.max(0, i.researchResults) * 14),
    // ~20 resolved forecasts saturates weight credibility.
    trackRecord: clamp(Math.max(0, i.resolvedTotal) * 5),
  };
}

export interface ConfidenceScore {
  /** 0-100 */
  score: number;
  breakdown: ConfidenceBreakdown;
}

const WEIGHTS = { agreement: 0.35, priorConvergence: 0.25, evidence: 0.2, trackRecord: 0.2 } as const;

/** Blend the four components into the final 0-100 confidence score. */
export function confidenceScore(i: ConfidenceInputs): ConfidenceScore {
  const breakdown = confidenceBreakdown(i);
  const score = clamp(
    breakdown.agreement * WEIGHTS.agreement +
      breakdown.priorConvergence * WEIGHTS.priorConvergence +
      breakdown.evidence * WEIGHTS.evidence +
      breakdown.trackRecord * WEIGHTS.trackRecord,
  );
  return { score, breakdown };
}
