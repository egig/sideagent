// Generates static/llms.txt (index) and static/llms-full.txt (all docs inline) from docs/*.md.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = "https://egig.github.io/sideagent";
const docs = readdirSync(join(root, "docs"))
  .filter((f) => f.endsWith(".md"))
  .map((f) => {
    const raw = readFileSync(join(root, "docs", f), "utf8");
    const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
    const fm = m?.[1] ?? "";
    const title = fm.match(/^title:\s*(.+)$/m)?.[1].trim() ?? f.replace(/\.md$/, "");
    const pos = Number(fm.match(/^sidebar_position:\s*(\d+)/m)?.[1] ?? 99);
    const slug = f === "intro.md" ? "" : f.replace(/\.md$/, "");
    const body = raw.slice(m?.[0].length ?? 0).trim();
    return { title, pos, url: `${site}/${slug}`, body, summary: body.split("\n").find((l) => l && !l.startsWith("#") && /^[A-Z`][^<{]*\. ?/.test(l) && !l.startsWith("```")) ?? "" };
  })
  .sort((a, b) => a.pos - b.pos);

const head = `# sideagent\n\n> Embed a chat agent in your app. Give it an OpenAPI spec and an OpenAI-compatible LLM host and key; get a secure agent endpoint (\`sideagent/server\`) and a React chat UI (\`sideagent\`).\n\n`;
const index = head + "## Docs\n\n" + docs.map((d) => `- [${d.title}](${d.url}): ${d.summary}`).join("\n") + `\n\n## Optional\n\n- [Full docs in one file](${site}/llms-full.txt)\n- [Source](https://github.com/egig/sideagent)\n`;
const full = head + docs.map((d) => `# ${d.title}\n\nSource: ${d.url}\n\n${d.body}`).join("\n\n---\n\n") + "\n";

mkdirSync(join(root, "static"), { recursive: true });
writeFileSync(join(root, "static/llms.txt"), index);
writeFileSync(join(root, "static/llms-full.txt"), full);
