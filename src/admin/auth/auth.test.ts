import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolve } from "../test/harness.js";
import { createAdmin } from "../index.js";
import { createPgStore } from "../store/pg/store.js";
import { createAuth } from "./index.js";

const BASE = "http://localhost:8787";
const EMAIL = "integrator@example.com";

const pg = new PGlite({ extensions: { vector } });
const db = drizzle(pg);
const store = createPgStore(db);
afterAll(() => pg.close());

let sent: string[];
let logs: string[];

async function makeApp(signup = true, sendMagicLink?: (email: string, url: string) => Promise<void>) {
  await store.migrate();
  await pg.exec(
    `TRUNCATE sideagent."user" CASCADE; TRUNCATE sideagent."rateLimit"; TRUNCATE sideagent."agent" CASCADE`,
  );
  const auth = createAuth({
    db,
    baseURL: BASE,
    secret: "test-secret-generated-locally-0123456789abcdef",
    signup,
    sendMagicLink: sendMagicLink ?? (async (_email, url) => void sent.push(url)),
  });
  return createAdmin({
    store,
    auth,
    session: auth.session,
    publicUrl: BASE,
    secrets: { CONFIG_KEK: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))) },
    resolve,
    fetch,
  });
}

const req = (path: string, init: RequestInit = {}) =>
  new Request(`${BASE}${path}`, {
    ...init,
    headers: { origin: BASE, "content-type": "application/json", ...init.headers },
  });
const requestLink = (app: Awaited<ReturnType<typeof makeApp>>) =>
  app.fetch(
    req("/api/auth/sign-in/magic-link", {
      method: "POST",
      body: JSON.stringify({ email: EMAIL, callbackURL: "/app" }),
    }),
  );
const users = async () => (await pg.query(`select count(*)::int n from sideagent."user"`)).rows;

beforeEach(() => {
  sent = [];
  logs = [];
  for (const level of ["log", "info", "warn", "error"] as const)
    vi.spyOn(console, level).mockImplementation((...a) => void logs.push(a.join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("bundled auth", () => {
  it("refuses new accounts unless signup is on", async () => {
    const app = await makeApp(false);
    expect(await (await app.fetch(req("/api/auth-providers"))).json()).toMatchObject({ signup: false });
    await requestLink(app);
    if (sent[0]) {
      const verify = await app.fetch(req(`/api/auth/magic-link/verify?${new URL(sent[0]).hash.slice(1)}`));
      expect(verify.headers.get("set-cookie") ?? "").not.toMatch(/session_token/);
    }
    expect(await users()).toEqual([{ n: 0 }]);
  });

  it("guards /api with a uniform 401 and leaves public routes open", async () => {
    const app = await makeApp();
    const me = await app.fetch(req("/api/me"));
    expect(me.status).toBe(401);
    expect(await me.json()).toEqual({ error: "unauthorized" });
    expect((await app.fetch(req("/api/agents"))).status).toBe(401);
    expect((await app.fetch(req("/api/health"))).status).toBe(200);
    expect(await (await app.fetch(req("/api/auth-providers"))).json()).toEqual({
      github: false,
      google: false,
      signup: true,
    });
  });

  it("signs in with a single-use magic link carried in the URL fragment", async () => {
    const app = await makeApp();
    expect((await requestLink(app)).status).toBe(200);
    expect(sent).toHaveLength(1);
    const link = new URL(sent[0]!);
    expect(`${link.origin}${link.pathname}`).toBe(`${BASE}/verify`);
    expect(link.search).toBe("");
    const params = new URLSearchParams(link.hash.slice(1));
    const token = params.get("token")!;
    expect(token).toBeTruthy();

    // Stored hashed, never the raw token.
    const rows = (await pg.query(`select identifier, value from sideagent."verification"`)).rows;
    expect(JSON.stringify(rows)).not.toContain(token);

    const verify = await app.fetch(req(`/api/auth/magic-link/verify?${params}`));
    expect(verify.status).toBe(302);
    const cookie = verify.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    expect(cookie).toContain("sideagent.session_token=");

    const me = await app.fetch(req("/api/me", { headers: { cookie } }));
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { email: string } }).user.email).toBe(EMAIL);

    // The cookie works on the agents API too, and the same link mints nothing a second time.
    expect((await app.fetch(req("/api/agents", { headers: { cookie } }))).status).toBe(200);
    const replay = await app.fetch(req(`/api/auth/magic-link/verify?${params}`));
    expect(replay.headers.getSetCookie().join()).not.toContain("session_token=");
    expect(replay.headers.get("location")).toContain("error=");
    expect(logs.join("\n")).not.toContain(token);
  });

  it("fails the request when the link cannot be sent", async () => {
    const app = await makeApp(true, async () => {
      throw new Error("no transport");
    });
    expect((await requestLink(app)).status).toBeGreaterThanOrEqual(400);
    expect(sent).toHaveLength(0);
  });
});
