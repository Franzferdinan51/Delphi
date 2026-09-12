/**
 * Delphi council — five forecaster personas, topic-relevance selection,
 * and per-persona prompt construction.
 *
 * Adapted from the AI-Bot-Council-Consensus selection idea: pick the right
 * minds for the question instead of running everyone every time.
 */
import type { CouncilorDef, ProviderId } from "./types.js";

export const COUNCILORS: CouncilorDef[] = [
  {
    id: "base-rate-analyst",
    name: "Base-Rate Analyst",
    tagline: "The outside view",
    role: "Starts from reference classes and historical base rates, then adjusts for specifics. Distrusts narratives.",
    systemPrompt: `You are the Base-Rate Analyst on a forecasting council. Your job is the OUTSIDE VIEW.

Method:
1. Identify the relevant reference class for this event (what category of event is this?).
2. State the historical base rate for that reference class explicitly.
3. Adjust from the base rate only for specific, evidenced reasons — and say how much each adjustment moves you.
4. Never let a vivid story override the base rate without quantified justification.

Be numerically explicit. Your probability must be anchored in the base rate you cite.`,
    topics: ["election", "market", "stock", "recession", "startup", "product", "launch", "sports", "war", "default"],
    provider: "lmstudio",
  },
  {
    id: "domain-expert",
    name: "Domain Expert",
    tagline: "The inside view",
    role: "Deep domain knowledge of the specific mechanisms at play. Reads the causal chain, not just the statistics.",
    systemPrompt: `You are the Domain Expert on a forecasting council. Your job is the INSIDE VIEW.

Method:
1. Break the question into its causal mechanisms — what would actually have to happen for each outcome?
2. Bring specific domain knowledge: key actors, incentives, constraints, timelines, precedents.
3. Identify the 2-3 variables that matter most and assess each.
4. Name what you don't know and how much it matters.

Be concrete and mechanism-focused. Avoid generic punditry.`,
    topics: [
      "ai", "model", "llm", "tech", "software", "chip", "semiconductor",
      "fed", "rate", "inflation", "economy", "gdp", "market", "crypto", "bitcoin",
      "election", "vote", "congress", "senate", "policy", "regulation",
      "climate", "weather", "hurricane", "cannabis", "fda", "drug",
      "nfl", "nba", "sports", "olympics", "space", "nasa", "rocket",
    ],
    provider: "grok",
  },
  {
    id: "skeptic",
    name: "Skeptic",
    tagline: "Red team",
    role: "Attacks the thesis. Steelman the opposite case, hunts for flawed assumptions, and prices in surprise.",
    systemPrompt: `You are the Skeptic (red team) on a forecasting council. Your job is to ATTACK the consensus thesis.

Method:
1. Steelman the opposite case: what is the strongest argument that the likely-seeming outcome does NOT happen?
2. List the hidden assumptions the bullish case depends on. Which is most fragile?
3. Consider base rates of surprise: how often do "sure things" in this domain fail?
4. Your probability should reflect genuine doubt, not contrarianism for its own sake — be adversarial but calibrated.

If the evidence truly is overwhelming, say so and give a high probability. Otherwise, find the crack in the case.`,
    topics: [],
    provider: "minimax",
  },
  {
    id: "superforecaster",
    name: "Superforecaster",
    tagline: "Fermi + Bayes",
    role: "Decomposes the question, Fermi-estimates the pieces, and updates like a Bayesian. Granular and explicit.",
    systemPrompt: `You are the Superforecaster on a forecasting council. Your job is STRUCTURED DECOMPOSITION.

Method:
1. Decompose the question into 2-4 sub-questions, each easier to estimate.
2. For each sub-question, give a Fermi-style estimate with brief justification.
3. Combine them explicitly (show your rough math).
4. Start from a prior, then Bayesian-update on the strongest 2-3 pieces of evidence. State the prior and the update.

Show your work numerically. Precision of reasoning matters more than round numbers — avoid 50%, use 47% or 63% when your math says so.`,
    topics: [],
    provider: "openai",
  },
  {
    id: "quant",
    name: "Quant Modeler",
    tagline: "Distributions, not stories",
    role: "Thinks in distributions and expected values. Translates narratives into numbers and checks them against data.",
    systemPrompt: `You are the Quant Modeler on a forecasting council. Your job is to think in DISTRIBUTIONS, not stories.

Method:
1. Frame the outcome as a distribution: what is the range of plausible values and where is the mass?
2. Convert qualitative arguments into quantitative adjustments with explicit magnitudes.
3. Sanity-check against any relevant numbers: market prices, prediction markets, polls, historical frequencies.
4. Report your central estimate and what would move it 10+ points.

Numbers first, narrative second. If a driver can't be quantified, say how much weight you're giving it anyway.`,
    topics: ["market", "stock", "price", "odds", "poll", "statistic", "data", "forecast", "gdp", "rate"],
    provider: "lmstudio",
  },
];

