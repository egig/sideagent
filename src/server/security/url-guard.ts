export interface UrlGuardOptions {
  /** Pinned origin from config. Requests may only go here. */
  baseUrl: string;
  allowPrivateNetworks?: boolean;
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? parts
    : null;
}

const isIPv6 = (h: string) => h.includes(":");

/** URL parsing normalizes ::ffff:a.b.c.d to ::ffff:xxxx:xxxx; unwrap it to the embedded IPv4. */
function unmapIPv6(h: string): string {
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (!m) return h;
  const hi = parseInt(m[1]!, 16);
  const lo = parseInt(m[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Link-local and cloud metadata ranges are blocked regardless of options. */
export function isAlwaysBlockedHost(host: string): boolean {
  const h = unmapIPv6(host.replace(/^\[|\]$/g, "").toLowerCase());
  if (isIPv6(h)) return h.startsWith("fe80:") || h.startsWith("fd00:ec2:");
  const v4 = parseIPv4(h);
  return v4 !== null && v4[0] === 169 && v4[1] === 254;
}

export function isPrivateHost(host: string): boolean {
  const h = unmapIPv6(host.replace(/^\[|\]$/g, "").toLowerCase());
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true;
  if (isIPv6(h)) return h === "::1" || h.startsWith("fc") || h.startsWith("fd");
  const v4 = parseIPv4(h);
  if (!v4) return false;
  const [a, b] = v4 as [number, number, number, number];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Throws unless `url` is safe to call under the pinned config. */
export function assertAllowedUrl(url: string, opts: UrlGuardOptions): URL {
  const target = new URL(url);
  const base = new URL(opts.baseUrl);
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    throw new Error(`blocked scheme: ${target.protocol}`);
  }
  if (isAlwaysBlockedHost(target.hostname)) throw new Error("blocked: link-local/metadata address");
  if (target.origin !== base.origin) throw new Error(`blocked: origin ${target.origin} is not baseUrl origin`);
  if (!opts.allowPrivateNetworks && isPrivateHost(target.hostname) && !isPrivateHost(base.hostname)) {
    throw new Error("blocked: private network address");
  }
  return target;
}

/** For knowledge URLs: any public http(s) host. Private ranges need allowPrivateNetworks; metadata never. */
export function assertPublicUrl(url: string, allowPrivateNetworks?: boolean): URL {
  const target = new URL(url);
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error(`blocked scheme: ${target.protocol}`);
  if (isAlwaysBlockedHost(target.hostname)) throw new Error("blocked: link-local/metadata address");
  if (!allowPrivateNetworks && isPrivateHost(target.hostname)) throw new Error("blocked: private network address");
  return target;
}
