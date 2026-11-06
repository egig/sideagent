/**
 * Turns in flight. A slot is taken in one synchronous step, before the handler awaits anything else, so
 * parallel requests cannot all pass the same check. It is held until the turn's stream ends.
 *
 * Two limits: turns per user, and one turn per thread (two turns on one thread would write to the same
 * checkpoint at once and interleave their messages). Both are per process: behind several instances, route a
 * thread to one instance or add a shared lock in `beforeTurn`.
 */
export function createSlots(maxPerUser: number) {
  const perUser = new Map<string, number>();
  const threads = new Set<string>();

  return {
    reserve(userId: string, threadId?: string): { release: () => void } | { denied: "user" | "thread" } {
      if ((perUser.get(userId) ?? 0) >= maxPerUser) return { denied: "user" };
      if (threadId && threads.has(threadId)) return { denied: "thread" };
      perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
      if (threadId) threads.add(threadId);
      let done = false;
      return {
        release() {
          if (done) return;
          done = true;
          const left = (perUser.get(userId) ?? 1) - 1;
          if (left > 0) perUser.set(userId, left);
          else perUser.delete(userId);
          if (threadId) threads.delete(threadId);
        },
      };
    },
  };
}
