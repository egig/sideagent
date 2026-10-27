import { z } from "zod";

const chatBody = z.union([
  z.object({ action: z.literal("threads.list") }),
  z.object({ action: z.enum(["threads.get", "threads.delete"]), threadId: z.string() }),
  z.object({ threadId: z.string().optional(), message: z.string().min(1).max(8000), context: z.unknown().optional() }),
  z.object({
    threadId: z.string(),
    approval: z.object({ token: z.string(), decision: z.enum(["approve", "reject"]) }),
  }),
]);

export type ChatBody = z.infer<typeof chatBody>;
export type ThreadAction = Extract<ChatBody, { action: unknown }>;
export type TurnBody = Exclude<ChatBody, ThreadAction>;

const MAX_BODY = 256 * 1024;

export async function readChatBody(request: Request): Promise<{ body: ChatBody } | { status: number; error: string }> {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return { status: 413, error: "body too large" };
  let parsed;
  try {
    parsed = chatBody.safeParse(JSON.parse(raw));
  } catch {
    return { status: 400, error: "invalid json" };
  }
  if (!parsed.success) return { status: 400, error: "invalid request" };
  return { body: parsed.data };
}
