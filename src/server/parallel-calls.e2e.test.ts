import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentEvent } from "../protocol.js";
import { createAgent, type Agent, type AuditEvent } from "./index.js";

// The model asks for two writes in one reply. createAgent runs a reply's calls in parallel; sideagent must run
// only the first, so an approval pause and its resume can never send a write twice or send one unapproved.

const ORIGIN = "https://app.example.com";
const spec = {
  openapi: "3.0.0",
  info: { title: "t", version: "1" },
  paths: {
    "/invoices": {
      post: {
        operationId: "createInvoice",
        description: "Create an invoice",
        requestBody: {
          content: {
            "application/json": {
              schema: { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] },
            },
          },
        },
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

const writes: string[] = [];
let toolMessages: string[] = [];

function listen(handle: (body: string) => { type: string; text: string }): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const out = handle(body);
      res.writeHead(200, { "content-type": out.type });
      res.end(out.text);
    }).listen(0, "127.0.0.1", () => resolve(s));
  });
}
const port = (s: Server) => (s.address() as AddressInfo).port;

function reply(body: string) {
  const req = JSON.parse(body) as { messages: { role: string; content: unknown }[]; stream?: boolean };
  const last = req.messages.at(-1)!;
  toolMessages = req.messages.filter((m) => m.role === "tool").map((m) => String(m.content));
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const calls =
    last.role === "user"
      ? [1, 2].map((n) => ({
          index: n - 1,
          id: `call_${n}_${crypto.randomUUID().slice(0, 6)}`,
          type: "function",
          function: { name: "createInvoice", arguments: JSON.stringify({ body: { amount: n } }) },
        }))
      : undefined;
  const message = calls
    ? { role: "assistant", content: null, tool_calls: calls }
    : { role: "assistant", content: "Done." };
  const finish = calls ? "tool_calls" : "stop";
  if (!req.stream)
    return {
      type: "application/json",
      text: JSON.stringify({
        id,
        object: "chat.completion",
        created: 0,
        model: "m",
        choices: [{ index: 0, message, finish_reason: finish }],
      }),
    };
  const chunk = (delta: unknown, finish_reason: string | null = null) =>
    `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
  const text = chunk({ ...message }) + chunk({}, finish) + "data: [DONE]\n\n";
  return { type: "text/event-stream", text };
}

let api: Server, llm: Server, agent: Agent;
const audits: AuditEvent[] = [];

beforeAll(async () => {
  api = await listen((body) => {
    writes.push(body);
    return { type: "application/json", text: JSON.stringify({ ok: true }) };
  });
  llm = await listen(reply);
  agent = await createAgent({
    spec,
    baseUrl: `http://127.0.0.1:${port(api)}`,
    allowPrivateNetworks: true,
    llm: { baseUrl: `http://127.0.0.1:${port(llm)}/v1`, apiKey: "test", model: "m" },
    allow: ["createInvoice"],
    allowedOrigins: [ORIGIN],
    approvalSecret: "test-secret-test-secret",
    getAuth: () => ({ userId: "u1", headers: {} }),
    onAudit: (e) => void audits.push(e),
  });
});
afterAll(() => {
  api.close();
  llm.close();
});

async function chat(body: unknown) {
  const res = await agent.handler(
    new Request("http://localhost/agent", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(body),
    }),
  );
  const events: AgentEvent[] = [];
  for (const block of (await res.text()).split("\n\n"))
    if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  return events;
}
const of = <T extends AgentEvent["type"]>(events: AgentEvent[], t: T) =>
  events.filter((e) => e.type === t) as Extract<AgentEvent, { type: T }>[];

describe("several tool calls in one reply", () => {
  it("asks approval for the first only, sends exactly that write, and skips the rest", async () => {
    const first = await chat({ message: "create two invoices" });
    const requests = of(first, "approval.request");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.args).toEqual({ body: { amount: 1 } });
    expect(writes).toHaveLength(0);
    const threadId = of(first, "turn.start")[0]!.threadId;

    const second = await chat({ threadId, approval: { token: requests[0]!.token, decision: "approve" } });
    expect(of(second, "approval.request")).toHaveLength(0);
    expect(writes).toEqual([JSON.stringify({ amount: 1 })]);
    expect(audits.filter((a) => a.status === "executed")).toHaveLength(1);
    expect(toolMessages.filter((c) => c.startsWith("Skipped:"))).toHaveLength(1);
  });
});
