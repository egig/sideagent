// Request bodies the data plane checks itself, before the library sees the request.
import { z } from "zod";
import { MESSAGE_MAX } from "./limits.js";

export const body = z
  .object({ threadId: z.string().max(100).optional(), message: z.string().trim().min(1).max(MESSAGE_MAX) })
  .passthrough();

export const historyAction = z.union([
  z.object({ action: z.literal("threads.list") }),
  z.object({ action: z.enum(["threads.get", "threads.delete"]), threadId: z.string().max(100) }),
]);
