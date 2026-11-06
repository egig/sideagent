import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "server/index": "src/create-server.ts",
    "server/node": "src/create-server-node.ts",
    "server/store": "src/create-server-store.ts",
    cli: "src/cli.ts",
    "workers-ai/index": "src/workers-ai/index.ts",
    "testing/mock-llm": "src/testing/mock-llm.ts",
  },
  // The contract tests use the host project's test runner; the Postgres driver is the host's to install, and PGlite (the no-config dev database) is optional.
  external: [
    "vitest",
    "pg",
    "drizzle-orm/node-postgres",
    "drizzle-orm/pglite",
    "@electric-sql/pglite",
    "@electric-sql/pglite-pgvector",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
});
