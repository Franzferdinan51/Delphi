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

const API_KEY_STORAGE = "delphi.apiKey";

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || "";
  } catch {
    return "";
  }
}

export function setStoredApiKey(key: string): void {
  try {
    if (key.trim()) localStorage.setItem(API_KEY_STORAGE, key.trim());
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    /* ignore quota / private mode */
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const key = getStoredApiKey();
  if (key && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${key}`);
  const res = await fetch(`/api${path}`, { ...init, headers });
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
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(getStoredApiKey() ? { Authorization: `Bearer ${getStoredApiKey()}` } : {}),
    },
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
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error("Forecast stream ended before a result was received.");
      buf += decoder.decode(value, { stream: true });
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buf))) {
        const frame = buf.slice(0, separator.index);
        buf = buf.slice(separator.index + separator[0].length);
        const payload = frame.split(/\r?\n/).filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (!payload || payload === "[DONE]") continue;
        const raw = JSON.parse(payload);
        // REST uses {type, opinion}; accept older flat events as well.
        const event = (raw.type === "opinion" && raw.opinion
          ? { ...raw.opinion, type: "opinion" } : raw) as StreamEvent;
        onEvent(event);
        if (event.type === "result" || event.type === "error") return;
      }
      if (buf.length > 1024 * 1024) throw new Error("Forecast stream frame is too large.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
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

export interface CouncilorInfo {
  id: string;
  name: string;
  tagline: string;
  role: string;
  provider: string;
}

export function getCouncilors(): Promise<{ councilors: CouncilorInfo[] }> {
  return apiFetch<{ councilors: CouncilorInfo[] }>("/councilors");
}

export function setCouncilorProvider(id: string, provider: string): Promise<{ ok: boolean; provider: string }> {
  return apiFetch(`/councilors/${encodeURIComponent(id)}/provider`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
}
