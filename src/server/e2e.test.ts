import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mockLlmHandler } from "../testing/mock-llm.js";
import type { AgentEvent } from "../protocol.js";
import { createAgent, type Agent, type AuditEvent } from "./index.js";

const ORIGIN = "https://app.example.com";
const spec = {
  openapi: "3.0.3",
  info: { title: "t", version: "1" },
  paths: {
    "/invoices": {
      get: {
        operationId: "listInvoices",
        summary: "List invoices",
        "x-agent": { responseFields: ["id", "customer", "amount"] },
        responses: { "200": { description: "ok" } },
      },
      post: {
        operationId: "createInvoice",
        summary: "Create invoice",
        "x-agent": { invalidates: ["invoices"] },
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { customer: { type: "string" }, amount: { type: "number" } },
                required: ["customer", "amount"],
              },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
    "/invoices/{id}": {
      delete: {
        operationId: "deleteInvoice",
        summary: "Delete",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

const invoices: any[] = [{ id: "1", customer: "Acme", amount: 5, internalNote: "secret margin" }];
const seenAuth: (string | undefined)[] = [];
const apiHits: string[] = [];

function listen(
  handler: (req: IncomingMessage, body: string) => { status: number; body: unknown } | Promise<Response>,
): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const out = await handler(req, body);
      if (out instanceof Response) {
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(Buffer.from(await out.arrayBuffer()));
      } else {
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.body));
      }
    }).listen(0, "127.0.0.1", () => resolve(s));
  });
}
const port = (s: Server) => (s.address() as AddressInfo).port;

let api: Server, llm: Server, agent: Agent;
const audits: AuditEvent[] = [];

beforeAll(async () => {
  api = await listen((req, body) => {
    seenAuth.push(req.headers.authorization);
    apiHits.push(`${req.method} ${req.url}`);
    if (req.method === "GET") return { status: 200, body: invoices };
    if (req.method === "POST") {
      const inv = { id: String(invoices.length + 1), ...JSON.parse(body) };
      invoices.push(inv);
      return { status: 200, body: inv };
    }
    return { status: 200, body: { deleted: true } };
  });
  llm = await listen(async (req, body) =>
    mockLlmHandler(new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } })),
  );
  agent = await createAgent({
    spec,
    baseUrl: `http://127.0.0.1:${port(api)}`,
    allowPrivateNetworks: true,
    llm: { baseUrl: `http://127.0.0.1:${port(llm)}/v1`, apiKey: "test", model: "mock" },
    allow: ["listInvoices", "createInvoice"],
    allowedOrigins: [ORIGIN],
    approvalSecret: "test-secret-test-secret",
    getAuth: (req) => {
      const auth = req.headers.get("authorization") ?? "";
      return { userId: auth.replace("Bearer ", "") || "anon", headers: { authorization: auth } };
    },
    onAudit: (e) => void audits.push(e),
  });
});
afterAll(() => {
  api.close();
  llm.close();
});

