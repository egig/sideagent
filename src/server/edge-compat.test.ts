import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Server core must run on edge runtimes (Workers, Vercel Edge): no node:* or Buffer/process in src.
describe("edge runtime compatibility", () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  for (const f of files) {
    it(`${f} uses only web-standard APIs`, () => {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src).not.toMatch(/from\s+["']node:/);
      expect(src).not.toMatch(/\bBuffer\b|\bprocess\./);
    });
  }
});
