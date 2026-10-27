// Publishable keys for sideagent Cloud: `pk_<environment>_` + base64url of `<host>$<agentId>`.
// A publishable key names an agent and the host that serves it. It is public and proves nothing.
// No dependencies, so the browser client and the Cloud's Worker share this one definition.

export type KeyEnvironment = "test" | "live";

export interface PublishableKeyParts {
  environment: KeyEnvironment;
  /** host[:port], no scheme. */
  host: string;
  agentId: string;
}

/** Request header that carries the publishable key. Authorization stays free for the user's token. */
export const PUBLISHABLE_KEY_HEADER = "x-sideagent-key";

const AGENT_ID = /^agt_[a-z0-9]{16}$/;
const HOST = /^[a-z0-9.-]+(:\d+)?$/i;
const LOOPBACK = /^(localhost|127\.0\.0\.1)(:\d+)?$/i;

function b64url(s: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function publishableKey(environment: KeyEnvironment, host: string, agentId: string): string {
  return `pk_${environment}_${b64url(`${host}$${agentId}`)}`;
}

/** The key's parts, or null when it is not a well-formed publishable key. */
export function parsePublishableKey(key: string): PublishableKeyParts | null {
  const m = /^pk_(test|live)_([A-Za-z0-9_-]+)$/.exec(key);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = fromB64url(m[2]!);
  } catch {
    return null;
  }
  const at = decoded.lastIndexOf("$");
  if (at <= 0) return null;
  const host = decoded.slice(0, at);
  const agentId = decoded.slice(at + 1);
  if (!AGENT_ID.test(agentId) || !HOST.test(host)) return null;
  return { environment: m[1] as KeyEnvironment, host, agentId };
}

/** The agent's data-plane URL. https, except http for localhost and 127.0.0.1 (local development). */
export function publishableEndpoint({ host, agentId }: PublishableKeyParts): string {
  return `${LOOPBACK.test(host) ? "http" : "https"}://${host}/v1/agents/${agentId}`;
}
