// Behaviour every AdminStore must have. A new dialect runs this against its own store:
//   runStoreContract("sqlite", async () => ({ store, reset }))
import { beforeEach, describe, expect, it } from "vitest";
import { emptyConfig } from "../config.js";
import type { AdminStore, AgentRecord } from "./types.js";

export const agentRecord = (over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: "agt_a",
  ownerId: "u1",
  name: "A",
  status: "draft",
  disabledAt: null,
  configVersion: 1,
  config: emptyConfig(),
  llmKeySealed: null,
  llmKeyLast4: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const unit = (...v: number[]) => v;
const trace = (at: string, level: "metadata" | "full" = "metadata") => ({
  at,
  userId: "u9",
  threadId: null,
  level,
  status: "ok" as const,
  durationMs: 5,
  llmCalls: 1,
  toolCalls: 0,
  inputTokens: null,
  outputTokens: null,
  spans: [],
});

export function runStoreContract(name: string, open: () => Promise<{ store: AdminStore; reset: () => Promise<void> }>) {
  describe(`AdminStore contract: ${name}`, () => {
    let store: AdminStore;
    beforeEach(async () => {
      const opened = await open();
      store = opened.store;
      await opened.reset();
    });

    it("migrates twice without error", async () => {
      await store.migrate();
      await store.migrate();
    });

    describe("agents", () => {
      it("lists newest first, only the owner's", async () => {
        await store.agents.create(agentRecord({ id: "agt_old", createdAt: new Date("2026-01-01") }));
        await store.agents.create(agentRecord({ id: "agt_new", createdAt: new Date("2026-02-01") }));
        await store.agents.create(agentRecord({ id: "agt_x", ownerId: "u2" }));
        expect((await store.agents.list("u1")).map((a) => a.id)).toEqual(["agt_new", "agt_old"]);
      });

      it("treats another owner's agent as missing (D-9)", async () => {
        await store.agents.create(agentRecord());
        expect(await store.agents.getOwned("u2", "agt_a")).toBeNull();
        expect(await store.agents.update("u2", "agt_a", { name: "Hacked" })).toBeNull();
        expect(await store.agents.remove("u2", "agt_a")).toBeNull();
        expect((await store.agents.get("agt_a"))?.name).toBe("A");
      });

      it("bumps configVersion on every update", async () => {
        await store.agents.create(agentRecord());
        const one = await store.agents.update("u1", "agt_a", { name: "B" });
        const two = await store.agents.update("u1", "agt_a", { status: "active" });
        expect([one?.configVersion, two?.configVersion]).toEqual([2, 3]);
        expect(two).toMatchObject({ name: "B", status: "active" });
      });

      it("round-trips the config", async () => {
        const config = { ...emptyConfig(), allowedOrigins: ["https://a.example"], instructions: "hi" };
        await store.agents.create(agentRecord({ config }));
        expect((await store.agents.get("agt_a"))?.config).toEqual(config);
      });

      it("removes the agent with everything under it and names its users", async () => {
        await store.agents.create(agentRecord());
        await store.agents.trackUser("agt_a", "alice");
        await store.agents.trackUser("agt_a", "alice");
        await store.agents.trackUser("agt_a", "bob");
        await store.knowledge.addSource("agt_a", { kind: "text", title: "T", content: "x" });
        await store.audit.recordEvent({ agentId: "agt_a", event: "chat.turn", result: "ok" });
        const gone = await store.agents.remove("u1", "agt_a");
        expect(gone?.userIds.sort()).toEqual(["alice", "bob"]);
        expect(await store.agents.get("agt_a")).toBeNull();
        expect((await store.audit.listEvents("agt_a", { range: "30d", page: 1 })).total).toBe(0);
        expect(await store.knowledge.counts("agt_a")).toMatchObject({ sources: 0 });
      });
    });

    describe("usage", () => {
      const now = new Date("2026-03-15T12:00:00Z");

      it("never overshoots under concurrency", async () => {
        await store.agents.create(agentRecord());
        const results = await Promise.all(Array.from({ length: 10 }, () => store.usage.consumeAnon("agt_a", 4, now)));
        expect(results.filter((r) => r.allowed)).toHaveLength(4);
        expect(await store.usage.anonUsed("agt_a", now)).toBe(4);
      });

      it("refuses at a zero cap", async () => {
        await store.agents.create(agentRecord());
        expect((await store.usage.consumeAnon("agt_a", 0, now)).allowed).toBe(false);
      });

      it("counts anonymous messages per agent per day", async () => {
        await store.agents.create(agentRecord());
        await store.usage.consumeAnon("agt_a", 2, now);
        await store.usage.consumeAnon("agt_a", 2, now);
        expect((await store.usage.consumeAnon("agt_a", 2, now)).allowed).toBe(false);
        expect(await store.usage.anonUsed("agt_a", now)).toBe(2);
        expect(await store.usage.anonUsed("agt_a", new Date("2026-03-16T00:00:00Z"))).toBe(0);
      });
    });

    describe("audit and traces", () => {
      const now = new Date("2026-03-15T12:00:00Z");
      beforeEach(async () => {
        await store.agents.create(agentRecord());
      });

      it("filters events and links a turn to its trace", async () => {
        await store.audit.recordEvent(
          { id: "t1", agentId: "agt_a", event: "chat.turn", result: "ok", userId: "u9", durationMs: 12.6 },
          now,
        );
        await store.audit.recordEvent({ agentId: "agt_a", event: "auth", result: "denied", reason: "bad_token" }, now);
        await store.audit.recordTrace("agt_a", trace(now.toISOString()), "t1", now);
        const all = await store.audit.listEvents("agt_a", { range: "24h", page: 1 }, now);
        expect(all.total).toBe(2);
        expect(all.events.find((e) => e.id === "t1")).toMatchObject({ durationMs: 13, traceId: "t1" });
        expect(
          (await store.audit.listEvents("agt_a", { range: "24h", page: 1, result: "denied" }, now)).events,
        ).toHaveLength(1);
        expect((await store.audit.listEvents("agt_a", { range: "24h", page: 1, user: "u9" }, now)).events).toHaveLength(
          1,
        );
      });

      it("hides events outside the range", async () => {
        await store.audit.recordEvent(
          { agentId: "agt_a", event: "chat.turn", result: "ok" },
          new Date("2026-03-10T00:00:00Z"),
        );
        expect((await store.audit.listEvents("agt_a", { range: "24h", page: 1 }, now)).total).toBe(0);
        expect((await store.audit.listEvents("agt_a", { range: "7d", page: 1 }, now)).total).toBe(1);
      });

      it("counts this window and the one before it, leaving previews out", async () => {
        await store.agents.create(agentRecord({ id: "agt_b" }));
        const at = (iso: string) => new Date(iso);
        const ev = (input: Partial<Parameters<typeof store.audit.recordEvent>[0]>, when: string) =>
          store.audit.recordEvent({ agentId: "agt_a", event: "chat.turn", result: "ok", ...input }, at(when));
        await ev({ durationMs: 100 }, "2026-03-15T11:00:00Z");
        await ev({ durationMs: 300 }, "2026-03-14T00:00:00Z");
        await ev({ durationMs: 200 }, "2026-03-12T00:00:00Z");
        await ev({ result: "error", reason: "llm_error", durationMs: 9000 }, "2026-03-13T00:00:00Z");
        await ev({ event: "request", result: "denied", reason: "origin_not_allowed" }, "2026-03-13T00:00:00Z");
        await ev({ result: "limited", reason: "anon_daily_cap_reached" }, "2026-03-13T00:00:00Z");
        await ev({ event: "preview.turn", durationMs: 1 }, "2026-03-15T11:00:00Z");
        await ev({ event: "preview.request", result: "denied" }, "2026-03-15T11:00:00Z");
        await ev({ durationMs: 50 }, "2026-03-05T00:00:00Z"); // previous week
        await ev({ durationMs: 50 }, "2026-02-20T00:00:00Z"); // older than both windows
        await store.audit.recordEvent({ agentId: "agt_b", event: "chat.turn", result: "ok" }, now);
        const week = await store.audit.stats("agt_a", "7d", now);
        expect(week).toEqual({
          range: "7d",
          current: { turns: 5, ok: 3, errors: 1, refused: 1, limited: 1, medianMs: 200 },
          previous: { turns: 1, ok: 1, errors: 0, refused: 0, limited: 0, medianMs: 50 },
        });
        expect((await store.audit.stats("agt_a", "24h", now)).current).toEqual({
          turns: 1,
          ok: 1,
          errors: 0,
          refused: 0,
          limited: 0,
          medianMs: 100,
        });
        expect((await store.audit.stats("agt_c", "7d", now)).current).toMatchObject({ turns: 0, medianMs: null });
      });

      it("keeps traces by level and hides expired ones", async () => {
        await store.audit.recordTrace("agt_a", trace("2026-03-15T11:00:00Z"), "fresh", now);
        await store.audit.recordTrace("agt_a", trace("2026-03-07T00:00:00Z"), "old-meta", now);
        await store.audit.recordTrace("agt_a", trace("2026-03-11T00:00:00Z", "full"), "old-full", now);
        const page = await store.audit.listTraces("agt_a", { page: 1 }, now);
        expect(page.traces.map((x) => x.id)).toEqual(["fresh"]);
        expect(await store.audit.getTrace("agt_a", "old-meta", now)).toBeNull();
        expect(await store.audit.getTrace("agt_a", "fresh", now)).toMatchObject({ id: "fresh", spans: [] });
      });

      it("never reads another agent's trace", async () => {
        await store.agents.create(agentRecord({ id: "agt_b" }));
        await store.audit.recordTrace("agt_a", trace(now.toISOString()), "t", now);
        expect(await store.audit.getTrace("agt_b", "t", now)).toBeNull();
      });
    });

    describe("knowledge", () => {
      beforeEach(async () => {
        await store.agents.create(agentRecord());
        await store.agents.create(agentRecord({ id: "agt_b", ownerId: "u2" }));
      });

      const index = async (agentId: string, id: string, vectors: number[][], embedKey: string | null = "m1") =>
        store.knowledge.saveIndexed(agentId, id, {
          title: "Indexed",
          bytes: 10,
          embedKey,
          texts: vectors.map((_, i) => `chunk ${i}`),
          vectors,
        });

      it("queues, claims once, indexes and counts", async () => {
        const s = await store.knowledge.addSource("agt_a", { kind: "url", title: "Doc", url: "https://x.example/d" });
        expect(s).toMatchObject({ status: "pending", url: "https://x.example/d" });
        const first = await store.knowledge.claimPending("agt_a");
        expect(first.map((q) => q.id)).toEqual([s.id]);
        expect(await store.knowledge.hasPending("agt_a")).toBe(true);
        expect(await index("agt_a", s.id, [unit(1, 0), unit(0, 1)])).toBe(true);
        expect(await store.knowledge.hasPending("agt_a")).toBe(false);
        expect(await store.knowledge.counts("agt_a")).toEqual({
          sources: 1,
          indexed: 1,
          pending: 0,
          failed: 0,
          chunks: 2,
        });
        expect((await store.knowledge.listSources("agt_a"))[0]).toMatchObject({
          status: "indexed",
          chunks: 2,
          title: "Indexed",
        });
      });

      it("records a failure on the source", async () => {
        const s = await store.knowledge.addSource("agt_a", { kind: "text", title: "T", content: "x" });
        await store.knowledge.markFailed("agt_a", s.id, "No text found.");
        expect(await store.knowledge.counts("agt_a")).toMatchObject({ failed: 1 });
        expect((await store.knowledge.listSources("agt_a"))[0]).toMatchObject({
          status: "failed",
          error: "No text found.",
        });
      });

      it("drops an index result for a source removed meanwhile", async () => {
        const s = await store.knowledge.addSource("agt_a", { kind: "text", title: "T", content: "x" });
        expect(await store.knowledge.removeSource("agt_a", s.id)).toBe(true);
        expect(await index("agt_a", s.id, [unit(1, 0)])).toBe(false);
        expect(await store.knowledge.search("agt_a", unit(1, 0), 5)).toEqual([]);
      });

      it("removes a source only under its own agent", async () => {
        const s = await store.knowledge.addSource("agt_a", { kind: "text", title: "T", content: "x" });
        expect(await store.knowledge.removeSource("agt_b", s.id)).toBe(false);
        expect(await store.knowledge.removeSource("agt_a", s.id)).toBe(true);
      });

      it("ranks by cosine similarity and stays inside the agent", async () => {
        const a = await store.knowledge.addSource("agt_a", { kind: "text", title: "A", content: "x" });
        const b = await store.knowledge.addSource("agt_b", { kind: "text", title: "B", content: "x" });
        await index("agt_a", a.id, [unit(1, 0), unit(0.8, 0.6), unit(0, 1)]);
        await index("agt_b", b.id, [unit(1, 0)]);
        const hits = await store.knowledge.search("agt_a", unit(1, 0), 2);
        expect(hits.map((h) => h.text)).toEqual(["chunk 0", "chunk 1"]);
        expect(hits[0]!.score).toBeCloseTo(1, 5);
        expect(hits[1]!.score).toBeCloseTo(0.8, 5);
        expect(hits[0]!.meta).toMatchObject({ sourceId: a.id, title: "Indexed" });
        expect(await store.knowledge.search("agt_a", unit(1, 0), 0)).toEqual([]);
      });

      it("skips vectors of another size or another embedding model (D-30)", async () => {
        const a = await store.knowledge.addSource("agt_a", { kind: "text", title: "A", content: "x" });
        const b = await store.knowledge.addSource("agt_a", { kind: "text", title: "B", content: "x" });
        await index("agt_a", a.id, [unit(1, 0)], "m1");
        await index("agt_a", b.id, [unit(1, 0, 0)], "m2");
        expect(await store.knowledge.search("agt_a", unit(1, 0), 5)).toHaveLength(1);
        expect(await store.knowledge.search("agt_a", unit(1, 0, 0), 5, "m2")).toHaveLength(1);
        expect(await store.knowledge.search("agt_a", unit(1, 0), 5, "m2")).toHaveLength(0);
        expect(await store.knowledge.isStale("agt_a", "m1")).toBe(true);
        expect(await store.knowledge.isStale("agt_a", "m1x")).toBe(true);
      });

      it("counts chunks outside a source, and re-queues everything on markAllPending", async () => {
        const a = await store.knowledge.addSource("agt_a", { kind: "text", title: "A", content: "x" });
        const b = await store.knowledge.addSource("agt_a", { kind: "text", title: "B", content: "x" });
        await index("agt_a", a.id, [unit(1, 0), unit(0, 1)]);
        await index("agt_a", b.id, [unit(1, 1)]);
        expect(await store.knowledge.chunksOutside("agt_a", a.id)).toBe(1);
        expect(await store.knowledge.markAllPending("agt_a")).toBe(2);
        expect(await store.knowledge.counts("agt_a")).toMatchObject({ pending: 2, indexed: 0 });
        expect(await store.knowledge.search("agt_a", unit(1, 0), 5)).not.toHaveLength(0);
      });
    });
  });
}

export function runThreadContract(
  name: string,
  open: () => Promise<{ store: AdminStore; reset: () => Promise<void> }>,
) {
  describe(`ThreadStorage contract: ${name}`, () => {
    let store: AdminStore;
    beforeEach(async () => {
      const opened = await open();
      store = opened.store;
      await opened.reset();
      await store.agents.create(agentRecord());
      await store.agents.create(agentRecord({ id: "agt_b" }));
    });
    const cp = (threadId: string, checkpointId: string, parentId: string | null = null) => ({
      threadId,
      ns: "",
      checkpointId,
      parentId,
      type: "json",
      checkpoint: "cp",
      metadata: "md",
    });
    const wr = (threadId: string, checkpointId: string, idx: number, value: string) => ({
      threadId,
      ns: "",
      checkpointId,
      taskId: "t",
      idx,
      channel: "c",
      taskPath: "",
      type: "json",
      value,
    });

    it("lists a user's threads, newest first, and never another user's", async () => {
      await store.threads.touch("agt_a", "alice", "t1", "First", 1);
      await store.threads.touch("agt_a", "alice", "t2", "Second", 2);
      await store.threads.touch("agt_a", "bob", "t3", "Bob's", 3);
      expect((await store.threads.list("agt_a", "alice")).map((t) => t.id)).toEqual(["t2", "t1"]);
      expect(await store.threads.has("agt_a", "alice", "t3")).toBe(false);
      expect(await store.threads.has("agt_a", "bob", "t3")).toBe(true);
    });

    it("keeps the title on touch and cannot take over another user's thread", async () => {
      await store.threads.touch("agt_a", "alice", "t1", "Original", 1);
      await store.threads.touch("agt_a", "alice", "t1", "Changed", 5);
      await store.threads.touch("agt_a", "bob", "t1", "Stolen", 9);
      expect(await store.threads.list("agt_a", "alice")).toEqual([{ id: "t1", title: "Original", updatedAt: 5 }]);
      expect(await store.threads.list("agt_a", "bob")).toEqual([]);
    });

    it("stores checkpoints with their writes, newest first, and replaces on conflict", async () => {
      await store.threads.putCheckpoint("agt_a", cp("t1", "001"));
      await store.threads.putCheckpoint("agt_a", cp("t1", "002", "001"));
      await store.threads.putWrites("agt_a", [wr("t1", "002", 0, "first"), wr("t1", "002", 1, "second")]);
      await store.threads.putWrites("agt_a", [wr("t1", "002", 0, "ignored"), wr("t1", "002", -1, "special")]);
      await store.threads.putWrites("agt_a", [wr("t1", "002", -1, "special2")]);
      const latest = await store.threads.getCheckpoint("agt_a", "t1", "", null);
      expect(latest).toMatchObject({ checkpointId: "002", parentId: "001" });
      expect(latest!.writes.map((w) => [w.idx, w.value]).sort()).toEqual([
        [-1, "special2"],
        [0, "first"],
        [1, "second"],
      ]);
      expect((await store.threads.getCheckpoint("agt_a", "t1", "", "001"))?.writes).toEqual([]);
      expect((await store.threads.listCheckpoints("agt_a", "t1", {})).map((c) => c.checkpointId)).toEqual([
        "002",
        "001",
      ]);
      expect(
        (await store.threads.listCheckpoints("agt_a", "t1", { before: "002" })).map((c) => c.checkpointId),
      ).toEqual(["001"]);
      expect(await store.threads.getCheckpoint("agt_b", "t1", "", null)).toBeNull();
    });

    it("deletes a thread with its checkpoints, only for its owner", async () => {
      await store.threads.touch("agt_a", "alice", "t1", "T", 1);
      await store.threads.putCheckpoint("agt_a", cp("t1", "001"));
      await store.threads.putWrites("agt_a", [wr("t1", "001", 0, "v")]);
      await store.threads.delete("agt_a", "bob", "t1");
      expect(await store.threads.has("agt_a", "alice", "t1")).toBe(true);
      await store.threads.delete("agt_a", "alice", "t1");
      expect(await store.threads.has("agt_a", "alice", "t1")).toBe(false);
      expect(await store.threads.getCheckpoint("agt_a", "t1", "", null)).toBeNull();
    });

    it("destroys one user's data and the agent's delete takes the rest", async () => {
      await store.threads.touch("agt_a", "alice", "t1", "T", 1);
      await store.threads.touch("agt_a", "bob", "t2", "T", 1);
      await store.threads.putCheckpoint("agt_a", cp("t1", "001"));
      await store.threads.putCheckpoint("agt_a", cp("t2", "001"));
      await store.threads.destroyUser("agt_a", "alice");
      expect(await store.threads.list("agt_a", "alice")).toEqual([]);
      expect(await store.threads.getCheckpoint("agt_a", "t1", "", null)).toBeNull();
      expect(await store.threads.getCheckpoint("agt_a", "t2", "", null)).not.toBeNull();
      await store.agents.remove("u1", "agt_a");
      expect(await store.threads.getCheckpoint("agt_a", "t2", "", null)).toBeNull();
    });
  });
}
