import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

// biome-ignore lint/suspicious/noExplicitAny: any Drizzle pg driver
export type PgDb = PgDatabase<PgQueryResultHKT, any>;

/** The rows of a raw `execute` result, whichever shape the driver returns. */
export const rowsOf = <T>(result: unknown): T[] =>
  (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
