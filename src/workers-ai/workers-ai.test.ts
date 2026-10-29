import { AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { workersAiChatModel, workersAiEmbeddings, type WorkersAiBinding } from "./index.js";

function fake(replies: unknown[]) {
  const calls: { model: string; input: any }[] = [];
  const ai: WorkersAiBinding = {
    async run(model, input) {
      calls.push({ model, input });
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { ai, calls };
}

const sse = (...events: unknown[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      const enc = new TextEncoder();
      for (const e of events) c.enqueue(enc.encode(`data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`));
      c.close();
    },
  });

const tool = {
  type: "function",
  function: { name: "listInvoices", description: "List", parameters: { type: "object", properties: {} } },
};

describe("workersAiChatModel", () => {
  it("returns a text reply from { response }", async () => {
    const { ai, calls } = fake([{ response: "hello" }]);
    const m = workersAiChatModel(ai, "@cf/m", { streaming: false, temperature: 0.2 });
    const out = await m.invoke([new SystemMessage("sys"), new HumanMessage("hi")]);
    expect(out.content).toBe("hello");
    expect(calls[0]!.model).toBe("@cf/m");
    expect(calls[0]!.input).toMatchObject({
      temperature: 0.2,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
    });
    expect(calls[0]!.input.tools).toBeUndefined();
  });

  it("reads Responses-style output and skips reasoning", async () => {
    const { ai } = fake([
      {
        output: [
          { type: "reasoning", content: [{ type: "reasoning_text", text: "thinking" }] },
          { type: "message", content: [{ type: "output_text", text: "answer" }] },
        ],
      },
    ]);
    const out = await workersAiChatModel(ai, "m", { streaming: false }).invoke("q");
    expect(out.content).toBe("answer");
  });

  it("maps tool calls both ways (Responses-style function_call, then tool result back)", async () => {
    const { ai, calls } = fake([
      { output: [{ type: "function_call", call_id: "c1", name: "listInvoices", arguments: '{"limit":2}' }] },
      { choices: [{ message: { role: "assistant", content: "two invoices" } }] },
    ]);
    const bound = workersAiChatModel(ai, "m", { streaming: false }).bindTools!([tool], {
      parallel_tool_calls: false,
    } as object);
    const first = (await bound.invoke("list")) as AIMessage;
    expect(first.tool_calls).toEqual([{ type: "tool_call", id: "c1", name: "listInvoices", args: { limit: 2 } }]);
    expect(calls[0]!.input.tools).toEqual([tool]);

    const second = await bound.invoke([
      new HumanMessage("list"),
      first,
      new ToolMessage({ tool_call_id: "c1", content: "[1,2]" }),
    ]);
    expect(second.content).toBe("two invoices");
    const wire = calls[1]!.input.messages;
    expect(wire[1]).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "c1", type: "function", function: { name: "listInvoices", arguments: '{"limit":2}' } }],
    });
    expect(wire[2]).toEqual({ role: "tool", tool_call_id: "c1", content: "[1,2]" });
  });

  it("reads chat-style tool_calls and top-level tool_calls without ids", async () => {
    const { ai } = fake([
      {
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: "x", type: "function", function: { name: "a", arguments: "{}" } }],
            },
          },
        ],
      },
      { response: null, tool_calls: [{ name: "b", arguments: { n: 1 } }] },
    ]);
    const m = workersAiChatModel(ai, "m", { streaming: false });
    expect(((await m.invoke("1")) as AIMessage).tool_calls?.[0]).toMatchObject({ id: "x", name: "a" });
    const second = ((await m.invoke("2")) as AIMessage).tool_calls?.[0];
    expect(second).toMatchObject({ name: "b", args: { n: 1 } });
    expect(second?.id).toMatch(/^call_/);
  });

  it("throws on malformed output", async () => {
    const m = (r: unknown) => workersAiChatModel(fake([r]).ai, "m", { streaming: false });
    await expect(m({ nope: 1 }).invoke("q")).rejects.toThrow(/unrecognized response/);
    await expect(m(42).invoke("q")).rejects.toThrow(/unrecognized response/);
    await expect(
      m({ choices: [{ message: { tool_calls: [{ id: "1", function: { name: "a", arguments: "{oops" } }] } }] }).invoke(
        "q",
      ),
    ).rejects.toThrow(/malformed arguments/);
    await expect(m({ output: [{ type: "function_call", name: "a", arguments: "[1]" }] }).invoke("q")).rejects.toThrow(
      /malformed arguments/,
    );
  });

  it("returns an empty message for empty output", async () => {
    const m = (r: unknown) => workersAiChatModel(fake([r]).ai, "m", { streaming: false });
    const a = (await m({ output: [] }).invoke("q")) as AIMessage;
    expect(a.content).toBe("");
    expect(a.tool_calls).toEqual([]);
    expect((await m({ response: "" }).invoke("q")).content).toBe("");
    expect((await m({ response: null }).invoke("q")).content).toBe("");
  });

  it("propagates binding errors", async () => {
    await expect(
      workersAiChatModel(fake([new Error("quota")]).ai, "m", { streaming: false }).invoke("q"),
    ).rejects.toThrow("quota");
  });

  it("reports token usage, for a reply and for a stream", async () => {
    const reply = fake([{ response: "hi", usage: { prompt_tokens: 7, completion_tokens: 2 } }]);
    const out = (await workersAiChatModel(reply.ai, "m", { streaming: false }).invoke("q")) as AIMessage;
    expect(out.usage_metadata).toEqual({ input_tokens: 7, output_tokens: 2, total_tokens: 9 });

    const streamed = fake([
      sse({ response: "he" }, { response: "llo" }, { usage: { prompt_tokens: 5, completion_tokens: 3 } }, "[DONE]"),
    ]);
    let last: AIMessageChunk | undefined;
    for await (const c of await workersAiChatModel(streamed.ai, "m").stream("hi")) last = last ? last.concat(c) : c;
    expect(last!.content).toBe("hello");
    expect(last!.usage_metadata).toMatchObject({ input_tokens: 5, output_tokens: 3, total_tokens: 8 });
  });

  it("streams text and assembles streamed tool calls", async () => {
    const text = fake([sse({ response: "Hel" }, { response: "lo" }, "[DONE]")]);
    const tokens: string[] = [];
    for await (const c of await workersAiChatModel(text.ai, "m").stream("hi")) tokens.push(c.content as string);
    expect(tokens.filter(Boolean)).toEqual(["Hel", "lo"]);
    expect(text.calls[0]!.input.stream).toBe(true);

    const calls = fake([
      sse(
        {
          choices: [
            { delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "listInvoices", arguments: '{"li' } }] } },
          ],
        },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'mit":3}' } }] } }] },
        "[DONE]",
      ),
    ]);
    let merged: AIMessageChunk | undefined;
    for await (const c of await workersAiChatModel(calls.ai, "m").bindTools!([tool]).stream("list"))
      merged = merged ? merged.concat(c as AIMessageChunk) : (c as AIMessageChunk);
    expect(merged!.tool_calls).toEqual([{ type: "tool_call", id: "t1", name: "listInvoices", args: { limit: 3 } }]);
  });

  it("falls back to a single chunk when the binding ignores stream", async () => {
    const out = await workersAiChatModel(fake([{ response: "whole" }]).ai, "m").invoke("q");
    expect(out.content).toBe("whole");
  });

  it("asks again without streaming when the stream carries neither text nor a call", async () => {
    const reasoningOnly = sse(
      { choices: [{ delta: { reasoning_content: "I should search" } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      "[DONE]",
    );
    const { ai, calls } = fake([
      reasoningOnly,
      {
        choices: [
          { message: { content: "", tool_calls: [{ id: "c1", function: { name: "listInvoices", arguments: "{}" } }] } },
        ],
      },
    ]);
    const chunks: AIMessageChunk[] = [];
    for await (const c of await workersAiChatModel(ai, "m").bindTools!([tool]).stream("list")) chunks.push(c);
    expect(calls.map((c) => c.input.stream)).toEqual([true, undefined]);
    expect(chunks.flatMap((c) => c.tool_calls ?? []).map((t) => t.name)).toEqual(["listInvoices"]);
  });

  it("rejects a malformed stream event", async () => {
    await expect(
      (async () => {
        for await (const _ of await workersAiChatModel(fake([sse("{broken")]).ai, "m").stream("q"));
      })(),
    ).rejects.toThrow(/malformed stream event/);
  });
});

describe("workersAiEmbeddings", () => {
  it("sends { text } and reads { data }", async () => {
    const { ai, calls } = fake([
      {
        shape: [2, 2],
        data: [
          [1, 0],
          [0, 1],
        ],
      },
      { data: [[0.5, 0.5]] },
    ]);
    const e = workersAiEmbeddings(ai, "@cf/baai/bge-m3");
    expect(await e.embedDocuments(["a", "b"])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(calls[0]).toEqual({ model: "@cf/baai/bge-m3", input: { text: ["a", "b"] } });
    expect(await e.embedQuery("q")).toEqual([0.5, 0.5]);
  });

  it("batches large inputs and rejects bad shapes", async () => {
    const texts = Array.from({ length: 150 }, (_, i) => String(i));
    const { ai, calls } = fake([
      { data: texts.slice(0, 100).map(() => [1]) },
      { data: texts.slice(100).map(() => [1]) },
    ]);
    expect(await workersAiEmbeddings(ai, "m").embedDocuments(texts)).toHaveLength(150);
    expect(calls.map((c) => c.input.text.length)).toEqual([100, 50]);
    await expect(workersAiEmbeddings(fake([{ data: [[1]] }]).ai, "m").embedDocuments(["a", "b"])).rejects.toThrow(
      /unrecognized embeddings/,
    );
  });
});
