import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Recursive, so code moved into subfolders stays covered.
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [path] : [];
  });
const noNode = (src: string) => {
  expect(src).not.toMatch(/from\s+["']node:/);
  expect(src).not.toMatch(/\bBuffer\b|\bprocess\./);
};

// Server core must run on edge runtimes (Workers, Vercel Edge): no node:* or Buffer/process in src.
describe("edge runtime compatibility", () => {
  for (const f of [...sources(__dirname), ...sources(join(__dirname, "../workers-ai"))]) {
    it(`${f.split("/src/")[1]} uses only web-standard APIs`, () => noNode(readFileSync(f, "utf8")));
  }
});

// The built entries a Workers bundler resolves must not pull in node: builtins at the top level.
// Only runs after `pnpm build`.
describe.skipIf(!existsSync(join(__dirname, "../../dist/workers-ai/index.js")))("built Workers entries", () => {
  const dist = join(__dirname, "../../dist");
  const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));

  it("maps workerd and worker before browser, to the real server build", () => {
    const keys = Object.keys(pkg.exports["./server"]);
    expect(pkg.exports["./server"].workerd).toBe("./dist/server/index.js");
    expect(pkg.exports["./server"].worker).toBe("./dist/server/index.js");
    expect(keys.indexOf("workerd")).toBeLessThan(keys.indexOf("browser"));
    expect(keys.indexOf("worker")).toBeLessThan(keys.indexOf("browser"));
    expect(pkg.exports["./server"].browser).toBe("./dist/server/browser.js");
  });

  for (const entry of ["server/index.js", "workers-ai/index.js"]) {
    it(`dist/${entry} has no static node: imports, Buffer or process`, () => {
      const src = readFileSync(join(dist, entry), "utf8");
      expect(src).not.toMatch(/^\s*(import|export)\b[^;]*?from\s*["']node:/m);
      expect(src).not.toMatch(/\bBuffer\b|\bprocess\./);
    });
  }
});
