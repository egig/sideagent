// Turn traces (D-35): a LangChain callback handler that records the model and tool calls of one turn as spans,
// stored by AdminStore.audit.recordTrace. A turn is one row. At "metadata" no text is kept; at "full" prompts, replies
// and tool input and output are, redacted by key and cut to fixed lengths. Writes never throw into the turn.
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { TOOL_TAG } from "../../../server/index.js";
import type { Trace, TraceLevel, TraceSpan } from "../../api.js";

/** Per-field and per-turn limits, so one turn is one bounded row (a row stays far under any database's size limit). */
const FIELD_MAX = 4000;
const SPANS_MAX = 60;
const TEXT_BUDGET = 48_000;

const SENSITIVE = /pass(word)?|secret|token|api[-_]?key|authorization|cookie|credential/i;
// Credentials that sit inside text rather than under a key: bearer tokens and long key-like strings.
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEYLIKE = /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{12,}/g;

function redactKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE.test(k) ? "[redacted]" : redactKeys(v)]),
    );
  }
  return value;
}

/** Text safe to store at "full": credentials by key and by shape removed, cut to the field limit. */
export function clip(value: unknown, max = FIELD_MAX): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(redactKeys(value)) ?? "");
  } catch {
    text = String(value);
  }
  text = text.replace(BEARER, "$1 [redacted]").replace(KEYLIKE, "[redacted]");
  return text.length > max ? `${text.slice(0, max)}… (${text.length - max} more characters)` : text;
}

const messageText = (m: BaseMessage) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
const transcript = (messages: BaseMessage[]) => messages.map((m) => `${m.getType()}: ${messageText(m)}`).join("\n\n");

interface Open {
  kind: TraceSpan["kind"];
  name: string;
  startedAt: number;
  input?: string;
}

export interface TraceSink {
  agentId: string;
  userId: string;
  level: Exclude<TraceLevel, "off">;
  /** The turn's id (the audit row of the same turn has it too), so the dashboard can join the two. */
  id?: string;
  /** Called once with the finished trace. */
  write: (trace: Omit<Trace, "id">, id?: string) => Promise<void> | void;
}

/** One instance per turn. Awaited by LangChain, so the row is written before the stream closes. */
export class TraceHandler extends BaseCallbackHandler {
  name = "sideagent-admin-trace";
  awaitHandlers = true;

  private root: string | undefined;
  private threadId: string | null = null;
  private startedAt = Date.now();
  private open = new Map<string, Open>();
  /** Every run we saw, kept or not, so a span can find its nearest recorded ancestor. */
  private parents = new Map<string, string | undefined>();
  private kept = new Set<string>();
  private spans: TraceSpan[] = [];
  private budget = TEXT_BUDGET;

  constructor(private sink: TraceSink) {
    super();
  }

  private full() {
    return this.sink.level === "full";
  }

  private begin(runId: string, parentRunId: string | undefined, span: Open) {
    this.open.set(runId, span);
    this.kept.add(runId);
    this.parents.set(runId, parentRunId);
  }

  private nearestKept(runId: string | undefined): string | null {
    for (let id = runId; id; id = this.parents.get(id)) if (this.kept.has(id)) return id;
    return null;
  }

  /** Text is dropped once the budget is spent; the span itself is always recorded (up to SPANS_MAX). */
  private text(value: string | undefined): string | undefined {
    if (!this.full() || value === undefined) return undefined;
    const out = clip(value);
    if (out.length > this.budget) return undefined;
    this.budget -= out.length;
    return out;
  }

  private finish(runId: string, status: TraceSpan["status"], extra: Partial<TraceSpan> = {}) {
    const o = this.open.get(runId);
    if (!o) return;
    this.open.delete(runId);
    if (this.spans.length >= SPANS_MAX) return;
    const now = Date.now();
    this.spans.push({
      id: runId,
      parentId: this.nearestKept(this.parents.get(runId)),
      kind: o.kind,
      name: o.name,
      startMs: o.startedAt - this.startedAt,
      durationMs: now - o.startedAt,
      status,
      ...(o.input !== undefined && { input: o.input }),
      ...extra,
    });
  }

  private errorOf(err: unknown): { status: TraceSpan["status"]; error?: string } {
    const name = (err as { name?: string } | null)?.name ?? "Error";
    // Provider error text can echo keys and customer text, so only the class is kept at "metadata".
    const message = this.full() ? this.text(`${name}: ${(err as Error)?.message ?? ""}`) : undefined;
    return { status: "error", error: message ?? name };
  }

