// End-user auth on the data plane (D-29): verifies the bearer token a customer's app sends with
// each chat request, in the agent's mode, and derives the user ID that threads are bound to. Not the integrator's dashboard sign-in (control/auth.ts).
// - jwks: the token is a JWT signed by a key in the customer's JWKS; iss, aud and exp are checked.
// - userinfo: the token is sent to the customer's userinfo URL, which names the user.
// Every failure is one of a few fixed reasons, for the tenant audit log only; the client always
// gets 401 {"error":"unauthorized"}. The token never reaches a log or an audit row.
import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from "jose";
import { assertPublicUrl, type Resolve } from "../url-guard.js";
import { sha256Hex } from "../crypto.js";
import type { AuthConfig } from "../config.js";

export type TokenAuth = Extract<AuthConfig, { mode: "jwks" | "userinfo" }>;
export type AuthFailure = "no_token" | "bad_token" | "token_rejected" | "jwks_unavailable" | "userinfo_unavailable";
export type Verified = { ok: true; userId: string } | { ok: false; reason: AuthFailure };

export interface EndUserAuthDeps {
  resolve: Resolve;
  fetch: typeof fetch;
  now?: () => number;
}

const TOKEN_MAX = 8192;
const FETCH_TIMEOUT_MS = 5000;
const JWKS_MAX_BYTES = 100_000;
const USERINFO_MAX_BYTES = 64_000;
const JWKS_TTL_MS = 10 * 60_000;
/** A token with an unknown kid refetches the JWKS at most this often, so it cannot hammer the host. */
const JWKS_REFETCH_MS = 60_000;
const CLOCK_TOLERANCE_S = 60;
const CACHE_MAX = 1000;
/** UserStore objects are named `agentId|userId` (D-24); agent IDs are 20 characters. 256 in all. */
export const USER_ID_MAX = 256 - 21;

class Unavailable extends Error {}
class Rejected extends Error {}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearer(header: string | undefined): string | null {
  const m = /^Bearer[ ]+([^\s]+)$/i.exec(header?.trim() ?? "");
  return m && m[1]!.length <= TOKEN_MAX ? m[1]! : null;
}

// Guarded like every customer URL (D-11): public address, no redirects, size cap, timeout.
async function fetchJson(
  deps: EndUserAuthDeps,
  url: string,
  headers: Record<string, string>,
  maxBytes: number,
): Promise<unknown> {
  try {
    await assertPublicUrl(url, deps.resolve);
  } catch {
    throw new Unavailable();
  }
  let res: Response;
  try {
    res = await deps.fetch(url, {
      redirect: "manual",
      headers: { accept: "application/json", ...headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new Unavailable();
  }
  if (res.status === 401 || res.status === 403) throw new Rejected();
  if (!res.ok || !res.body) throw new Unavailable();
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new Unavailable();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Unavailable();
      }
      chunks.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new Unavailable();
  }
}

/** A user ID claim or field: a non-empty string or a number. */
function idValue(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.length > 0 ? v : null;
}

function remember<V>(map: Map<string, V>, key: string, value: V) {
  map.delete(key);
  map.set(key, value);
  if (map.size > CACHE_MAX) map.delete(map.keys().next().value!);
}

/** Caches are per isolate: the JWKS by URL, userinfo answers by URL and token hash. */
export function createEndUserAuth(deps: EndUserAuthDeps) {
  const now = deps.now ?? Date.now;
  const jwksCache = new Map<string, { keys: ReturnType<typeof createLocalJWKSet>; at: number }>();
  const userinfoCache = new Map<string, { id: string; until: number }>();

  async function loadJwks(url: string) {
    const data = await fetchJson(deps, url, {}, JWKS_MAX_BYTES).catch((e) => {
      throw e instanceof Rejected ? new Unavailable() : e;
    });
    if (!data || typeof data !== "object" || !Array.isArray((data as JSONWebKeySet).keys)) throw new Unavailable();
    const entry = { keys: createLocalJWKSet(data as JSONWebKeySet), at: now() };
    remember(jwksCache, url, entry);
    return entry;
  }

  async function verifyJwt(auth: Extract<TokenAuth, { mode: "jwks" }>, token: string): Promise<string> {
    let entry = jwksCache.get(auth.jwksUrl);
    if (!entry || now() - entry.at > JWKS_TTL_MS) entry = await loadJwks(auth.jwksUrl);
    const verify = (keys: ReturnType<typeof createLocalJWKSet>) =>
      jwtVerify(token, keys, {
        issuer: auth.issuer,
        audience: auth.acceptAnyAudience ? undefined : auth.audience,
        // Asymmetric only (D-14); none and HS* cannot be configured.
        algorithms: auth.algorithms,
        requiredClaims: ["exp"],
        clockTolerance: CLOCK_TOLERANCE_S,
        currentDate: new Date(now()),
      });
    let result;
    try {
      result = await verify(entry.keys);
    } catch (e) {
      // A key rotated in since the last fetch: refetch once, rate-limited.
      if (!(e instanceof errors.JWKSNoMatchingKey) || now() - entry.at < JWKS_REFETCH_MS) throw e;
      result = await verify((await loadJwks(auth.jwksUrl)).keys);
    }
    const id = idValue(result.payload[auth.userIdClaim]);
    if (!id) throw new Rejected();
    return `${auth.issuer}|${id}`;
  }

  async function verifyUserinfo(auth: Extract<TokenAuth, { mode: "userinfo" }>, token: string): Promise<string> {
    const key = `${auth.url}|${await sha256Hex(token)}`;
    const hit = userinfoCache.get(key);
    let id = hit && hit.until > now() ? hit.id : null;
    if (!id) {
      const data = await fetchJson(deps, auth.url, { authorization: `Bearer ${token}` }, USERINFO_MAX_BYTES);
      id = idValue(data && typeof data === "object" ? (data as Record<string, unknown>)[auth.userIdField] : null);
      if (!id) throw new Rejected();
      if (auth.cacheTtlSeconds > 0) remember(userinfoCache, key, { id, until: now() + auth.cacheTtlSeconds * 1000 });
    }
    return `${new URL(auth.url).origin}|${id}`;
  }

  return {
    async verify(auth: TokenAuth, authorization: string | undefined): Promise<Verified> {
      if (!authorization) return { ok: false, reason: "no_token" };
      const token = bearer(authorization);
      if (!token) return { ok: false, reason: "bad_token" };
      try {
        const userId = auth.mode === "jwks" ? await verifyJwt(auth, token) : await verifyUserinfo(auth, token);
        if (userId.length > USER_ID_MAX) return { ok: false, reason: "token_rejected" };
        return { ok: true, userId };
      } catch (e) {
        if (e instanceof Unavailable)
          return { ok: false, reason: auth.mode === "jwks" ? "jwks_unavailable" : "userinfo_unavailable" };
        if (e instanceof errors.JWSInvalid || e instanceof errors.JWTInvalid) return { ok: false, reason: "bad_token" };
        return { ok: false, reason: "token_rejected" };
      }
    },
  };
}