export function councilorById(id: string): CouncilorDef {
  const c = COUNCILORS.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown councilor: ${id}`);
  return c;
}

/**
 * Select councilors by topic relevance. Scores each persona on keyword
 * overlap with the question + context; personae with no topic keywords
 * (skeptic, superforecaster) are universal and get a baseline score.
 */
export function selectCouncilors(
  question: string,
  context: string,
  count = 4,
): CouncilorDef[] {
  const text = `${question} ${context}`.toLowerCase();
  const scored = COUNCILORS.map((c) => {
    let score = c.topics.length === 0 ? 5 : 0; // universal personae baseline
    for (const kw of c.topics) {
      if (text.includes(kw.toLowerCase())) score += 3;
    }
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score || COUNCILORS.indexOf(a.c) - COUNCILORS.indexOf(b.c));
  const n = Math.min(Math.max(count, 1), COUNCILORS.length);
  return scored.slice(0, n).map((s) => s.c);
}

/** Build the round-1 prompt: persona + brief + research notes + priors + decomposition. */
export function buildBriefPrompt(
  councilor: CouncilorDef,
  brief: {
    question: string;
    questionType: string;
    deadline: string;
    resolutionCriteria: string;
    context: string;
    researchNotes: string;
    priorNotes?: string;
    decompositionNotes?: string;
  },
): string {
  const answerInstruction =
    brief.questionType === "timing"
      ? "Give the most likely month, quarter, or date window in <forecast_answer>."
      : brief.questionType === "numeric"
        ? "Give the most likely numeric range with units in <forecast_answer>."
        : brief.questionType === "categorical"
          ? "Give the most likely outcome or scenario in <forecast_answer>."
          : "Give Yes or No in <forecast_answer>.";
  return [
    `Question:\n${brief.question.trim()}`,
    `Question type: ${brief.questionType}`,
    `Resolution deadline: ${brief.deadline}`,
    brief.resolutionCriteria.trim()
      ? `Resolution criteria:\n${brief.resolutionCriteria.trim()}`
      : "",
    brief.context.trim() ? `Context:\n${brief.context.trim()}` : "",
    brief.researchNotes.trim() ? `Research notes:\n${brief.researchNotes.trim()}` : "",
    brief.priorNotes?.trim() ? `Bayesian anchors (argue for/against moving from each):\n${brief.priorNotes.trim()}` : "",
    brief.decompositionNotes?.trim() ? `${brief.decompositionNotes.trim()}` : "",
    [
      "Return XML only.",
      answerInstruction,
      "Use <probability>0-100</probability> for your confidence that the central answer is correct,",
      "<confidence>High|Medium|Low</confidence>,",
      "<reasoning>3-6 sentences, in your persona's voice and method</reasoning>,",
      "<drivers>semicolon-separated key drivers</drivers>,",
      "<counter_signals>semicolon-separated disconfirming signals</counter_signals>,",
      "<update_triggers>semicolon-separated facts that would change your estimate</update_triggers>,",
      "<assumptions>semicolon-separated assumptions</assumptions>.",
    ].join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Build the round-2 (critic) prompt: persona sees peers' reasoning, may update. */
export function buildCriticPrompt(
  councilor: CouncilorDef,
  brief: { question: string; questionType: string; deadline: string },
  ownProbability: number,
  peers: Array<{ name: string; probability: number; reasoning: string }>,
): string {
  const peerText = peers
    .map(
      (p) =>
        `## ${p.name} — ${p.probability}%\n${p.reasoning.slice(0, 600)}`,
    )
    .join("\n\n");
  return [
    `You gave an initial forecast of ${ownProbability}% on: "${brief.question.trim()}" (deadline ${brief.deadline}).`,
    `Now you see the other councilors' independent reasoning:\n\n${peerText}`,
    [
      "Critique phase. Consider: did a peer surface evidence or a mechanism you missed?",
      "Did anyone make an error you can identify?",
      "Update your probability ONLY if the peers genuinely changed your mind — anchoring to the group is a failure mode.",
      "Return XML only with the same tags as before: <forecast_answer>, <probability>, <confidence>, <reasoning> (explain what you kept, what you changed, and why), <drivers>, <counter_signals>, <update_triggers>, <assumptions>.",
    ].join(" "),
  ].join("\n\n");
}

export function providerForCouncilor(c: CouncilorDef): ProviderId {
  return c.provider;
}
