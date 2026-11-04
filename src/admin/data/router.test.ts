import { describe, expect, it } from "vitest";
import { publishableKey } from "../../keys.js";
import { mockEmbeddingsHandler } from "../../testing/mock-llm.js";
import {
  BASE,
  app,
  remote,
  body,
  call,
  create,
  logs,
  modelCalls,
  runIndexing,
  setDeps,
  signIn,
  store,
} from "../test/harness.js";

describe("data plane", () => {
  const ORIGIN = "https://app.example.com";
  async function liveKnowledgeAgent(origins = [ORIGIN]) {
    const cookie = await signIn("a@example.com");
    const a = await create(cookie);
    const add = (json: unknown) => call(`/api/agents/${a.id}/knowledge`, { method: "POST", json }, cookie);
    await add({ kind: "text", title: "Refunds", content: "Refund policy: refunds are issued within five days." });
    await add({ kind: "text", title: "Shipping", content: "Shipping takes a week." });
    await call(
      `/api/agents/${a.id}`,
      { method: "PATCH", json: { allowedOrigins: origins, instructions: "You answer product questions." } },
      cookie,
    );
    await call(`/api/agents/${a.id}/auth`, { method: "PUT", json: { mode: "anonymous" } }, cookie);
    expect((await call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie)).status).toBe(200);
    await runIndexing(a.id);
    return { cookie, id: a.id };
  }
  // Close enough to the stored passage for the relevance gate (the mock embeddings are bag-of-words).
  const REFUND_QUESTION = "Refund policy: refunds are issued within five days.";
  // A fresh address per call, so the per-address limit only bites in the tests about it.
  let ipCounter = 0;
  const keyOf = (id: string) => publishableKey(new URL(BASE).host, id);
  // Reads the stream to its end before returning, so the turn is over (and logged) when a test looks.
  const ask = async (id: string, json: unknown, headers: Record<string, string> = { origin: ORIGIN }) => {
    const res = await app.fetch(
      new Request(`${BASE}/v1/agents/${id}`, {
        method: "POST",
        body: JSON.stringify(json),
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": `10.0.0.${++ipCounter}`,
          "x-sideagent-key": keyOf(id),
          ...headers,
        },
      }),
    );
    await res.clone().text();
    return res;
  };
  const events = async (res: Response) =>
    (await res.text())
      .split("\n\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l.replace(/^data: /, "")) as { type: string; text?: string; code?: string });

  it("answers from the agent's knowledge as protocol events", async () => {
    const { id } = await liveKnowledgeAgent();
    const res = await ask(id, { message: REFUND_QUESTION });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const evs = await events(res);
    expect(evs[0]!.type).toBe("turn.start");
    expect(evs.at(-1)!.type).toBe("turn.end");
    expect(evs.some((e) => e.type === "text.delta")).toBe(true);
    expect(modelCalls).toBeGreaterThan(0);
  });

  it("answers off-topic questions without calling the model", async () => {
    const { id } = await liveKnowledgeAgent();
    const res = await ask(id, { message: "write me a poem" });
    expect(res.status).toBe(200);
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(["turn.start", "text.delta", "turn.end"]);
    expect(evs[1]!.text).toContain("only answer questions about");
    expect(modelCalls).toBe(0);
  });

  it("hides unknown, draft and deactivated agents the same way", async () => {
    const cookie = await signIn("a@example.com");
    const draft = await create(cookie);
    const { id: live, cookie: liveCookie } = await liveKnowledgeAgent();
    await call(`/api/agents/${live}/deactivate`, { method: "POST" }, liveCookie);
    const results = [];
    for (const id of [draft.id, live, "agt_doesnotexist0000"]) {
      const res = await ask(id, { message: "hi" });
      results.push([res.status, await res.json()]);
    }
    expect(results).toEqual([
      [404, { error: "not_found" }],
      [404, { error: "not_found" }],
      [404, { error: "not_found" }],
    ]);
  });

  it("refuses other origins and answers preflight only for allowed ones", async () => {
    const { id } = await liveKnowledgeAgent();
    const bad = await ask(id, { message: "hi" }, { origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(await bad.json()).toEqual({ error: "forbidden" });
    const preflight = (origin: string) =>
      app.fetch(
        new Request(`${BASE}/v1/agents/${id}`, {
          method: "OPTIONS",
          headers: { origin, "access-control-request-method": "POST" },
        }),
      );
    expect((await preflight(ORIGIN)).status).toBe(204);
    expect((await preflight("https://evil.example")).status).toBe(403);
  });

  describe("publishable key (D-27)", () => {
    it("is required: missing is 401, malformed or for another agent is 404", async () => {
      const { id } = await liveKnowledgeAgent();
      const other = await liveKnowledgeAgent();
      const send = (key: string | undefined) =>
        ask(
          id,
          { message: "hi" },
          { origin: ORIGIN, ...(key ? { "x-sideagent-key": key } : { "x-sideagent-key": "" }) },
        );
      expect((await send(undefined)).status).toBe(401);
      expect((await send("nonsense")).status).toBe(404);
      expect((await send(keyOf(other.id))).status).toBe(404);
      expect((await send(keyOf(id))).status).toBe(200);
    });

    it("is checked after the origin, so a disallowed origin learns nothing about its key", async () => {
      const { id } = await liveKnowledgeAgent();
      const res = await ask(id, { message: "hi" }, { origin: "https://evil.example", "x-sideagent-key": "nonsense" });
      expect(res.status).toBe(403);
    });
  });

  describe("limits", () => {
    it("caps anonymous messages per agent per day (D-38)", async () => {
      setDeps({ anonDailyMessages: 1 });
      const { id } = await liveKnowledgeAgent();
      expect((await ask(id, { message: REFUND_QUESTION })).status).toBe(200);
      expect((await ask(id, { message: REFUND_QUESTION })).status).toBe(429);
      const info = await ask(id, { action: "agent.info" });
      expect(await info.json()).toMatchObject({ available: false });
    });

    it("limits requests per address", async () => {
      const { id } = await liveKnowledgeAgent();
      const sameIp = { origin: ORIGIN, "x-forwarded-for": "203.0.113.9" };
      const codes = [];
      for (let i = 0; i < 12; i++) codes.push((await ask(id, { action: "agent.info" }, sameIp)).status);
      expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
      expect(codes.slice(10)).toEqual([429, 429]);
    });

    it("uses the host's rate limiter keyed by agent and address (D-37)", async () => {
      const keys: string[] = [];
      setDeps({ rateLimit: { limit: async ({ key }) => (keys.push(key), { success: keys.length < 3 }) } });
      const { id } = await liveKnowledgeAgent();
      const ip = { origin: ORIGIN, "x-forwarded-for": "198.51.100.7" };
      expect((await ask(id, { action: "agent.info" }, ip)).status).toBe(200);
      expect((await ask(id, { action: "agent.info" }, ip)).status).toBe(200);
      expect((await ask(id, { action: "agent.info" }, ip)).status).toBe(429);
      expect(keys[0]).toBe(`${id}|198.51.100.7`);
    });

    it("reads the client address from the host's function", async () => {
      const keys: string[] = [];
      setDeps({
        clientIp: (r) => r.headers.get("x-real-ip") ?? undefined,
        rateLimit: { limit: async ({ key }) => (keys.push(key), { success: true }) },
      });
      const { id } = await liveKnowledgeAgent();
      await ask(id, { action: "agent.info" }, { origin: ORIGIN, "x-real-ip": "192.0.2.1" });
      expect(keys).toEqual([`${id}|192.0.2.1`]);
    });
  });

  describe("audit log", () => {
    it("records turns and denied origins without any message text", async () => {
      const { id, cookie } = await liveKnowledgeAgent();
      await ask(id, { message: "What is the refund policy? my secret is hunter2" });
      await ask(id, { message: "hi" }, { origin: "https://evil.example" });
      const audit = await body<{ events: { event: string; result: string; reason: string | null }[] }>(
        call(`/api/agents/${id}/audit`, {}, cookie),
      );
      expect(audit.events.map((e) => [e.event, e.result, e.reason])).toEqual(
        expect.arrayContaining([
          ["chat.turn", "ok", null],
          ["request", "denied", "origin_not_allowed"],
        ]),
      );
      expect(JSON.stringify(audit)).not.toContain("hunter2");
    });

    it("is tenant-scoped", async () => {
      const { id } = await liveKnowledgeAgent();
      await ask(id, { message: REFUND_QUESTION });
      const bob = await signIn("bob@example.com");
      expect((await call(`/api/agents/${id}/audit`, {}, bob)).status).toBe(404);
    });
  });

  describe("traces (D-35)", () => {
    it("records a turn's spans without text at metadata, and links them from the audit row", async () => {
      const { id, cookie } = await liveKnowledgeAgent();
      await ask(id, { message: REFUND_QUESTION });
      const page = await body<{ traces: { id: string; llmCalls: number; level: string }[] }>(
        call(`/api/agents/${id}/traces`, {}, cookie),
      );
      expect(page.traces).toHaveLength(1);
      expect(page.traces[0]).toMatchObject({ level: "metadata" });
      const full = await body<{ spans: { input?: string; output?: string }[] }>(
        call(`/api/agents/${id}/traces/${page.traces[0]!.id}`, {}, cookie),
      );
      expect(full.spans.length).toBeGreaterThan(0);
      expect(full.spans.every((s) => s.input === undefined && s.output === undefined)).toBe(true);
      const audit = await body<{ events: { traceId: string | null; event: string }[] }>(
        call(`/api/agents/${id}/audit`, {}, cookie),
      );
      expect(audit.events.find((e) => e.event === "chat.turn")?.traceId).toBe(page.traces[0]!.id);
    });

    it("keeps nothing when tracing is off", async () => {
      const { id, cookie } = await liveKnowledgeAgent();
      await call(`/api/agents/${id}/tracing`, { method: "PUT", json: { level: "off" } }, cookie);
      await ask(id, { message: REFUND_QUESTION });
      expect((await body<{ traces: [] }>(call(`/api/agents/${id}/traces`, {}, cookie))).traces).toEqual([]);
    });
  });

  describe("preview (D-31)", () => {
    it("is the owner's alone and runs in any status", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      await call(
        `/api/agents/${a.id}/knowledge`,
        { method: "POST", json: { kind: "text", title: "Refunds", content: "Refund policy: five days." } },
        cookie,
      );
      await runIndexing(a.id);
      const preview = (c: string) =>
        call(
          `/api/agents/${a.id}/preview`,
          { method: "POST", json: { message: REFUND_QUESTION }, headers: { origin: BASE } },
          c,
        );
      const mine = await preview(cookie);
      expect(mine.status).toBe(200);
      expect(await mine.text()).toContain("knowledge.hits");
      expect((await preview(await signIn("bob@example.com"))).status).toBe(404);
      expect((await call(`/api/agents/${a.id}/preview/threads`, { method: "DELETE" }, cookie)).status).toBe(200);
    });

    it("cannot be reached through the public route", async () => {
      const res = await app.fetch(
        new Request(`${BASE}/v1/agents/__preview`, { method: "POST", body: "{}", headers: { origin: BASE } }),
      );
      expect(res.status).toBe(404);
    });
  });

  it("never shows provider errors to the client", async () => {
    const cookie = await signIn("a@example.com");
    const a = await create(cookie);
    const secret = "sk-provider-secret-0123456789";
    await call(
      `/api/agents/${a.id}/knowledge`,
      { method: "POST", json: { kind: "text", title: "Refunds", content: REFUND_QUESTION } },
      cookie,
    );
    await call(`/api/agents/${a.id}`, { method: "PATCH", json: { allowedOrigins: [ORIGIN] } }, cookie);
    // The provider: embeddings work, the chat model fails and echoes the key it was sent.
    remote["https://llm.example.com/v1/embeddings"] = (req) => mockEmbeddingsHandler(req);
    remote["https://llm.example.com/v1/chat/completions"] = () => new Response(`bad key ${secret}`, { status: 401 });
    await call(`/api/agents/${a.id}/auth`, { method: "PUT", json: { mode: "anonymous" } }, cookie);
    await call(
      `/api/agents/${a.id}/llm`,
      {
        method: "PUT",
        json: { baseUrl: "https://llm.example.com/v1", model: "m", apiKey: secret },
      },
      cookie,
    );
    await runIndexing(a.id);
    await call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie);
    const res = await ask(a.id, { message: REFUND_QUESTION });
    const text = await res.text();
    expect(text).not.toContain(secret);
    expect(text).toContain('"type":"error"');
    expect(logs.join("\n")).not.toContain(secret);
    const audit = await body<{ events: { result: string; reason: string | null }[] }>(
      call(`/api/agents/${a.id}/audit`, {}, cookie),
    );
    expect(audit.events.find((e) => e.result === "error")?.reason).toBe("llm_error");
    expect(store).toBeDefined();
  });
});
