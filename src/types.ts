/**
 * Delphi — shared types for the council-based prediction engine.
 */

export type QuestionType = "binary" | "timing" | "numeric" | "categorical";

/** Provider ids. Built-ins below; custom OpenAI-compatible endpoints may be
 *  registered via the DELPHI_PROVIDERS env var and get their own string id. */
export type ProviderId = string;

/** The four preconfigured providers shipped with Delphi. */
export const BUILTIN_PROVIDER_IDS = [
  "lmstudio",
  "minimax",
  "grok",
  "openai",
] as const;
export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];

export type OpinionStatus = "live" | "demo" | "seed" | "error";

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  connected: boolean;
}

export interface CouncilorDef {
  id: string;
  name: string;
  tagline: string;
  /** Short persona description shown in the UI. */
  role: string;
  systemPrompt: string;
  /** Keywords used for topic-relevance selection. */
  topics: string[];
  /** Preferred provider for this persona. */
  provider: ProviderId;
}

export interface AskInput {
  question: string;
  questionType: QuestionType;
  deadline: string;
  resolutionCriteria?: string;
  context?: string;
  demoMode?: boolean;
  councilSize?: number;
  /**
   * Re-run an existing question: appends a new forecast run (belief
   * tracking) instead of creating a new question. The question text/type
   * are taken from the stored question unless overridden.
   */
  existingQuestionId?: string;
}

export interface ResearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface CouncilorOpinion {
  councilorId: string;
  councilorName: string;
  tagline: string;
  provider: ProviderId;
  providerName: string;
  round: 1 | 2;
  probability: number; // 0-100, confidence the central answer is correct
  confidence: "High" | "Medium" | "Low";
  answer: string;
  reasoning: string;
  status: OpinionStatus;
  error?: string;
  weight: number; // aggregation weight (0-1)
}

export interface ForecastReadout {
  thesis: string;
  drivers: string[];
  counterSignals: string[];
  updateTriggers: string[];
  assumptions: string[];
  indicators: string[];
}

export interface ForecastPayload {
  id: string;
  questionId: string;
  runNumber: number;
  createdAt: string;
  question: string;
  questionType: QuestionType;
  deadline: string;
  resolutionCriteria: string;
  context: string;
  probability: number;
  confidence: "High" | "Medium" | "Low";
  answer: string;
  confidenceRange: [number, number];
  summary: string;
  timeline: string;
  bestCase: string;
  worstCase: string;
  readout: ForecastReadout;
  opinions: CouncilorOpinion[];
  weights: Record<string, number>;
  method: string;
}

export type PipelinePhase =
  | "research"
  | "deliberation"
  | "critic"
  | "aggregation"
  | "done";

export type PipelineEvent =
  | { type: "started"; questionId: string; councilors: Array<{ id: string; name: string; tagline: string; provider: ProviderId }> }
  | { type: "phase"; phase: PipelinePhase }
  | { type: "research"; query: string; results: ResearchResult[] }
  | { type: "opinion"; opinion: CouncilorOpinion }
  | { type: "result"; forecast: ForecastPayload }
  | { type: "error"; message: string };

export interface ScoreRow {
  councilorId: string;
  councilorName: string;
  n: number;
  brier: number;
  logScore: number;
}

export interface ProviderScoreRow {
  id: string;
  name: string;
  n: number;
  brier: number;
}

export interface CalibrationBucket {
  label: string;
  lo: number;
  hi: number;
  n: number;
  avgForecast: number;
  hitRate: number;
}
