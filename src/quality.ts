/**
 * Delphi quality gates — every councilor response must pass before it
 * counts. Adapted from the council's generator-verifier pattern.
 */
export interface QualityResult {
  passed: boolean;
  issues: string[];
  score: number;
}

const CRITERIA = {
  minLength: 120,
  requiredTags: ["<probability>", "<reasoning>"],
  forbiddenPatterns: ["as an AI", "i cannot", "i don't have access", "[COPY]"],
};

export function checkQuality(response: string): QualityResult {
  const issues: string[] = [];
  let score = 100;
  if (response.length < CRITERIA.minLength) {
    issues.push(`Too short (${response.length} < ${CRITERIA.minLength})`);
    score -= 25;
  }
  for (const tag of CRITERIA.requiredTags) {
    if (!response.toLowerCase().includes(tag.toLowerCase())) {
      issues.push(`Missing tag: ${tag}`);
      score -= 25;
    }
  }
  const lower = response.toLowerCase();
  for (const pattern of CRITERIA.forbiddenPatterns) {
    if (lower.includes(pattern)) {
      issues.push(`Forbidden pattern: "${pattern}"`);
      score -= 30;
    }
  }
  // Repetition check
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length > 20) {
    const unique = new Set(words);
    if (unique.size < words.length * 0.3) {
      issues.push("High repetition");
      score -= 30;
    }
  }
  return { passed: score >= 60, issues, score: Math.max(0, score) };
}

export function extractTag(text: string, tag: string): string {
  return (
    text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"))?.[1]?.trim() || ""
  );
}

export function listTag(text: string, tag: string): string[] {
  return extractTag(text, tag)
    .split(/\n|;|•/)
    .map((v) => v.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

export interface ParsedOpinion {
  probability: number;
  confidence: "High" | "Medium" | "Low";
  answer: string;
  reasoning: string;
  drivers: string[];
  counterSignals: string[];
  updateTriggers: string[];
  assumptions: string[];
}

/** Parse a councilor's XML-tagged response into a structured opinion. */
export function parseOpinion(text: string): ParsedOpinion {
  const proseMatch =
    text.match(/(?:probability|chance|likely)\D{0,20}(\d{1,3})\s*%/i) ||
    text.match(/(\d{1,3})\s*%\s*(?:chance|probability|likelihood)/i);
  const rawProb =
    extractTag(text, "probability") || proseMatch?.[1] || "50";
  const conf = extractTag(text, "confidence").toLowerCase();
  return {
    probability: Math.max(0, Math.min(100, Number.parseInt(rawProb, 10) || 50)),
    confidence: conf.startsWith("high") ? "High" : conf.startsWith("low") ? "Low" : "Medium",
    answer: extractTag(text, "forecast_answer") || extractTag(text, "answer"),
    reasoning:
      extractTag(text, "reasoning") ||
      text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1600),
    drivers: listTag(text, "drivers"),
    counterSignals: listTag(text, "counter_signals"),
    updateTriggers: listTag(text, "update_triggers"),
    assumptions: listTag(text, "assumptions"),
  };
}
