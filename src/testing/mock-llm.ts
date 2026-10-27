/**
 * Scripted OpenAI-compatible /chat/completions endpoint for tests and demos. No API key needed.
 * - "CALL <tool> <json>" in a user message makes the model call that tool (even if not offered).
 * - "list" / "create" / "delete" are shortcuts for the demo invoice tools.
 * - After a tool result the model answers with a short text.
 */
type Msg = { role: string; content?: string | null };

function script(messages: Msg[], forced?: string): { text?: string; call?: { name: string; args: unknown } } {
  if (forced) return { call: { name: forced, args: {} } };
  const last = messages[messages.length - 1];
  if (!last) return { text: "..." };
  if (last.role === "tool") return { text: `Done. Result: ${String(last.content).slice(0, 120)}` };
  const text = String(last.content ?? "");
  const explicit = /CALL (\S+)\s*(\{.*\})?/s.exec(text);
  if (explicit) return { call: { name: explicit[1]!, args: explicit[2] ? JSON.parse(explicit[2]) : {} } };
  if (/\b(policy|refunds?|terms|docs|warranty)\b/i.test(text))
    return { call: { name: "search_knowledge", args: { query: text } } };
  if (/\blist\b/i.test(text)) return { call: { name: "listInvoices", args: {} } };
  if (/\bcreate\b/i.test(text))
    return { call: { name: "createInvoice", args: { body: { customer: "Acme", amount: 100 } } } };
  if (/\bdelete\b/i.test(text)) return { call: { name: "deleteInvoice", args: { id: "1" } } };
  return { text: "Hello from the mock model." };
}

export async function mockLlmHandler(request: Request): Promise<Response> {
  const body = (await request.json()) as {
    messages: Msg[];
    stream?: boolean;
    tool_choice?: { function?: { name?: string } };
  };
  const { text, call } = script(body.messages, body.tool_choice?.function?.name);
  // Unique per response: LangGraph merges messages that share an id.
  const id = `chatcmpl-mock-${crypto.randomUUID()}`;
  const base = { id, object: "chat.completion.chunk", created: 0, model: "mock" };

  if (!body.stream) {
    return Response.json({
      id,
      object: "chat.completion",
      created: 0,
      model: "mock",
      choices: [
        {
          index: 0,
          finish_reason: call ? "tool_calls" : "stop",
          message: call
            ? {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  },
                ],
              }
            : { role: "assistant", content: text },
        },
      ],
    });
  }

  const chunks: unknown[] = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" } }] }];
  if (call) {
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: `call_${Math.random().toString(36).slice(2, 8)}`,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              },
            ],
          },
        },
      ],
    });
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
  } else {
    for (const w of (text ?? "").split(/(?<= )/))
      chunks.push({ ...base, choices: [{ index: 0, delta: { content: w } }] });
    chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
  }
  const sse = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(sse, { headers: { "content-type": "text/event-stream" } });
}

const DIM = 128;
function hashToken(t: string): number {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return Math.abs(h) % DIM;
}
/** Deterministic bag-of-words embedding: texts that share words get similar vectors. */
export function mockEmbed(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) v[hashToken(w)]! += 1;
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}

/** Scripted OpenAI-compatible /embeddings endpoint for tests and demos. */
export async function mockEmbeddingsHandler(request: Request): Promise<Response> {
  const body = (await request.json()) as { input: string | string[]; encoding_format?: string };
  const inputs = Array.isArray(body.input) ? body.input : [body.input];
  const toB64 = (v: number[]) => {
    const bytes = new Uint8Array(new Float32Array(v).buffer);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };
  return Response.json({
    object: "list",
    model: "mock-embedding",
    data: inputs.map((t, index) => ({
      object: "embedding",
      index,
      embedding: body.encoding_format === "base64" ? toB64(mockEmbed(t)) : mockEmbed(t),
    })),
    usage: { prompt_tokens: 0, total_tokens: 0 },
  });
}
