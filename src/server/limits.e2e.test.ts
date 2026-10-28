import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mockLlmHandler } from "../testing/mock-llm.js";
import type { AgentEvent } from "../protocol.js";
import { createAgent } from "./index.js";

const ORIGIN = "https://app.example.com";
const spec = {
  openapi: "3.0.3",
  info: { title: "t", version: "1" },
  paths: { "/invoices": { get: { operationId: "listInvoices", responses: { "200": { description: "ok" } } } } },
};

function listen(handler: (req: Request) => Promise<Response>): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const out = await handler(
        new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } }),
      );
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    }).listen(0, "127.0.0.1", () => resolve(s));
  });
}
const port = (s: Server) => (s.address() as AddressInfo).port;

let api: Server, loopLlm: Server, slowLlm: Server;
beforeAll(async () => {
  api = await listen(async () => Response.json([]));
  // Pretends the user keeps asking for a list, so the model never stops calling tools.
  loopLlm = await listen(async (req) => {
    const body = await req.json();
    body.messages = body.messages.map((m: any) => (m.role === "tool" ? { role: "user", content: "list" } : m));
    return mockLlmHandler(new Request("http://x", { method: "POST", body: JSON.stringify(body) }));
  });
  slowLlm = await listen(async (req) => {
    await new Promise((r) => setTimeout(r, 1_000));
    return mockLlmHandler(req);
  });
});
afterAll(() => {
  api.close();
  loopLlm.close();
  slowLlm.close();
});

async function turn(llm: Server, limits: Record<string, number>) {
  const agent = await createAgent({
    spec,
    baseUrl: `http://127.0.0.1:${port(api)}`,
    allowPrivateNetworks: true,
    llm: { baseUrl: `http://127.0.0.1:${port(llm)}/v1`, apiKey: "test", model: "mock" },
    allow: ["listInvoices"],
    limits,
    allowedOrigins: [ORIGIN],
    approvalSecret: "test-secret-test-secret",
    getAuth: () => ({ userId: "u1", headers: {} }),
  });
  const res = await agent.handler(
    new Request("http://localhost/agent", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ message: "list" }),
    }),
  );
  const events: AgentEvent[] = [];
  for (const block of (await res.text()).split("\n\n"))
    if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  return events.filter((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");
}

describe("turn limits", () => {
  it("reports step_limit when the model keeps calling tools", async () => {
    const errors = await turn(loopLlm, { maxSteps: 1 });
    expect(errors.map((e) => e.code)).toEqual(["step_limit"]);
  });

  it("reports timeout when the turn runs too long", async () => {
    const errors = await turn(slowLlm, { turnTimeoutMs: 100 });
    expect(errors.map((e) => e.code)).toEqual(["timeout"]);
    expect(errors[0]!.message).toBe("turn timed out");
  });
});
