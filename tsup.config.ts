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
    "workers-ai/index": "src/workers-ai/index.ts",
    "testing/mock-llm": "src/testing/mock-llm.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
