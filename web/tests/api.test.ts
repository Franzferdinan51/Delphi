import { afterEach, describe, expect, it, vi } from "vitest";
import { askStream } from "../src/api";
const request = { question: "Test?", questionType: "binary" as const, deadline: "2027-01-01" };
const respond = (text: string) => vi.stubGlobal("fetch", vi.fn(async () => new Response(text, { headers: { "Content-Type": "text/event-stream" } })));
afterEach(() => vi.unstubAllGlobals());
describe("web streaming contract", () => {
  it("normalizes nested API opinion events for councilor cards", async () => {
    respond('data: {"type":"opinion","opinion":{"councilorId":"skeptic","round":1,"probability":0}}\n\ndata: {"type":"result","forecast":{}}\n\n');
    const events: any[] = [];
    await askStream(request, e => events.push(e));
    expect(events[0].councilorId).toBe("skeptic");
    expect(events[0].probability).toBe(0);
  });
  it("rejects a truncated stream instead of reporting success", async () => {
    respond('data: {"type":"phase","phase":"research"}\n\n');
    await expect(askStream(request, () => {})).rejects.toThrow(/before.*result/i);
  });
  it("does not swallow consumer errors", async () => {
    respond('data: {"type":"result","forecast":{}}\n\n');
    await expect(askStream(request, () => { throw new Error("consumer failed"); })).rejects.toThrow("consumer failed");
  });
});
