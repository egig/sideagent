import { describe, expect, it, vi } from "vitest";
import { publishableKey } from "../../keys.js";
import { ANON_THREAD_TTL_MS } from "../retention.js";
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
    const res = await ask(id, { message: "what is 2+2" });
    expect(res.status).toBe(200);
    const evs = await events(res);
    expect(evs.map((e) => e.type)).toEqual(["turn.start", "text.delta", "turn.end"]);
    expect(evs[1]!.text).toContain("only answer questions about");
    expect(modelCalls).toBe(0);
  });

  describe("anonymous conversations", () => {
    const threadOf = async (res: Response) =>
      (await events(res)).find((e) => e.type === "turn.start") as unknown as { threadId: string };

    it("keeps the context of a thread for the visitor who holds its id", async () => {
      const { id } = await liveKnowledgeAgent();
      const first = await threadOf(await ask(id, { message: REFUND_QUESTION }));
      const calls = modelCalls;
      // Alone, this has nothing to do with the documentation (the next test); after the first message it is a follow-up.
      const res = await ask(id, { threadId: first.threadId, message: "how long does it take?" });
      expect(res.status).toBe(200);
      const again = await threadOf(res);
      expect(again.threadId).toBe(first.threadId);
      expect(modelCalls).toBeGreaterThan(calls);
    });

    it("refuses the same follow-up from a visitor with no thread", async () => {
      const { id } = await liveKnowledgeAgent();
      const calls = modelCalls;
      const evs = await events(await ask(id, { message: "how long does it take?" }));
      expect(evs[1]!.text).toContain("only answer questions about");
      expect(modelCalls).toBe(calls);
    });

    it("gives each visitor without a thread a thread of their own", async () => {
      const { id } = await liveKnowledgeAgent();
      const a = await threadOf(await ask(id, { message: REFUND_QUESTION }));
      const b = await threadOf(await ask(id, { message: REFUND_QUESTION }));
      expect(a.threadId).not.toBe(b.threadId);
    });

    it("answers 404 to a thread it does not have, and treats any other id as no thread", async () => {
      const { id } = await liveKnowledgeAgent();
      const unknown = `anonymous%3A${crypto.randomUUID()}:${crypto.randomUUID()}`;
      expect((await ask(id, { threadId: unknown, message: REFUND_QUESTION })).status).toBe(404);
      // A signed-in user's id, or junk, never reaches another user's thread: it just starts a new one.
      for (const threadId of ["alice%40example.com:" + crypto.randomUUID(), "../etc", "anonymous"]) {
        const res = await ask(id, { threadId, message: REFUND_QUESTION });
        expect(res.status).toBe(200);
        expect((await threadOf(res)).threadId).not.toBe(threadId);
      }
    });

    it("keeps the thread in the database, without the visitor's words as a title", async () => {
      const { id } = await liveKnowledgeAgent();
      const { threadId } = await threadOf(await ask(id, { message: REFUND_QUESTION }));
      const user = decodeURIComponent(threadId.split(":")[0]!);
      expect(user).toMatch(/^anonymous:/);
      expect(await store.threads.has(id, user, threadId)).toBe(true);
      expect(await store.threads.list(id, user)).toEqual([{ id: threadId, title: "", updatedAt: expect.any(Number) }]);
      expect(await store.threads.getCheckpoint(id, threadId, "", null)).not.toBeNull();
    });

    it("forgets a thread an hour after its last message, and a new message renews it", async () => {
      let clock = Date.now();
      setDeps({ now: () => clock });
      const { id } = await liveKnowledgeAgent();
      const { threadId } = await threadOf(await ask(id, { message: REFUND_QUESTION }));
      clock += ANON_THREAD_TTL_MS - 1000;
      expect((await ask(id, { threadId, message: REFUND_QUESTION })).status).toBe(200);
      clock += ANON_THREAD_TTL_MS - 1000;
      expect((await ask(id, { threadId, message: REFUND_QUESTION })).status).toBe(200);
      clock += ANON_THREAD_TTL_MS + 1000;
      expect((await ask(id, { threadId, message: REFUND_QUESTION })).status).toBe(404);
    });

    it("offers no thread list or history to an anonymous visitor", async () => {
      const { id } = await liveKnowledgeAgent();
      expect((await ask(id, { action: "threads.list" })).status).toBe(501);
    });
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

    it("counts a built-in message against the owner's cap before the model runs (D-18)", async () => {
      const owners: string[] = [];
      setDeps({
        builtin: {
          model: "b",
          embeddingModel: "e",
          models: () => ({}),
          embed: async (t) => t.map(() => new Float32Array(1)),
          consume: async (ownerId) => (owners.push(ownerId), { allowed: false }),
          usage: async () => ({ month: "2026-11", used: 100, limit: 100 }),
        },
      });
      const { id } = await liveKnowledgeAgent();
      await store.agents.update((await store.agents.get(id))!.ownerId, id, {
        config: { ...(await store.agents.get(id))!.config, llm: { provider: "builtin" } },
      });
      expect((await ask(id, { message: REFUND_QUESTION })).status).toBe(429);
      expect(owners).toEqual([(await store.agents.get(id))!.ownerId]);
      expect(modelCalls).toBe(0);
      expect(await (await ask(id, { action: "agent.info" })).json()).toMatchObject({ available: false });
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

  describe("bot challenge (D-39)", () => {
    const challenge = {
      siteKey: "site-key",
      secret: "challenge-secret",
      verify: async (proof: string) => proof === "solved",
    };
    const verify = (id: string, token: string, headers?: Record<string, string>) =>
      ask(id, { action: "challenge.verify", token }, headers);

    it("is off unless the host sets one", async () => {
      const { id } = await liveKnowledgeAgent();
      expect(await (await ask(id, { action: "agent.info" })).json()).not.toHaveProperty("challenge");
      expect((await ask(id, { message: REFUND_QUESTION })).status).toBe(200);
    });

    it("refuses anonymous messages without a token, and accepts one earned by a solved challenge", async () => {
      setDeps({ challenge });
      const { id } = await liveKnowledgeAgent();
      expect(await (await ask(id, { action: "agent.info" })).json()).toMatchObject({
        challenge: { siteKey: "site-key" },
      });
      const refused = await ask(id, { message: REFUND_QUESTION });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "challenge_required" });
      const ip = { origin: ORIGIN, "x-forwarded-for": "192.0.2.50" };
      expect((await verify(id, "wrong", ip)).status).toBe(403);
      const issued = (await (await verify(id, "solved", ip)).json()) as { challengeToken: string };
      expect(
        (await ask(id, { message: REFUND_QUESTION }, { ...ip, "x-sideagent-challenge": issued.challengeToken })).status,
      ).toBe(200);
    });

    it("gives a token that works for one agent and one address only", async () => {
      setDeps({ challenge });
      const first = await liveKnowledgeAgent();
      const issued = (await (
        await verify(first.id, "solved", { origin: ORIGIN, "x-forwarded-for": "192.0.2.1" })
      ).json()) as {
        challengeToken: string;
      };
      const withToken = (ip: string) => ({
        origin: ORIGIN,
        "x-sideagent-challenge": issued.challengeToken,
        "x-forwarded-for": ip,
      });
      expect((await ask(first.id, { message: REFUND_QUESTION }, withToken("192.0.2.1"))).status).toBe(200);
      expect((await ask(first.id, { message: REFUND_QUESTION }, withToken("192.0.2.2"))).status).toBe(403);
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

    it("records a turn the browser cancelled", async () => {
      const { id, cookie } = await liveKnowledgeAgent();
      const res = await app.fetch(
        new Request(`${BASE}/v1/agents/${id}`, {
          method: "POST",
          body: JSON.stringify({ message: REFUND_QUESTION }),
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `10.0.1.${++ipCounter}`,
            "x-sideagent-key": keyOf(id),
            origin: ORIGIN,
          },
        }),
      );
      const reader = res.body!.getReader();
      await reader.read();
      await reader.cancel();
      await vi.waitFor(async () => {
        const audit = await body<{ events: { event: string; result: string; reason: string | null }[] }>(
          call(`/api/agents/${id}/audit`, {}, cookie),
        );
        expect(audit.events.map((e) => [e.event, e.result, e.reason])).toContainEqual([
          "chat.turn",
          "ok",
          "client_aborted",
        ]);
      });
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
        json: { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m", apiKey: secret },
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
