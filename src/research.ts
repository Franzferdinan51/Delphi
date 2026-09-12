/**
 * Delphi research — SearXNG by default, Tavily/Brave optional via API keys.
 * Search budgets, 5-minute SQLite cache, URL dedup. In demo mode, returns
 * canned research notes so the pipeline runs with zero credentials.
 */
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SEARCH } from "./config.js";
import { getCachedResearch, setCachedResearch } from "./db.js";
import type { ResearchResult } from "./types.js";

const inFlight = new Map<string, Promise<ResearchResult[]>>();

function hashQuery(q: string): string {
  return createHash("sha256").update(q).digest("hex").slice(0, 32);
}

function dedupe(results: ResearchResult[]): ResearchResult[] {
  const seen = new Set<string>();
  return results.filter((r) => {
    const key = r.url.split("?")[0].toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function searchSearxng(query: string): Promise<ResearchResult[]> {
  const url =
    `${SEARCH.searxngUrl}/search?q=${encodeURIComponent(query)}` +
    `&format=json&categories=general&language=en`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`SearXNG search failed (${res.status})`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results || []).slice(0, SEARCH.maxResults).map((r) => ({
    title: r.title || "Untitled",
    url: r.url || "",
    snippet: (r.content || "").slice(0, 400),
  }));
}

async function searchTavily(query: string): Promise<ResearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      api_key: SEARCH.tavilyApiKey,
      query,
      max_results: SEARCH.maxResults,
      search_depth: "advanced",
    }),
  });
  if (!res.ok) throw new Error(`Tavily search failed (${res.status})`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results || []).map((r) => ({
    title: r.title || "Untitled",
    url: r.url || "",
    snippet: (r.content || "").slice(0, 400),
  }));
}

async function searchBrave(query: string): Promise<ResearchResult[]> {
  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${SEARCH.maxResults}`,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": SEARCH.braveApiKey,
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!res.ok) throw new Error(`Brave search failed (${res.status})`);
  const data = (await res.json()) as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };
  return (data.web?.results || []).map((r) => ({
    title: r.title || "Untitled",
    url: r.url || "",
    snippet: (r.description || "").slice(0, 400),
  }));
}

async function liveSearch(query: string): Promise<ResearchResult[]> {
  // Prefer Tavily > Brave > SearXNG when keys exist; SearXNG is the default.
  if (SEARCH.tavilyApiKey) return searchTavily(query);
  if (SEARCH.braveApiKey) return searchBrave(query);
  return searchSearxng(query);
}

export function demoResearch(query: string): ResearchResult[] {
  return [
    {
      title: `Background: ${query.slice(0, 80)}`,
      url: "demo://research/background",
      snippet:
        "Demo research note: in a live run this would be fresh web evidence. Base rates for comparable events were reviewed; no disqualifying evidence found in the brief.",
    },
    {
      title: "Reference class comparables",
      url: "demo://research/reference-class",
      snippet:
        "Demo research note: similar past events resolved positively roughly half the time, with outcomes clustering around the base rate. Treat narratives with skepticism.",
    },
  ];
}

/** Run one query through cache → live search → cache store. */
export async function runQuery(
  db: DatabaseSync,
  query: string,
  demoMode: boolean,
): Promise<ResearchResult[]> {
  if (demoMode) return demoResearch(query);
  const key = hashQuery(query);
  const cached = getCachedResearch(db, key, SEARCH.cacheTtlMs);
  if (cached) return JSON.parse(cached) as ResearchResult[];

  const existing = inFlight.get(key);
  if (existing) return existing;

  const p = liveSearch(query)
    .then((results) => {
      const clean = dedupe(results);
      setCachedResearch(db, key, JSON.stringify(clean));
      inFlight.delete(key);
      return clean;
    })
    .catch((e) => {
      inFlight.delete(key);
      throw e;
    });
  inFlight.set(key, p);
  return p;
}

export function buildQueries(question: string, deadline: string): string[] {
  const queries = [question];
  const withDeadline = `${question} ${deadline}`.trim();
  if (withDeadline !== question) queries.push(withDeadline);
  return queries.slice(0, SEARCH.maxQueries);
}

/** Flatten research into prompt-ready notes. */
export function researchNotes(
  perQuery: Array<{ query: string; results: ResearchResult[] }>,
): string {
  const lines: string[] = [];
  for (const { query, results } of perQuery) {
    lines.push(`Search: "${query}"`);
    for (const r of results.slice(0, SEARCH.maxResults)) {
      lines.push(`- ${r.title} (${r.url}): ${r.snippet}`);
    }
  }
  const seen = new Set<string>();
  return lines
    .filter((l) => (seen.has(l) ? false : (seen.add(l), true)))
    .join("\n")
    .slice(0, 4000);
}
