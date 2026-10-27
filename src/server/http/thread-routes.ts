import { toHistory } from "../history.js";
import { pendingApprovalOf, type AgentGraph } from "../graph/index.js";
import { ownsThread, type ThreadStore } from "../threads.js";
import { json } from "./cors.js";
import type { ThreadAction } from "./request.js";

export async function handleThreadAction(
  body: ThreadAction,
  { userId, threads, graph }: { userId: string; threads: ThreadStore; graph: AgentGraph },
  cors: Record<string, string>,
): Promise<Response> {
  if (body.action === "threads.list") return json(200, { threads: (await threads.list(userId)).slice(0, 50) }, cors);
  if (!(await ownsThread(threads, userId, body.threadId))) return json(404, { error: "thread not found" }, cors);

  if (body.action === "threads.delete") {
    await threads.delete(userId, body.threadId);
    await (graph.checkpointer as { deleteThread?: (id: string) => Promise<void> } | undefined)?.deleteThread?.(body.threadId);
    return json(200, { ok: true }, cors);
  }
  const snap = await graph.getState({ configurable: { thread_id: body.threadId } });
  const waiting = pendingApprovalOf(snap);
  return json(200, { messages: toHistory(snap.values.messages ?? []), ...(waiting ? { pending: { type: "approval.request", ...waiting } } : {}) }, cors);
}
