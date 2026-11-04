import { describe, expect, it } from "vitest";
import { parsePublishableKey } from "../../keys.js";
import {
  BASE,
  LLM_KEY,
  app,
  body,
  call,
  configure,
  create,
  fakeVector,
  fetched,
  logs,
  pg,
  remote,
  responses,
  runIndexing,
  setDeps,
  signIn,
  store,
  deps,
} from "../test/harness.js";

describe("agents API", () => {
  it("requires a session on every route", async () => {
    for (const [method, path] of [
      ["GET", "/api/agents"],
      ["POST", "/api/agents"],
      ["GET", "/api/agents/agt_x"],
      ["PATCH", "/api/agents/agt_x"],
      ["PUT", "/api/agents/agt_x/llm"],
      ["PUT", "/api/agents/agt_x/auth"],
      ["PUT", "/api/agents/agt_x/tracing"],
      ["POST", "/api/agents/agt_x/activate"],
      ["POST", "/api/agents/agt_x/deactivate"],
      ["GET", "/api/agents/agt_x/knowledge"],
      ["POST", "/api/agents/agt_x/knowledge"],
      ["DELETE", "/api/agents/agt_x/knowledge/src_x"],
      ["POST", "/api/agents/agt_x/knowledge/reindex"],
      ["GET", "/api/agents/agt_x/audit"],
      ["GET", "/api/agents/agt_x/traces"],
      ["GET", "/api/agents/agt_x/traces/t"],
      ["POST", "/api/agents/agt_x/preview"],
      ["DELETE", "/api/agents/agt_x/preview/threads"],
      ["DELETE", "/api/agents/agt_x"],
    ]) {
      const res = await call(path!, { method, body: method === "GET" ? undefined : "{}" });
      expect(res.status, `${method} ${path}`).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("creates an inactive agent with a publishable key, and nothing ready", async () => {
    const cookie = await signIn("a@example.com");
    const { agent, readiness } = await body(
      call("/api/agents", { method: "POST", json: { name: "  Invoices assistant " } }, cookie),
    );
    expect(agent).toMatchObject({
      name: "Invoices assistant",
      status: "inactive",
      configVersion: 1,
      llm: null,
    });
    expect(agent.id).toMatch(/^agt_[a-km-np-z2-9]{16}$/);
    expect(parsePublishableKey(agent.publishableKey)).toEqual({ host: "localhost:8787", agentId: agent.id });
    expect(agent.endpoint).toBe(`${BASE}/v1/agents/${agent.id}`);
    expect(readiness.filter((r) => !r.ok).map((r) => r.id)).toEqual(["content", "origins", "llm", "auth"]);
    const second = await create(cookie, "Staging");
    const list = await body<{ agents: { id: string }[] }>(call("/api/agents", {}, cookie));
    expect(new Set(list.agents.map((a) => a.id))).toEqual(new Set([second.id, agent.id]));
  });

  it("rejects bad names", async () => {
    const cookie = await signIn("a@example.com");
    for (const raw of ['{"name":"   "}', "{}", '{"name":42}', "not json", JSON.stringify({ name: "x".repeat(81) })]) {
      const res = await call("/api/agents", { method: "POST", body: raw }, cookie);
      expect(res.status).toBe(400);
      expect((await body<{ error: string }>(res)).error).toBe("invalid_request");
    }
  });

  it("validates general settings and bumps configVersion", async () => {
    const cookie = await signIn("a@example.com");
    const a = await create(cookie);
    const patch = (json: unknown) => call(`/api/agents/${a.id}`, { method: "PATCH", json }, cookie);
    for (const allowedOrigins of [["https://app.example.com/path"], ["http://app.example.com"], ["nope"]]) {
      expect((await patch({ allowedOrigins })).status).toBe(400);
    }
    expect((await patch({ instructions: "x".repeat(8001) })).status).toBe(400);
    expect((await patch({ unknownField: 1 })).status).toBe(400);
    const ok = await body(
      patch({
        name: "Renamed",
        allowedOrigins: ["https://App.example.com", "https://app.example.com", "http://localhost:3000"],
        instructions: "Be brief.",
      }),
    );
    expect(ok.agent).toMatchObject({
      name: "Renamed",
      allowedOrigins: ["https://app.example.com", "http://localhost:3000"],
      instructions: "Be brief.",
      configVersion: 3,
    });
  });

  it("deletes the agent with everything under it and clears the users' threads", async () => {
    const destroyed: string[] = [];
    setDeps({ destroyThreads: async (agentId, userId) => void destroyed.push(`${agentId}|${userId}`) });
    const cookie = await signIn("a@example.com");
    const a = await create(cookie);
    await store.agents.trackUser(a.id, "alice");
    await call(
      `/api/agents/${a.id}/knowledge`,
      { method: "POST", json: { kind: "text", title: "T", content: "x" } },
      cookie,
    );
    expect((await call(`/api/agents/${a.id}`, { method: "DELETE" }, cookie)).status).toBe(204);
    expect((await call(`/api/agents/${a.id}`, {}, cookie)).status).toBe(404);
    expect(destroyed).toEqual([`${a.id}|alice`]);
    for (const table of ["agent", "knowledgeSource", "agentUser"]) {
      expect((await pg.query(`select count(*)::int n from sideagent."${table}"`)).rows).toEqual([{ n: 0 }]);
    }
  });

  describe("status", () => {
    it("activates only when ready, and deactivates and reactivates", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      const notReady = await call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie);
      expect(notReady.status).toBe(409);
      expect(
        (await body<{ readiness: { id: string; ok: boolean }[] }>(notReady)).readiness
          .filter((r) => !r.ok)
          .map((r) => r.id),
      ).toEqual(["content", "origins", "auth"]);
      await configure(cookie, a.id);
      const live = await body(call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie));
      expect(live.agent.status).toBe("active");
      expect(live.readiness.every((r) => r.ok)).toBe(true);
      expect((await body(call(`/api/agents/${a.id}/deactivate`, { method: "POST" }, cookie))).agent.status).toBe(
        "inactive",
      );
      expect((await body(call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie))).agent.status).toBe(
        "active",
      );
    });

    it("needs allowed origins in every mode", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      await configure(cookie, a.id);
      await call(`/api/agents/${a.id}`, { method: "PATCH", json: { allowedOrigins: [] } }, cookie);
      expect((await call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie)).status).toBe(409);
    });

    it("reads a stored backend proxy mode (removed, D-28) as no mode chosen", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      await configure(cookie, a.id);
      await pg.query(
        `update sideagent."agent" set config = jsonb_set(config, '{auth}', '{"mode":"proxy"}') where id = $1`,
        [a.id],
      );
      const detail = await body(call(`/api/agents/${a.id}`, {}, cookie));
      expect(detail.agent.auth).toBeNull();
      expect((await call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie)).status).toBe(409);
    });
  });

  describe("LLM", () => {
    it("starts with no LLM, so the agent is not ready for one", async () => {
      const cookie = await signIn("a@example.com");
      const detail = await body(call("/api/agents", { method: "POST", json: { name: "A" } }, cookie));
      expect(detail.agent.llm).toBeNull();
      expect(detail.readiness.find((r) => r.id === "llm")).toMatchObject({ ok: false, detail: "Not set up" });
    });

    it("refuses the removed built-in provider", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      const res = await call(`/api/agents/${a.id}/llm`, { method: "PUT", json: { provider: "builtin" } }, cookie);
      expect(res.status).toBe(400);
    });

    describe("built-in model (D-18)", () => {
      const builtin = {
        model: "builtin-chat",
        embeddingModel: "builtin-embed",
        models: () => ({}),
        embed: async (texts: string[]) => texts.map(() => new Float32Array(1)),
        consume: async () => ({ allowed: true }),
        usage: async () => ({ month: "2026-11", used: 3, limit: 100 }),
      };

      it("is not offered without a host model: a stored one reads as unavailable", async () => {
        const cookie = await signIn("a@example.com");
        const a = await create(cookie);
        expect(
          (await call(`/api/agents/${a.id}/llm`, { method: "PUT", json: { provider: "builtin" } }, cookie)).status,
        ).toBe(400);
        await pg.query(
          `update sideagent."agent" set config = jsonb_set(config, '{llm}', '{"provider":"builtin"}') where id = $1`,
          [a.id],
        );
        const detail = await body(call(`/api/agents/${a.id}`, {}, cookie));
        expect(detail.builtin).toBeUndefined();
        expect(detail.readiness.find((r) => r.id === "llm")).toMatchObject({ ok: false });
      });

      it("starts new agents on it, shows its use, and switches back and forth keeping the custom key", async () => {
        setDeps({ builtin });
        const cookie = await signIn("a@example.com");
        const fresh = await body(call("/api/agents", { method: "POST", json: { name: "A" } }, cookie));
        expect(fresh.agent.llm).toEqual({ provider: "builtin" });
        expect(fresh.builtin).toEqual({
          model: "builtin-chat",
          embeddingModel: "builtin-embed",
          usage: { month: "2026-11", used: 3, limit: 100 },
        });
        expect(fresh.readiness.find((r) => r.id === "llm")).toMatchObject({
          ok: true,
          detail: "Built-in (builtin-chat)",
        });
        const put = (json: unknown) => call(`/api/agents/${fresh.agent.id}/llm`, { method: "PUT", json }, cookie);
        const custom = { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m", apiKey: LLM_KEY };
        expect((await body(put(custom))).agent.llmKey).toEqual({ last4: LLM_KEY.slice(-4) });
        const back = await body(put({ provider: "builtin" }));
        expect(back.agent.llm).toEqual({ provider: "builtin" });
        expect(back.agent.llmKey).toEqual({ last4: LLM_KEY.slice(-4) });
      });

      it("reads rows from before the provider tag as custom", async () => {
        const cookie = await signIn("a@example.com");
        const a = await create(cookie);
        await pg.query(
          `update sideagent."agent" set config = jsonb_set(config, '{llm}', '{"baseUrl":"https://llm.example.com/v1","model":"m"}') where id = $1`,
          [a.id],
        );
        expect((await body(call(`/api/agents/${a.id}`, {}, cookie))).agent.llm).toEqual({
          provider: "custom",
          baseUrl: "https://llm.example.com/v1",
          model: "m",
          embeddingModel: "text-embedding-3-small",
        });
      });
    });

    it("seals the key and only ever returns its last 4 characters", async () => {
      const cookie = await signIn("a@example.com");
      const a = (await body(call("/api/agents", { method: "POST", json: { name: "A" } }, cookie))).agent;
      const put = (json: unknown) => call(`/api/agents/${a.id}/llm`, { method: "PUT", json }, cookie);
      const custom = { provider: "custom" as const, baseUrl: "https://llm.example.com/v1", model: "gpt-4o-mini" };
      expect((await body<{ fields: object }>(put(custom))).fields).toHaveProperty("apiKey");
      expect((await put({ ...custom, baseUrl: "https://llm.private.example", apiKey: LLM_KEY })).status).toBe(400);
      expect((await put({ ...custom, provider: "openai", apiKey: LLM_KEY })).status).toBe(400);
      const saved = await body(put({ ...custom, apiKey: LLM_KEY }));
      expect(saved.agent.llm).toEqual({ ...custom, embeddingModel: "text-embedding-3-small" });
      expect(saved.agent.llmKey).toEqual({ last4: LLM_KEY.slice(-4) });
      expect((await body(put({ ...custom, model: "gpt-4.1" }))).agent.llm).toMatchObject({ model: "gpt-4.1" });
      const rows = (await pg.query(`select * from sideagent."agent" where id = $1`, [a.id])).rows;
      expect(JSON.stringify(rows)).not.toContain(LLM_KEY);
      await call(`/api/agents/${a.id}`, {}, cookie);
      expect(responses.join("\n")).not.toContain(LLM_KEY);
      expect(logs.join("\n")).not.toContain(LLM_KEY);
    });

    it("re-indexes knowledge when embeddings move to another provider or model", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      await call(
        `/api/agents/${a.id}/knowledge`,
        { method: "POST", json: { kind: "text", title: "Refunds", content: "Refund policy." } },
        cookie,
      );
      await runIndexing(a.id);
      const status = async () => (await store.knowledge.listSources(a.id))[0]!.status;
      expect(await status()).toBe("indexed");
      const custom = {
        provider: "custom" as const,
        baseUrl: "https://llm.example.com/v1",
        model: "m",
        embeddingModel: "embed-2",
        apiKey: LLM_KEY,
      };
      // Hold the background indexer so the queued state is visible.
      const held: Promise<unknown>[] = [];
      setDeps({ background: (w) => void held.push(w()) });
      await call(`/api/agents/${a.id}/llm`, { method: "PUT", json: custom }, cookie);
      expect(["pending", "indexing", "failed"]).toContain(await status());
      await Promise.all(held);
      // Same embeddings: only the chat model changed.
      held.length = 0;
      await call(
        `/api/agents/${a.id}/llm`,
        { method: "PUT", json: { ...custom, model: "other", apiKey: undefined } },
        cookie,
      );
      expect(held).toHaveLength(0);
    });
  });

  describe("knowledge", () => {
    it("adds pasted text and web pages, indexes them and searches by meaning", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      const add = (json: unknown) => call(`/api/agents/${a.id}/knowledge`, { method: "POST", json }, cookie);
      const text = await add({ kind: "text", title: "Refund policy", content: "# Refunds\n\nRefunds take 5 days." });
      expect(text.status).toBe(201);
      expect((await body<{ source: { status: string; kind: string } }>(text)).source).toMatchObject({
        kind: "text",
        status: "pending",
      });
      remote["https://help.example.com/shipping"] = () =>
        new Response(
          "<html><title>Shipping help</title><body><h1>Shipping</h1><p>Shipping is free over $50.</p></body></html>",
          {
            headers: { "content-type": "text/html" },
          },
        );
      expect((await add({ kind: "url", url: "https://help.example.com/shipping" })).status).toBe(201);
      expect(fetched).toEqual([]); // fetched by the indexer, not the request

      await runIndexing(a.id);
      const { sources } = await body<{
        sources: { title: string; status: string; chunks: number; indexedAt: string | null }[];
      }>(call(`/api/agents/${a.id}/knowledge`, {}, cookie));
      expect(sources.map((s) => [s.title, s.status])).toEqual(
        expect.arrayContaining([
          ["Refund policy", "indexed"],
          ["Shipping help", "indexed"],
        ]),
      );
      expect(sources.every((s) => s.chunks > 0 && s.indexedAt)).toBe(true);

      const [best] = await store.knowledge.search(a.id, await fakeVector("shipping"), 4);
      expect(best!.meta).toMatchObject({ title: "Shipping help", url: "https://help.example.com/shipping" });
      expect(best!.text).toContain("free over $50");
      const detail = await body(call(`/api/agents/${a.id}`, {}, cookie));
      expect(detail.agent.knowledge).toMatchObject({ sources: 2, indexed: 2, pending: 0 });
    });

    it("rejects blocked URLs before storing them, and validates text", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      const add = (json: unknown) => call(`/api/agents/${a.id}/knowledge`, { method: "POST", json }, cookie);
      for (const url of [
        "https://intranet.example.local/faq",
        "https://faq.private.example/",
        "http://help.example.com",
        "https://10.0.0.1/",
      ]) {
        const res = await add({ kind: "url", url });
        expect(res.status, url).toBe(400);
        expect(Object.keys((await body<{ fields: object }>(res)).fields)).toEqual(["url"]);
      }
      expect((await add({ kind: "text", title: "", content: "x" })).status).toBe(400);
      expect((await add({ kind: "text", title: "T", content: "   " })).status).toBe(400);
      expect((await add({ kind: "text", title: "T", content: "x".repeat(200_001) })).status).toBe(400);
      expect((await add({ kind: "file", title: "T" })).status).toBe(400);
      await add({ kind: "url", url: "https://help.example.com/a" });
      expect((await add({ kind: "url", url: "https://help.example.com/a" })).status).toBe(400);
      expect(fetched).toEqual([]);
      expect(await store.knowledge.listSources(a.id)).toHaveLength(1);
    });

    it("records indexing failures per source and removes sources with their chunks", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      const add = (json: unknown) => call(`/api/agents/${a.id}/knowledge`, { method: "POST", json }, cookie);
      remote["https://help.example.com/moved"] = () =>
        new Response(null, { status: 302, headers: { location: "https://evil.example.com/" } });
      await add({ kind: "url", url: "https://help.example.com/moved" });
      const ok = await body<{ source: { id: string } }>(
        add({ kind: "text", title: "Invoices", content: "Invoice numbering." }),
      );
      await runIndexing(a.id);
      const sources = await store.knowledge.listSources(a.id);
      expect(sources.find((s) => s.kind === "url")).toMatchObject({
        status: "failed",
        error: "Redirects to another host are refused.",
      });
      expect(sources.find((s) => s.kind === "text")?.status).toBe("indexed");
      expect(fetched).not.toContain("https://evil.example.com/");
      expect((await call(`/api/agents/${a.id}/knowledge/${ok.source.id}`, { method: "DELETE" }, cookie)).status).toBe(
        204,
      );
      expect((await call(`/api/agents/${a.id}/knowledge/${ok.source.id}`, { method: "DELETE" }, cookie)).status).toBe(
        404,
      );
      expect(await store.knowledge.search(a.id, await fakeVector("invoice"), 4)).toEqual([]);
      const detail = await body(call(`/api/agents/${a.id}`, {}, cookie));
      expect(detail.readiness.find((r) => r.id === "content")).toMatchObject({
        ok: false,
        detail: "Add instructions or knowledge (1 source failed to index)",
      });
      expect(
        (await body<{ queued: number }>(call(`/api/agents/${a.id}/knowledge/reindex`, { method: "POST" }, cookie)))
          .queued,
      ).toBe(1);
    });

    it("lets a knowledge-only agent go live", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      await call(
        `/api/agents/${a.id}/knowledge`,
        { method: "POST", json: { kind: "text", title: "FAQ", content: "Answers." } },
        cookie,
      );
      await call(
        `/api/agents/${a.id}`,
        { method: "PATCH", json: { allowedOrigins: ["https://app.example.com"] } },
        cookie,
      );
      expect(
        (await call(`/api/agents/${a.id}/auth`, { method: "PUT", json: { mode: "anonymous" } }, cookie)).status,
      ).toBe(200);
      const live = await call(`/api/agents/${a.id}/activate`, { method: "POST" }, cookie);
      expect(live.status).toBe(200);
      expect((await body(live)).agent).toMatchObject({ status: "active" });
    });
  });

  describe("scope", () => {
    it("shares one workspace between signed-in users by default", async () => {
      setDeps({ scope: undefined });
      const alice = await signIn("alice@example.com");
      const bob = await signIn("bob@example.com");
      const a = await create(alice, "Shared agent");
      const seen = await body<{ agents: { id: string }[] }>(call("/api/agents", {}, bob));
      expect(seen.agents.map((x) => x.id)).toEqual([a.id]);
      expect((await call(`/api/agents/${a.id}`, {}, bob)).status).toBe(200);
    });

    it("groups users by the host's scope hook", async () => {
      setDeps({ scope: (user) => (user.email?.endsWith("@acme.test") ? "acme" : user.id) });
      const alice = await signIn("alice@acme.test");
      const bob = await signIn("bob@acme.test");
      const eve = await signIn("eve@other.test");
      const a = await create(alice, "Acme agent");
      expect((await call(`/api/agents/${a.id}`, {}, bob)).status).toBe(200);
      expect((await call(`/api/agents/${a.id}`, {}, eve)).status).toBe(404);
    });
  });

  describe("security invariants", () => {
    it("hides another integrator's agent behind the same 404 on every route", async () => {
      const alice = await signIn("alice@example.com");
      const bob = await signIn("bob@example.com");
      const a = await create(alice, "Alice's agent");
      await configure(alice, a.id);
      const aliceSource = await body<{ source: { id: string } }>(
        call(
          `/api/agents/${a.id}/knowledge`,
          { method: "POST", json: { kind: "text", title: "Alice", content: "Private." } },
          alice,
        ),
      );
      const before = await body(call(`/api/agents/${a.id}`, {}, alice));
      expect((await body<{ agents: [] }>(call("/api/agents", {}, bob))).agents).toEqual([]);
      const routes: [string, string, unknown?][] = [
        ["GET", ""],
        ["PATCH", "", { name: "Taken" }],
        [
          "PUT",
          "/llm",
          { provider: "custom", baseUrl: "https://llm.example.com", model: "m", apiKey: "sk-bob-0000000000" },
        ],
        ["GET", "/knowledge"],
        ["POST", "/knowledge", { kind: "text", title: "Bob", content: "Planted." }],
        ["DELETE", `/knowledge/${aliceSource.source.id}`],
        ["POST", "/knowledge/reindex"],
        ["PUT", "/auth", { mode: "anonymous" }],
        ["PUT", "/tracing", { level: "full" }],
        ["POST", "/activate"],
        ["POST", "/deactivate"],
        ["GET", "/audit"],
        ["GET", "/traces"],
        ["GET", "/traces/t1"],
        ["POST", "/preview"],
        ["DELETE", "/preview/threads"],
        ["DELETE", ""],
      ];
      for (const [method, suffix, json] of routes) {
        const foreign = await call(`/api/agents/${a.id}${suffix}`, { method, json }, bob);
        const missing = await call(`/api/agents/agt_doesnotexist0000${suffix}`, { method, json }, bob);
        expect(foreign.status, `${method} ${suffix}`).toBe(404);
        expect(await foreign.json()).toEqual(await missing.json());
      }
      expect(await body(call(`/api/agents/${a.id}`, {}, alice))).toEqual(before);
    });

    it("refuses writes from another origin", async () => {
      const cookie = await signIn("a@example.com");
      const crossSite = await call(
        "/api/agents",
        { method: "POST", json: { name: "x" }, headers: { origin: "https://evil.example" } },
        cookie,
      );
      expect(crossSite.status).toBe(403);
      const noOrigin = await app.fetch(
        new Request(`${BASE}/api/agents`, { method: "POST", body: '{"name":"x"}', headers: { cookie } }),
      );
      expect(noOrigin.status).toBe(403);
      expect((await body<{ agents: [] }>(call("/api/agents", {}, cookie))).agents).toEqual([]);
    });

    it("never leaks a stack trace or secret on an internal error", async () => {
      const cookie = await signIn("a@example.com");
      const a = await create(cookie);
      setDeps({ secrets: { CONFIG_KEK: "" } });
      const res = await call(
        `/api/agents/${a.id}/llm`,
        {
          method: "PUT",
          json: { provider: "custom", baseUrl: "https://llm.example.com/v1", model: "m", apiKey: LLM_KEY },
        },
        cookie,
      );
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "internal" });
      expect(logs.join("\n")).not.toContain(LLM_KEY);
    });
  });
});
