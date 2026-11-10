import { configDefaults, defineConfig } from "vitest/config";

// Playwright specs (`pnpm test:e2e`) live in e2e/ and examples/; vitest must not collect them.
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**", "examples/**"],
  },
});
