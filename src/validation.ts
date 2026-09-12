import { z } from "zod";
import type { AskInput } from "./types.js";

const askSchema = z.object({
  question: z.string().trim().max(10000).default(""),
  questionType: z.enum(["binary", "timing", "numeric", "categorical"]).default("binary"),
  deadline: z.string().trim().default(""),
  resolutionCriteria: z.string().trim().max(20000).optional(),
  context: z.string().trim().max(50000).optional(),
  demoMode: z.boolean().optional(),
  councilSize: z.number().int().min(1).max(5).optional(),
  existingQuestionId: z.string().trim().min(1).optional(),
}).superRefine((input, ctx) => {
  if (!input.existingQuestionId && !input.question) {
    ctx.addIssue({ code: "custom", path: ["question"], message: "Question is required." });
  }
  if (!input.existingQuestionId || input.deadline) {
    const date = new Date(`${input.deadline}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.deadline) {
      ctx.addIssue({ code: "custom", path: ["deadline"], message: "Deadline must be a real calendar date (YYYY-MM-DD)." });
    }
  }
});

/** One non-coercing boundary shared by REST, CLI and MCP pipeline calls. */
export function parseAskInput(value: unknown): AskInput {
  const result = askSchema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw Object.assign(new Error(message), { status: 400 });
  }
  return result.data;
}
