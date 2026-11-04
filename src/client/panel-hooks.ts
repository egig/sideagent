// State hooks of the panel shell (AgentChat.tsx): the dock width with its resize handle, and the agent's
// name and availability.
import { useCallback, useContext, useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SetAvailableContext } from "./context.js";
import { storeGet, storeSet, WIDTH_KEY } from "./storage.js";
import { fetchAgentInfo } from "./transport.js";

export const MIN_WIDTH = 300;
const DEFAULT_WIDTH = 400;
export const maxWidth = () => Math.max(MIN_WIDTH, Math.min(760, Math.round(window.innerWidth * 0.7)));
const clampWidth = (w: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(w)));

/** The docked panel's width, remembered, and the props for its drag handle (pointer and arrow keys). */
export function useResizableWidth() {
  const [width, setWidth] = useState(() => clampWidth(Number(storeGet(WIDTH_KEY)) || DEFAULT_WIDTH));
  const [resizing, setResizing] = useState(false);
  const resizeTo = useCallback((w: number) => {
    const next = clampWidth(w);
    setWidth(next);
    return next;
  }, []);
  const handle = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizing(true);
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (resizing) resizeTo(e.currentTarget.parentElement!.getBoundingClientRect().right - e.clientX);
    },
    onPointerUp: () => {
      setResizing(false);
      storeSet(WIDTH_KEY, String(width));
    },
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      const d = e.key === "ArrowLeft" ? 16 : e.key === "ArrowRight" ? -16 : 0;
      if (d) {
        e.preventDefault();
        storeSet(WIDTH_KEY, String(resizeTo(width + d)));
      }
    },
  };
  return { width, resizing, handle };
}

/**
 * Only admin-hosted agents (publishableKey) have a name to show and can say they are unavailable. An agent
 * over a usage cap hides the whole chat, launcher included.
 */
export function useAgentInfo(
  enabled: boolean,
  endpoint: string,
  opts: Parameters<typeof fetchAgentInfo>[0],
): { agentName: string | null; available: boolean } {
  const [agentName, setAgentName] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const reportAvailable = useContext(SetAvailableContext);
  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, endpoint]);
  return { agentName, available };
}
