// Bot challenge for anonymous agents (D-39). The host plugs in a verifier (`turnstileChallenge` is Cloudflare
// Turnstile); one solved challenge is exchanged for the admin's own short-lived token, so it covers a conversation.
// The token is `<expiry ms>.<HMAC>` over agent, address and expiry, keyed by the host's secret: stateless, and
// useless for another agent or another address.

export const CHALLENGE_HEADER = "x-sideagent-challenge";
export const CHALLENGE_TTL_MS = 30 * 60_000;
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface Challenge {
  /** Handed to browsers so they can render the widget. */
  siteKey: string;
  /** Whether the visitor's proof is genuine. Any failure, including a network one, is false. */
  verify(proof: string, ip: string): Promise<boolean>;
  /** Keys the tokens this challenge issues. */
  secret: string;
}

/** Cloudflare Turnstile. `fetch` is the host's (a test double, or the global one). */
export function turnstileChallenge(options: { siteKey: string; secret: string; fetch?: typeof fetch }): Challenge {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  return {
    siteKey: options.siteKey,
    secret: options.secret,
    async verify(response, ip) {
      try {
        const form = new URLSearchParams({ secret: options.secret, response });
        if (ip !== "unknown") form.set("remoteip", ip);
        const res = await fetcher(SITEVERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(5000) });
        if (!res.ok) return false;
        return ((await res.json()) as { success?: boolean }).success === true;
      } catch {
        return false;
      }
    },
  };
}

const enc = new TextEncoder();

async function sign(secret: string, agentId: string, ip: string, expires: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`v1|${agentId}|${ip}|${expires}`)));
  let bin = "";
  for (const b of mac) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function issueChallengeToken(
  challenge: Pick<Challenge, "secret">,
  agentId: string,
  ip: string,
  now: number,
) {
  const expires = now + CHALLENGE_TTL_MS;
  return {
    token: `${expires}.${await sign(challenge.secret, agentId, ip, expires)}`,
    expiresIn: CHALLENGE_TTL_MS / 1000,
  };
}

export async function checkChallengeToken(
  challenge: Pick<Challenge, "secret">,
  agentId: string,
  ip: string,
  token: string | undefined,
  now: number,
): Promise<boolean> {
  if (!token) return false;
  const [exp, sig, ...rest] = token.split(".");
  const expires = Number(exp);
  if (!sig || rest.length || !Number.isSafeInteger(expires) || expires <= now) return false;
  const want = await sign(challenge.secret, agentId, ip, expires);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
