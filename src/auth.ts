import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function configuredApiKey(): string {
  return (process.env.DELPHI_API_KEY || "").trim();
}

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

/** When an API key is configured, mutating and data routes require Bearer auth. Health stays public. */
export function authorize(req: IncomingMessage): boolean {
  const expected = configuredApiKey();
  if (!expected) return true;
  const hdr = String(req.headers.authorization || "");
  const got = /^bearer\s+/i.test(hdr) ? hdr.replace(/^bearer\s+/i, "").trim() : "";
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
