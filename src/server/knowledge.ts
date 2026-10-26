import { assertPublicUrl } from "./url-guard.js";
import { readCapped } from "./executor.js";

export const SEARCH_TOOL = "search_knowledge";

export interface KnowledgeSourceInput {
  id: string;
  title: string;
  content: string;
}
export interface KnowledgeUrlInput {
  url: string;
  title?: string;
}

export interface KnowledgeOptions {
  sources: KnowledgeSourceInput[];
  urls: (string | KnowledgeUrlInput)[];
  topK: number;
  ttlMs: number;
  maxSourceBytes: number;
  maxChunks: number;
  chunkSize: number;
}

export interface ChunkMeta {
  sourceId: string;
  title: string;
  /** Only set for sources that came from a URL listed in config. */
  url?: string;
}
export interface StoredChunk {
  text: string;
  vector: number[];
  meta: ChunkMeta;
}
export interface Hit {
  text: string;
  score: number;
  meta: ChunkMeta;
}

/** Plug in your own (pgvector, Vectorize, …). The default is an in-memory cosine store. */
export interface VectorStore {
  replace(sourceId: string, chunks: StoredChunk[]): Promise<void>;
  search(vector: number[], k: number): Promise<Hit[]>;
}

export class MemoryVectorStore implements VectorStore {
  private bySource = new Map<string, StoredChunk[]>();
  async replace(sourceId: string, chunks: StoredChunk[]) {
    this.bySource.set(sourceId, chunks);
  }
  async search(vector: number[], k: number) {
    const hits: Hit[] = [];
    for (const chunks of this.bySource.values()) {
      for (const c of chunks) hits.push({ text: c.text, meta: c.meta, score: cosine(vector, c.vector) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, k);
  }
}

export function cosine(a: number[], b: number[]): number {
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

/** Splits markdown/plain text into chunks of roughly `size` chars, keeping the nearest heading as context. */
export function chunkText(content: string, size: number): string[] {
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
    // hard-split blocks that are bigger than a chunk
    const pieces = block.length > size ? (block.match(new RegExp(`[\\s\\S]{1,${size}}(?:\\s|$)`, "g")) ?? [block]) : [block];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 2 > size) flush();
      if (!cur) cur = withHeading(piece.trim());
      else cur += `\n\n${piece.trim()}`;
    }
  }
  flush();
  return out;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** Dependency-free HTML to text/markdown-ish conversion. Plain text out; never HTML. */
export function htmlToText(html: string): { title?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t}\n\n`)
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

export interface SourceStatus {
  id: string;
  title: string;
  url?: string;
  chunks: number;
  loadedAt?: number;
  error?: string;
}

export interface KnowledgeDeps {
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  store?: VectorStore;
  allowPrivateNetworks?: boolean;
  fetch?: typeof fetch;
  now?: () => number;
}

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15_000;

export class KnowledgeBase {
  readonly store: VectorStore;
  private statuses = new Map<string, SourceStatus>();
  private refreshing: Promise<void> | null = null;
  private lastRefresh = 0;
  private totalChunks = 0;

  constructor(
    private opts: KnowledgeOptions,
    private deps: KnowledgeDeps,
  ) {
    this.store = deps.store ?? new MemoryVectorStore();
  }

  private now = () => (this.deps.now ?? Date.now)();

  status(): SourceStatus[] {
    return [...this.statuses.values()];
  }

  /** Loads every source. Failures are recorded per source and never throw. */
  async load(): Promise<void> {
    for (const s of this.opts.sources) {
      await this.ingest(s.id, s.title, s.content, undefined);
    }
    await this.loadUrls();
    this.lastRefresh = this.now();
  }

  private async loadUrls() {
    for (const entry of this.opts.urls) {
      const { url, title } = typeof entry === "string" ? { url: entry, title: undefined } : entry;
      const id = `url:${url}`;
      try {
        const page = await this.fetchPage(url);
        await this.ingest(id, title ?? page.title ?? new URL(url).hostname + new URL(url).pathname, page.text, url);
      } catch (e) {
        const prev = this.statuses.get(id);
        this.statuses.set(id, { ...(prev ?? { id, title: title ?? url, url, chunks: 0 }), error: (e as Error).message });
        console.warn(`[sideagent] knowledge url failed (${url}): ${(e as Error).message}`);
      }
    }
  }

  private async ingest(id: string, title: string, content: string, url: string | undefined) {
    try {
      if (new TextEncoder().encode(content).byteLength > this.opts.maxSourceBytes) {
        throw new Error(`source larger than maxSourceBytes (${this.opts.maxSourceBytes})`);
      }
      const texts = chunkText(content, this.opts.chunkSize);
      const others = this.totalChunks - (this.statuses.get(id)?.chunks ?? 0);
      if (others + texts.length > this.opts.maxChunks) throw new Error(`would exceed maxChunks (${this.opts.maxChunks})`);
      const vectors = texts.length ? await this.deps.embedDocuments(texts) : [];
      const meta: ChunkMeta = { sourceId: id, title, ...(url ? { url } : {}) };
      await this.store.replace(id, texts.map((text, i) => ({ text, vector: vectors[i]!, meta })));
      this.totalChunks = others + texts.length;
      this.statuses.set(id, { id, title, ...(url ? { url } : {}), chunks: texts.length, loadedAt: this.now() });
    } catch (e) {
      const prev = this.statuses.get(id);
      this.statuses.set(id, { ...(prev ?? { id, title, ...(url ? { url } : {}), chunks: 0 }), error: (e as Error).message });
      console.warn(`[sideagent] knowledge source "${id}" failed: ${(e as Error).message}`);
    }
  }

  private async fetchPage(url: string): Promise<{ title?: string; text: string }> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const target = assertPublicUrl(current, this.deps.allowPrivateNetworks);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await (this.deps.fetch ?? fetch)(target, {
          redirect: "manual",
          signal: ctrl.signal,
          headers: { accept: "text/markdown,text/plain,text/html;q=0.9", "user-agent": "sideagent-knowledge" },
        });
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) throw new Error("redirect without location");
          const next = new URL(loc, target);
          if (next.hostname !== target.hostname) throw new Error("cross-host redirect refused");
          current = next.toString();
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = (res.headers.get("content-type") ?? "").toLowerCase();
        const { text, truncated } = await readCapped(res, this.opts.maxSourceBytes);
        if (truncated) throw new Error(`page larger than maxSourceBytes (${this.opts.maxSourceBytes})`);
        if (type.includes("html")) return htmlToText(text);
        if (type.includes("markdown") || type.startsWith("text/")) return { text };
        throw new Error(`unsupported content-type "${type || "unknown"}"`);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("too many redirects");
  }

  /** Re-fetches URL sources. Keeps the old data for any source that fails. Concurrent calls share one run. */
  refresh(): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.loadUrls()
        .then(() => void (this.lastRefresh = this.now()))
        .finally(() => void (this.refreshing = null));
    }
    return this.refreshing;
  }

  async search(query: string): Promise<Hit[]> {
    // stale-while-revalidate: answer from the current index, refresh in the background
    if (this.opts.urls.length && this.now() - this.lastRefresh > this.opts.ttlMs) void this.refresh().catch(() => {});
    const vector = await this.deps.embedQuery(query);
    return this.store.search(vector, this.opts.topK);
  }
}

/** Model-visible rendering: labelled, untrusted reference data with its closing tag neutralised. */
export function wrapKnowledge(hits: Hit[], maxBytes: number): string {
  if (!hits.length) return "<knowledge_results>No relevant knowledge found.</knowledge_results>";
  const esc = (t: string) => t.replace(/<\/?knowledge_(source|results)/gi, (m) => m.replace("<", "&lt;"));
  const attr = (t: string) => t.replace(/["<>&]/g, "");
  let out = "";
  for (const h of hits) {
    const block = `<knowledge_source id="${attr(h.meta.sourceId)}" title="${attr(h.meta.title)}">\n${esc(h.text)}\n</knowledge_source>\n`;
    if (out.length + block.length > maxBytes) break;
    out += block;
  }
  return out || "<knowledge_results>Result too large.</knowledge_results>";
}

export function uniqueSources(hits: Hit[]): { id: string; title: string; url?: string }[] {
  const seen = new Map<string, { id: string; title: string; url?: string }>();
  for (const h of hits) {
    if (!seen.has(h.meta.sourceId)) {
      seen.set(h.meta.sourceId, { id: h.meta.sourceId, title: h.meta.title, ...(h.meta.url ? { url: h.meta.url } : {}) });
    }
  }
  return [...seen.values()];
}
