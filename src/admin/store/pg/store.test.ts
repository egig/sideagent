import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll } from "vitest";
import { runStoreContract, runThreadContract } from "../contract.js";
import { createPgStore } from "./store.js";

// PGlite is Postgres in process, with pgvector: the same SQL as production, no server to start.
const client = new PGlite({ extensions: { vector } });
const store = createPgStore(drizzle(client));
afterAll(() => client.close());

runStoreContract("postgres (pglite)", async () => ({
  store,
  reset: async () => {
    await store.migrate();
    await client.exec(`TRUNCATE sideagent."agent" CASCADE`);
  },
}));

runThreadContract("postgres (pglite)", async () => ({
  store,
  reset: async () => {
    await store.migrate();
    await client.exec(`TRUNCATE sideagent."agent" CASCADE`);
  },
}));
