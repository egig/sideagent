// Envelope encryption for per-agent secrets (the LLM key).
// Each value gets its own random data key (AES-256-GCM); the data key is
// wrapped with the key-encryption key CONFIG_KEK. Both layers bind the agent ID
// and field name as associated data, so a ciphertext copied to another agent
// or field fails to decrypt.

export interface CryptoEnv {
  /** base64 of 32 random bytes: `openssl rand -base64 32`. */
  CONFIG_KEK: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

const keks = new Map<string, Promise<CryptoKey>>();
function kek(env: CryptoEnv): Promise<CryptoKey> {
  const raw = env.CONFIG_KEK;
  if (!raw) throw new Error("CONFIG_KEK is not set");
  let key = keks.get(raw);
  if (!key) {
    const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
    if (bytes.length !== 32) throw new Error("CONFIG_KEK must be 32 bytes, base64");
    key = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
    keks.set(raw, key);
  }
  return key;
}

const aad = (agentId: string, field: string) => enc.encode(`sideagent:v1:${agentId}:${field}`);

async function gcm(
  op: "encrypt" | "decrypt",
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
  ad: Uint8Array<ArrayBuffer>,
) {
  const params = { name: "AES-GCM", iv, additionalData: ad };
  return new Uint8Array(await crypto.subtle[op](params, key, data));
}

/** Returns `v1.<iv>.<wrapped data key>.<iv>.<ciphertext>`, base64url parts. */
export async function seal(env: CryptoEnv, agentId: string, field: string, plaintext: string): Promise<string> {
  const ad = aad(agentId, field);
  const dataKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const dataKey = await crypto.subtle.importKey("raw", dataKeyBytes, "AES-GCM", false, ["encrypt"]);
  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await gcm("encrypt", await kek(env), wrapIv, dataKeyBytes, ad);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await gcm("encrypt", dataKey, iv, enc.encode(plaintext), ad);
  return ["v1", b64url(wrapIv), b64url(wrapped), b64url(iv), b64url(ct)].join(".");
}

export async function open(env: CryptoEnv, agentId: string, field: string, sealed: string): Promise<string> {
  const [v, wrapIv, wrapped, iv, ct] = sealed.split(".") as [string, string, string, string, string];
  if (v !== "v1" || !ct) throw new Error("unknown ciphertext format");
  const ad = aad(agentId, field);
  const dataKeyBytes = await gcm("decrypt", await kek(env), fromB64url(wrapIv), fromB64url(wrapped), ad);
  const dataKey = await crypto.subtle.importKey("raw", dataKeyBytes, "AES-GCM", false, ["decrypt"]);
  return dec.decode(await gcm("decrypt", dataKey, fromB64url(iv), fromB64url(ct), ad));
}

export const SECRET_MIN_LENGTH = 32;

/**
 * Two independent secrets from the one master `secret` (HKDF-SHA256, a different label for each): the key that wraps
 * stored secrets (`CONFIG_KEK`) and the one that signs sign-in cookies. Rotating the master rotates both.
 */
export async function deriveSecrets(secret: string): Promise<{ kek: string; authSecret: string }> {
  if (secret.length < SECRET_MIN_LENGTH)
    throw new Error(`sideagent: secret must be at least ${SECRET_MIN_LENGTH} characters: openssl rand -base64 32`);
  const master = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveBits"]);
  const derive = async (label: string) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "HKDF", hash: "SHA-256", salt: enc.encode("sideagent:v1"), info: enc.encode(label) },
        master,
        256,
      ),
    );
  const kek = await derive("config-kek");
  const auth = await derive("auth-secret");
  return {
    kek: btoa(String.fromCharCode(...kek)),
    authSecret: btoa(String.fromCharCode(...auth)),
  };
}
