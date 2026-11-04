// SSRF guard for customer-supplied URLs (spec, base URL, LLM, JWKS, userinfo),
// checked at save time and again before every server-side fetch. Mirrors the
// M0.1 rules planned for the library; the library still needs its own fix for
// the data plane (D-11).

export type Resolve = (hostname: string) => Promise<string[]>;

export class BlockedUrlError extends Error {}

const blocked = (reason: string) => new BlockedUrlError(reason);

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p))) return null;
  const n = parts.map(Number);
  return n.every((x) => x <= 255) ? n : null;
}

// [cidr base, prefix length]. Everything not publicly routable, plus the
// documentation and benchmarking ranges.
const V4_BLOCKED: [number[], number][] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 0, 2, 0], 24],
  [[192, 88, 99, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[198, 51, 100, 0], 24],
  [[203, 0, 113, 0], 24],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

const v4Int = (o: number[]) => ((o[0]! << 24) | (o[1]! << 16) | (o[2]! << 8) | o[3]!) >>> 0;

export function isBlockedIPv4(octets: number[]): boolean {
  const ip = v4Int(octets);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (v4Int(base) & mask);
  });
}

// Expands an IPv6 literal (no brackets) into 8 numbers, or null if malformed.
function parseIPv6(host: string): number[] | null {
  let h = host.toLowerCase();
  const v4 = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(h);
  if (v4) {
    const o = parseIPv4(v4[2]!);
    if (!o) return null;
    h = `${v4[1]}${((o[0]! << 8) | o[1]!).toString(16)}:${((o[2]! << 8) | o[3]!).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

// Allow-list for IPv6: global unicast 2000::/3 only, minus documentation,
// Teredo, 6to4 and ORCHID-like ranges that embed or tunnel other addresses.
// Mapped and compatible IPv4 (::ffff:a.b.c.d, ::a.b.c.d), NAT64, ::, ::1,
// ULA, link-local and multicast all fall outside 2000::/3.
export function isBlockedIPv6(groups: number[]): boolean {
  const [g0, g1] = groups as [number, number];
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x2001 && g1 === 0x0000) return true;
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0010) return true;
  if (g0 === 0x2001 && (g1 & 0xfff0) === 0x0020) return true;
  if (g0 === 0x2002) return true;
  if (g0 === 0x3fff && (g1 & 0xf000) === 0x0000) return true;
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const v4 = parseIPv4(ip);
  if (v4) return isBlockedIPv4(v4);
  const v6 = parseIPv6(ip);
  return v6 ? isBlockedIPv6(v6) : true;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa", ".lan", ".intranet", ".corp"];

// Literal checks only: scheme, credentials, IP literals, reserved names.
export function checkUrlSyntax(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked("Not a valid URL.");
  }
  if (url.protocol !== "https:") throw blocked("HTTPS only.");
  if (url.username || url.password) throw blocked("URLs with a user name or password are not accepted.");
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (host.startsWith("[")) {
    if (isBlockedAddress(host.slice(1, -1))) throw blocked("Private and internal addresses are blocked.");
    return url;
  }
  if (parseIPv4(host)) {
    if (isBlockedAddress(host)) throw blocked("Private and internal addresses are blocked.");
    return url;
  }
  if (!host.includes(".") || host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw blocked("Private and internal addresses are blocked.");
  }
  return url;
}

// Literal checks, then every address the hostname resolves to. Resolution
// failure blocks (fail closed). DNS can change between this check and the
// fetch (rebinding); see D-11 for the residual risk.
export async function assertPublicUrl(raw: string, resolve: Resolve): Promise<URL> {
  const url = checkUrlSyntax(raw);
  const host = url.hostname.replace(/\.$/, "");
  if (host.startsWith("[") || parseIPv4(host)) return url;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw blocked("The host name could not be resolved.");
  }
  if (addresses.length === 0) throw blocked("The host name could not be resolved.");
  if (addresses.some(isBlockedAddress)) throw blocked("The host resolves to a private or internal address.");
  return url;
}

// Workers have no DNS API; ask Cloudflare's DNS-over-HTTPS resolver for A and
// AAAA records. CNAME chains are followed by the resolver; only address
// records (types 1 and 28) are checked.
export const dohResolve: Resolve = async (hostname) => {
  const lookup = async (type: "A" | "AAAA") => {
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`doh ${res.status}`);
    const body = (await res.json()) as { Status: number; Answer?: { type: number; data: string }[] };
    if (body.Status !== 0 && body.Status !== 3) throw new Error(`doh status ${body.Status}`);
    return (body.Answer ?? []).filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
  };
  const [a, aaaa] = await Promise.all([lookup("A"), lookup("AAAA")]);
  return [...a, ...aaaa];
};
