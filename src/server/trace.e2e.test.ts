import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mockEmbeddings, mockLlmHandler } from "../testing/mock-llm.js";
import { createAgent, type Agent } from "./index.js";
import { TOOL_TAG } from "./graph/index.js";

const ORIGIN = "https://app.example.com";
/** Records what a trace handler is told. */
class Recorder extends BaseCallbackHandler {
  name = "recorder";
  awaitHandlers = true;
  llm = 0;
  tools: { name?: string; tags?: string[]; input: string }[] = [];
  toolEnds = 0;
  handleLLMStart() {
    this.llm++;
  }
  handleChainStart(
    _c: unknown,
    input: Record<string, unknown>,
    _id: string,
    _p?: string,
    tags?: string[],
    _m?: unknown,
    _t?: string,
    name?: string,
  ) {
    if (tags?.includes(TOOL_TAG)) this.tools.push({ name, tags, input: JSON.stringify(input) });
  }
  handleChainEnd(_o: unknown, _id: string, _p?: string, tags?: string[]) {
    if (tags?.includes(TOOL_TAG)) this.toolEnds++;
  }
}

let llm: Server;
let agent: Agent;
const port = (s: Server) => (s.address() as AddressInfo).port;
const seen: Recorder[] = [];

beforeAll(async () => {
  llm = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const out = await mockLlmHandler(
      new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } }),
    );
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => llm.once("listening", r));
  agent = await createAgent({
    llm: { baseUrl: `http://127.0.0.1:${port(llm)}/v1`, apiKey: "k", model: "mock" },
    knowledge: {
      sources: [
        { id: "refunds", title: "Refund policy", content: "Customers can request a refund within thirty days." },
      ],
    },
    embeddings: mockEmbeddings,
    allowedOrigins: [ORIGIN],
    anonymous: true,
    callbacks: ({ request }) => {
      if (request.headers.get("x-trace") === "boom") throw new Error("boom");
      if (request.headers.get("x-trace") !== "1") return undefined;
      const r = new Recorder();
      seen.push(r);
      return [r];
    },
  });
});
afterAll(() => {
  llm.close();
});

const chat = (headers: Record<string, string>, body: object = { message: "what is the refund policy" }) =>
  agent.handler(
    new Request("http://x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
      body: JSON.stringify(body),
    }),
  );

describe("callbacks", () => {
  it("sees the model calls and the tool call of a turn", async () => {
    seen.length = 0;
    const res = await chat({ "x-trace": "1" });
    expect(await res.text()).toContain("tool.complete");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.llm).toBeGreaterThan(0);
    expect(seen[0]!.tools.map((t) => t.name)).toEqual(["search_knowledge"]);
    expect(seen[0]!.toolEnds).toBe(1);
  });

  it("is not called for a request the host did not ask to trace", async () => {
    seen.length = 0;
    await (await chat({})).text();
    expect(seen).toHaveLength(0);
  });

  it("cannot be switched on from the request body", async () => {
    seen.length = 0;
    await (await chat({}, { message: "what is the refund policy", callbacks: ["x"], trace: true })).text();
    expect(seen).toHaveLength(0);
  });

  it("runs the turn untraced when the callback throws", async () => {
    const res = await chat({ "x-trace": "boom" });
    expect(await res.text()).toContain("tool.complete");
  });
});
