import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toPct, formatDate } from "../src/hooks";
import { ResultPanel } from "../src/components/ResultPanel";
import type { Forecast } from "../src/types";
describe("forecast presentation", () => {
  it("does not turn a 1% forecast into 100%", () => {
    expect(toPct(1)).toBe(1);
    expect(toPct(0.5)).toBe(0.5);
    expect(toPct(-1)).toBe(0);
  });
  it("does not shift calendar deadlines to the previous day", () => {
    expect(formatDate("2027-01-01")).toContain("2027");
    expect(formatDate("2027-01-01")).not.toContain("31");
  });
  it("labels heuristic uncertainty honestly rather than promising 90% coverage", () => {
    const forecast = { question: "Test", questionType: "binary", probability: 1, confidence: "Low", confidenceScore: 40, confidenceRange: [0, 25], opinions: [], weights: {}, runNumber: 1, createdAt: "2026-01-01", readout: {} } as unknown as Forecast;
    const html = renderToStaticMarkup(createElement(ResultPanel, { forecast }));
    expect(html).not.toContain("90% interval");
    expect(html).toContain("Heuristic range");
    expect(html).toContain("not a calibrated probability");
  });
});
