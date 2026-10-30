/**
 * Postgres + pgvector store for the demo (and anyone self-hosting next to a Postgres).
 * Same contract as sideagent's MemoryVectorStore: stable chunk ids, upsert in place and a
 * keyword ranking for hybrid retrieval. Only the demo imports it; the library stays edge-safe.
 */
import { Document } from "@langchain/core/documents";
import type { EmbeddingsInterface } from "@langchain/core/embeddings";
import { VectorStore } from "@langchain/core/vectorstores";
import { Pool } from "pg";

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_TABLE = "sideagent_chunks";

export interface PgVectorStoreOptions {
  connectionString: string;
  /** Table to keep chunks in. Created on first write. Default: sideagent_chunks. */
  table?: string;
  /** Reuse an existing pool, for example one shared with the rest of the app. */
  pool?: Pool;
}

interface Row {
  content: string;
  source_id: string;
  title: string;
  url: string | null;
  score: number;
}

export class PgVectorStore extends VectorStore {
  declare FilterType: Record<string, never>;
  lc_namespace = ["sideagent", "vectorstores", "postgres"];

  private pool: Pool;
  private ownsPool: boolean;
  private table: string;
  private ready: Promise<string> | null = null;

  constructor(options: PgVectorStoreOptions) {
    // sideagent embeds chunks itself, so the store never calls these.
    super(undefined as unknown as EmbeddingsInterface, {});
    this.table = options.table ?? DEFAULT_TABLE;
    if (!IDENTIFIER.test(this.table)) throw new Error(`Invalid table name: ${this.table}`);
    this.pool = options.pool ?? new Pool({ connectionString: options.connectionString });
    this.ownsPool = !options.pool;
  }

  _vectorstoreType() {
    return "sideagent_postgres";
  }

  /** Creates the table (and indexes) sized to the embedding on first write. */
  private ensure(dimension: number): Promise<string> {
    if (!this.ready) this.ready = this.create(dimension);
    return this.ready;
  }

  private async create(dimension: number): Promise<string> {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 16_000)
      throw new Error(`Invalid embedding dimension: ${dimension}`);
    await this.pool.query("CREATE EXTENSION IF NOT EXISTS vector");
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id text PRIMARY KEY,
        source_id text NOT NULL,
        title text NOT NULL,
        url text,
        content text NOT NULL,
        embedding vector(${dimension}) NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.table}_embedding_idx
        ON ${this.table} USING hnsw (embedding vector_cosine_ops)
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS ${this.table}_content_fts_idx
        ON ${this.table} USING gin (to_tsvector('simple', content))
    `);
    const { rows } = await this.pool.query<{ type: string }>(
      `SELECT format_type(atttypid, atttypmod) AS type
         FROM pg_attribute
        WHERE attrelid = $1::regclass AND attname = 'embedding' AND NOT attisdropped`,
      [this.table],
    );
    const actual = Number(/vector\((\d+)\)/.exec(rows[0]?.type ?? "")?.[1] ?? 0);
    if (actual && actual !== dimension)
      throw new Error(
        `Table ${this.table} holds vector(${actual}) but the embeddings are ${dimension}-dimensional. ` +
          `Drop the table (or the Postgres volume) before switching embedding models.`,
      );
    return this.table;
  }

  /** sideagent calls addVectors with ids; this only exists to satisfy the LangChain base class. */
  async addDocuments(documents: Document[], options?: { ids?: string[] }) {
    if (!this.embeddings) throw new Error("PgVectorStore takes vectors from sideagent; call addVectors instead.");
    const vectors = await this.embeddings.embedDocuments(documents.map((doc) => doc.pageContent));
    return this.addVectors(vectors, documents, options);
  }

  async addVectors(vectors: number[][], documents: Document[], options?: { ids?: string[] }) {
    if (!vectors.length) return [];
    await this.ensure(vectors[0]!.length);
    const ids = documents.map((_, i) => options?.ids?.[i] ?? crypto.randomUUID());
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i]!;
        const meta = doc.metadata as { sourceId?: string; title?: string; url?: string };
        await client.query(
          `INSERT INTO ${this.table} (id, source_id, title, url, content, embedding)
           VALUES ($1, $2, $3, $4, $5, $6::vector)
           ON CONFLICT (id) DO UPDATE SET
             source_id = EXCLUDED.source_id,
             title = EXCLUDED.title,
             url = EXCLUDED.url,
             content = EXCLUDED.content,
             embedding = EXCLUDED.embedding,
             updated_at = now()`,
          [
            ids[i],
            meta.sourceId ?? "",
            meta.title ?? "",
            meta.url ?? null,
            doc.pageContent,
            JSON.stringify(vectors[i]),
          ],
        );
      }
      await client.query("COMMIT");
      return ids;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(params?: { ids?: string[] }) {
    const ids = params?.ids ?? [];
    if (!ids.length) return;
    if (!(await this.tableExists())) return;
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = ANY($1::text[])`, [ids]);
  }

  async similaritySearchVectorWithScore(query: number[], k: number): Promise<[Document, number][]> {
    if (!(await this.tableExists())) return [];
    const { rows } = await this.pool.query<Row>(
      `SELECT content, source_id, title, url, 1 - (embedding <=> $1::vector) AS score
         FROM ${this.table}
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [JSON.stringify(query), k],
    );
    return rows.map((row) => [toDocument(row), Number(row.score)]);
  }

  /** Lexical ranking for hybrid retrieval: Postgres full-text over the same chunks. */
  async keywordSearch(query: string, k: number): Promise<[Document, number][]> {
    if (!(await this.tableExists())) return [];
    const { rows } = await this.pool.query<Row>(
      `SELECT content, source_id, title, url,
              ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) AS score
         FROM ${this.table}
        WHERE to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
        ORDER BY score DESC
        LIMIT $2`,
      [query, k],
    );
    return rows.map((row) => [toDocument(row), Number(row.score)]);
  }

  private async tableExists(): Promise<boolean> {
    if (this.ready) {
      await this.ready;
      return true;
    }
    const { rows } = await this.pool.query<{ name: string | null }>("SELECT to_regclass($1) AS name", [this.table]);
    return Boolean(rows[0]?.name);
  }

  /** Release the connections this store opened (not a pool passed in). */
  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

function toDocument(row: Row): Document {
  return new Document({
    pageContent: row.content,
    metadata: {
      sourceId: row.source_id,
      title: row.title,
      ...(row.url ? { url: row.url } : {}),
    },
  });
}
