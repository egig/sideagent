import {
  BaseChatModel,
  type BaseChatModelCallOptions,
  type BindToolsInput,
} from "@langchain/core/language_models/chat_models";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { Runnable } from "@langchain/core/runnables";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { messageText } from "../server/message-text.js";

/**
 * The part of the Workers AI binding (`env.AI`) used here. Structural on purpose:
 * no dependency on @cloudflare/workers-types.
 */
export interface WorkersAiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface WorkersAiChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the binding for a stream. Falls back to one chunk when it returns a plain object. Default true. */
  streaming?: boolean;
}

interface WorkersAiCallOptions extends BaseChatModelCallOptions {
  tools?: unknown[];
}

interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

interface Parsed {
  text: string;
  toolCalls: ToolCall[];
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);

function toWire(messages: BaseMessage[]): unknown[] {
  return messages.map((m) => {
    const type = m.getType();
    const content = messageText(m.content);
    if (type === "system") return { role: "system", content };
    if (type === "human") return { role: "user", content };
    if (type === "tool")
      return { role: "tool", tool_call_id: (m as unknown as { tool_call_id: string }).tool_call_id, content };
    const calls = (m as AIMessage).tool_calls ?? [];
    return {
      role: "assistant",
      content,
      ...(calls.length
        ? {
            tool_calls: calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) },
            })),
          }
        : {}),
    };
  });
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw == null || raw === "") return {};
  if (isObj(raw)) return raw;
  if (typeof raw === "string") {
    let v: unknown;
    try {
      v = JSON.parse(raw);
    } catch {
      throw new Error("Workers AI returned a tool call with malformed arguments");
    }
    if (isObj(v)) return v;
  }
  throw new Error("Workers AI returned a tool call with malformed arguments");
}

