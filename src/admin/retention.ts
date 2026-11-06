// How long the admin keeps audit rows and traces, and how big their pages are. Shared by every store.
export const AUDIT_RETENTION_DAYS = 30;
export const AUDIT_PAGE_SIZE = 25;
export const TRACE_PAGE_SIZE = 25;
/** Days kept per level. Full text is customer data, so it goes sooner. */
export const TRACE_RETENTION_DAYS = { metadata: 7, full: 3 } as const;
export const DAY_MS = 86_400_000;
export const AUDIT_RANGES = {
  "1h": 3_600_000,
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": AUDIT_RETENTION_DAYS * DAY_MS,
} as const;
export const AUDIT_RESULTS = ["ok", "denied", "limited", "error"] as const;
/** Retention without a cron: one write in this many trims its agent's old rows. */
export const PRUNE_ODDS = 20;
/**
 * How long an anonymous visitor's conversation is kept after its last message. It is customer text from someone
 * who never signed in, so it goes sooner than anything else; a visitor who comes back later starts a new one.
 */
export const ANON_THREAD_TTL_MS = 60 * 60_000;
/** Every anonymous visitor's user id starts with this (data/router.ts). */
export const ANON_USER_PREFIX = "anonymous:";
