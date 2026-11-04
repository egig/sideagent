import { and, count, desc, eq, gte, inArray, lt, or, type SQL } from "drizzle-orm";
import type { AuditPage, Trace, TracePage } from "../../api.js";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_RANGES,
  AUDIT_RETENTION_DAYS,
  DAY_MS,
  PRUNE_ODDS,
  TRACE_PAGE_SIZE,
  TRACE_RETENTION_DAYS,
} from "../../retention.js";
import type { AdminStore, AuditInput, AuditQuery, TraceQuery } from "../types.js";
import type { PgDb } from "./db.js";
import * as t from "./schema.js";

const summary = (r: Omit<typeof t.auditTrace.$inferSelect, "spans" | "agentId">) => ({
  id: r.id,
  at: r.at.toISOString(),
  userId: r.userId,
  threadId: r.threadId,
  level: r.level,
  status: r.status,
  durationMs: r.durationMs,
  llmCalls: r.llmCalls,
  toolCalls: r.toolCalls,
  inputTokens: r.inputTokens,
  outputTokens: r.outputTokens,
});

/** Rows past their level's retention are hidden even before a write prunes them. */
const alive = (now: Date) =>
  or(
    and(
      eq(t.auditTrace.level, "metadata"),
      gte(t.auditTrace.at, new Date(+now - TRACE_RETENTION_DAYS.metadata * DAY_MS)),
    ),
    and(eq(t.auditTrace.level, "full"), gte(t.auditTrace.at, new Date(+now - TRACE_RETENTION_DAYS.full * DAY_MS))),
  );

export const auditStore = (db: PgDb): AdminStore["audit"] => ({
  async recordEvent(input: AuditInput, now = new Date()) {
    try {
      await db.insert(t.auditEvent).values({
        id: input.id ?? crypto.randomUUID(),
        agentId: input.agentId,
        at: now,
        userId: input.userId?.slice(0, 256) ?? null,
        event: input.event,
        result: input.result,
        reason: input.reason ?? null,
        durationMs: input.durationMs == null ? null : Math.max(0, Math.round(input.durationMs)),
      });
      if (Math.floor(Math.random() * PRUNE_ODDS) === 0) {
        await db
          .delete(t.auditEvent)
          .where(
            and(
              eq(t.auditEvent.agentId, input.agentId),
              lt(t.auditEvent.at, new Date(+now - AUDIT_RETENTION_DAYS * DAY_MS)),
            ),
          );
      }
    } catch {
      console.error("audit write failed");
    }
  },

  async listEvents(agentId, q: AuditQuery, now = new Date()): Promise<AuditPage> {
    const e = t.auditEvent;
    const conds: (SQL | undefined)[] = [eq(e.agentId, agentId), gte(e.at, new Date(+now - AUDIT_RANGES[q.range]))];
    if (q.result) conds.push(eq(e.result, q.result));
    if (q.event) conds.push(eq(e.event, q.event));
    if (q.user) conds.push(eq(e.userId, q.user));
    const where = and(...conds);
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(e).where(where);
    const rows = await db
      .select()
      .from(e)
      .where(where)
      .orderBy(desc(e.at), desc(e.id))
      .limit(AUDIT_PAGE_SIZE)
      .offset((q.page - 1) * AUDIT_PAGE_SIZE);
    // A turn's audit row and its trace row share an id; rows from before that, and turns with tracing off, have none.
    const turns = rows.filter((r) => r.event === "chat.turn" || r.event === "preview.turn").map((r) => r.id);
    const traced = new Set(
      turns.length === 0
        ? []
        : (
            await db
              .select({ id: t.auditTrace.id })
              .from(t.auditTrace)
              .where(and(eq(t.auditTrace.agentId, agentId), inArray(t.auditTrace.id, turns), alive(now)))
          ).map((r) => r.id),
    );
    return {
      total: Number(total),
      pageSize: AUDIT_PAGE_SIZE,
      retentionDays: AUDIT_RETENTION_DAYS,
      events: rows.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        userId: r.userId,
        event: r.event,
        result: r.result,
        reason: r.reason,
        durationMs: r.durationMs,
        traceId: traced.has(r.id) ? r.id : null,
      })),
    };
  },

  async recordTrace(agentId, trace: Omit<Trace, "id">, id = crypto.randomUUID(), now = new Date()) {
    try {
      await db.insert(t.auditTrace).values({ ...trace, id, agentId, at: new Date(trace.at) });
      if (Math.floor(Math.random() * PRUNE_ODDS) === 0) {
        const a = t.auditTrace;
        await db
          .delete(a)
          .where(
            and(
              eq(a.agentId, agentId),
              or(
                and(eq(a.level, "metadata"), lt(a.at, new Date(+now - TRACE_RETENTION_DAYS.metadata * DAY_MS))),
                and(eq(a.level, "full"), lt(a.at, new Date(+now - TRACE_RETENTION_DAYS.full * DAY_MS))),
              ),
            ),
          );
      }
    } catch {
      console.error("trace write failed");
    }
  },

  async listTraces(agentId, q: TraceQuery, now = new Date()): Promise<TracePage> {
    const a = t.auditTrace;
    const where = and(
      eq(a.agentId, agentId),
      alive(now),
      q.user ? eq(a.userId, q.user) : undefined,
      q.status ? eq(a.status, q.status) : undefined,
    );
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(a).where(where);
    const rows = await db
      .select({
        id: a.id,
        at: a.at,
        userId: a.userId,
        threadId: a.threadId,
        level: a.level,
        status: a.status,
        durationMs: a.durationMs,
        llmCalls: a.llmCalls,
        toolCalls: a.toolCalls,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
      })
      .from(a)
      .where(where)
      .orderBy(desc(a.at), desc(a.id))
      .limit(TRACE_PAGE_SIZE)
      .offset((q.page - 1) * TRACE_PAGE_SIZE);
    return {
      total: Number(total),
      pageSize: TRACE_PAGE_SIZE,
      retentionDays: { ...TRACE_RETENTION_DAYS },
      traces: rows.map(summary),
    };
  },

  async getTrace(agentId, id, now = new Date()) {
    const a = t.auditTrace;
    const [r] = await db
      .select()
      .from(a)
      .where(and(eq(a.agentId, agentId), eq(a.id, id), alive(now)));
    return r ? { ...summary(r), spans: r.spans } : null;
  },
});
