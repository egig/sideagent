// AdminStore on Postgres with pgvector, through Drizzle. Any Drizzle pg driver works: node-postgres, postgres.js,
// Neon, PGlite. This file imports no driver and no Node API, so it also runs on Workers behind Hyperdrive.
// One file per area of the store; this one only puts them together.
import type { AdminStore } from "../types.js";
import { agentsStore } from "./agents.js";
import { auditStore } from "./audit.js";
import type { PgDb } from "./db.js";
import { knowledgeStore } from "./knowledge.js";
import { migrate } from "./migrate.js";
import { threadsStore } from "./threads.js";
import { usageStore } from "./usage.js";

export type { PgDb } from "./db.js";

export function createPgStore(db: PgDb, options: { onClose?: () => Promise<void> } = {}): AdminStore {
  return {
    migrate: () => migrate(db),
    async close() {
      await options.onClose?.();
    },
    agents: agentsStore(db),
    usage: usageStore(db),
    audit: auditStore(db),
    threads: threadsStore(db),
    knowledge: knowledgeStore(db),
  };
}
