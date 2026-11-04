import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    protocol: "src/protocol.ts",
    keys: "src/keys.ts",
    "server/index": "src/server/index.ts",
    "server/browser": "src/server/browser.ts",
    "admin/index": "src/admin/index.ts",
    "admin/auth": "src/admin/auth/index.ts",
    "admin/ui": "src/admin/ui.ts",
    "admin/node": "src/admin/node.ts",
    "admin/pg": "src/admin/store/pg/index.ts",
    "admin/contract": "src/admin/store/contract.ts",
    "workers-ai/index": "src/workers-ai/index.ts",
    "testing/mock-llm": "src/testing/mock-llm.ts",
  },
  // The contract tests use the host project's test runner.
  external: ["vitest"],
  format: ["esm"],
  dts: true,
  clean: true,
});
