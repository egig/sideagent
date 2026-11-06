import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentEvent, HistoryMessage } from "../protocol.js";
import { mockEmbeddings, mockEmbeddingsHandler, mockLlmHandler } from "../testing/mock-llm.js";
import { createAgent, type Agent } from "./index.js";

const ORIGIN = "https://app.example.com";
const OFF_TOPIC = "Stay on topic.";
const sources = [
  { id: "refunds", title: "Refund policy", content: "Customers can request a refund within thirty days." },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A chat model that answers from a script and keeps what it was shown. */
class ScriptedModel extends BaseChatModel {
  seen: BaseMessage[][] = [];
  constructor(private script: (messages: BaseMessage[]) => AIMessage) {
    super({});
  }
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.seen.push(messages);
    const message = this.script(messages);
    return { generations: [{ text: "", message }] };
  }
  async *_streamResponseChunks(messages: BaseMessage[]) {
    this.seen.push(messages);
    const m = this.script(messages);
    if (m.tool_calls?.length) {
      const tool_call_chunks = m.tool_calls.map((c, index) => ({
        type: "tool_call_chunk" as const,
        index,
        id: c.id,
        name: c.name,
        args: JSON.stringify(c.args),
      }));
      yield new ChatGenerationChunk({ text: "", message: new AIMessageChunk({ content: "", tool_call_chunks }) });
      return;
    }
    // One chunk per content block, as providers that stream blocks do.
    if (typeof m.content === "string") {
      yield new ChatGenerationChunk({ text: m.content, message: new AIMessageChunk({ content: m.content }) });
      return;
    }
    for (const block of m.content) {
      yield new ChatGenerationChunk({ text: "", message: new AIMessageChunk({ content: [block] }) });
    }
  }
}

async function turn(agent: Agent, body: Record<string, unknown>, opts: { user?: string; signal?: AbortSignal } = {}) {
  const res = await agent.handler(
    new Request("http://localhost/agent", {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, authorization: opts.user ?? "u1" },
      body: JSON.stringify(body),
      signal: opts.signal,
    }),
  );
  const events: AgentEvent[] = [];
  let error: unknown;
  if (res.headers.get("content-type")?.includes("event-stream")) {
    for (const block of (await res.text()).split("\n\n"))
      if (block.startsWith("data: ")) events.push(JSON.parse(block.slice(6)));
  } else error = await res.json();
  const text = events.map((e) => (e.type === "text.delta" ? e.text : "")).join("");
  const threadId = events.find((e) => e.type === "turn.start")?.threadId;
  return { res, events, text, threadId, error };
}
const getAuth = (request: Request) => ({ userId: request.headers.get("authorization") ?? "u1" });

describe("streamed text", () => {
  it("reaches the user from a model that returns content blocks", async () => {
    const model = new ScriptedModel(
      () =>
        new AIMessage({
          content: [
            { type: "text", text: "Refunds take " },
            { type: "text", text: "thirty days." },
          ],
        }),
    );
    const agent = await createAgent({
      model,
      embeddings: mockEmbeddings,
      knowledge: { sources },
      allowedOrigins: [ORIGIN],
      getAuth,
    });
    const { text, events } = await turn(agent, { message: "hello" });
    expect(text).toBe("Refunds take thirty days.");
    expect(events.at(-1)?.type).toBe("turn.end");
  });

  it("ignores blocks that are not text", async () => {
    const model = new ScriptedModel(
      () =>
        new AIMessage({
          content: [
            { type: "thinking", thinking: "private notes" },
            { type: "text", text: "Answer." },
          ] as never,
        }),
    );
    const agent = await createAgent({
      model,
      embeddings: mockEmbeddings,
      knowledge: { sources },
      allowedOrigins: [ORIGIN],
      getAuth,
    });
    expect((await turn(agent, { message: "hello" })).text).toBe("Answer.");
  });
});

