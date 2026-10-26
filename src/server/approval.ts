/** Approval tokens: HMAC over the exact thread, call, operation and arguments the user was shown. */

export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  let s = "";
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface ApprovalClaims {
  threadId: string;
  callId: string;
  operationId: string;
  args: unknown;
}

const payload = (c: ApprovalClaims, exp: number) =>
  `${c.threadId}|${c.callId}|${c.operationId}|${canonicalJson(c.args)}|${exp}`;

export async function signApproval(secret: string, claims: ApprovalClaims, ttlMs: number) {
  const expiresAt = Date.now() + ttlMs;
  return { expiresAt, token: `${expiresAt}.${await hmac(secret, payload(claims, expiresAt))}` };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifyApproval(secret: string, token: string, claims: ApprovalClaims): Promise<boolean> {
  const [expStr, mac] = token.split(".");
  const exp = Number(expStr);
  if (!mac || !Number.isFinite(exp) || exp < Date.now()) return false;
  return timingSafeEqual(mac, await hmac(secret, payload(claims, exp)));
}
