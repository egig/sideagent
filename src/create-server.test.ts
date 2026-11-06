import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, describe, expect, it } from "vitest";
import { deriveSecrets } from "./admin/security/crypto.js";
import type { PgDb } from "./admin/store/pg/index.js";
import { createServer } from "./create-server.js";

const client = new PGlite({ extensions: { vector } });
const db = drizzle(client) as unknown as PgDb;
afterAll(() => client.close());

const secret = "x".repeat(40);
const base = { database: db, publicUrl: "https://agent.example.com", secret };

describe("createServer", () => {
  it("refuses to start without a database, a URL or a long enough secret", async () => {
    expect(() => createServer({ ...base, database: undefined as never })).toThrow("database is required");
    expect(() => createServer({ ...base, publicUrl: "agent" })).toThrow("publicUrl must be a URL");
    expect(() => createServer({ ...base, secret: "" })).toThrow("secret is required");
    await expect(createServer({ ...base, secret: "short" }).ready).rejects.toThrow("at least 32 characters");
  });

  it("answers the health check, guards the dashboard API and leaves the agents' endpoints to their own checks", async () => {
    const server = createServer(base);
    await server.ready;
    const health = await server.fetch(new Request("https://agent.example.com/api/health"));
    expect(health.status).toBe(200);
    const agents = await server.fetch(new Request("https://agent.example.com/api/agents"));
    expect(agents.status).toBe(401);
    const turn = await server.fetch(
      new Request("https://agent.example.com/v1/agents/agt_aaaaaaaaaaaaaaaa", { method: "POST" }),
    );
    expect(turn.status).not.toBe(200);
  });

  it("uses your own sign-in instead of the bundled one", async () => {
    const server = createServer({ ...base, auth: { session: async () => ({ id: "u1" }) } });
    await server.ready;
    const agents = await server.fetch(new Request("https://agent.example.com/api/agents"));
    expect(agents.status).toBe(200);
    const bundledRoute = await server.fetch(new Request("https://agent.example.com/api/auth-providers"));
    expect(bundledRoute.status).toBe(404);
  });

  it("serves the dashboard through ui and falls through for anything else", async () => {
    const server = createServer({
      ...base,
      ui: (request) => (new URL(request.url).pathname === "/" ? Promise.resolve(new Response("dashboard")) : null),
    });
    expect(await (await server.fetch(new Request("https://agent.example.com/"))).text()).toBe("dashboard");
    expect((await server.fetch(new Request("https://agent.example.com/api/health"))).status).toBe(200);
  });

  it("refuses to send sign-in links by default outside localhost", async () => {
    const server = createServer({ ...base, auth: { signup: true } });
    await server.ready;
    const res = await server.fetch(
      new Request("https://agent.example.com/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://agent.example.com" },
        body: JSON.stringify({ email: "a@example.com" }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("deriveSecrets", () => {
  it("derives two different keys, the same ones every time, from the master secret", async () => {
    const a = await deriveSecrets(secret);
    expect(a.kek).not.toBe(a.authSecret);
    expect(await deriveSecrets(secret)).toEqual(a);
    expect((await deriveSecrets("y".repeat(40))).kek).not.toBe(a.kek);
    expect(atob(a.kek)).toHaveLength(32);
  });

  it("rejects a short secret", async () => {
    await expect(deriveSecrets("short")).rejects.toThrow("at least 32 characters");
  });
});
