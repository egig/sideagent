import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import { ArrowUpIcon } from "@radix-ui/react-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApprovalCard } from "./ApprovalCard.js";
import { RenderersContext } from "./context.js";
import { safely, turnHooks } from "./hooks.js";
import { AssistantMessage, UserMessage } from "./Messages.js";
import { applyEvent, toInitialMessages, type Part } from "./parts.js";
import { streamChat } from "./transport.js";
import type { AgentChatProps, ApprovalEvent, Decision, Session } from "./types.js";

/** One conversation: streams turns, pauses on approval requests, and resumes with the user's decision. */
export function Chat(
  props: AgentChatProps & { endpoint: string; session: Session; onThread: (id: string) => void; onReload: () => void },
) {
  const { endpoint, hooks, credentials, headers, getHeaders } = props;
  const latest = useRef(props);
  latest.current = props;
  const threadId = useRef<string | undefined>(props.session.threadId);
  // An approval the thread was already waiting on when loaded from history.
  const [loadedPending, setLoadedPending] = useState<ApprovalEvent | null>(props.session.pending ?? null);
  // An approval raised during a live turn; `decide` resumes the adapter's generator.
  const [approval, setApproval] = useState<{ event: ApprovalEvent; decide: (d: Decision) => void } | null>(null);

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
        let body: Parameters<typeof streamChat>[0] = { threadId: threadId.current, message: text, context: ctx };
        try {
          for (;;) {
            let pending: ApprovalEvent | undefined;
            for await (const ev of streamChat(body, {
              endpoint: p.endpoint,
              credentials: p.credentials,
              headers: p.headers,
              getHeaders: p.getHeaders,
              signal: abortSignal,
            })) {
              parts = applyEvent(parts, ev);
              turn.event(ev);
              if (ev.type === "turn.start") {
                threadId.current = ev.threadId;
                p.onThread(ev.threadId);
              } else if (ev.type === "approval.request") {
                pending = ev;
              }
              yield { content: parts as any };
            }
            if (!pending) break;
            const req = pending;
            safely(() => p.hooks?.onApprovalRequested?.(req));
            const decision = await new Promise<Decision>((resolve) => {
              abortSignal.addEventListener("abort", () => resolve("reject"), { once: true });
              setApproval({ event: req, decide: resolve });
            });
            setApproval(null);
            body = { threadId: threadId.current!, approval: { token: req.token, decision } };
          }
        } finally {
          setApproval(null);
          turn.end();
        }
        yield { content: parts as any };
      },
    }),
    // endpoint/hooks/etc. are read through `latest`, so the adapter stays stable.
    [endpoint, hooks, credentials, headers],
  );

  const runtime = useLocalRuntime(adapter, { initialMessages: toInitialMessages(props.session.messages) });

  // A restored approval is waiting on the user just like a live one.
  const announced = useRef(false);
  useEffect(() => {
    const req = props.session.pending;
    if (!req || announced.current) return;
    announced.current = true;
    safely(() => latest.current.hooks?.onApprovalRequested?.(req));
  }, [props.session.pending]);

  const decideLoaded = async (decision: Decision) => {
    const req = loadedPending;
    if (!req || !threadId.current) return;
    setLoadedPending(null);
    const turn = turnHooks(hooks);
    try {
      for await (const ev of streamChat(
        { threadId: threadId.current, approval: { token: req.token, decision } },
        { endpoint, credentials, headers, getHeaders },
      )) {
        turn.event(ev);
      }
    } catch {
      turn.event({ type: "error", code: "network", message: "Connection lost. Reload to see the result." });
    } finally {
      turn.end();
    }
    props.onReload();
  };
  const shownApproval = approval?.event ?? loadedPending;
  const decide = (d: Decision) => (approval ? approval.decide(d) : void decideLoaded(d));

  return (
    <RenderersContext.Provider value={props.resultRenderers}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root style={{ display: "contents" }}>
          <ThreadPrimitive.Viewport className="sa-viewport">
            <ThreadPrimitive.Empty>
              <div className="sa-empty">
                Ask me to look things up or make changes. I will ask before changing anything.
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </ThreadPrimitive.Viewport>
          {shownApproval && <ApprovalCard event={shownApproval} onDecide={decide} />}
          <ComposerPrimitive.Root className="sa-composer">
            <ComposerPrimitive.Input
              className="sa-input"
              rows={2}
              placeholder={props.placeholder ?? "Message…"}
              disabled={!!shownApproval}
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
    </RenderersContext.Provider>
  );
}
