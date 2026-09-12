export type QuestionType = "binary" | "timing" | "numeric" | "categorical";
export type Phase = "research" | "deliberation" | "critic" | "aggregation" | "done";
export type ConfidenceLevel = "High" | "Medium" | "Low";
export type OpinionStatus = "live" | "demo" | "error";

export interface ProviderInfo {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  connected: boolean;
  availableModels: string[];
}

export interface Health {
  ok: boolean;
  version: string;
  demoMode: boolean;
  providers: ProviderInfo[];
}

export interface Councilor {
  id: string;
  name: string;
  tagline: string;
  provider: string;
}

export interface ResearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchEvent {
  type: "research";
  query: string;
  results: ResearchResultItem[];
}

export interface OpinionPayload {
  round: 1 | 2;
  councilorId: string;
  councilorName: string;
  tagline: string;
  provider: string;
  providerName: string;
  probability: number; // 0-100
  confidence: number | string;
  answer: string;
  reasoning: string;
  status: OpinionStatus;
  weight?: number;
}

export interface OpinionEvent extends OpinionPayload {
  type: "opinion";
}

export interface ForecastReadout {
  thesis: string;
  drivers: string[];
  counterSignals: string[];
  updateTriggers: string[];
  assumptions: string[];
  indicators: string[];
}

export interface Forecast {
  id: string;
  questionId: string;
  runNumber: number;
  createdAt: string;
  question: string;
  questionType: string;
  deadline: string;
  resolutionCriteria?: string;
  context?: string;
  probability: number; // 0-100
  confidence: ConfidenceLevel | string;
  answer: string;
  confidenceRange: [number, number];
  summary: string;
  timeline: string;
  bestCase: string;
  worstCase: string;
  readout: ForecastReadout;
  opinions: OpinionPayload[];
  weights: Record<string, number>;
  method: string;
}

export type StreamEvent =
  | { type: "started"; questionId: string; councilors: Councilor[] }
  | { type: "phase"; phase: Phase }
  | ResearchEvent
  | OpinionEvent
  | { type: "result"; forecast: Forecast }
  | { type: "error"; message: string };

export interface AskRequest {
  question: string;
  questionType: QuestionType;
  deadline: string;
  resolutionCriteria?: string;
  context?: string;
  demoMode?: boolean;
  councilSize?: 3 | 4 | 5;
}

export interface QuestionSummary {
  id: string;
  question: string;
  questionType: string;
  deadline: string;
  status: "open" | "resolved";
  probability: number;
  createdAt: string;
  resolvedAt?: string;
  outcome?: string;
}

export interface ForecastRun {
  runNumber: number;
  createdAt: string;
  probability: number;
  confidence: string;
}

export interface CouncilorScore {
  councilorId: string;
  councilorName?: string;
  brier: number;
  logScore: number;
}

export interface QuestionDetail {
  question: QuestionSummary & { resolutionCriteria?: string; context?: string };
  forecasts: ForecastRun[];
  latest: Forecast | null;
  resolution: {
    outcome: string;
    resolvedAt: string;
    scores: CouncilorScore[];
  } | null;
}

export interface ResolveResponse {
  ok: boolean;
  resolution: { outcome: string; score: number; resolvedAt: string };
  scores: (CouncilorScore & { councilorName?: string })[];
}

export interface LeaderboardEntry {
  id: string;
  name: string;
  tagline: string;
  n: number;
  brier: number;
  logScore: number;
}

export interface Leaderboard {
  councilors: LeaderboardEntry[];
  providers: { id: string; name: string; n: number; brier: number }[];
}

export interface CalibrationBucket {
  label: string;
  lo: number;
  hi: number;
  n: number;
  avgForecast: number;
  hitRate: number;
}

export interface Calibration {
  buckets: CalibrationBucket[];
  brierOverTime: { date: string; brier: number; n: number }[];
}
