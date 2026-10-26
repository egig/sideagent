import type { AgentEvent, ChatRequest } from "../protocol.js";

export interface TransportOptions {
  endpoint: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** POSTs a chat request and yields the server's SSE events. */
export async function* streamChat(body: ChatRequest, opts: TransportOptions): AsyncGenerator<AgentEvent> {
  const res = await fetch(opts.endpoint, {
    method: "POST",
    credentials: opts.credentials ?? "same-origin",
    headers: { "content-type": "application/json", ...opts.headers },
    body: JSON.stringify(body),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) message = String(j.error);
    } catch {
      /* keep default */
    }
    yield { type: "error", code: `http_${res.status}`, message };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (block.startsWith("data: ")) yield JSON.parse(block.slice(6)) as AgentEvent;
    }
  }
}

/** POSTs a non-streaming request (history actions) and returns the JSON body. */
export async function callJson<T>(body: ChatRequest, opts: Omit<TransportOptions, "signal">): Promise<{ status: number; data: T | null }> {
  const res = await fetch(opts.endpoint, {
    method: "POST",
    credentials: opts.credentials ?? "same-origin",
    headers: { "content-type": "application/json", ...opts.headers },
    body: JSON.stringify(body),
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}