async function chat(body: unknown, opts: { user?: string; origin?: string | null; method?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${opts.user ?? "u1"}`,
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  const res = await agent.handler(
    new Request("http://localhost/agent", { method: opts.method ?? "POST", headers, body: JSON.stringify(body) }),
  );
  const events: AgentEvent[] = [];
  if (res.headers.get("content-type")?.includes("event-stream")) {
    for (const block of (await res.text()).split("\n\n"))
      if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  }
  return { res, events };
}
const of = <T extends AgentEvent["type"]>(events: AgentEvent[], t: T) =>
  events.filter((e) => e.type === t) as Extract<AgentEvent, { type: T }>[];

describe("happy paths", () => {
  it("runs a read call without approval, forwards auth, filters fields", async () => {
    const { events } = await chat({ message: "list my invoices" });
    const done = of(events, "tool.complete")[0]!;
    expect(done.operationId).toBe("listInvoices");
    expect(JSON.stringify(done.result)).not.toContain("secret margin");
    expect(of(events, "text.delta").length).toBeGreaterThan(0);
    expect(seenAuth.at(-1)).toBe("Bearer u1");
    expect(of(events, "approval.request")).toHaveLength(0);
  });

  it("pauses a write for approval, then runs it once approved", async () => {
    const before = invoices.length;
    const first = await chat({ message: "create an invoice" });
    const req = of(first.events, "approval.request")[0]!;
    expect(req.method).toBe("POST");
    expect(invoices.length).toBe(before);
    const threadId = of(first.events, "turn.start")[0]!.threadId;

    const second = await chat({ threadId, approval: { token: req.token, decision: "approve" } });
    expect(of(second.events, "tool.complete")[0]!.invalidates).toEqual(["invoices"]);
    expect(invoices.length).toBe(before + 1);
    expect(audits.some((a) => a.operationId === "createInvoice" && a.approval === "approved")).toBe(true);
  });

  it("answers a follow-up message on the same thread after an approval", async () => {
    const first = await chat({ message: "create an invoice" });
    const req = of(first.events, "approval.request")[0]!;
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    await chat({ threadId, approval: { token: req.token, decision: "approve" } });
    const next = await chat({ threadId, message: "list my invoices" });
    expect(of(next.events, "tool.complete")[0]?.operationId).toBe("listInvoices");
  });

  it("does not run a rejected write", async () => {
    const before = invoices.length;
    const first = await chat({ message: "create an invoice" });
    const req = of(first.events, "approval.request")[0]!;
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    const second = await chat({ threadId, approval: { token: req.token, decision: "reject" } });
    expect(of(second.events, "tool.rejected")).toHaveLength(1);
    expect(invoices.length).toBe(before);
  });
});

describe("attacks", () => {
  it("rejects a non-allowlisted tool the model asks for", async () => {
    apiHits.length = 0;
    const { events } = await chat({ message: 'CALL deleteInvoice {"id":"1"}' });
    expect(of(events, "tool.start")).toHaveLength(0);
    expect(apiHits.some((h) => h.startsWith("DELETE"))).toBe(false);
    expect(audits.some((a) => a.operationId === "deleteInvoice" && a.status === "denied")).toBe(true);
  });

  it("rejects a tampered approval token", async () => {
    const first = await chat({ message: "create an invoice" });
    const req = of(first.events, "approval.request")[0]!;
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    const bad = req.token.slice(0, -2) + (req.token.endsWith("AA") ? "BB" : "AA");
    const { res } = await chat({ threadId, approval: { token: bad, decision: "approve" } });
    expect(res.status).toBe(403);
  });

  it("denies another user's thread", async () => {
    const first = await chat({ message: "create an invoice" });
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    const req = of(first.events, "approval.request")[0]!;
    const { res } = await chat({ threadId, approval: { token: req.token, decision: "approve" } }, { user: "u2" });
    expect(res.status).toBe(404);
  });

  it("refuses a new message while an approval is pending", async () => {
    const first = await chat({ message: "create an invoice" });
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    const { res } = await chat({ threadId, message: "hi" });
    expect(res.status).toBe(409);
  });

  it("checks origin, method and content type", async () => {
    expect((await chat({ message: "hi" }, { origin: "https://evil.com" })).res.status).toBe(403);
    expect((await chat({ message: "hi" }, { origin: null })).res.status).toBe(403);
    expect((await chat({ message: "hi" }, { method: "PUT" })).res.status).toBe(405);
    const res = await agent.handler(
      new Request("http://x", { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: "x" }),
    );
    expect(res.status).toBe(415);
  });
});

describe("config safety", () => {
  it("requires getAuth or anonymous", async () => {
    await expect(
      createAgent({
        spec,
        baseUrl: "https://a.com",
        llm: { baseUrl: "https://l.com/v1", apiKey: "k", model: "m" },
        allow: ["listInvoices"],
        allowedOrigins: [ORIGIN],
      }),
    ).rejects.toThrow(/getAuth/);
  });
  it("fails when an allow pattern matches nothing", async () => {
    await expect(
      createAgent({
        spec,
        baseUrl: "https://a.com",
        llm: { baseUrl: "https://l.com/v1", apiKey: "k", model: "m" },
        allow: ["nope"],
        allowedOrigins: [ORIGIN],
        anonymous: true,
      }),
    ).rejects.toThrow(/matched no operation/);
  });
  it("doctor lists exposed tools with approval mode", async () => {
    const report = await agent.doctor();
    expect(report.tools.map((t) => `${t.operationId}:${t.approval}`).sort()).toEqual([
      "createInvoice:required",
      "listInvoices:auto",
    ]);
  });
});

describe("cors", () => {
  it("answers preflight only for allowed origins", async () => {
    const ok = await agent.handler(new Request("http://x", { method: "OPTIONS", headers: { origin: ORIGIN } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    const bad = await agent.handler(
      new Request("http://x", { method: "OPTIONS", headers: { origin: "https://evil.com" } }),
    );
    expect(bad.status).toBe(405);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("history", () => {
  const post = async (body: unknown, user = "u1") => {
    const res = await agent.handler(
      new Request("http://x", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, authorization: `Bearer ${user}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: res.headers.get("content-type")?.includes("json") ? await res.json() : null };
  };

  it("lists threads with a title from the user's message and rebuilds messages with filtered results", async () => {
    const { events } = await chat({ message: "list my invoices please" }, { user: "hist1" });
    const threadId = of(events, "turn.start")[0]!.threadId;
    const list = await post({ action: "threads.list" }, "hist1");
    expect(list.json.threads[0]).toMatchObject({ id: threadId, title: "list my invoices please" });

    const got = await post({ action: "threads.get", threadId }, "hist1");
    const msgs = got.json.messages;
    expect(msgs[0]).toMatchObject({ role: "user" });
    const tool = msgs[1].parts.find((p: any) => p.type === "tool");
    expect(tool.operationId).toBe("listInvoices");
    expect(JSON.stringify(tool.result)).not.toContain("secret margin");
  });

  it("reports a pending approval on load", async () => {
    const first = await chat({ message: "create an invoice" }, { user: "hist2" });
    const threadId = of(first.events, "turn.start")[0]!.threadId;
    const got = await post({ action: "threads.get", threadId }, "hist2");
    expect(got.json.pending.operationId).toBe("createInvoice");
  });

  it("does not let another user read or delete a thread", async () => {
    const { events } = await chat({ message: "hello" }, { user: "owner" });
    const threadId = of(events, "turn.start")[0]!.threadId;
    expect((await post({ action: "threads.get", threadId }, "intruder")).status).toBe(404);
    expect((await post({ action: "threads.delete", threadId }, "intruder")).status).toBe(404);
    expect((await post({ action: "threads.get", threadId }, "owner")).status).toBe(200);
  });

  it("rejects a client-invented thread id even with the right prefix", async () => {
    const forged = `${encodeURIComponent("u9")}:${crypto.randomUUID()}`;
    expect((await post({ action: "threads.get", threadId: forged }, "u9")).status).toBe(404);
    expect((await chat({ threadId: forged, message: "hi" }, { user: "u9" })).res.status).toBe(404);
  });

  it("deletes a thread", async () => {
    const { events } = await chat({ message: "hello" }, { user: "del" });
    const threadId = of(events, "turn.start")[0]!.threadId;
    expect((await post({ action: "threads.delete", threadId }, "del")).status).toBe(200);
    expect((await post({ action: "threads.list" }, "del")).json.threads).toHaveLength(0);
    expect((await post({ action: "threads.get", threadId }, "del")).status).toBe(404);
  });
});
