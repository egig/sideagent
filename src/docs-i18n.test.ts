import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Indonesian docs translate the English prose only: same pages, same sidebar order, same code, and headings
// that keep the English anchors so links with a #fragment work in both locales.
const website = join(__dirname, "../website");
const en = join(website, "docs");
const id = join(website, "i18n/id/docusaurus-plugin-content-docs/current");

const code = (md: string) => md.match(/```[^\n]*\n[\s\S]*?```/g) ?? [];
const prose = (md: string) => md.replace(/```[^\n]*\n[\s\S]*?```/g, "");
const position = (md: string) => /^sidebar_position:\s*(\S+)$/m.exec(md)?.[1];
const slug = (h: string) =>
  h
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
const anchors = (md: string, translated: boolean) =>
  [...prose(md).matchAll(/^#{2,6} (.+?)(?: \{#([\w-]+)\})?$/gm)].map(([, text, explicit]) =>
    translated ? explicit : (explicit ?? slug(text!)),
  );

describe("Indonesian docs", () => {
  const pages = readdirSync(en).filter((f) => f.endsWith(".md"));

  it("translate every English page and nothing else", () => {
    expect(readdirSync(id).sort()).toEqual(pages.sort());
  });

  for (const page of pages) {
    describe(page, () => {
      const source = readFileSync(join(en, page), "utf8");
      const translated = readFileSync(join(id, page), "utf8");

      it("keeps the sidebar position", () => expect(position(translated)).toBe(position(source)));
      it("keeps every code block unchanged", () => expect(code(translated)).toEqual(code(source)));
      it("keeps the English heading anchors", () => expect(anchors(translated, true)).toEqual(anchors(source, false)));
    });
  }
});
