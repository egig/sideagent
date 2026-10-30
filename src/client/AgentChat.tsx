import {
  ChatBubbleIcon,
  CounterClockwiseClockIcon,
  Cross2Icon,
  OpenInNewWindowIcon,
  PlusIcon,
  ViewVerticalIcon,
} from "@radix-ui/react-icons";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { ThreadResponse } from "../protocol.js";
import { Chat } from "./Chat.js";
import { AgentContext, DockContext, SetAvailableContext } from "./context.js";
import { HistoryList } from "./HistoryList.js";
import { MODE_KEY, readMode, storeGet, storeSet, threadKey, WIDTH_KEY } from "./storage.js";
import { CSS } from "./styles.js";
import { resolveTarget } from "./target.js";
import { callJson, fetchAgentInfo } from "./transport.js";
import type { AgentChatMode, AgentChatProps, Session } from "./types.js";

export type { AgentChatMode, AgentChatProps } from "./types.js";

const MIN_WIDTH = 300;
const DEFAULT_WIDTH = 400;
const maxWidth = () => Math.max(MIN_WIDTH, Math.min(760, Math.round(window.innerWidth * 0.7)));
const clampWidth = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

/** The panel shell: open/close, floating or docked layout, resize, history and session loading. */
export function AgentChat(props: AgentChatProps) {
  // First, so a bad key or missing endpoint throws before anything else renders.
  const target = useMemo(
    () => resolveTarget(props),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.endpoint, props.publishableKey, props.headers],
  );
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
  const remember = props.history !== false;
  const key = threadKey(target.endpoint, props.storageKey);
  const opts = {
    endpoint: target.endpoint,
    credentials: props.credentials,
    headers: target.headers,
    getHeaders: props.getHeaders,
  };

  // Only Cloud agents (publishableKey) have a name to show and can say they are unavailable; an explicit
  // `title` always wins. An agent over a usage cap hides the whole chat, launcher included.
  const [agentName, setAgentName] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const reportAvailable = useContext(SetAvailableContext);
  const wantInfo = props.publishableKey !== undefined;
  useEffect(() => {
    if (!wantInfo) return;
    let live = true;
    void fetchAgentInfo(opts).then((info) => {
      if (!live || !info) return;
      setAgentName(info.name);
      setAvailable(info.available);
      reportAvailable?.(info.available);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantInfo, target.endpoint]);
  const title = props.title ?? agentName ?? "Assistant";

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
          setSession((s) => ({ key: s.key + 1, threadId: id, messages: r.data!.messages }));
          if (remember) storeSet(key, id);
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
    [target, props.credentials, props.getHeaders, remember],
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

  // Another user (storageKey) or endpoint: drop the open conversation and reopen theirs.
  const shownKey = useRef(key);
  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    booted.current = false;
    setView("chat");
    setSession((s) => ({ key: s.key + 1 }));
  }, [key]);

  // Reopen the last conversation the first time the panel is shown.
  useEffect(() => {
    if (!visible || booted.current) return;
    booted.current = true;
    if (!remember) return;
    const last = storeGet(key);
    if (last) void openThread(last);
  }, [visible, key, openThread, remember]);

  if (!available) return null;

  return (
    <div
      className={`sa-root sa-${mode}${docked ? " sa-docked" : ""}${resizing ? " sa-resizing" : ""}`}
      data-theme={props.theme === "system" || !props.theme ? "auto" : props.theme}
    >
      <style>{CSS}</style>
      {!open && props.launcher !== false && (
        <button className="sa-fab" aria-label="Open assistant" onClick={() => setOpen(true)}>
          <ChatBubbleIcon width={22} height={22} />
        </button>
      )}
      {visible && (
        <section className="sa-panel" aria-label={title} style={docked ? { width } : undefined}>
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
            <span className="sa-title">{title}</span>
            {props.allowModeSwitch !== false && (
              <button
                className="sa-btn sa-icon-btn sa-mode-btn"
                onClick={() => setMode(mode === "floating" ? "sidebar" : "floating")}
                title={mode === "floating" ? "Dock to sidebar" : "Float"}
                aria-label={mode === "floating" ? "Dock to sidebar" : "Float"}
              >
                {mode === "floating" ? <ViewVerticalIcon /> : <OpenInNewWindowIcon />}
              </button>
            )}
            {props.headerActions}
            {remember && (
              <button
                className="sa-btn sa-icon-btn"
                aria-pressed={view === "history"}
                onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
                title="History"
                aria-label="History"
              >
                <CounterClockwiseClockIcon />
              </button>
            )}
            {props.newChatButton !== false && (
              <button className="sa-btn sa-icon-btn" onClick={newChat} title="New chat" aria-label="New chat">
                <PlusIcon />
              </button>
            )}
            <button className="sa-btn sa-icon-btn" onClick={() => setOpen(false)} aria-label="Close" title="Close">
              <Cross2Icon />
            </button>
          </header>
          {remember && view === "history" && (
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
                {...target}
                session={session}
                onThread={(id) => remember && storeSet(key, id)}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}
