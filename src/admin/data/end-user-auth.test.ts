import { beforeEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { bearer, createEndUserAuth, USER_ID_MAX, type TokenAuth } from "./end-user-auth.js";

const JWKS_URL = "https://auth.example.com/.well-known/jwks.json";
const ISSUER = "https://auth.example.com/";
const JWKS: TokenAuth = {
  mode: "jwks",
  jwksUrl: JWKS_URL,
  issuer: ISSUER,
  audience: "api",
  acceptAnyAudience: false,
  userIdClaim: "sub",
  algorithms: ["RS256", "ES256", "EdDSA"],
};
const USERINFO: TokenAuth = {
  mode: "userinfo",
  url: "https://api.example.com/me",
  userIdField: "sub",
  cacheTtlSeconds: 60,
};

const resolve = async (host: string) => (host.endsWith("private.example") ? ["10.0.0.9"] : ["93.184.216.34"]);

// Keys generated per run; never real ones.
async function signer(alg: "RS256" | "ES256" | "EdDSA", kid: string) {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg, use: "sig" };
  const sign = (claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
    new SignJWT({ sub: "user-1", ...claims })
      .setProtectedHeader({ alg, kid, ...header })
      .setIssuer((claims.iss as string) ?? ISSUER)
      .setAudience((claims.aud as string) ?? "api")
      .setIssuedAt(Math.floor(clock / 1000))
      .setExpirationTime((claims.exp as number) ?? Math.floor(clock / 1000) + 300)
      .sign(privateKey);
  return { jwk, sign, privateKey };
}

let clock: number;
let calls: { url: string; init?: RequestInit }[];
let routes: Record<string, (init?: RequestInit) => Response>;
const fetcher: typeof fetch = async (input, init) => {
  const url = String(input);
  calls.push({ url, init });
  return routes[url]?.(init) ?? new Response("not found", { status: 404 });
};
const auth = () => createEndUserAuth({ resolve, fetch: fetcher, now: () => clock });
const serve = (keys: JWK[]) => (routes[JWKS_URL] = () => Response.json({ keys }));

beforeEach(() => {
  clock = Date.UTC(2026, 9, 27, 12);
  calls = [];
  routes = {};
});

describe("bearer", () => {
  it("takes the token from Authorization: Bearer only", () => {
    expect(bearer("Bearer abc.def")).toBe("abc.def");
    expect(bearer("bearer abc")).toBe("abc");
    for (const h of [undefined, "", "Basic abc", "Bearer", "Bearer a b", `Bearer ${"x".repeat(8193)}`])
      expect(bearer(h)).toBeNull();
  });
});

describe("jwks mode", () => {
  it("accepts RS256, ES256 and EdDSA tokens and scopes the user ID by issuer", async () => {
    const keys = await Promise.all([signer("RS256", "r"), signer("ES256", "e"), signer("EdDSA", "d")]);
    serve(keys.map((k) => k.jwk));
    const a = auth();
    for (const k of keys) {
      const token = await k.sign();
      expect(await a.verify(JWKS, `Bearer ${token}`)).toEqual({ ok: true, userId: `${ISSUER}|user-1` });
    }
    // One JWKS fetch, cached for the rest.
    expect(calls.filter((c) => c.url === JWKS_URL)).toHaveLength(1);
  });

  it("uses the configured claim, and accepts numeric IDs", async () => {
    const k = await signer("ES256", "e");
    serve([k.jwk]);
    const a = auth();
    expect(await a.verify({ ...JWKS, userIdClaim: "uid" }, `Bearer ${await k.sign({ uid: 42 })}`)).toMatchObject({
      ok: true,
      userId: `${ISSUER}|42`,
    });
    expect(await a.verify({ ...JWKS, userIdClaim: "uid" }, `Bearer ${await k.sign()}`)).toEqual({
      ok: false,
      reason: "token_rejected",
    });
    expect(await a.verify(JWKS, `Bearer ${await k.sign({ sub: "" })}`)).toEqual({
      ok: false,
      reason: "token_rejected",
    });
  });

  it("rejects wrong issuer, audience, expiry, key and algorithm", async () => {
    const k = await signer("ES256", "e");
    const other = await signer("ES256", "e");
    serve([k.jwk]);
    const a = auth();
    const now = Math.floor(clock / 1000);
    const rejected = { ok: false, reason: "token_rejected" };
    expect(await a.verify(JWKS, `Bearer ${await k.sign({ iss: "https://evil.example.com/" })}`)).toEqual(rejected);
    expect(await a.verify(JWKS, `Bearer ${await k.sign({ aud: "other-app" })}`)).toEqual(rejected);
    expect(await a.verify(JWKS, `Bearer ${await k.sign({ exp: now - 61 })}`)).toEqual(rejected);
    // Within the 60 s clock tolerance.
    expect((await a.verify(JWKS, `Bearer ${await k.sign({ exp: now - 30 })}`)).ok).toBe(true);
    expect(await a.verify(JWKS, `Bearer ${await other.sign()}`)).toEqual(rejected);
    // ES256 is allowed in general but not configured here.
    expect(await a.verify({ ...JWKS, algorithms: ["RS256"] }, `Bearer ${await k.sign()}`)).toEqual(rejected);
  });

  it("accepts any audience only when configured to", async () => {
    const k = await signer("ES256", "e");
    serve([k.jwk]);
    expect(
      (
        await auth().verify(
          { ...JWKS, audience: "", acceptAnyAudience: true },
          `Bearer ${await k.sign({ aud: "other-app" })}`,
        )
      ).ok,
    ).toBe(true);
  });

  it("requires exp", async () => {
    const k = await signer("ES256", "e");
    serve([k.jwk]);
    const forever = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "ES256", kid: "e" })
      .setIssuer(ISSUER)
      .setAudience("api")
      .sign(k.privateKey);
    expect(await auth().verify(JWKS, `Bearer ${forever}`)).toEqual({ ok: false, reason: "token_rejected" });
  });

  it("rejects alg none and HS256 even with a matching kid", async () => {
    const k = await signer("RS256", "r");
    serve([k.jwk]);
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const claims = { sub: "user-1", iss: ISSUER, aud: "api", exp: Math.floor(clock / 1000) + 300 };
    const none = `${b64({ alg: "none", kid: "r" })}.${b64(claims)}.`;
    const hs = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", kid: "r" })
      .sign(new TextEncoder().encode("a-shared-secret-of-enough-length!!"));
    for (const t of [none, hs]) expect((await auth().verify(JWKS, `Bearer ${t}`)).ok).toBe(false);
  });

  it("tells malformed tokens and a missing header apart, for the audit log", async () => {
    serve([]);
    expect(await auth().verify(JWKS, undefined)).toEqual({ ok: false, reason: "no_token" });
    expect(await auth().verify(JWKS, "Basic abc")).toEqual({ ok: false, reason: "bad_token" });
    expect(await auth().verify(JWKS, "Bearer not-a-jwt")).toEqual({ ok: false, reason: "bad_token" });
  });

  it("refetches the JWKS for a new kid, at most once a minute", async () => {
    const old = await signer("ES256", "old");
    const next = await signer("ES256", "new");
    serve([old.jwk]);
    const a = auth();
    expect((await a.verify(JWKS, `Bearer ${await old.sign()}`)).ok).toBe(true);
    serve([old.jwk, next.jwk]);
    // Too soon after the last fetch: the unknown kid is rejected without a fetch.
    expect(await a.verify(JWKS, `Bearer ${await next.sign()}`)).toEqual({ ok: false, reason: "token_rejected" });
    expect(calls).toHaveLength(1);
    clock += 61_000;
    expect((await a.verify(JWKS, `Bearer ${await next.sign()}`)).ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("refetches the JWKS after ten minutes", async () => {
    const k = await signer("ES256", "e");
    serve([k.jwk]);
    const a = auth();
    await a.verify(JWKS, `Bearer ${await k.sign()}`);
    clock += 10 * 60_000 + 1;
    await a.verify(JWKS, `Bearer ${await k.sign()}`);
    expect(calls).toHaveLength(2);
  });

  it("fails closed when the JWKS is unreachable, private, redirected or oversized", async () => {
    const k = await signer("ES256", "e");
    const token = `Bearer ${await k.sign()}`;
    const down = { ok: false, reason: "jwks_unavailable" };
    expect(await auth().verify(JWKS, token)).toEqual(down); // 404
    routes[JWKS_URL] = () => new Response(null, { status: 302, headers: { location: "https://x.example.com" } });
    expect(await auth().verify(JWKS, token)).toEqual(down);
    routes[JWKS_URL] = () => Response.json({ keys: [k.jwk], pad: "x".repeat(100_001) });
    expect(await auth().verify(JWKS, token)).toEqual(down);
    routes[JWKS_URL] = () => new Response("not json");
    expect(await auth().verify(JWKS, token)).toEqual(down);
    calls = [];
    expect(await auth().verify({ ...JWKS, jwksUrl: "https://jwks.private.example/k" }, token)).toEqual(down);
    expect(calls).toHaveLength(0);
  });

  it("asks for no redirects and sends no token to the JWKS URL", async () => {
    const k = await signer("ES256", "e");
    serve([k.jwk]);
    await auth().verify(JWKS, `Bearer ${await k.sign()}`);
    expect(calls[0]!.init?.redirect).toBe("manual");
    expect(JSON.stringify(calls[0]!.init?.headers)).not.toMatch(/authorization/i);
  });

  it("rejects a user ID that would not fit the store name", async () => {
    const k = await signer("ES256", "e");
    serve([k.jwk]);
    const long = "u".repeat(USER_ID_MAX);
    expect(await auth().verify(JWKS, `Bearer ${await k.sign({ sub: long })}`)).toEqual({
      ok: false,
      reason: "token_rejected",
    });
  });
});

describe("userinfo mode", () => {
  const me = (init?: RequestInit) =>
    new Headers(init?.headers).get("authorization") === "Bearer good"
      ? Response.json({ sub: "42", name: "Ada" })
      : new Response("no", { status: 401 });

  it("names the user from the userinfo answer, scoped by its origin, and caches it", async () => {
    routes["https://api.example.com/me"] = me;
    const a = auth();
    expect(await a.verify(USERINFO, "Bearer good")).toEqual({ ok: true, userId: "https://api.example.com|42" });
    expect(await a.verify(USERINFO, "Bearer good")).toMatchObject({ ok: true });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer good");
    expect(calls[0]!.init?.redirect).toBe("manual");
    clock += 60_001;
    await a.verify(USERINFO, "Bearer good");
    expect(calls).toHaveLength(2);
  });

  it("does not cache with a TTL of 0, nor cache failures", async () => {
    routes["https://api.example.com/me"] = me;
    const a = auth();
    const noCache = { ...USERINFO, cacheTtlSeconds: 0 };
    await a.verify(noCache, "Bearer good");
    await a.verify(noCache, "Bearer good");
    expect(calls).toHaveLength(2);
    expect(await a.verify(USERINFO, "Bearer bad")).toEqual({ ok: false, reason: "token_rejected" });
    expect(await a.verify(USERINFO, "Bearer bad")).toEqual({ ok: false, reason: "token_rejected" });
    expect(calls).toHaveLength(4);
  });

  it("rejects an answer without the user ID field", async () => {
    routes["https://api.example.com/me"] = () => Response.json({ name: "Ada" });
    expect(await auth().verify(USERINFO, "Bearer good")).toEqual({ ok: false, reason: "token_rejected" });
    expect(await auth().verify({ ...USERINFO, userIdField: "name" }, "Bearer good")).toMatchObject({
      ok: true,
      userId: "https://api.example.com|Ada",
    });
  });

  it("fails closed when the userinfo URL errors or redirects", async () => {
    const down = { ok: false, reason: "userinfo_unavailable" };
    routes["https://api.example.com/me"] = () => new Response("oops", { status: 500 });
    expect(await auth().verify(USERINFO, "Bearer good")).toEqual(down);
    routes["https://api.example.com/me"] = () =>
      new Response(null, { status: 302, headers: { location: "https://api.example.com/login" } });
    expect(await auth().verify(USERINFO, "Bearer good")).toEqual(down);
  });

  it("keeps the cache apart per token", async () => {
    routes["https://api.example.com/me"] = me;
    const a = auth();
    await a.verify(USERINFO, "Bearer good");
    expect(await a.verify(USERINFO, "Bearer bad")).toEqual({ ok: false, reason: "token_rejected" });
  });
});