describe("an interrupted turn", () => {
  it("does not break the thread: the next turn answers the call that never finished", async () => {
    let block = true;
    let unblock = () => {};
    const gate = new Promise<void>((r) => (unblock = r));
    const embeddings = {
      embedDocuments: mockEmbeddings.embedDocuments,
      embedQuery: async (t: string) => {
        if (block) await gate;
        return mockEmbeddings.embedQuery(t);
      },
    };
    const model = new ScriptedModel((messages) => {
      const last = messages[messages.length - 1]!;
      return last.getType() === "human" && String(last.content).includes("search")
        ? new AIMessage({
            content: "",
            tool_calls: [{ id: "call_1", name: "search_knowledge", args: { query: "refund" } }],
          })
        : new AIMessage("ok");
    });
    const agent = await createAgent({ model, embeddings, knowledge: { sources }, allowedOrigins: [ORIGIN], getAuth });

    const ac = new AbortController();
    const first = turn(agent, { message: "please search" }, { signal: ac.signal });
    await vi.waitFor(() => expect(model.seen).toHaveLength(1));
    await sleep(50);
    ac.abort();
    const { threadId } = await first;
    block = false;
    unblock();

    const second = await turn(agent, { threadId, message: "hello again" });
    expect(second.text).toBe("ok");
    const shown = model.seen.at(-1)!;
    expect(shown.map((m) => m.getType())).toEqual(["system", "human", "ai", "tool", "human"]);
    expect((shown[3] as unknown as { tool_call_id: string }).tool_call_id).toBe("call_1");
  });
});

