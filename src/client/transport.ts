import type { AgentEvent, AgentInfo, ChatRequest } from "../protocol.js";

export type GetHeaders = () => Record<string, string> | Promise<Record<string, string>>;

export interface TransportOptions {
  endpoint: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  /** Called before every request, e.g. for a fresh login token. `headers` wins on a clash. */
  getHeaders?: GetHeaders;
  signal?: AbortSignal;
}

async function requestHeaders(opts: Omit<TransportOptions, "signal">): Promise<Record<string, string>> {
  const dynamic = opts.getHeaders ? await opts.getHeaders() : {};
  return { "content-type": "application/json", ...dynamic, ...opts.headers };
}

/** POSTs a chat request and yields the server's SSE events. */
export async function* streamChat(body: ChatRequest, opts: TransportOptions): AsyncGenerator<AgentEvent> {
  let headers: Record<string, string>;
  try {
    headers = await requestHeaders(opts);
  } catch {
    yield { type: "error", code: "headers_failed", message: "Could not get credentials. Sign in again." };
    return;
  }
  const res = await fetch(opts.endpoint, {
    method: "POST",
    credentials: opts.credentials ?? "same-origin",
    headers,
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
export async function callJson<T>(
  body: ChatRequest,
  opts: Omit<TransportOptions, "signal">,
): Promise<{ status: number; data: T | null }> {
  let headers: Record<string, string>;
  try {
    headers = await requestHeaders(opts);
  } catch {
    return { status: 0, data: null };
  }
  const res = await fetch(opts.endpoint, {
    method: "POST",
    credentials: opts.credentials ?? "same-origin",
    headers,
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

export interface AgentSummary {
  name: string;
  available: boolean;
}

const infos = new Map<string, Promise<AgentSummary | null>>();

/**
 * The agent's display name and availability from sideagent Cloud (`agent.info`), or null if the server does
 * not give a name. Cached per endpoint, so a cap reached later shows on the next page load.
 */
export function fetchAgentInfo(opts: Omit<TransportOptions, "signal">): Promise<AgentSummary | null> {
  let info = infos.get(opts.endpoint);
  if (!info) {
    info = callJson<AgentInfo>({ action: "agent.info" }, opts)
      .then((r) =>
        r.status === 200 && typeof r.data?.name === "string" && r.data.name.trim()
          ? {
              name: r.data.name,
              available: r.data.available !== false,
            }
          : null,
      )
      .catch(() => null);
    infos.set(opts.endpoint, info);
    // A failure (signed out, offline) is retried on the next mount.
    void info.then((i) => i === null && infos.delete(opts.endpoint));
  }
  return info;
}
