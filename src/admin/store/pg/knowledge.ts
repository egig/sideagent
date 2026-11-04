import { and, asc, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { KnowledgeSource } from "../../api.js";
import type { AdminStore, Hit, IndexedChunks, KnowledgeCounts, QueuedSource, SourceInput } from "../types.js";
import { rowsOf, type PgDb } from "./db.js";
import * as t from "./schema.js";

const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
const newSourceId = () =>
  `src_${Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => alphabet[b & 31]).join("")}`;

function toSource(r: typeof t.knowledgeSource.$inferSelect): KnowledgeSource {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    url: r.url,
    status: r.status,
    error: r.error,
    chunks: r.chunks,
    bytes: r.bytes,
    createdAt: r.createdAt.toISOString(),
    indexedAt: r.indexedAt ? r.indexedAt.toISOString() : null,
  };
}

export const knowledgeStore = (db: PgDb): AdminStore["knowledge"] => ({
  async counts(agentId): Promise<KnowledgeCounts> {
    const rows = await db
      .select({
        status: t.knowledgeSource.status,
        n: count(),
        chunks: sql<number>`coalesce(sum(${t.knowledgeSource.chunks}), 0)`,
      })
      .from(t.knowledgeSource)
      .where(eq(t.knowledgeSource.agentId, agentId))
      .groupBy(t.knowledgeSource.status);
    const by = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    return {
      sources: rows.reduce((n, r) => n + Number(r.n), 0),
      indexed: by("indexed"),
      pending: by("pending") + by("indexing"),
      failed: by("failed"),
      chunks: rows.reduce((n, r) => n + Number(r.chunks), 0),
    };
  },

  async listSources(agentId) {
    const rows = await db
      .select()
      .from(t.knowledgeSource)
      .where(eq(t.knowledgeSource.agentId, agentId))
      .orderBy(desc(t.knowledgeSource.createdAt), asc(t.knowledgeSource.id));
    return rows.map(toSource);
  },

  async addSource(agentId, input: SourceInput, now = new Date()) {
    const [row] = await db
      .insert(t.knowledgeSource)
      .values({
        id: newSourceId(),
        agentId,
        kind: input.kind,
        title: input.title,
        url: input.url ?? null,
        content: input.content ?? null,
        status: "pending",
        bytes: input.kind === "text" ? new TextEncoder().encode(input.content ?? "").byteLength : 0,
        createdAt: now,
      })
      .returning();
    return toSource(row!);
  },

  async removeSource(agentId, id) {
    const rows = await db
      .delete(t.knowledgeSource)
      .where(and(eq(t.knowledgeSource.agentId, agentId), eq(t.knowledgeSource.id, id)))
      .returning({ id: t.knowledgeSource.id });
    return rows.length > 0;
  },

  async markAllPending(agentId) {
    const rows = await db
      .update(t.knowledgeSource)
      .set({ status: "pending", error: null })
      .where(eq(t.knowledgeSource.agentId, agentId))
      .returning({ id: t.knowledgeSource.id });
    return rows.length;
  },

  async claimPending(agentId): Promise<QueuedSource[]> {
    // FOR UPDATE SKIP LOCKED: two workers never claim the same source. "indexing" rows left by a worker that died
    // are claimed again.
    const result = await db.execute(sql`
          UPDATE sideagent."knowledgeSource" SET status = 'indexing', error = NULL
          WHERE id IN (
            SELECT id FROM sideagent."knowledgeSource"
            WHERE "agentId" = ${agentId} AND status IN ('pending', 'indexing')
            ORDER BY "createdAt" FOR UPDATE SKIP LOCKED)
          RETURNING id, kind, title, url, content, "createdAt"`);
    return rowsOf<QueuedSource & { createdAt: Date | string }>(result)
      .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
      .map(({ id, kind, title, url, content }) => ({ id, kind, title, url, content }));
  },

  async hasPending(agentId) {
    const rows = await db
      .select({ id: t.knowledgeSource.id })
      .from(t.knowledgeSource)
      .where(and(eq(t.knowledgeSource.agentId, agentId), inArray(t.knowledgeSource.status, ["pending", "indexing"])))
      .limit(1);
    return rows.length > 0;
  },

  async chunksOutside(agentId, sourceId) {
    const [r] = await db
      .select({ n: count() })
      .from(t.knowledgeChunk)
      .where(and(eq(t.knowledgeChunk.agentId, agentId), ne(t.knowledgeChunk.sourceId, sourceId)));
    return Number(r?.n ?? 0);
  },

  async saveIndexed(agentId, sourceId, result: IndexedChunks, now = new Date()) {
    return db.transaction(async (tx) => {
      // Removed during the embedding call: drop the result. The lock keeps a concurrent remove from racing the insert.
      const [source] = await tx
        .select({ id: t.knowledgeSource.id })
        .from(t.knowledgeSource)
        .where(and(eq(t.knowledgeSource.id, sourceId), eq(t.knowledgeSource.agentId, agentId)))
        .for("update");
      if (!source) return false;
      await tx.delete(t.knowledgeChunk).where(eq(t.knowledgeChunk.sourceId, sourceId));
      if (result.texts.length) {
        await tx.insert(t.knowledgeChunk).values(
          result.texts.map((text, i) => ({
            id: `${sourceId}#${i}`,
            agentId,
            sourceId,
            ord: i,
            text,
            embedding: result.vectors[i]!,
          })),
        );
      }
      await tx
        .update(t.knowledgeSource)
        .set({
          status: "indexed",
          error: null,
          title: result.title,
          chunks: result.texts.length,
          bytes: result.bytes,
          indexedAt: now,
          embedKey: result.embedKey,
        })
        .where(eq(t.knowledgeSource.id, sourceId));
      return true;
    });
  },

  async markFailed(agentId, sourceId, message) {
    await db
      .update(t.knowledgeSource)
      .set({ status: "failed", error: message })
      .where(and(eq(t.knowledgeSource.id, sourceId), eq(t.knowledgeSource.agentId, agentId)));
  },

  async search(agentId, vector, k, embedKey): Promise<Hit[]> {
    const limit = Math.max(0, Math.min(Math.trunc(k), 50));
    if (!limit || !vector.length) return [];
    const query = `[${vector.join(",")}]`;
    const result = await db.execute(sql`
          SELECT c.text AS text, c."sourceId" AS "sourceId", s.title AS title, s.url AS url,
                 1 - (c.embedding <=> ${query}::vector) AS score
          FROM sideagent."knowledgeChunk" c
          JOIN sideagent."knowledgeSource" s ON s.id = c."sourceId"
          WHERE c."agentId" = ${agentId}
            AND vector_dims(c.embedding) = ${vector.length}
            AND (${embedKey ?? null}::text IS NULL OR s."embedKey" IS NULL OR s."embedKey" = ${embedKey ?? null})
          ORDER BY c.embedding <=> ${query}::vector
          LIMIT ${limit}`);
    return rowsOf<{ text: string; sourceId: string; title: string; url: string | null; score: number | string }>(
      result,
    ).map((r) => ({
      text: r.text,
      score: Number(r.score),
      meta: { sourceId: r.sourceId, title: r.title, ...(r.url ? { url: r.url } : {}) },
    }));
  },

  async isStale(agentId, embedKey) {
    const rows = await db
      .select({ id: t.knowledgeSource.id })
      .from(t.knowledgeSource)
      .where(
        and(
          eq(t.knowledgeSource.agentId, agentId),
          eq(t.knowledgeSource.status, "indexed"),
          ne(t.knowledgeSource.embedKey, embedKey),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },
});
