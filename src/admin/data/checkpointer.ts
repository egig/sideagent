// LangGraph checkpoint saver over a user's store (worker/stores/user-store.ts). One saver serves every
// user of an agent; each call is routed to the owner's object by the thread id, which the library
// builds as `<encodeURIComponent(userId)>:<uuid>` and checks against the signed-in user before
// any graph call (so the prefix is trusted only after that check).
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
import {
  WRITES_IDX_MAP,
  compareWritesSortKeys,
  writesSortKey,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { CheckpointWithWrites, ThreadStorage } from "../store/types.js";

export function userOfThread(threadId: string): string | null {
  const at = threadId.indexOf(":");
  if (at <= 0) return null;
  try {
    return decodeURIComponent(threadId.slice(0, at));
  } catch {
    return null;
  }
}

const toB64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export class StoreCheckpointer extends BaseCheckpointSaver {
  constructor(
    private readonly agentId: string,
    private readonly threads: ThreadStorage,
  ) {
    super();
  }

  /** The thread's storage, if its id names a user at all. */
  private storeOf(threadId: string) {
    return userOfThread(threadId) ? this.threads : null;
  }

  private async tuple(row: CheckpointWithWrites): Promise<CheckpointTuple> {
    const writes = [...row.writes].sort((a, b) =>
      compareWritesSortKeys(writesSortKey(a.taskPath, a.taskId, a.idx), writesSortKey(b.taskPath, b.taskId, b.idx)),
    );
    const pendingWrites = (await Promise.all(
      writes.map(async (w): Promise<[string, string, unknown]> => [
        w.taskId,
        w.channel,
        await this.serde.loadsTyped(w.type, fromB64(w.value)),
      ]),
    )) as CheckpointTuple["pendingWrites"];
    const tuple: CheckpointTuple = {
      config: { configurable: { thread_id: row.threadId, checkpoint_ns: row.ns, checkpoint_id: row.checkpointId } },
      checkpoint: (await this.serde.loadsTyped(row.type, fromB64(row.checkpoint))) as Checkpoint,
      metadata: (await this.serde.loadsTyped(row.type, fromB64(row.metadata))) as CheckpointMetadata,
      pendingWrites,
    };
    if (row.parentId)
      tuple.parentConfig = {
        configurable: { thread_id: row.threadId, checkpoint_ns: row.ns, checkpoint_id: row.parentId },
      };
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const store = threadId ? this.storeOf(threadId) : null;
    if (!threadId || !store) return undefined;
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const row = await store.getCheckpoint(
      this.agentId,
      threadId,
      ns,
      (config.configurable?.checkpoint_id as string | undefined) ?? null,
    );
    return row ? this.tuple(row) : undefined;
  }

  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> },
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const store = threadId ? this.storeOf(threadId) : null;
    if (!threadId || !store) return;
    const rows = await store.listCheckpoints(this.agentId, threadId, {
      ns: config.configurable?.checkpoint_ns as string | undefined,
      checkpointId: config.configurable?.checkpoint_id as string | undefined,
      before: options?.before?.configurable?.checkpoint_id as string | undefined,
    });
    let left = options?.limit ?? Infinity;
    for (const row of rows) {
      if (left <= 0) return;
      const t = await this.tuple(row);
      if (
        options?.filter &&
        !Object.entries(options.filter).every(
          ([k, v]) => (t.metadata as Record<string, unknown> | undefined)?.[k] === v,
        )
      )
        continue;
      left -= 1;
      yield t;
    }
  }

  async put(config: RunnableConfig, checkpoint: Checkpoint, metadata: CheckpointMetadata): Promise<RunnableConfig> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const store = threadId ? this.storeOf(threadId) : null;
    if (!threadId || !store) throw new Error("Failed to put checkpoint: no valid thread_id.");
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const [[type, cp], [, meta]] = await Promise.all([
      this.serde.dumpsTyped(copyCheckpoint(checkpoint)),
      this.serde.dumpsTyped(metadata),
    ]);
    await store.putCheckpoint(this.agentId, {
      threadId,
      ns,
      checkpointId: checkpoint.id,
      parentId: (config.configurable?.checkpoint_id as string | undefined) ?? null,
      type,
      checkpoint: toB64(cp),
      metadata: toB64(meta),
    });
    return { configurable: { thread_id: threadId, checkpoint_ns: ns, checkpoint_id: checkpoint.id } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string, taskPath?: string): Promise<void> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    const store = threadId ? this.storeOf(threadId) : null;
    if (!threadId || !checkpointId || !store)
      throw new Error("Failed to put writes: thread_id and checkpoint_id are required.");
    const ns = (config.configurable?.checkpoint_ns as string | undefined) ?? "";
    const rows = await Promise.all(
      writes.map(async ([channel, value], i) => {
        const [type, bytes] = await this.serde.dumpsTyped(value);
        return {
          threadId,
          ns,
          checkpointId,
          taskId,
          idx: WRITES_IDX_MAP[channel] ?? i,
          channel,
          taskPath: taskPath ?? "",
          type,
          value: toB64(bytes),
        };
      }),
    );
    if (rows.length) await store.putWrites(this.agentId, rows);
  }

  /** The library calls threads.delete on the thread store first, which clears checkpoints too. */
  async deleteThread(threadId: string): Promise<void> {
    const userId = userOfThread(threadId);
    if (userId) await this.threads.delete(this.agentId, userId, threadId);
  }
}
