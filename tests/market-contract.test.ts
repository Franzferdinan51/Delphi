import { afterEach, describe, expect, it, vi } from "vitest";
import { collectPriors } from "../src/priors.js";
import { memoryDb } from "../src/db.js";
const question = "Will the test launch by January 1, 2027?";
const market = { question, outcomes: '["No","Yes"]', outcomePrices: '["0.3","0.7"]', lastTradePrice: "0.3", volume: "20000", active: true, closed: false, endDate: "2027-01-01T00:00:00Z" };
afterEach(() => vi.unstubAllGlobals());
async function lookup(overrides = {}) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ events: [{ slug: "test", markets: [{ ...market, ...overrides }] }] }))));
  const db = memoryDb();
  try { return await collectPriors(question, "2027-01-01", { db, provider: null, demoMode: false }); }
  finally { db.close(); }
}
describe("Polymarket contract", () => {
  it("reads the documented object response and indexes the YES outcome", async () => {
    const priors = await lookup();
    expect(priors.market?.value).toBe(70);
    expect(priors.market?.url).toBe("https://polymarket.com/event/test");
  });
  it.each([{ closed: true }, { active: false }, { question: "Unrelated high-volume event?" }, { endDate: "2028-01-01" }, { outcomePrices: '["0.7",null]' }])("rejects misleading anchors %j", async (override) => {
    expect((await lookup(override)).market).toBeNull();
  });
});
