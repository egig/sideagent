// Knowledge ingestion for the agent store: page fetching, text extraction,
// chunking and the OpenAI-compatible embeddings call. chunkText and htmlToText
// copy the library's (sideagent src/server/knowledge.ts) so hosted chunks look
// like self-hosted ones; htmlToText also drops <head>, whose <title> text the
// library leaves in the body.
import { assertPublicUrl, BlockedUrlError, type Resolve } from "../security/url-guard.js";

export const KNOWLEDGE_MAX_SOURCES = 50;
/** The library's defaults for maxSourceBytes, maxChunks and chunkSize. */
export const SOURCE_MAX_BYTES = 200_000;
export const MAX_CHUNKS = 2000;
export const CHUNK_SIZE = 800;
export const TITLE_MAX = 200;
const PAGE_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const EMBED_BATCH = 64;
const EMBED_TIMEOUT_MS = 30_000;

export class KnowledgeError extends Error {}

/** Splits markdown/plain text into chunks of roughly `size` chars, keeping the nearest heading as context. */
export function chunkText(content: string, size = CHUNK_SIZE): string[] {
  const out: string[] = [];
  let heading = "";
  let cur = "";
  const flush = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = "";
  };
  const withHeading = (t: string) => (heading && !t.startsWith("#") ? `${heading}\n\n${t}` : t);

  for (const raw of content.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    const block = raw.trim();
    if (!block) continue;
    if (/^#{1,6}\s/.test(block)) {
      flush();
      heading = block.split("\n")[0]!;
    }
    const pieces =
      block.length > size ? (block.match(new RegExp(`[\\s\\S]{1,${size}}(?:\\s|$)`, "g")) ?? [block]) : [block];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 2 > size) flush();
      if (!cur) cur = withHeading(piece.trim());
      else cur += `\n\n${piece.trim()}`;
    }
  }
  flush();
  return out;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Dependency-free HTML to text/markdown-ish conversion. Plain text out; never HTML. */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head\b[\s\S]*?<\/head>|<title\b[\s\S]*?<\/title>/gi, "")
    .replace(/<head\b[\s\S]*?<\/head>|<title\b[\s\S]*?<\/title>/gi, "")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, "")
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_m, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t}\n\n`,
    )
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|tr|ul|ol|table|pre|blockquote)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title: title ? htmlToText(title).text.replace(/\s+/g, " ") : undefined, text };
}

async function readCapped(res: Response, max: number): Promise<string> {
  if (Number(res.headers.get("content-length") ?? 0) > max) throw new KnowledgeError("Page is larger than 200 KB.");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new KnowledgeError("Page is larger than 200 KB.");
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

// Every hop passes the guard again, DNS included. Redirects to another host
// are refused, as in the library.
export async function fetchPage(
  url: string,
  resolve: Resolve,
  fetcher: typeof fetch,
): Promise<{ title?: string; text: string }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let target: URL;
    try {
      target = await assertPublicUrl(current, resolve);
    } catch (e) {
      if (e instanceof BlockedUrlError)
        throw new KnowledgeError(`Blocked: ${e.message.replace(/\.$/, "").toLowerCase()}`);
      throw e;
    }
    let res: Response;
    try {
      res = await fetcher(target.href, {
        redirect: "manual",
        signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
        headers: { accept: "text/markdown,text/plain,text/html;q=0.9", "user-agent": "sideagent-knowledge" },
      });
    } catch {
      throw new KnowledgeError("The page did not answer within 15 seconds.");
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new KnowledgeError("Redirect without a location.");
      const next = new URL(location, target);
      if (next.hostname !== target.hostname) throw new KnowledgeError("Redirects to another host are refused.");
      current = next.href;
      continue;
    }
    if (!res.ok) throw new KnowledgeError(`The page returned HTTP ${res.status}.`);
    const type = (res.headers.get("content-type") ?? "").toLowerCase();
    const body = await readCapped(res, SOURCE_MAX_BYTES).catch((e) => {
      throw e instanceof KnowledgeError ? e : new KnowledgeError("The page download did not finish.");
    });
    if (type.includes("html")) return htmlToText(body);
    if (type.includes("markdown") || type.startsWith("text/")) return { text: body };
    throw new KnowledgeError(`Unsupported content type "${type.slice(0, 60) || "unknown"}".`);
  }
  throw new KnowledgeError("Too many redirects.");
}

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type Embed = (texts: string[]) => Promise<Float32Array[]>;

// OpenAI-compatible POST {baseUrl}/embeddings. The response is checked for
// count and shape; the key never appears in an error message.
export function embedder(cfg: EmbeddingConfig, fetcher: typeof fetch): Embed {
  return async (texts) => {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      let res: Response;
      try {
        res = await fetcher(`${cfg.baseUrl.replace(/\/$/, "")}/embeddings`, {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
          headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ model: cfg.model, input: batch }),
        });
      } catch {
        throw new KnowledgeError("The embeddings provider did not answer.");
      }
      if (!res.ok) throw new KnowledgeError(`The embeddings provider returned HTTP ${res.status}.`);
      const body = (await res.json().catch(() => null)) as { data?: { index?: number; embedding?: unknown }[] } | null;
      const data = body?.data;
      if (!Array.isArray(data) || data.length !== batch.length) {
        throw new KnowledgeError("The embeddings provider returned an unexpected response.");
      }
      const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      for (const d of sorted) {
        if (!Array.isArray(d.embedding) || d.embedding.length === 0 || d.embedding.length > 4096) {
          throw new KnowledgeError("The embeddings provider returned an unexpected response.");
        }
        out.push(Float32Array.from(d.embedding as number[]));
      }
    }
    return out;
  };
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
