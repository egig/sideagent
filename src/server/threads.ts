import type { BaseStore } from "@langchain/langgraph";
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

/**
 * Thread index on any LangGraph `BaseStore` (Postgres, Redis, …), so one store can serve the checkpointer
 * ecosystem and the thread list. Keeps at most 200 threads per user, like `MemoryThreadStore`.
 */
export class LangGraphThreadStore implements ThreadStore {
  constructor(private store: BaseStore) {}

  // Namespace labels cannot contain "." and user ids are often emails.
  private ns = (userId: string) => ["sideagent", "threads", encodeURIComponent(userId).replace(/\./g, "%2E")];

  private async all(userId: string): Promise<ThreadMeta[]> {
    const items = await this.store.search(this.ns(userId), { limit: MAX_THREADS_PER_USER + 1 });
    return items.map((i) => i.value as unknown as ThreadMeta).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async list(userId: string) {
    return (await this.all(userId)).slice(0, MAX_THREADS_PER_USER);
  }
  async has(userId: string, threadId: string) {
    return (await this.store.get(this.ns(userId), threadId)) != null;
  }
  async touch(userId: string, threadId: string, title: string) {
    const existing = (await this.store.get(this.ns(userId), threadId))?.value as ThreadMeta | undefined;
    const meta: ThreadMeta = { id: threadId, title: existing?.title ?? title, updatedAt: Date.now() };
    await this.store.put(this.ns(userId), threadId, meta as unknown as Record<string, unknown>);
    const threads = await this.all(userId);
    if (threads.length > MAX_THREADS_PER_USER) await this.delete(userId, threads[threads.length - 1]!.id);
  }
  async delete(userId: string, threadId: string) {
    await this.store.delete(this.ns(userId), threadId);
  }
}

export const titleFrom = (message: string) => message.replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";

/** Thread ids are `<encoded userId>:<uuid>`. */
export const threadPrefix = (userId: string) => `${encodeURIComponent(userId)}:`;

/** A thread belongs to a user only if it carries their prefix and is in their own index. */
export async function ownsThread(store: ThreadStore, userId: string, threadId: string): Promise<boolean> {
  return threadId.startsWith(threadPrefix(userId)) && (await store.has(userId, threadId));
}
