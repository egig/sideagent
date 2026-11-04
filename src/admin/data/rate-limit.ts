/** A host-supplied limiter: a shared counter keyed by agent and address, e.g. one backed by Redis. */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The limit for one data-plane request (D-37). With the binding, the key is agent and address, so one
 * agent's traffic cannot use up another's allowance, and the count is shared by every instance. Without
 * it (local dev, tests) it falls back to the in-memory limiter below. A failing limiter lets the request through.
 */
export function createRequestLimiter(now: () => number) {
  const local = createRateLimiter(now);
  return async function limited(binding: RateLimitBinding | undefined, agentId: string, ip: string): Promise<boolean> {
    if (!binding) return local(`${agentId}|${ip}`);
    try {
      return !(await binding.limit({ key: `${agentId}|${ip}` })).success;
    } catch {
      return false;
    }
  };
}

/** Per client address, in memory. Weak by design (D-20): it only stops casual loops. */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_TRACKED = 5000;

/** Returns `limited(ip)`: records a hit and says whether the address is over the limit. */
export function createRateLimiter(now: () => number) {
  const hits = new Map<string, number[]>();
  return function limited(ip: string): boolean {
    const t = now();
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < RATE_WINDOW_MS);
    recent.push(t);
    hits.set(ip, recent);
    if (hits.size > MAX_TRACKED) for (const [k, v] of hits) if (v.every((x) => t - x >= RATE_WINDOW_MS)) hits.delete(k);
    return recent.length > RATE_LIMIT;
  };
}
