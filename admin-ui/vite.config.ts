// The admin dashboard, built to dist/admin-ui as plain static files. Assets are relative (`base: "./"`) and the mount
// point comes from index.html at serve time, so one build serves any path.
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  // The logos and icons in the repo's public/ ship with the dashboard.
  publicDir: resolve(import.meta.dirname, "../public"),
  resolve: {
    alias: {
      "~": resolve(import.meta.dirname, "src"),
      "@shared/api": resolve(import.meta.dirname, "../src/admin/api.ts"),
      "@shared/limits": resolve(import.meta.dirname, "../src/admin/limits.ts"),
      sideagent: resolve(import.meta.dirname, "../src/client/internal.ts"),
    },
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "src/routes",
      generatedRouteTree: "src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  // `pnpm dev`: the API runs from dev/server.ts. Requests keep their Origin, so the admin's same-origin check passes.
  server: {
    port: 5174,
    proxy: {
      "/api": process.env.ADMIN_API ?? "http://localhost:8788",
      "/v1": process.env.ADMIN_API ?? "http://localhost:8788",
    },
  },
  build: { outDir: resolve(import.meta.dirname, "../dist/admin-ui"), emptyOutDir: true },
});
