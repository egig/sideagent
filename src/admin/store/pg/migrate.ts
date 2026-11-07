import { sql } from "drizzle-orm";
import type { PgDb } from "./db.js";
import { rowsOf } from "./db.js";
import { MIGRATIONS } from "./migrations.js";

const MIGRATION_LOCK = 7_265_001;

/** Runs the steps not yet recorded, in one transaction under an advisory lock so concurrent starts do not race. */
export async function migrate(db: PgDb) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
    await tx.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS sideagent`));
    await tx.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS sideagent._migration (step integer PRIMARY KEY, at timestamptz NOT NULL DEFAULT now())`,
      ),
    );
    const done = rowsOf<{ step: number }>(await tx.execute(sql.raw(`SELECT step FROM sideagent._migration`))).map((r) =>
      Number(r.step),
    );
    for (const [i, statements] of MIGRATIONS.entries()) {
      if (done.includes(i + 1)) continue;
      for (const statement of statements) await tx.execute(sql.raw(statement));
      await tx.execute(sql`INSERT INTO sideagent._migration (step) VALUES (${i + 1})`);
    }
  });
}
