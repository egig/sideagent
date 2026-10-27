import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
} from "@assistant-ui/react";
import {
  CheckCircledIcon,
  ChatBubbleIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CounterClockwiseClockIcon,
  Cross2Icon,
  CrossCircledIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ExclamationTriangleIcon,
  OpenInNewWindowIcon,
  PlusIcon,
  ReloadIcon,
  TrashIcon,
  ViewVerticalIcon,
} from "@radix-ui/react-icons";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentEvent, HistoryMessage, ThreadMeta, ThreadResponse } from "../protocol.js";
import { safely, type AgentHooks, type OperationEvent } from "./hooks.js";
import { humanize, ResultView } from "./results.js";
import { CSS } from "./styles.js";
import { callJson, streamChat } from "./transport.js";

export type AgentChatMode = "floating" | "sidebar";
type ApprovalEvent = Extract<AgentEvent, { type: "approval.request" }>;

export interface AgentChatProps {
  /** URL of your sideagent endpoint, e.g. "/api/agent". */
  endpoint: string;
  /** Starting layout. The user can switch; their choice is remembered. */
  mode?: AgentChatMode;
  title?: string;
  placeholder?: string;
  hooks?: AgentHooks;
  /**
   * Extra info about the page (route, selected record). The model sees it as untrusted data;
   * it never grants permissions.
   */
  context?: unknown | (() => unknown);
  /** Use "include" when the endpoint is on another origin and relies on cookies. */
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  defaultOpen?: boolean;
  /** Custom result views per operationId. Anything not listed gets the built-in table / fields view. */
  resultRenderers?: Record<string, (e: { operationId: string; args: unknown; result: unknown }) => ReactNode>;
  /** "auto" follows the OS and host `.dark` / `data-theme=dark`. Colors are overridable via --sideagent-* CSS variables. */
  theme?: "auto" | "light" | "dark";
  /** Set false to hide the layout switcher. */
  allowModeSwitch?: boolean;
}

const MODE_KEY = "sideagent:mode";
const WIDTH_KEY = "sideagent:width";
const threadKey = (endpoint: string) => `sideagent:thread:${endpoint}`;

interface Session {
  key: number;
  threadId?: string;
  messages?: HistoryMessage[];
  pending?: ApprovalEvent;
}

function storeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function storeSet(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

function toInitialMessages(messages: HistoryMessage[] | undefined) {
  return (messages ?? []).map((m) =>
    m.role === "user"
      ? { role: "user" as const, content: m.parts.map((p) => ({ type: "text" as const, text: p.type === "text" ? p.text : "" })) }
      : {
          role: "assistant" as const,
          content: m.parts.map((p: any) =>
            p.type === "text"
              ? { type: "text" as const, text: p.text }
              : { type: "tool-call" as const, toolCallId: p.callId, toolName: p.operationId, args: p.args ?? {}, argsText: pretty(p.args), result: p.result },
          ),
          status: { type: "complete" as const, reason: "stop" as const },
        },
  );
}

function fireComplete(hooks: AgentHooks | undefined, ev: Extract<AgentEvent, { type: "tool.complete" }>) {
  const oe: OperationEvent = { operationId: ev.operationId, status: ev.status, args: ev.args, result: ev.result };
  safely(() => hooks?.onAnyOperation?.(oe));
  safely(() => hooks?.onOperationComplete?.[ev.operationId]?.(oe));
  for (const tag of ev.invalidates) safely(() => hooks?.onInvalidate?.(tag, oe));
}

const ago = (t: number) => {
  const s = Math.round((t - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const a = Math.abs(s);
  if (a < 60) return rtf.format(s, "second");
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
};
const MODES: AgentChatMode[] = ["floating", "sidebar"];
const MIN_WIDTH = 300;
const DEFAULT_WIDTH = 400;
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(760, Math.round(window.innerWidth * 0.7)));
const clampWidth = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

/** Set by AgentProvider so a sidebar chat docks beside the app instead of floating over it. */
const DockContext = createContext(false);

export interface AgentControls {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const AgentContext = createContext<AgentControls | null>(null);

/** Open or close the assistant from anywhere under `AgentProvider`. */
export function useAgent(): AgentControls {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used inside <AgentProvider>");
  return ctx;
}

/** Lays the app and a docked sidebar chat side by side, and shares open state via `useAgent`. Takes the same props as AgentChat. */
export function AgentProvider({ children, className, style, ...chat }: AgentChatProps & { children: ReactNode; className?: string; style?: CSSProperties }) {
  const [open, setOpen] = useState(chat.defaultOpen ?? false);
  const controls = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <AgentContext.Provider value={controls}>
      <DockContext.Provider value>
        <div className={`sa-shell${className ? ` ${className}` : ""}`} style={style}>
          <div className="sa-shell-main">{children}</div>
          <AgentChat {...chat} />
        </div>
      </DockContext.Provider>
    </AgentContext.Provider>
  );
}

function readMode(fallback: AgentChatMode): AgentChatMode {
  try {
    const v = localStorage.getItem(MODE_KEY) as AgentChatMode | null;
    return v && MODES.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

const pretty = (v: unknown) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

/** Plain-text only: model output is never rendered as HTML and links/images are never auto-loaded. */
const Text = ({ text }: { text: string }) => <span>{text}</span>;

const RenderersContext = createContext<AgentChatProps["resultRenderers"]>(undefined);

const httpUrl = (u: unknown): string | null => {
  try {
    const url = new URL(String(u));
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Knowledge search shows where the answer came from. Links only for http(s) URLs from your config. */
function Sources({ result }: { result: unknown }) {
  const sources = ((result as any)?.sources ?? []) as { id: string; title: string; url?: string }[];
  if (typeof (result as any)?.error === "string") return <div className="sa-error">{(result as any).error}</div>;
  if (!sources.length) return <div className="sa-more">No relevant sources found.</div>;
  return (
    <ul className="sa-sources">
      {sources.map((s) => {
        const href = s.url ? httpUrl(s.url) : null;
        return (
          <li key={s.id}>
            <FileTextIcon />
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {s.title} <ExternalLinkIcon />
              </a>
            ) : (
              <span>{s.title}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ToolCard(props: { toolName: string; args: unknown; result?: unknown }) {
  const renderers = useContext(RenderersContext);
  const { toolName, args, result } = props;
  const rejected = (result as any)?.rejected === true;
  const failed = !rejected && typeof (result as any)?.error === "string";
  const running = result === undefined;
  const custom = renderers?.[toolName];
  return (
    <div className="sa-tool" data-state={running ? "running" : rejected ? "rejected" : failed ? "error" : "done"}>
      <div className="sa-tool-head">
        {running ? <ReloadIcon className="sa-spin" /> : rejected || failed ? <CrossCircledIcon /> : <CheckCircledIcon />}
        <span>{toolName === "search_knowledge" ? "Sources" : humanize(toolName)}</span>
      </div>
      {!running &&
        (custom ? custom({ operationId: toolName, args, result }) : toolName === "search_knowledge" ? <Sources result={result} /> : <ResultView result={result} />)}
      <details className="sa-details">
        <summary>
          <ChevronRightIcon /> Details
        </summary>
        <pre>{pretty(args)}</pre>
        {!running && <pre>{pretty(result)}</pre>}
      </details>
    </div>
  );
}

/** Model output is untrusted: react-markdown drops raw HTML, and links open in a new tab without referrer. */
const mdComponents = {
  a: ({ node: _n, ...p }: any) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" />,
};

const UserMessage = () => (
  <MessagePrimitive.Root className="sa-msg sa-user">
    <MessagePrimitive.Parts components={{ Text }} />
  </MessagePrimitive.Root>
);

const AssistantMessage = () => (
  <MessagePrimitive.Root style={{ display: "contents" }}>
    <MessagePrimitive.Parts
      components={{
        Text: ({ text }: { text: string }) => (text ? (
          <div className="sa-msg sa-assistant sa-md">
            <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {text}
            </Markdown>
          </div>
        ) : null),
        tools: { Fallback: ToolCard as any },
      }}
    />
  </MessagePrimitive.Root>
);

/** Primitive top-level values of the request (and its body), shown as plain "Label: value" rows. */
function summaryFields(args: unknown): [string, string][] {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const body = a.body && typeof a.body === "object" && !Array.isArray(a.body) ? (a.body as Record<string, unknown>) : {};
  const { body: _body, ...rest } = a;
  return Object.entries({ ...rest, ...body })
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => [humanize(k), String(v)]);
}

function ApprovalCard({ event, onDecide }: { event: ApprovalEvent; onDecide: (d: "approve" | "reject") => void }) {
  const action = humanize(event.operationId).toLowerCase();
  const fields = summaryFields(event.args);
  return (
    <div className="sa-approval" role="alertdialog" aria-label="Approval needed">
      <strong className="sa-approval-title">
        <ExclamationTriangleIcon /> Confirm before I continue
      </strong>
      <p className="sa-approval-text">
        I'd like to <strong>{action}</strong>. Nothing changes until you approve.
      </p>
      {fields.length > 0 && (
        <dl className="sa-fields">
          {fields.map(([k, v]) => (
            <div key={k} className="sa-field">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="sa-details">
        <summary>
          <ChevronRightIcon /> Details
        </summary>
        <pre>
          {event.method} {event.path}
          {"\n"}
          {pretty(event.args)}
        </pre>
      </details>
      <div className="sa-row">
        <button className="sa-btn sa-btn-primary" onClick={() => onDecide("approve")}>
          Approve
        </button>
        <button className="sa-btn" onClick={() => onDecide("reject")}>
          Reject
        </button>
      </div>
    </div>
  );
}

function Chat(props: AgentChatProps & { session: Session; onThread: (id: string) => void; onReload: () => void }) {
  const { endpoint, hooks, credentials, headers } = props;
  const latest = useRef(props);
  latest.current = props;
  const threadId = useRef<string | undefined>(props.session.threadId);
  const [loadedPending, setLoadedPending] = useState<ApprovalEvent | null>(props.session.pending ?? null);
  const [approval, setApproval] = useState<{ event: ApprovalEvent; decide: (d: "approve" | "reject") => void } | null>(null);

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

        const parts: any[] = [];
        const upsertTool = (callId: string, patch: Record<string, unknown>) => {
          let part = parts.find((x) => x.type === "tool-call" && x.toolCallId === callId);
          if (!part) {
            part = { type: "tool-call", toolCallId: callId, toolName: "", args: {}, argsText: "{}" };
            parts.push(part);
          }
          Object.assign(part, patch);
        };
        safely(p.hooks?.onTurnStart);
        let body: Parameters<typeof streamChat>[0] = { threadId: threadId.current, message: text, context: ctx };
        try {
          for (;;) {
            let pending: ApprovalEvent | undefined;
            for await (const ev of streamChat(body, { endpoint: p.endpoint, credentials: p.credentials, headers: p.headers, signal: abortSignal })) {
              switch (ev.type) {
                case "turn.start":
                  threadId.current = ev.threadId;
                  p.onThread(ev.threadId);
                  break;
                case "text.delta": {
                  const tail = parts[parts.length - 1];
                  if (tail?.type === "text") tail.text += ev.text;
                  else parts.push({ type: "text", text: ev.text });
                  break;
                }
                case "approval.request":
                  pending = ev;
                  upsertTool(ev.callId, { toolName: ev.operationId, args: ev.args as any, argsText: pretty(ev.args) });
                  break;
                case "tool.start":
                  upsertTool(ev.callId, { toolName: ev.operationId });
                  break;
                case "tool.rejected":
                  upsertTool(ev.callId, { toolName: ev.operationId, result: { rejected: true } });
                  break;
                case "tool.complete": {
                  upsertTool(ev.callId, { toolName: ev.operationId, args: (ev.args ?? {}) as any, argsText: pretty(ev.args), result: ev.result ?? null });
                  fireComplete(p.hooks, ev);
                  break;
                }
                case "error":
                  parts.push({ type: "text", text: `⚠ ${ev.message}` });
                  safely(() => p.hooks?.onError?.({ code: ev.code, message: ev.message }));
                  break;
              }
              yield { content: parts.map((x) => ({ ...x })) };
            }
            if (!pending) break;
            const req = pending;
            safely(() => p.hooks?.onApprovalRequested?.(req));
            const decision = await new Promise<"approve" | "reject">((resolve) => {
              abortSignal.addEventListener("abort", () => resolve("reject"), { once: true });
              setApproval({ event: req, decide: resolve });
            });
            setApproval(null);
            body = { threadId: threadId.current!, approval: { token: req.token, decision } };
          }
        } finally {
          setApproval(null);
          safely(p.hooks?.onTurnEnd);
        }
        yield { content: parts.map((x) => ({ ...x })) };
      },
    }),
    // endpoint/hooks/etc. are read through `latest`, so the adapter stays stable.
    [endpoint, hooks, credentials, headers],
  );

  const runtime = useLocalRuntime(adapter, { initialMessages: toInitialMessages(props.session.messages) });

  const decideLoaded = async (decision: "approve" | "reject") => {
    const req = loadedPending;
    if (!req || !threadId.current) return;
    setLoadedPending(null);
    for await (const ev of streamChat({ threadId: threadId.current, approval: { token: req.token, decision } }, { endpoint, credentials, headers })) {
      if (ev.type === "tool.complete") fireComplete(hooks, ev);
      if (ev.type === "error") safely(() => hooks?.onError?.({ code: ev.code, message: ev.message }));
    }
    props.onReload();
  };
  const shownApproval = approval?.event ?? loadedPending;
  const decide = (d: "approve" | "reject") => (approval ? approval.decide(d) : void decideLoaded(d));

  return (
    <RenderersContext.Provider value={props.resultRenderers}>
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root style={{ display: "contents" }}>
        <ThreadPrimitive.Viewport className="sa-viewport">
          <ThreadPrimitive.Empty>
            <div className="sa-empty">Ask me to look things up or make changes. I will ask before changing anything.</div>
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
        </ThreadPrimitive.Viewport>
        {shownApproval && <ApprovalCard event={shownApproval} onDecide={decide} />}
        <ComposerPrimitive.Root className="sa-composer">
          <ComposerPrimitive.Input className="sa-input" rows={2} placeholder={props.placeholder ?? "Message…"} disabled={!!shownApproval} />
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

function HistoryList(props: { endpoint: string; credentials?: RequestCredentials; headers?: Record<string, string>; onOpen: (id: string) => void; onClose: () => void; onDeleted: (id: string) => void }) {
  const [threads, setThreads] = useState<ThreadMeta[] | null>(null);
  const [error, setError] = useState(false);
  const opts = { endpoint: props.endpoint, credentials: props.credentials, headers: props.headers };
  useEffect(() => {
    callJson<{ threads: ThreadMeta[] }>({ action: "threads.list" }, opts)
      .then((r) => (r.data?.threads ? setThreads(r.data.threads) : setError(true)))
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remove = async (id: string) => {
    await callJson({ action: "threads.delete", threadId: id }, opts);
    setThreads((t) => t?.filter((x) => x.id !== id) ?? null);
    props.onDeleted(id);
  };
  return (
    <div className="sa-viewport sa-history">
      <button className="sa-btn sa-back" onClick={props.onClose}>
        <ArrowLeftIcon /> Back to chat
      </button>
      {error && <div className="sa-error">Could not load history.</div>}
      {threads === null && !error && <div className="sa-more">Loading…</div>}
      {threads?.length === 0 && <div className="sa-empty">No conversations yet.</div>}
      {threads?.map((t) => (
        <div key={t.id} className="sa-thread">
          <button className="sa-thread-open" onClick={() => props.onOpen(t.id)}>
            <span className="sa-thread-title">{t.title}</span>
            <span className="sa-more">{ago(t.updatedAt)}</span>
          </button>
          <button className="sa-btn sa-icon-btn" aria-label="Delete conversation" title="Delete" onClick={() => void remove(t.id)}>
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AgentChat(props: AgentChatProps) {
  const [mode, setModeState] = useState<AgentChatMode>(() => readMode(props.mode ?? "floating"));
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false);
  const shared = useContext(AgentContext);
  const open = shared ? shared.open : localOpen;
  const setOpen = shared ? shared.setOpen : setLocalOpen;
  const [view, setView] = useState<"chat" | "history">("chat");
  const [session, setSession] = useState<Session>({ key: 0 });
  const [loading, setLoading] = useState(false);
  const docked = useContext(DockContext) && mode === "sidebar";
  const [width, setWidth] = useState(() => clampWidth(Number(storeGet(WIDTH_KEY)) || DEFAULT_WIDTH));
  const [resizing, setResizing] = useState(false);
  const booted = useRef(false);
  const key = threadKey(props.endpoint);
  const opts = { endpoint: props.endpoint, credentials: props.credentials, headers: props.headers };

  const setMode = useCallback((m: AgentChatMode) => {
    setModeState(m);
    storeSet(MODE_KEY, m);
  }, []);

  const openThread = useCallback(
    async (id: string) => {
      setLoading(true);
      try {
        const r = await callJson<ThreadResponse>({ action: "threads.get", threadId: id }, opts);
        if (r.status === 200 && r.data) {
          setSession((s) => ({ key: s.key + 1, threadId: id, messages: r.data!.messages, pending: r.data!.pending }));
          storeSet(key, id);
        } else {
          if (r.status === 404) storeSet(key, null);
          setSession((s) => ({ key: s.key + 1 }));
        }
      } catch {
        setSession((s) => ({ key: s.key + 1 }));
      } finally {
        setLoading(false);
        setView("chat");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.endpoint, props.credentials, props.headers],
  );

  const resizeTo = useCallback((w: number) => {
    const next = clampWidth(w);
    setWidth(next);
    return next;
  }, []);
  const onHandleDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onHandleMove = (e: PointerEvent<HTMLDivElement>) => {
    if (resizing) resizeTo(e.currentTarget.parentElement!.getBoundingClientRect().right - e.clientX);
  };
  const onHandleUp = () => {
    setResizing(false);
    storeSet(WIDTH_KEY, String(width));
  };
  const onHandleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
    if (d) {
      e.preventDefault();
      storeSet(WIDTH_KEY, String(resizeTo(width + d)));
    }
  };

  const newChat = () => {
    storeSet(key, null);
    setSession((s) => ({ key: s.key + 1 }));
    setView("chat");
  };

  const visible = open;

  // Reopen the last conversation the first time the panel is shown.
  useEffect(() => {
    if (!visible || booted.current) return;
    booted.current = true;
    const last = storeGet(key);
    if (last) void openThread(last);
  }, [visible, key, openThread]);

  return (
    <div className={`sa-root sa-${mode}${docked ? " sa-docked" : ""}${resizing ? " sa-resizing" : ""}`} data-theme={props.theme ?? "auto"}>
      <style>{CSS}</style>
      {!open && (
        <button className="sa-fab" aria-label="Open assistant" onClick={() => setOpen(true)}>
          <ChatBubbleIcon width={22} height={22} />
        </button>
      )}
      {visible && (
        <section className="sa-panel" aria-label={props.title ?? "Assistant"} style={docked ? { width } : undefined}>
          {docked && (
            <div
              className="sa-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize assistant"
              aria-valuemin={MIN_WIDTH}
              aria-valuemax={maxWidth()}
              aria-valuenow={width}
              tabIndex={0}
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              onKeyDown={onHandleKey}
            />
          )}
          <header className="sa-header">
            <span className="sa-title">{props.title ?? "Assistant"}</span>
            {props.allowModeSwitch !== false && (
              <button
                className="sa-btn sa-icon-btn"
                onClick={() => setMode(mode === "floating" ? "sidebar" : "floating")}
                title={mode === "floating" ? "Dock to sidebar" : "Float"}
                aria-label={mode === "floating" ? "Dock to sidebar" : "Float"}
              >
                {mode === "floating" ? <ViewVerticalIcon /> : <OpenInNewWindowIcon />}
              </button>
            )}
            <button className="sa-btn sa-icon-btn" aria-pressed={view === "history"} onClick={() => setView((v) => (v === "history" ? "chat" : "history"))} title="History" aria-label="History">
              <CounterClockwiseClockIcon />
            </button>
            <button className="sa-btn sa-icon-btn" onClick={newChat} title="New chat" aria-label="New chat">
              <PlusIcon />
            </button>
            <button className="sa-btn sa-icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close">
              <Cross2Icon />
            </button>
          </header>
          {view === "history" && (
            <HistoryList
              {...opts}
              onOpen={(id) => void openThread(id)}
              onClose={() => setView("chat")}
              onDeleted={(id) => {
                if (id === session.threadId) newChat();
              }}
            />
          )}
          {/* Kept mounted while History is open so an in-flight turn is not cancelled. */}
          <div className="sa-chatwrap" hidden={view === "history"}>
            {loading ? (
              <div className="sa-viewport">
                <div className="sa-more">Loading…</div>
              </div>
            ) : (
              <Chat
                key={session.key}
                {...props}
                session={session}
                onThread={(id) => storeSet(key, id)}
                onReload={() => session.threadId && void openThread(session.threadId)}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
