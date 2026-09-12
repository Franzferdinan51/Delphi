import type {
  AskRequest,
  Calibration,
  Health,
  Leaderboard,
  QuestionDetail,
  QuestionSummary,
  ResolveResponse,
  StreamEvent,
  ProviderInfo,
} from "./types";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`API ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

export function getHealth(): Promise<Health> {
  return apiFetch<Health>("/health");
}

export function getQuestions(): Promise<{ questions: QuestionSummary[] }> {
  return apiFetch<{ questions: QuestionSummary[] }>("/questions");
}

export function getQuestion(id: string): Promise<QuestionDetail> {
  return apiFetch<QuestionDetail>(`/questions/${encodeURIComponent(id)}`);
}

export function resolveQuestion(id: string, outcome: string): Promise<ResolveResponse> {
  return apiFetch<ResolveResponse>("/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, outcome }),
  });
}

export function getLeaderboard(): Promise<Leaderboard> {
  return apiFetch<Leaderboard>("/leaderboard");
}

export function getCalibration(): Promise<Calibration> {
  return apiFetch<Calibration>("/calibration");
}

/**
 * POST /api/ask as SSE via fetch + ReadableStream.
 * Calls onEvent for every parsed `data:` JSON line until the stream closes
 * or the AbortSignal aborts.
 */
export async function askStream(
  body: AskRequest,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    throw new Error(`Ask failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith(":")) continue;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onEvent(JSON.parse(payload) as StreamEvent);
      } catch {
        /* ignore malformed line */
      }
    }
  }
}

export interface ProvidersResponse {
  ok: boolean;
  providers: ProviderInfo[];
}

export function getProviders(): Promise<ProvidersResponse> {
  return apiFetch<ProvidersResponse>("/providers");
}

export function setProviderModel(id: string, model: string): Promise<ProvidersResponse> {
  return apiFetch<ProvidersResponse>(`/providers/${encodeURIComponent(id)}/model`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
}