  override handleChatModelStart(
    llm: unknown,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extra?: Record<string, unknown>,
  ) {
    const model = String(
      (extra?.invocation_params as { model?: string } | undefined)?.model ??
        (llm as { id?: string[] })?.id?.at(-1) ??
        "model",
    );
    this.begin(runId, parentRunId, {
      kind: "llm",
      name: model,
      startedAt: Date.now(),
      input: this.text(transcript(messages[0] ?? [])),
    });
  }

  override handleLLMStart(
    llm: unknown,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extra?: Record<string, unknown>,
  ) {
    const model = String(
      (extra?.invocation_params as { model?: string } | undefined)?.model ??
        (llm as { id?: string[] })?.id?.at(-1) ??
        "model",
    );
    this.begin(runId, parentRunId, {
      kind: "llm",
      name: model,
      startedAt: Date.now(),
      input: this.text(prompts.join("\n\n")),
    });
  }

  override handleLLMEnd(output: LLMResult, runId: string) {
    const gen = output.generations[0]?.[0] as
      | {
          text?: string;
          message?: { tool_calls?: unknown[]; usage_metadata?: { input_tokens?: number; output_tokens?: number } };
        }
      | undefined;
    const usage = gen?.message?.usage_metadata;
    const tokenUsage = (
      output.llmOutput as { tokenUsage?: { promptTokens?: number; completionTokens?: number } } | undefined
    )?.tokenUsage;
    const calls = gen?.message?.tool_calls?.length ? `\n\ntool calls: ${clip(gen.message.tool_calls)}` : "";
    const inputTokens = usage?.input_tokens ?? tokenUsage?.promptTokens;
    const outputTokens = usage?.output_tokens ?? tokenUsage?.completionTokens;
    this.finish(runId, "ok", {
      ...(inputTokens !== undefined && { inputTokens }),
      ...(outputTokens !== undefined && { outputTokens }),
      ...(this.full() && { output: this.text(`${gen?.text ?? ""}${calls}`) }),
    });
  }

  override handleLLMError(err: unknown, runId: string) {
    this.finish(runId, ...this.fail(err));
  }

  private fail(err: unknown): [TraceSpan["status"], Partial<TraceSpan>] {
    const { status, error } = this.errorOf(err);
    return [status, error ? { error } : {}];
  }

  override handleChainStart(
    _chain: unknown,
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    _type?: string,
    name?: string,
  ) {
    if (parentRunId === undefined && this.root === undefined) {
      this.root = runId;
      this.startedAt = Date.now();
      const thread = metadata?.thread_id;
      this.threadId = typeof thread === "string" ? thread.slice(0, 256) : null;
    }
    this.parents.set(runId, parentRunId);
    if (!tags?.includes(TOOL_TAG)) return;
    this.begin(runId, parentRunId, {
      kind: "tool",
      name: name ?? "tool",
      startedAt: Date.now(),
      input: this.text(clip(inputs)),
    });
  }

  override async handleChainEnd(outputs: unknown, runId: string) {
    const o = this.open.get(runId);
    if (o?.kind === "tool") {
      const content = (outputs as { content?: unknown } | null)?.content;
      this.finish(
        runId,
        "ok",
        this.full() ? { output: this.text(typeof content === "string" ? content : clip(outputs)) } : {},
      );
    }
    if (runId === this.root) await this.flush();
  }

  override async handleChainError(err: unknown, runId: string) {
    if (this.open.has(runId)) this.finish(runId, ...this.fail(err));
    if (runId === this.root) await this.flush();
  }

  private async flush() {
    // A span still open here belongs to a turn that was cut off.
    for (const id of [...this.open.keys()]) this.finish(id, "error", { error: "Interrupted" });
    const spans = this.spans.sort((a, b) => a.startMs - b.startMs);
    const llm = spans.filter((s) => s.kind === "llm");
    const sum = (key: "inputTokens" | "outputTokens") =>
      llm.some((s) => s[key] !== undefined) ? llm.reduce((n, s) => n + (s[key] ?? 0), 0) : null;
    const status = spans.some((s) => s.status === "error") ? "error" : "ok";
    try {
      await this.sink.write(
        {
          at: new Date(this.startedAt).toISOString(),
          userId: this.sink.userId.startsWith("anonymous:") ? null : this.sink.userId.slice(0, 256),
          threadId: this.threadId,
          level: this.sink.level,
          status,
          durationMs: Date.now() - this.startedAt,
          llmCalls: llm.length,
          toolCalls: spans.length - llm.length,
          inputTokens: sum("inputTokens"),
          outputTokens: sum("outputTokens"),
          spans,
        },
        this.sink.id,
      );
    } catch {
      console.error("trace write failed");
    }
  }
}
