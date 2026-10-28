import { Parser } from "htmlparser2";

const SKIP = new Set(["script", "style", "noscript", "svg", "nav", "footer", "header", "form", "iframe", "template"]);
const BLOCK_END = new Set(["p", "div", "section", "article", "tr", "ul", "ol", "table", "pre", "blockquote"]);

/** HTML to text/markdown-ish conversion on a real parser. Plain text out; never HTML. */
export function htmlToText(html: string): { title?: string; text: string } {
  let out = "";
  let title = "";
  let skip = 0;
  let inTitle = false;

  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIP.has(name)) skip++;
        else if (name === "title") inTitle = true;
        else if (skip) return;
        else if (/^h[1-6]$/.test(name)) out += `\n\n${"#".repeat(Number(name[1]))} `;
        else if (name === "li") out += "\n- ";
        else if (name === "br") out += "\n";
      },
      onclosetag(name) {
        if (SKIP.has(name)) skip = Math.max(0, skip - 1);
        else if (name === "title") inTitle = false;
        else if (skip) return;
        else if (/^h[1-6]$/.test(name) || BLOCK_END.has(name)) out += "\n\n";
      },
      ontext(text) {
        if (inTitle) title += text;
        else if (!skip) out += text;
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  const text = out
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const clean = title.replace(/\s+/g, " ").trim();
  return { title: clean || undefined, text };
}
