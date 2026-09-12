/**
 * Delphi MCP server — Streamable HTTP transport.
 *
 * Exposes the full forecast lifecycle as tools so external agents
 * (Ryan's bots, coding agents, any MCP client) can drive Delphi over the
 * network without a browser:
 *
 *   POST /mcp  → JSON-RPC 2.0 (initialize → tools/list → tools/call)
 *
 * Stateless mode: every request carries its own JSON-RPC message(s) and
 * gets a single JSON response. No session persistence required.
 */
import type { DatabaseSync } from "node:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import { runPipeline } from "./pipeline.js";
import {
  findQuestion,
  forecastPayload,
  listQuestionsView,
  questionDetailView,
  leaderboardView,
  calibrationView,
  resolveQuestionView,
  councilorsView,
  providersView,
} from "./service.js";
import type { AskInput, QuestionType } from "./types.js";
import { VERSION, defaultProviders, resolveProviders, providerById, writeModelChoice } from "./config.js";

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

const QuestionTypeSchema = z
  .enum(["binary", "timing", "numeric", "categorical"])
  .default("binary")
  .describe("Forecast question type");

export interface ToolHandler {
  name: string;
  description: string;
  schema: ZodRawShapeCompat;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Tool definitions decoupled from the MCP server object so they can be
 * unit-tested without standing up a transport.
 */
export function buildToolHandlers(db: DatabaseSync): ToolHandler[] {
  const questionTypeOf = (v: unknown): QuestionType =>
    (["binary", "timing", "numeric", "categorical"].includes(String(v))
      ? String(v)
      : "binary") as QuestionType;

  return [
    {
      name: "ask_forecast",
      description:
        "Run the full Delphi council pipeline on a question: research, independent deliberation, critic round, track-record-weighted aggregation. Returns the stored forecast with per-councilor opinions, probabilities, and readout. Use existing_question_id to re-run (belief tracking) instead of creating a new question.",
      schema: {
        question: z.string().describe("The forecasting question, plainly worded"),
        question_type: QuestionTypeSchema,
        deadline: z.string().describe("Resolution deadline, e.g. 2027-01-01"),
        resolution_criteria: z.string().optional().describe("How the question resolves"),
        context: z.string().optional().describe("Extra context / known evidence"),
        demo_mode: z.boolean().optional().describe("Deterministic demo forecasts, no live models"),
        council_size: z.number().int().min(1).max(5).optional().describe("Number of councilors (default 4)"),
        existing_question_id: z.string().optional().describe("Re-run an open question: appends a new belief run"),
      },
      handler: async (args) => {
        const input: AskInput = {
          question: String(args.question),
          questionType: questionTypeOf(args.question_type),
          deadline: String(args.deadline),
          resolutionCriteria: args.resolution_criteria ? String(args.resolution_criteria) : undefined,
          context: args.context ? String(args.context) : undefined,
          demoMode: typeof args.demo_mode === "boolean" ? args.demo_mode : undefined,
          councilSize: typeof args.council_size === "number" ? args.council_size : undefined,
          existingQuestionId: args.existing_question_id ? String(args.existing_question_id) : undefined,
        };
        const forecast = await runPipeline(input, { db });
        return forecastPayload(forecast);
      },
    },
    {
      name: "list_questions",
      description: "List all forecast questions with latest probabilities and status.",
      schema: {},
      handler: async () => listQuestionsView(db),
    },
    {
      name: "get_question",
      description:
        "Full detail for a question: metadata, belief history across runs, latest forecast with per-councilor opinions, and resolution info if resolved. Accepts a full id or an unambiguous id prefix.",
      schema: {
        id: z.string().describe("Question id or id prefix"),
      },
      handler: async (args) => questionDetailView(db, String(args.id)),
    },
    {
      name: "resolve_question",
      description:
        "Record the outcome of an open question and grade every councilor. Outcome is normalized per question type: binary accepts yes/no/1/0/true/false; timing/numeric/categorical store the outcome verbatim.",
      schema: {
        id: z.string().describe("Question id or id prefix"),
        outcome: z.string().describe("The observed outcome"),
      },
      handler: async (args) =>
        resolveQuestionView(db, String(args.id), String(args.outcome)),
    },
    {
      name: "get_leaderboard",
      description:
        "Councilor and provider track records ranked by mean Brier score (lower is better).",
      schema: {},
      handler: async () => leaderboardView(db),
    },
    {
      name: "get_calibration",
      description:
        "Calibration buckets (forecast probability vs. observed hit rate) plus Brier score over time.",
      schema: {},
      handler: async () => calibrationView(db),
    },
    {
      name: "list_councilors",
      description: "The forecasting personas: id, name, role, topics, and default provider.",
      schema: {},
      handler: async () => councilorsView(),
    },
    {
      name: "get_providers",
      description:
        "Provider status: the six built-ins (LM Studio local default, MiniMax, Grok/xAI, OpenAI, NVIDIA NIM, OpenCode Zen free) plus any custom OpenAI-compatible endpoints from DELPHI_PROVIDERS, with connectivity and the live model catalog pulled from each provider's /models API.",
      schema: {},
      handler: async () => providersView(),
    },
    {
      name: "list_provider_models",
      description:
        "Pull the live model catalog from a provider's /models API. Delphi never hardcodes model IDs -- this is how you see what a provider can run.",
      schema: {
        id: z.string().describe("Provider id, e.g. lmstudio, minimax, grok, openai, nvidia, opencode"),
      },
      handler: async (args) => {
        const p = providerById(await resolveProviders(defaultProviders()), String(args.id));
        return {
          provider: p.id,
          name: p.name,
          connected: p.connected,
          model: p.model || null,
          availableModels: p.availableModels,
        };
      },
    },
    {
      name: "set_provider_model",
      description:
        "Choose which model a provider uses (persisted). Pick the model from list_provider_models first.",
      schema: {
        id: z.string().describe("Provider id"),
        model: z.string().describe("Model id from the provider's live catalog"),
      },
      handler: async (args) => {
        const model = String(args.model || "").trim();
        if (!model) throw new Error("model is required.");
        const providers = await resolveProviders(defaultProviders());
        const p = providers.find((x) => x.id === String(args.id));
        if (!p) throw new Error(`Unknown provider: ${args.id}`);
        if (p.availableModels.length > 0 && !p.availableModels.includes(model)) {
          throw new Error(`Unknown model "${model}" for ${p.name}. Pick one from its live catalog.`);
        }
        writeModelChoice(p.id, model);
        return { ok: true, provider: p.id, model };
      },
    },
    {
      name: "delphi_health",
      description: "Server health: version, demo-mode default, provider connectivity.",
      schema: {},
      handler: async () => ({
        ok: true,
        ...(await providersView()),
      }),
    },
  ];
}

export function createMcpServer(db: DatabaseSync): McpServer {
  const server = new McpServer(
    { name: "delphi", version: VERSION },
    { capabilities: { tools: {} } },
  );
  for (const t of buildToolHandlers(db)) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.schema },
      (async (args: Record<string, unknown>) => {
        const result = await t.handler(args);
        return text(result);
      }) as never,
    );
  }
  return server;
}

/**
 * Handle one stateless Streamable HTTP request: a fresh server + transport
 * per POST. The transport closes with the response.
 */
export async function handleMcpRequest(
  db: DatabaseSync,
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  parsedBody: unknown,
): Promise<void> {
  const server = createMcpServer(db);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless: no sessions
    enableJsonResponse: true,
  });
  const cleanup = () => {
    transport.close().catch(() => undefined);
    server.close().catch(() => undefined);
  };
  res.on("close", cleanup);
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } finally {
    cleanup();
  }
}

/** Convenience export for tests and for standalone stdio embedding. */
export { findQuestion };
