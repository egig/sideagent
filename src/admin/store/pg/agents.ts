import { and, desc, eq, sql } from "drizzle-orm";
import type { AdminStore, AgentChange, AgentRecord } from "../types.js";
import type { PgDb } from "./db.js";
import * as t from "./schema.js";

export const agentsStore = (db: PgDb): AdminStore["agents"] => ({
  async list(ownerId) {
    return db.select().from(t.agent).where(eq(t.agent.ownerId, ownerId)).orderBy(desc(t.agent.createdAt));
  },
  async get(id) {
    return (await db.select().from(t.agent).where(eq(t.agent.id, id)))[0] ?? null;
  },
  async getOwned(ownerId, id) {
    return (
      (
        await db
          .select()
          .from(t.agent)
          .where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)))
      )[0] ?? null
    );
  },
  async create(record: AgentRecord) {
    await db.insert(t.agent).values(record);
  },
  async update(ownerId, id, change: AgentChange) {
    const [row] = await db
      .update(t.agent)
      .set({ ...change, configVersion: sql`${t.agent.configVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)))
      .returning();
    return row ?? null;
  },
  async remove(ownerId, id) {
    return db.transaction(async (tx) => {
      const found = (
        await tx
          .select({ id: t.agent.id })
          .from(t.agent)
          .where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)))
      )[0];
      if (!found) return null;
      const users = await tx
        .select({ userId: t.agentUser.userId })
        .from(t.agentUser)
        .where(eq(t.agentUser.agentId, id));
      await tx.delete(t.agent).where(and(eq(t.agent.id, id), eq(t.agent.ownerId, ownerId)));
      return { userIds: users.map((u) => u.userId) };
    });
  },
  async trackUser(agentId, userId) {
    await db.insert(t.agentUser).values({ agentId, userId }).onConflictDoNothing();
  },
});