describe("turn slots", () => {
  let srv: Server;
  let agent: Agent;
  let onError: ReturnType<typeof vi.fn>;
  const port = () => (srv.address() as AddressInfo).port;
  beforeAll(async () => {
    srv = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      await sleep(300);
      const handler = req.url?.endsWith("/embeddings") ? mockEmbeddingsHandler : mockLlmHandler;
      const out = await handler(
        new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } }),
      );
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    }).listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    onError = vi.fn();
    agent = await createAgent({
      llm: { baseUrl: `http://127.0.0.1:${port()}/v1`, apiKey: "k", model: "mock", maxRetries: 0 },
      embeddings: mockEmbeddings,
      knowledge: { sources },
      allowedOrigins: [ORIGIN],
      getAuth,
      onError,
    });
  });
  afterAll(() => srv.close());

  it("counts concurrent turns at once: parallel requests cannot all get past the limit", async () => {
    const all = await Promise.all([1, 2, 3, 4].map(() => turn(agent, { message: "hello" }, { user: "racer" })));
    expect(all.map((r) => r.res.status).sort()).toEqual([200, 200, 429, 429]);
    // The slots come back when the streams end.
    expect((await turn(agent, { message: "hello" }, { user: "racer" })).res.status).toBe(200);
  });

  it("runs one turn per thread: a second turn on a busy thread is refused", async () => {
    const { threadId } = await turn(agent, { message: "hello" }, { user: "pair" });
    const both = await Promise.all([
      turn(agent, { threadId, message: "one" }, { user: "pair" }),
      turn(agent, { threadId, message: "two" }, { user: "pair" }),
    ]);
    expect(both.map((r) => r.res.status).sort()).toEqual([200, 409]);
    expect(both.find((r) => r.res.status === 409)?.error).toEqual({
      error: "a turn is already running for this thread",
    });
    expect((await turn(agent, { threadId, message: "three" }, { user: "pair" })).res.status).toBe(200);
  });

  it("stops the turn when the browser leaves, without reporting a failure, and frees the thread", async () => {
    const { threadId } = await turn(agent, { message: "hello" }, { user: "leaver" });
    const res = await agent.handler(
      new Request("http://localhost/agent", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, authorization: "leaver" },
        body: JSON.stringify({ threadId, message: "slow one" }),
      }),
    );
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await vi.waitFor(
      async () => expect((await turn(agent, { threadId, message: "again" }, { user: "leaver" })).res.status).toBe(200),
      {
        timeout: 3000,
      },
    );
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("the relevance gate and ambiguity", () => {
  let srv: Server;
  let strict: Agent;
  let lenient: Agent;
  let chatCalls = 0;
  let lastChatBody = "";
  const port = () => (srv.address() as AddressInfo).port;

  beforeAll(async () => {
    srv = createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      if (req.url?.endsWith("/chat/completions")) (chatCalls++, (lastChatBody = body));
      const handler = req.url?.endsWith("/embeddings") ? mockEmbeddingsHandler : mockLlmHandler;
      const out = await handler(
        new Request("http://x", { method: "POST", body, headers: { "content-type": "application/json" } }),
      );
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    }).listen(0, "127.0.0.1");
    await new Promise((r) => srv.once("listening", r));
    const base = {
      llm: { baseUrl: `http://127.0.0.1:${port()}/v1`, apiKey: "k", model: "mock" },
      embeddings: undefined,
      allowedOrigins: [ORIGIN],
      getAuth,
      knowledge: { embeddings: { model: "mock-embedding" }, sources },
    };
    lenient = await createAgent({ ...base, scope: { minScore: 0.3, offTopic: OFF_TOPIC } });
    strict = await createAgent({ ...base, scope: { minScore: 0.3, clarifyScore: 0.3, offTopic: OFF_TOPIC } });
  });
  afterAll(() => srv.close());

  const FOLLOW_UP = "and for production?";
  const sent = () => JSON.parse(lastChatBody) as { messages: { role: string; content: string }[] };

  it("gives a follow-up to the model when the earlier question explains it, with the ambiguity rules", async () => {
    const first = await turn(lenient, { message: "refund within thirty days" });
    expect(first.text).toContain("Done.");
    const before = chatCalls;
    const followUp = await turn(lenient, { threadId: first.threadId, message: FOLLOW_UP });
    expect(chatCalls).toBeGreaterThan(before);
    expect(followUp.text).not.toBe(OFF_TOPIC);
    const system = sent().messages[0]!.content;
    expect(system).toContain("may be an ambiguous follow-up");
    expect(system).toContain("ask one short clarifying question");
    // The scope rules still apply to it.
    expect(system).toContain("Answer only from search_knowledge results");
  });

  it("refuses the same words as a first message: nothing explains them", async () => {
    const before = chatCalls;
    const { text } = await turn(lenient, { message: FOLLOW_UP });
    expect(text).toBe(OFF_TOPIC);
    expect(chatCalls).toBe(before);
  });

  it("leaves an unrelated message after an on-topic one to the model, under the scope rules", async () => {
    // The earlier question makes the pair look close to the documentation, so the code gate cannot tell: that is
    // what the middle band is for. The model refuses it from the scope rules; clarifyScore = minScore turns this off.
    const first = await turn(lenient, { message: "refund within thirty days" });
    const before = chatCalls;
    await turn(lenient, { threadId: first.threadId, message: "what is 2+2" });
    expect(chatCalls).toBeGreaterThan(before);
    expect(sent().messages[0]!.content).toContain("Refuse requests unrelated to the application");
  });

  it("restores the strict gate when clarifyScore equals minScore", async () => {
    const first = await turn(strict, { message: "refund within thirty days" });
    const before = chatCalls;
    const { text } = await turn(strict, { threadId: first.threadId, message: FOLLOW_UP });
    expect(text).toBe(OFF_TOPIC);
    expect(chatCalls).toBe(before);
  });

  it("keeps a refusal out of what the model sees, and in what the user sees", async () => {
    const first = await turn(lenient, { message: "what is 2+2" });
    expect(first.text).toBe(OFF_TOPIC);
    const second = await turn(lenient, { threadId: first.threadId, message: "refund within thirty days" });
    expect(second.text).toContain("Done.");
    const shown = JSON.stringify(sent().messages);
    expect(shown).not.toContain("2+2");
    expect(shown).not.toContain(OFF_TOPIC);

    const history = await lenient.handler(
      new Request("http://localhost/agent", {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, authorization: "u1" },
        body: JSON.stringify({ action: "threads.get", threadId: first.threadId }),
      }),
    );
    const { messages } = (await history.json()) as { messages: HistoryMessage[] };
    expect(JSON.stringify(messages)).toContain("what is 2+2");
    expect(JSON.stringify(messages)).toContain(OFF_TOPIC);
  });

  it("tells every model to rewrite an ambiguous question and to ask when it is still unclear", async () => {
    await turn(lenient, { message: "refund within thirty days" });
    const system = sent().messages[0]!.content;
    expect(system).toContain("rewrite it as a self-contained query");
    expect(system).toContain("ask one short clarifying question instead of guessing or refusing");
  });
});
