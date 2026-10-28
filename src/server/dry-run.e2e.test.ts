import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { mockLlmHandler } from "../testing/mock-llm.js";
import { createAgent, type Agent, type AuditEvent } from "./index.js";

const ORIGIN = "https://app.example.com";
const spec = {
  openapi: "3.0.3",
  info: { title: "t", version: "1" },
  paths: {
    "/invoices": {
      get: { operationId: "listInvoices", responses: { "200": { description: "ok" } } },
      post: {
        operationId: "createInvoice",
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
  },
};

let api: Server, llm: Server;
let dry: Agent, always: Agent;
const apiHits: string[] = [];
const audits: AuditEvent[] = [];
const port = (s: Server) => (s.address() as AddressInfo).port;

beforeAll(async () => {
  api = createServer((req, res) => {
    apiHits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { "content-type": "application/json" });
    res.end("[]");
  }).listen(0, "127.0.0.1");
  llm = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const out = await mockLlmHandler(
      new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } }),
    );
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  }).listen(0, "127.0.0.1");
  await Promise.all([new Promise((r) => api.once("listening", r)), new Promise((r) => llm.once("listening", r))]);
  const base = {
    spec,
    baseUrl: `http://127.0.0.1:${port(api)}`,
    allowPrivateNetworks: true,
    llm: { baseUrl: `http://127.0.0.1:${port(llm)}/v1`, apiKey: "k", model: "mock" },
    allow: ["listInvoices", "createInvoice"],
    allowedOrigins: [ORIGIN],
    anonymous: true,
    approvalSecret: "test-secret-test-secret",
    onAudit: (e: AuditEvent) => void audits.push(e),
  };
  dry = await createAgent({ ...base, dryRun: ({ request }) => request.headers.get("x-preview") === "1" });
  always = await createAgent({
    ...base,
    dryRun: () => {
      throw new Error("boom");
    },
  });
});
afterAll(() => {
  api.close();
  llm.close();
});

async function chat(agent: Agent, body: object, headers: Record<string, string> = {}) {
  const res = await agent.handler(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );
  return (await res.text())
    .split("\n\n")
    .filter((b) => b.startsWith("data: "))
    .map((b) => JSON.parse(b.slice(6)) as AgentEvent);
}
const of = <T extends AgentEvent["type"]>(events: AgentEvent[], t: T) =>
  events.filter((e) => e.type === t) as Extract<AgentEvent, { type: T }>[];

async function approveWrite(
  agent: Agent,
  headers: Record<string, string>,
  body: object = { message: "create an invoice" },
) {
  const first = await chat(agent, body, headers);
  const req = of(first, "approval.request")[0]!;
  const threadId = of(first, "turn.start")[0]!.threadId;
  return chat(agent, { threadId, approval: { token: req.token, decision: "approve" } }, headers);
}

describe("dryRun", () => {
  it("asks for approval, then does not send the write, and says so", async () => {
    apiHits.length = 0;
    const events = await approveWrite(dry, { "x-preview": "1" });
    expect(apiHits.filter((h) => h.startsWith("POST"))).toEqual([]);
    const done = of(events, "tool.complete")[0]!;
    expect(done).toMatchObject({
      operationId: "createInvoice",
      status: 202,
      result: { dryRun: true, sent: false },
      invalidates: [],
    });
    expect(
      audits.some((a) => a.operationId === "createInvoice" && a.status === "dry_run" && a.approval === "approved"),
    ).toBe(true);
  });

  it("still sends reads", async () => {
    apiHits.length = 0;
    await chat(dry, { message: "list my invoices" }, { "x-preview": "1" });
    expect(apiHits).toContain("GET /invoices");
  });

  it("sends writes normally when the host did not ask for a dry run", async () => {
    apiHits.length = 0;
    await approveWrite(dry, {});
    expect(apiHits.some((h) => h.startsWith("POST"))).toBe(true);
  });

  it("cannot be switched on or off from the request body", async () => {
    apiHits.length = 0;
    await approveWrite(dry, {}, { message: "create an invoice", dryRun: false });
    expect(apiHits.some((h) => h.startsWith("POST"))).toBe(true);
    apiHits.length = 0;
    const events = await approveWrite(dry, { "x-preview": "1" }, { message: "create an invoice", dryRun: false });
    expect(of(events, "tool.complete")[0]!.status).toBe(202);
    expect(apiHits.filter((h) => h.startsWith("POST"))).toEqual([]);
  });

  it("treats a throwing callback as a dry run, the safe side", async () => {
    apiHits.length = 0;
    const events = await approveWrite(always, {});
    expect(of(events, "tool.complete")[0]!.status).toBe(202);
    expect(apiHits.filter((h) => h.startsWith("POST"))).toEqual([]);
  });
});
