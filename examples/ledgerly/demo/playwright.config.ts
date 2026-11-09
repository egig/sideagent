// Records the Ledgerly demo: `pnpm demo`. Starts the demo server (sideagent + dashboard, port 8801) and the Ledgerly
// app (Vite, port 8802), drives a browser through the whole story and keeps the video in demo/out/.
import { defineConfig } from "@playwright/test";

export const SERVER = "http://localhost:8801";
export const APP = "http://localhost:8802";
const SIZE = { width: 1280, height: 800 };

export default defineConfig({
  testDir: ".",
  testMatch: "demo.spec.ts",
  outputDir: "out",
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    baseURL: SERVER,
    viewport: SIZE,
    video: { mode: "on", size: SIZE },
    // Slow enough to follow on a recording.
    launchOptions: { slowMo: 250 },
  },
  webServer: [
    {
      command: "pnpm --dir ../.. exec tsx examples/ledgerly/demo/server.ts",
      cwd: "..",
      url: `${SERVER}/sign-in`,
      reuseExistingServer: false,
      timeout: 90_000,
    },
    {
      command: "pnpm exec vite --port 8802 --strictPort",
      cwd: "..",
      url: APP,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
