import { and, eq, lt, sql } from "drizzle-orm";
import type { AdminStore, UsageCount } from "../types.js";
import type { PgDb } from "./db.js";
import * as t from "./schema.js";

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

/** Counts one message with an upsert that only increments while under the cap, so concurrent callers cannot overshoot. */
async function consume(insert: () => Promise<{ used: number }[]>, limit: number): Promise<UsageCount> {
  if (limit <= 0) return { allowed: false, used: 0, limit };
  const [row] = await insert();
  return row ? { allowed: true, used: row.used, limit } : { allowed: false, used: limit, limit };
}

export const usageStore = (db: PgDb): AdminStore["usage"] => ({
  consumeAnon: (agentId, limit, now = new Date()) =>
    consume(
      () =>
        db
          .insert(t.agentUsage)
          .values({ agentId, day: dayOf(now), messages: 1 })
          .onConflictDoUpdate({
            target: [t.agentUsage.agentId, t.agentUsage.day],
            set: { messages: sql`${t.agentUsage.messages} + 1` },
            setWhere: lt(t.agentUsage.messages, limit),
          })
          .returning({ used: t.agentUsage.messages }),
      limit,
    ),
  async anonUsed(agentId, now = new Date()) {
    const [row] = await db
      .select({ used: t.agentUsage.messages })
      .from(t.agentUsage)
      .where(and(eq(t.agentUsage.agentId, agentId), eq(t.agentUsage.day, dayOf(now))));
    return row?.used ?? 0;
  },
});
