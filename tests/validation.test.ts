import { describe, expect, it } from "vitest";
import { memoryDb, listQuestions } from "../src/db.js";
import { runPipeline } from "../src/pipeline.js";
import type { AskInput } from "../src/types.js";
const valid = { question: "Will it work?", questionType: "binary", deadline: "2027-01-01", demoMode: true };
describe("pipeline validation before side effects", () => {
  it.each([
    { deadline: "tomorrow" }, { deadline: "2027-02-30" }, { deadline: "2027-13-01" },
    { demoMode: "false" }, { councilSize: 2.5 }, { councilSize: -1 },
    { question: 123 }, { questionType: "unknown" }, { context: [] },
  ])("rejects malformed fields %j without creating a question", async (patch) => {
    const db = memoryDb();
    try {
      await expect(runPipeline({ ...valid, ...patch } as unknown as AskInput, { db })).rejects.toThrow();
      expect(listQuestions(db)).toHaveLength(0);
    } finally { db.close(); }
  });
});
