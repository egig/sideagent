// Shared setup for the admin's HTTP tests: the whole API over PGlite (Postgres + pgvector in process), fake DNS, fetch
// and embeddings, and a fake sign-in. Importing this file registers the beforeEach/afterEach hooks of the importing file.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeEach, expect, vi } from "vitest";
import type { AgentDetail } from "../api.js";
import { createAdmin } from "../index.js";
import { mockEmbeddings, mockEmbeddingsHandler, mockLlmHandler } from "../../testing/mock-llm.js";
import type { AdminDeps } from "../deps.js";
import { indexPending } from "../knowledge/sources.js";
import { createPgStore } from "../store/pg/store.js";

export const BASE = "http://localhost:8787";
export const LLM_KEY = "sk-canary-llm-key-0f9e8d7c6b5a";

// Fake DNS: *.private.example resolves to an internal address.
export const resolve = async (host: string) => (host.endsWith("private.example") ? ["10.0.0.9"] : ["93.184.216.34"]);
export let remote: Record<string, (request: Request) => Response | Promise<Response>>;
export let fetched: string[];
export const LLM_BASE_URL = "https://llm.example.com/v1";
export const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  fetched.push(url);
  const request = new Request(url, init);
  const custom = await remote[url]?.(request);
  if (custom) return custom;
  // The integrator's provider: the library's scripted model and embeddings.
  if (url === `${LLM_BASE_URL}/chat/completions`) return (modelCalls++, mockLlmHandler(request));
  if (url === `${LLM_BASE_URL}/embeddings`) return mockEmbeddingsHandler(request);
  return new Response("not found", { status: 404 });
};

/** The embedding of a query, as the scripted embeddings make it. */
export const fakeVector = (text: string) => mockEmbeddings.embedQuery(text);

export const pg = new PGlite({ extensions: { vector } });
export const store = createPgStore(drizzle(pg));
afterAll(() => pg.close());

export let deps: AdminDeps;
export let app: ReturnType<typeof createAdmin>;
export let logs: string[];
/** Requests the scripted chat model received this test. */
export let modelCalls: number;
export let responses: string[] = [];

const kek = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

/** Replace the deps for the rest of a test (e.g. to break the key). */
export function setDeps(next: Partial<AdminDeps>) {
  deps = { ...deps, ...next };
  app = createAdmin(deps);
}

/** Sign-in is the cookie `user=<email>`; the fake session reads it. */
export const signIn = async (email: string) => `user=${encodeURIComponent(email)}`;

/** What the background indexer does, run on demand. */
export const runIndexing = async (agentId: string) => indexPending(deps, (await store.agents.get(agentId))!);

beforeEach(async () => {
  logs = [];
  modelCalls = 0;
  for (const level of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args.join(" ")));
  }
  fetched = [];
  remote = {};
  responses = [];
  await store.migrate();
  await pg.exec(`TRUNCATE sideagent."agent" CASCADE`);
  setDeps({
    store,
    session: async (req) => {
      const m = /(?:^|;\s*)user=([^;]+)/.exec(req.headers.get("cookie") ?? "");
      return m ? { id: `id-${decodeURIComponent(m[1]!)}`, email: decodeURIComponent(m[1]!) } : null;
    },
    // One workspace per user: the isolation tests need it. The default (one shared workspace) has its own test.
    scope: (user) => user.id,
    publicUrl: BASE,
    secrets: { CONFIG_KEK: kek() },
    resolve,
    fetch: fakeFetch,
    // Indexing runs only when a test calls runIndexing.
    background: () => {},
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

export async function call(path: string, init: RequestInit & { json?: unknown } = {}, cookie?: string) {
  const { json, ...rest } = init;
  const res = await app.fetch(
    new Request(`${BASE}${path}`, {
      ...rest,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
      headers: { origin: BASE, "content-type": "application/json", ...(cookie && { cookie }), ...rest.headers },
    }),
  );
  responses.push(await res.clone().text());
  return res;
}

export const body = async <T = AgentDetail>(res: Response | Promise<Response>) => (await (await res).json()) as T;

export async function create(cookie: string, name = "Invoices assistant") {
  const res = await call("/api/agents", { method: "POST", json: { name } }, cookie);
  expect(res.status).toBe(201);
  const { agent } = await body(res);
  // Every agent gets the scripted provider, as an integrator would set up theirs.
  const llm = await call(
    `/api/agents/${agent.id}/llm`,
    { method: "PUT", json: { baseUrl: LLM_BASE_URL, model: "gpt-4o-mini", apiKey: LLM_KEY } },
    cookie,
  );
  expect(llm.status).toBe(200);
  return (await body(llm)).agent;
}

// Fills every section so the agent can go live.
export async function configure(cookie: string, id: string) {
  await call(
    `/api/agents/${id}`,
    { method: "PATCH", json: { allowedOrigins: ["https://app.example.com"], instructions: "Answer from the docs." } },
    cookie,
  );
  await call(
    `/api/agents/${id}/llm`,
    {
      method: "PUT",
      json: { baseUrl: LLM_BASE_URL, model: "gpt-4o-mini", apiKey: LLM_KEY },
    },
    cookie,
  );
  await call(
    `/api/agents/${id}/auth`,
    {
      method: "PUT",
      json: {
        mode: "jwks",
        jwksUrl: "https://auth.example.com/.well-known/jwks.json",
        issuer: "https://auth.example.com/",
        audience: "api",
      },
    },
    cookie,
  );
}
