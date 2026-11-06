import { ANON_USER_PREFIX } from "../retention.js";

const ANON_THREAD = new RegExp(`^${encodeURIComponent(ANON_USER_PREFIX)}([0-9a-f-]{36}):[0-9a-f-]{36}$`, "i");

/**
 * The anonymous visitor a thread id belongs to. The library names a thread `<encoded user id>:<uuid>`, and an
 * anonymous visitor's id is `anonymous:<uuid>`. Anything else is not one of ours. The thread id is the visitor's
 * only credential: both parts are random UUIDs, so it can be neither guessed nor listed.
 */
export function anonUserOf(threadId: unknown): string | null {
  const m = typeof threadId === "string" ? ANON_THREAD.exec(threadId) : null;
  return m ? `${ANON_USER_PREFIX}${m[1]!.toLowerCase()}` : null;
}
