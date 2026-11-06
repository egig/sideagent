// End-to-end tests of the dashboard in a real browser: `pnpm test:e2e`. The server is e2e/server.ts (in-memory
// database, faked network), started for the run.
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8799);

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.pw.ts",
  // One server and one shared workspace: tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "off",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "tsx e2e/server.ts",
    url: `http://localhost:${port}/sign-in`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { E2E_PORT: String(port) },
  },
});
