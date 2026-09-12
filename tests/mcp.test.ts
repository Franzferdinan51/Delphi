import { describe, it, expect, afterEach } from "vitest";
import { memoryDb, listQuestions } from "../src/db.js";
import { buildToolHandlers } from "../src/mcp.js";
import { customProviders, defaultProviders } from "../src/config.js";

const call = async (
  db: ReturnType<typeof memoryDb>,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const tool = buildToolHandlers(db).find((t) => t.name === name);
  if (!tool) throw new Error(`No such tool: ${name}`);
  return (await tool.handler(args)) as Record<string, unknown>;
};

describe("MCP tools", () => {
  it("exposes the full forecast lifecycle", async () => {
    const db = memoryDb();

    const asked = (await call(db, "ask_forecast", {
      question: "Will the MCP test suite pass?",
      question_type: "binary",
      deadline: "2027-01-01",
      demo_mode: true,
      council_size: 3,
    })) as Record<string, unknown>;
    expect(asked.question).toBe("Will the MCP test suite pass?");
    expect(asked.probability).toBeGreaterThanOrEqual(0);
    expect(asked.probability).toBeLessThanOrEqual(100);
    expect(asked.opinions).toHaveLength(3);

    const listed = (await call(db, "list_questions")) as {
      questions: Array<{ id: string }>;
    };
    expect(listed.questions).toHaveLength(1);
    const id = listed.questions[0].id;

    const detail = (await call(db, "get_question", { id: id.slice(0, 8) })) as {
      question: { id: string };
      latest: { probability: number };
    };
    expect(detail.question.id).toBe(id);
    expect(detail.latest.probability).toBe(asked.probability);

    const resolved = (await call(db, "resolve_question", {
      id,
      outcome: "yes",
    })) as { ok: boolean; scores: Array<{ brier: number }> };
    expect(resolved.ok).toBe(true);
    expect(resolved.scores.length).toBeGreaterThan(0);

    const lb = (await call(db, "get_leaderboard")) as {
      councilors: Array<{ id: string; n: number }>;
    };
    expect(lb.councilors.some((c) => c.n > 0)).toBe(true);

    const cal = (await call(db, "get_calibration")) as {
      brierOverTime: Array<{ n: number }>;
    };
    expect(cal.brierOverTime).toHaveLength(1);

    expect(listQuestions(db)).toHaveLength(1);
  });

  it("supports belief tracking via existing_question_id", async () => {
    const db = memoryDb();
    const first = (await call(db, "ask_forecast", {
      question: "Belief tracking?",
      question_type: "binary",
      deadline: "2027-06-01",
      demo_mode: true,
      council_size: 2,
    })) as { questionId: string };
    const second = (await call(db, "ask_forecast", {
      question: "",
      question_type: "binary",
      deadline: "",
      demo_mode: true,
      existing_question_id: first.questionId,
    })) as { questionId: string; runNumber: number };
    expect(second.questionId).toBe(first.questionId);
    expect(second.runNumber).toBe(2);
    const detail = (await call(db, "get_question", {
      id: first.questionId,
    })) as { forecasts: Array<unknown> };
    expect(detail.forecasts).toHaveLength(2);
  });

  it("lists councilors and providers", async () => {
    const db = memoryDb();
    const councilors = (await call(db, "list_councilors")) as {
      councilors: Array<{ id: string; provider: string }>;
    };
    expect(councilors.councilors.length).toBeGreaterThanOrEqual(4);
    const providers = (await call(db, "get_providers")) as {
      providers: Array<{ id: string }>;
    };
    expect(providers.providers.map((p) => p.id)).toContain("lmstudio");
    const health = (await call(db, "delphi_health")) as { ok: boolean };
    expect(health.ok).toBe(true);
  });

  it("rejects unknown questions", async () => {
    const db = memoryDb();
    await expect(call(db, "get_question", { id: "nope" })).rejects.toThrow(
      "Question not found",
    );
  });
});

describe("custom providers (DELPHI_PROVIDERS)", () => {
  afterEach(() => {
    delete process.env.DELPHI_PROVIDERS;
  });

  it("parses custom OpenAI-compatible endpoints", () => {
    process.env.DELPHI_PROVIDERS = JSON.stringify([
      {
        id: "deepseek",
        name: "DeepSeek",
        endpoint: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-test",
      },
    ]);
    const customs = customProviders();
    expect(customs).toHaveLength(1);
    expect(customs[0].id).toBe("deepseek");
    expect(customs[0].endpoint).toBe("https://api.deepseek.com/v1");
    const all = defaultProviders();
    expect(all.map((p) => p.id)).toEqual(
      expect.arrayContaining(["lmstudio", "minimax", "grok", "openai", "nvidia", "opencode", "meta", "deepseek"]),
    );
  });

  it("rejects builtin id collisions and bad shapes", () => {
    process.env.DELPHI_PROVIDERS = JSON.stringify([{ id: "grok", endpoint: "https://x/v1" }]);
    expect(() => customProviders()).toThrow("collides with a built-in");
    process.env.DELPHI_PROVIDERS = "not json";
    expect(() => customProviders()).toThrow("not valid JSON");
    process.env.DELPHI_PROVIDERS = JSON.stringify([{ name: "no id" }]);
    expect(() => customProviders()).toThrow('"id" is required');
  });
});
