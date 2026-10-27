import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Frontend entry must never pull in server code (LLM key, credentials, LangGraph).
describe("client/server isolation", () => {
  // Recursive, so components moved into subfolders stay covered.
  const walk = (dir: string): string[] =>
    readdirSync(join(__dirname, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
    );
  const files = ["index.ts", ...walk("client")].filter((f) => /\.tsx?$/.test(f));
  for (const f of files) {
    it(`${f} does not import server code`, () => {
      const src = readFileSync(join(__dirname, f), "utf8");
      expect(src).not.toMatch(/from\s+["'][^"']*server[^"']*["']/);
      expect(src).not.toMatch(/@langchain|@scalar/);
    });
  }
});
