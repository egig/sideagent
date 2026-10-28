import { chunkText } from "./chunk.js";
import { fetchPage } from "./fetch-page.js";
import { Document } from "@langchain/core/documents";
import { MemoryVectorStore, type ChunkMeta, type Hit, type VectorStore } from "./vector-store.js";

export { chunkText } from "./chunk.js";
export { htmlToText } from "./html.js";
export { uniqueSources, wrapKnowledge } from "./format.js";
export { MemoryVectorStore } from "./vector-store.js";
export type { ChunkMeta, Hit, VectorStore } from "./vector-store.js";

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
  /** Chunk ids currently stored per source, so a refresh can drop the ones that disappeared. */
  private chunkIds = new Map<string, string[]>();
  private refreshing: Promise<void> | null = null;
  private lastRefresh = 0;
  private totalChunks = 0;

  constructor(
    private opts: KnowledgeOptions,
    private deps: KnowledgeDeps,
  ) {
    this.store =
      deps.store ??
      new MemoryVectorStore({ embedDocuments: (t) => deps.embedDocuments(t), embedQuery: (t) => deps.embedQuery(t) });
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
      const texts = await chunkText(content, this.opts.chunkSize);
      const others = this.totalChunks - (this.statuses.get(id)?.chunks ?? 0);
      if (others + texts.length > this.opts.maxChunks)
        throw new Error(`would exceed maxChunks (${this.opts.maxChunks})`);
      const vectors = texts.length ? await this.deps.embedDocuments(texts) : [];
      const meta: ChunkMeta = { sourceId: id, title, ...(url ? { url } : {}) };
      // Upsert first, then drop leftovers, so a failure midway never empties a source.
      const ids = texts.map((_, i) => `${id}#${i}`);
      if (texts.length) {
        await this.store.addVectors(
          vectors,
          texts.map((text) => new Document({ pageContent: text, metadata: meta })),
          { ids },
        );
      }
      const keep = new Set(ids);
      const stale = (this.chunkIds.get(id) ?? []).filter((old) => !keep.has(old));
      if (stale.length) await this.store.delete({ ids: stale });
      this.chunkIds.set(id, ids);
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
    const found = await this.store.similaritySearchVectorWithScore(vector, this.opts.topK);
    return found.map(([doc, score]) => ({ text: doc.pageContent, score, meta: doc.metadata as ChunkMeta }));
  }
}
