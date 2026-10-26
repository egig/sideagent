import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    protocol: "src/protocol.ts",
    "server/index": "src/server/index.ts",
    "server/browser": "src/server/browser.ts",
    "testing/mock-llm": "src/testing/mock-llm.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
});
