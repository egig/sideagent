import { MemorySaver } from "@langchain/langgraph";

const EPHEMERAL_THREADS = 200;

/** Checkpoints for anonymous turns, in memory and bounded: the oldest threads are dropped. */
export class EphemeralSaver extends MemorySaver {
  private threads: string[] = [];
  override async put(...args: Parameters<MemorySaver["put"]>) {
    const id = args[0].configurable?.thread_id as string | undefined;
    if (id && !this.threads.includes(id)) {
      this.threads.push(id);
      while (this.threads.length > EPHEMERAL_THREADS) await this.deleteThread(this.threads.shift()!);
    }
    return super.put(...args);
  }
}

/** Anonymous visitors have no thread list. */
export const NO_THREADS = {
  list: async () => [],
  has: async () => false,
  touch: async () => {},
  delete: async () => {},
};
