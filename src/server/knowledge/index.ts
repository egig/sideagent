import { chunkText } from "./chunk.js";
import { fetchPage } from "./fetch-page.js";
import { MemoryVectorStore, type ChunkMeta, type Hit, type VectorStore } from "./vector-store.js";

export { chunkText } from "./chunk.js";
export { htmlToText } from "./html.js";
export { uniqueSources, wrapKnowledge } from "./format.js";
export { cosine, MemoryVectorStore } from "./vector-store.js";
export type { ChunkMeta, Hit, StoredChunk, VectorStore } from "./vector-store.js";

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
        const page = await fetchPage(url, {
          maxBytes: this.opts.maxSourceBytes,
          allowPrivateNetworks: this.deps.allowPrivateNetworks,
          fetch: this.deps.fetch,
        });
        await this.ingest(id, title ?? page.title ?? new URL(url).hostname + new URL(url).pathname, page.text, url);
      } catch (e) {
        const prev = this.statuses.get(id);
        this.statuses.set(id, {
          ...(prev ?? { id, title: title ?? url, url, chunks: 0 }),
          error: (e as Error).message,
        });
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
      if (others + texts.length > this.opts.maxChunks)
        throw new Error(`would exceed maxChunks (${this.opts.maxChunks})`);
      const vectors = texts.length ? await this.deps.embedDocuments(texts) : [];
      const meta: ChunkMeta = { sourceId: id, title, ...(url ? { url } : {}) };
      await this.store.replace(
        id,
        texts.map((text, i) => ({ text, vector: vectors[i]!, meta })),
      );
      this.totalChunks = others + texts.length;
      this.statuses.set(id, { id, title, ...(url ? { url } : {}), chunks: texts.length, loadedAt: this.now() });
    } catch (e) {
      const prev = this.statuses.get(id);
      this.statuses.set(id, {
        ...(prev ?? { id, title, ...(url ? { url } : {}), chunks: 0 }),
        error: (e as Error).message,
      });
      console.warn(`[sideagent] knowledge source "${id}" failed: ${(e as Error).message}`);
    }
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
