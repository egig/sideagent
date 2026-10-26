import type { ThreadMeta } from "../protocol.js";

/** Index of a user's conversations. The messages themselves live in the LangGraph checkpointer. */
export interface ThreadStore {
  list(userId: string): Promise<ThreadMeta[]>;
  has(userId: string, threadId: string): Promise<boolean>;
  /** Creates the thread with `title` if new, otherwise only bumps `updatedAt`. */
  touch(userId: string, threadId: string, title: string): Promise<void>;
  delete(userId: string, threadId: string): Promise<void>;
}

const MAX_THREADS_PER_USER = 200;

/** Per-process store. Use a persistent implementation (SQL, KV, Redis) in production. */
export class MemoryThreadStore implements ThreadStore {
  private users = new Map<string, Map<string, ThreadMeta>>();

  private of(userId: string) {
    let m = this.users.get(userId);
    if (!m) this.users.set(userId, (m = new Map()));
    return m;
  }
  async list(userId: string) {
    return [...this.of(userId).values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async has(userId: string, threadId: string) {
    return this.of(userId).has(threadId);
  }
  async touch(userId: string, threadId: string, title: string) {
    const m = this.of(userId);
    const existing = m.get(threadId);
    m.set(threadId, { id: threadId, title: existing?.title ?? title, updatedAt: Date.now() });
    if (m.size > MAX_THREADS_PER_USER) {
      const oldest = [...m.values()].sort((a, b) => a.updatedAt - b.updatedAt)[0];
      if (oldest) m.delete(oldest.id);
    }
  }
  async delete(userId: string, threadId: string) {
    this.of(userId).delete(threadId);
  }
}

export const titleFrom = (message: string) => message.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
