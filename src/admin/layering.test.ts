import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Imports in src/admin flow one way: store (persistence) < security, control and data (services) < app.
// control (dashboard) and data (public agent API) never import each other, and nothing here reaches into
// the library except through its public entry (`server/index.js`).
const walk = (dir: string): string[] =>
  readdirSync(join(__dirname, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
  );
const files = walk(".").filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("./test/"));

const importsOf = (file: string) =>
  [...readFileSync(join(__dirname, file), "utf8").matchAll(/from\s+["'](\.[^"']*)["']/g)].map((m) => m[1]!);

/** The folder (first segment under src/admin) an import resolves to, or "server" and so on for paths leaving it. */
const resolve = (file: string, spec: string) => {
  const parts = join(file, "..", spec).split("/");
  return parts[0] === ".." ? (parts[1] === "server" ? `server:${parts.slice(2).join("/")}` : "outside") : parts[0]!;
};

const rules: { from: string; never: string[]; why: string }[] = [
  { from: "store", never: ["control", "data", "security", "auth"], why: "the store is the bottom layer" },
  { from: "control", never: ["data"], why: "dashboard and public API are separate planes" },
  { from: "data", never: ["control"], why: "dashboard and public API are separate planes" },
  { from: "security", never: ["control", "data", "store"], why: "security helpers have no dependencies on services" },
];

describe("admin layering", () => {
  for (const rule of rules) {
    it(`${rule.from}/ does not import ${rule.never.join(", ")} (${rule.why})`, () => {
      const bad = files
        .filter((f) => f.startsWith(`./${rule.from}/`) || f.startsWith(`${rule.from}/`))
        .flatMap((f) => importsOf(f).map((spec) => [f, resolve(f, spec)] as const))
        .filter(([, target]) => rule.never.includes(target));
      expect(bad).toEqual([]);
    });
  }

  it("reaches the library only through its public entry", () => {
    const bad = files
      .flatMap((f) => importsOf(f).map((spec) => [f, resolve(f, spec)] as const))
      .filter(([, target]) => target.startsWith("server:") && target !== "server:index.js");
    expect(bad).toEqual([]);
  });
});
