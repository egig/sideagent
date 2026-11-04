// The admin on its own: API and data plane in one Node process.
//   pnpm dev          this server on :8788 (reloads on change) plus the dashboard on :5174 (vite, hot reload)
//   pnpm admin:start  this server alone, serving the built dashboard (pnpm build:ui) on :8788; what Docker runs
// Without DATABASE_URL it runs on PGlite (Postgres in process, data lost on exit). Sign-in links print to the console.
// For real Postgres also set DATABASE_URL, BETTER_AUTH_SECRET and CONFIG_KEK.
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createAuth } from "../src/admin/auth/index.js";
import { createAdmin, dohResolve } from "../src/admin/index.js";
import { serveAdminUi } from "../src/admin/node.js";
import { createPgStore, type PgDb } from "../src/admin/store/pg/index.js";

const PORT = Number(process.env.PORT ?? 8788);
const production = process.env.NODE_ENV === "production";
// In dev the browser talks to vite, which proxies /api and /v1 here, so sign-in links and the origin check use vite's URL.
const PUBLIC_URL = process.env.PUBLIC_URL ?? (production ? `http://localhost:${PORT}` : "http://localhost:5174");
const secret = process.env.BETTER_AUTH_SECRET ?? crypto.randomUUID() + crypto.randomUUID();
const kek = process.env.CONFIG_KEK ?? btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
if (!process.env.BETTER_AUTH_SECRET || !process.env.CONFIG_KEK)
  console.warn(
    "BETTER_AUTH_SECRET or CONFIG_KEK not set: using throwaway ones, sessions and stored keys die with this process.",
  );

let db: PgDb;
let close: () => Promise<void>;
if (process.env.DATABASE_URL) {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzle(pool);
  close = () => pool.end();
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const { vector } = await import("@electric-sql/pglite-pgvector");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite({ extensions: { vector } });
  db = drizzle(client);
  close = () => client.close();
}
const store = createPgStore(db, { onClose: close });
await store.migrate();

const auth = createAuth({
  db,
  baseURL: PUBLIC_URL,
  secret,
  signup: process.env.SIGNUP !== "false",
  sendMagicLink: async (email, url) => console.log(`sign-in link for ${email}: ${url}`),
  ipHeaders: ["x-forwarded-for"],
});

const admin = createAdmin({
  store,
  auth,
  session: auth.session,
  publicUrl: PUBLIC_URL,
  secrets: { CONFIG_KEK: kek },
  resolve: dohResolve,
  fetch,
  clientIp: (request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
  debug: true,
});

const app = new Hono();
if (production) {
  // From source the built dashboard is in dist/admin-ui (pnpm build:ui).
  const ui = serveAdminUi({ dir: fileURLToPath(new URL("../dist/admin-ui", import.meta.url)), apiBase: "/api" });
  app.all("*", (c) => ui(c.req.raw) ?? admin.fetch(c.req.raw));
} else {
  app.all("*", (c) => admin.fetch(c.req.raw));
}

serve({ fetch: app.fetch, port: PORT }, () =>
  console.log(`admin on ${PUBLIC_URL} (${process.env.DATABASE_URL ? "postgres" : "pglite"})`),
);
