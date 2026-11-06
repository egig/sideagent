// End-to-end tests of the dashboard in a real browser: `pnpm test:e2e`. The server is e2e/support/server.ts (in-memory
// database, faked network), started for the run.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8799);
// A second server whose host offers a built-in model; only `*.builtin.spec.ts` runs against it.
const builtinPort = Number(process.env.E2E_BUILTIN_PORT ?? 8798);

export default defineConfig({
  testDir: "e2e/specs",
  // One server and one shared workspace: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "off",
    // Kept in test-results/, which CI uploads when a run fails.
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "default",
      testMatch: "**/*.spec.ts",
      testIgnore: "**/*.builtin.spec.ts",
      use: { baseURL: `http://localhost:${port}` },
    },
    { name: "builtin", testMatch: "**/*.builtin.spec.ts", use: { baseURL: `http://localhost:${builtinPort}` } },
  ],
  webServer: [
    {
      command: "tsx e2e/support/server.ts",
      url: `http://localhost:${port}/sign-in`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { E2E_PORT: String(port) },
    },
    {
      command: "tsx e2e/support/server.ts",
      url: `http://localhost:${builtinPort}/sign-in`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { E2E_PORT: String(builtinPort), E2E_BUILTIN: "1" },
    },
  ],
});
