// sideagent/admin/pg: the Postgres + pgvector store. Pass it any Drizzle pg database:
//   import { drizzle } from "drizzle-orm/node-postgres";
//   const store = createPgStore(drizzle(databaseUrl));
//   await store.migrate();
export { createPgStore } from "./store.js";
export type { PgDb } from "./store.js";
