import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { ArrowUpIcon } from "@radix-ui/react-icons";
import { useMemo, useRef } from "react";
import { turnHooks } from "./hooks.js";
import { AssistantMessage, UserMessage } from "./Messages.js";
import { applyEvent, toInitialMessages, type Part } from "./parts.js";
import { streamTurn } from "./transport.js";
import { MAX_MESSAGE_CHARS } from "../protocol.js";
import type { AgentChatProps, Session } from "./types.js";

/** One conversation: streams turns. */
export function Chat(
  props: AgentChatProps & {
    endpoint: string;
    session: Session;
    onThread: (id: string) => void;
    /** The server no longer has the conversation; the next message starts a new one. */
    onThreadLost?: () => void;
  },
) {
  const { endpoint, hooks, credentials, headers } = props;
  const latest = useRef(props);
  latest.current = props;
  const threadId = useRef<string | undefined>(props.session.threadId);

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }) {
        const p = latest.current;
        const last = [...messages].reverse().find((m) => m.role === "user");
        const text = (last?.content ?? [])
          .map((c: any) => (c.type === "text" ? c.text : ""))
          .join("\n")
          .trim();
        const ctx = typeof p.context === "function" ? (p.context as () => unknown)() : p.context;

        let parts: Part[] = [];
        const turn = turnHooks(p.hooks);
        try {
          for await (const ev of streamTurn(
            { threadId: threadId.current, message: text, context: ctx },
            {
              endpoint: p.endpoint,
              credentials: p.credentials,
              headers: p.headers,
              getHeaders: p.getHeaders,
              signal: abortSignal,
            },
            () => {
              threadId.current = undefined;
              p.onThreadLost?.();
            },
          )) {
            parts = applyEvent(parts, ev);
            turn.event(ev);
            if (ev.type === "turn.start") {
              threadId.current = ev.threadId;
              p.onThread(ev.threadId);
            }
            yield { content: parts as any };
          }
        } finally {
          turn.end();
        }
        yield { content: parts as any };
      },
    }),
    // endpoint/hooks/etc. are read through `latest`, so the adapter stays stable.
    [endpoint, hooks, credentials, headers],
  );

  const runtime = useLocalRuntime(adapter, { initialMessages: toInitialMessages(props.session.messages) });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root style={{ display: "contents" }}>
        <ThreadPrimitive.Viewport className="sa-viewport">
          <ThreadPrimitive.Empty>
            <div className="sa-empty">Ask me a question about this product.</div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        <ComposerPrimitive.Root className="sa-composer">
          <ComposerPrimitive.Input
            className="sa-input"
            rows={2}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder={props.placeholder ?? "Message…"}
          />
          <div className="sa-composer-bar">
            <span className="sa-hint">Enter to send · Shift+Enter for a new line</span>
            <ComposerPrimitive.Send className="sa-send" aria-label="Send" title="Send">
              <ArrowUpIcon />
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