const newId = () => `call_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** Reads every response shape the binding is known to return. Throws on anything else. */
export function parseWorkersAiResponse(res: unknown): Parsed {
  // Some models return the payload under `result`, like the REST API does.
  const r =
    isObj(res) && isObj(res.result) && !("response" in res) && !("choices" in res) && !("output" in res)
      ? res.result
      : res;
  if (typeof r === "string") return { text: r, toolCalls: [] };
  if (!isObj(r)) throw new Error("Workers AI returned an unrecognized response");

  let text = "";
  const toolCalls: ToolCall[] = [];
  let known = false;

  if (Array.isArray(r.output)) {
    // Responses-style (gpt-oss): reasoning items are dropped, only message text and function calls count.
    known = true;
    for (const item of r.output) {
      if (!isObj(item)) continue;
      if (item.type === "function_call") {
        toolCalls.push({
          id: String(item.call_id ?? item.id ?? newId()),
          name: String(item.name),
          args: parseArgs(item.arguments),
        });
      } else if (item.type === "message" || (item.type === undefined && Array.isArray(item.content))) {
        for (const part of Array.isArray(item.content) ? item.content : []) {
          if (isObj(part) && (part.type === "output_text" || part.type === "text") && typeof part.text === "string")
            text += part.text;
        }
      }
    }
  }

  const msg = Array.isArray(r.choices) && isObj(r.choices[0]) ? r.choices[0].message : undefined;
  if (isObj(msg)) {
    known = true;
    if (typeof msg.content === "string") text += msg.content;
    for (const c of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = isObj(c) ? (c.function ?? c) : undefined;
      if (!isObj(fn) || typeof fn.name !== "string") throw new Error("Workers AI returned a malformed tool call");
      toolCalls.push({ id: String(c.id ?? newId()), name: fn.name, args: parseArgs(fn.arguments) });
    }
  }

  if (typeof r.response === "string") {
    known = true;
    text += r.response;
  } else if (r.response === null) known = true;
  if (Array.isArray(r.tool_calls)) {
    // Top-level form of older models: { name, arguments } with arguments already an object, usually no id.
    known = true;
    for (const c of r.tool_calls) {
      const fn = isObj(c) ? (c.function ?? c) : undefined;
      if (!isObj(fn) || typeof fn.name !== "string") throw new Error("Workers AI returned a malformed tool call");
      toolCalls.push({ id: String(c.id ?? newId()), name: fn.name, args: parseArgs(fn.arguments) });
    }
  }

  if (!known) throw new Error("Workers AI returned an unrecognized response");
  return { text, toolCalls };
}

/** Yields the JSON payload of each `data:` line of an SSE byte stream. */
async function* sseEvents(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>,
): AsyncGenerator<unknown> {
  const dec = new TextDecoder();
  let buf = "";
  const source =
    Symbol.asyncIterator in stream
      ? (stream as AsyncIterable<Uint8Array | string>)
      : readerIterable(stream as ReadableStream<Uint8Array>);
  function* drain(final: boolean): Generator<unknown> {
    const lines = buf.split("\n");
    buf = final ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        throw new Error("Workers AI returned a malformed stream event");
      }
    }
  }
  for await (const chunk of source) {
    buf += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
    yield* drain(false);
  }
  yield* drain(true);
}

async function* readerIterable(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

const isStream = (v: unknown): v is ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string> =>
  !!v &&
  typeof v === "object" &&
  (typeof (v as ReadableStream).getReader === "function" || Symbol.asyncIterator in (v as object));

export class ChatWorkersAI extends BaseChatModel<WorkersAiCallOptions> {
  constructor(
    private readonly ai: WorkersAiBinding,
    private readonly modelName: string,
    private readonly opts: WorkersAiChatOptions = {},
  ) {
    super({});
  }

  _llmType() {
    return "workers-ai";
  }

  override bindTools(
    tools: BindToolsInput[],
    kwargs?: Partial<WorkersAiCallOptions>,
  ): Runnable<BaseLanguageModelInput, AIMessageChunk, WorkersAiCallOptions> {
    // kwargs may carry provider options for other models (e.g. parallel_tool_calls); they mean nothing here.
    return this.withConfig({
      ...(kwargs as object),
      tools: tools.map((t) => convertToOpenAITool(t as never)),
    } as Partial<WorkersAiCallOptions>) as never;
  }

  private input(messages: BaseMessage[], options: WorkersAiCallOptions, stream: boolean) {
    return {
      messages: toWire(messages),
      ...(options.tools?.length ? { tools: options.tools } : {}),
      ...(this.opts.temperature !== undefined ? { temperature: this.opts.temperature } : {}),
      ...(this.opts.maxTokens !== undefined ? { max_tokens: this.opts.maxTokens } : {}),
      ...(stream ? { stream: true } : {}),
    };
  }

  private async run(input: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    return this.ai.run(this.modelName, input);
  }

  async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]): Promise<ChatResult> {
    const { text, toolCalls } = parseWorkersAiResponse(
      await this.run(this.input(messages, options, false), options.signal),
    );
    const message = new AIMessage({
      content: text,
      tool_calls: toolCalls.map((c) => ({ type: "tool_call" as const, ...c })),
    });
    return { generations: [{ text, message }] };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const res =
      this.opts.streaming === false ? undefined : await this.run(this.input(messages, options, true), options.signal);
    if (!isStream(res)) {
      // The binding ignored `stream` (or streaming is off): emit the full reply as one chunk.
      const full =
        res === undefined
          ? parseWorkersAiResponse(await this.run(this.input(messages, options, false), options.signal))
          : parseWorkersAiResponse(res);
      yield* this.emit(full, runManager);
      return;
    }

    // Tool-call deltas arrive in pieces keyed by index; they are assembled and emitted once at the end.
    const partial = new Map<number, { id?: string; name: string; args: string }>();
    const whole: ToolCall[] = [];
    for await (const ev of sseEvents(res)) {
      options.signal?.throwIfAborted();
      if (!isObj(ev)) continue;
      let delta = "";
      if (typeof ev.response === "string") delta = ev.response;
      const choice = Array.isArray(ev.choices) && isObj(ev.choices[0]) ? ev.choices[0] : undefined;
      if (choice) {
        const d = isObj(choice.delta) ? choice.delta : isObj(choice.message) ? choice.message : {};
        if (typeof d.content === "string") delta += d.content;
        for (const tc of Array.isArray(d.tool_calls) ? d.tool_calls : []) {
          const i = typeof tc.index === "number" ? tc.index : partial.size;
          const cur = partial.get(i) ?? { name: "", args: "" };
          if (tc.id) cur.id = String(tc.id);
          if (tc.function?.name) cur.name += tc.function.name;
          if (typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
          partial.set(i, cur);
        }
      }
      // Responses-style events (gpt-oss)
      if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") delta += ev.delta;
      if (ev.type === "response.output_item.done" && isObj(ev.item) && ev.item.type === "function_call") {
        whole.push({
          id: String(ev.item.call_id ?? ev.item.id ?? newId()),
          name: String(ev.item.name),
          args: parseArgs(ev.item.arguments),
        });
      }
      if (Array.isArray(ev.tool_calls)) whole.push(...parseWorkersAiResponse({ tool_calls: ev.tool_calls }).toolCalls);
      if (delta) yield* this.emit({ text: delta, toolCalls: [] }, runManager);
    }
    const toolCalls = [...whole];
    for (const p of partial.values()) {
      if (!p.name) throw new Error("Workers AI returned a malformed tool call");
      toolCalls.push({ id: p.id ?? newId(), name: p.name, args: parseArgs(p.args) });
    }
    if (toolCalls.length) yield* this.emit({ text: "", toolCalls }, runManager);
  }

  private async *emit(
    { text, toolCalls }: Parsed,
    runManager?: CallbackManagerForLLMRun,
  ): AsyncGenerator<ChatGenerationChunk> {
    const chunk = new ChatGenerationChunk({
      text,
      message: new AIMessageChunk({
        content: text,
        tool_call_chunks: toolCalls.map((c, index) => ({
          type: "tool_call_chunk" as const,
          index,
          id: c.id,
          name: c.name,
          args: JSON.stringify(c.args),
        })),
      }),
    });
    yield chunk;
    await runManager?.handleLLMNewToken(text, undefined, undefined, undefined, undefined, { chunk });
  }
}

/** A LangChain chat model backed by the Workers AI binding. Pass it to createAgent as `model`. */
export function workersAiChatModel(ai: WorkersAiBinding, model: string, opts?: WorkersAiChatOptions): BaseChatModel {
  return new ChatWorkersAI(ai, model, opts);
}

const EMBED_BATCH = 100;

/** Embeddings backed by the Workers AI binding. Pass them to createAgent as `embeddings`. */
export function workersAiEmbeddings(ai: WorkersAiBinding, model: string) {
  async function embedDocuments(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const res: any = await ai.run(model, { text: batch });
      const data = res?.data ?? res?.result?.data;
      if (!Array.isArray(data) || data.length !== batch.length || !data.every((v: unknown) => Array.isArray(v))) {
        throw new Error("Workers AI returned an unrecognized embeddings response");
      }
      out.push(...(data as number[][]));
    }
    return out;
  }
  return {
    embedDocuments,
    async embedQuery(text: string): Promise<number[]> {
      return (await embedDocuments([text]))[0]!;
    },
  };
}
