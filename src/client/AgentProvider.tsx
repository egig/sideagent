import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AgentChat } from "./AgentChat.js";
import { AgentContext, DockContext } from "./context.js";
import type { AgentChatProps } from "./types.js";

/** Lays the app and a docked sidebar chat side by side, and shares open state via `useAgent`. Takes the same props as AgentChat. */
export function AgentProvider({
  children,
  className,
  style,
  ...chat
}: AgentChatProps & { children: ReactNode; className?: string; style?: CSSProperties }) {
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
