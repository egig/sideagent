import type { ReactNode } from "react";
import { AgentChat as Panel } from "./AgentChat.js";
import { AgentProvider as ProviderPanel } from "./AgentProvider.js";
import type { AgentChatProps as PanelProps } from "./types.js";

/** The props a host app sets. Where requests go comes from the publishable key alone. */
export interface AgentChatProps extends Omit<
  PanelProps,
  "endpoint" | "publishableKey" | "credentials" | "headers" | "getHeaders"
> {
  /** The agent's publishable key (`pk_…`), from the dashboard. It names the agent and the server that runs it. */
  publishableKey: string;
  /**
   * Returns the signed-in user's token (a JWT or access token your agent's end-user auth accepts), or null for an
   * anonymous visitor. Called before every request, so it can refresh. If it throws, the request is not sent.
   */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
}

const withToken = ({ getToken, ...rest }: AgentChatProps): PanelProps => ({
  ...rest,
  getHeaders: getToken
    ? async (): Promise<Record<string, string>> => {
        const token = await getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      }
    : undefined,
});

/** The chat panel. Floating or docked, with history, themed by --sideagent-* CSS variables. */
export function AgentChat(props: AgentChatProps) {
  return <Panel {...withToken(props)} />;
}

/** Lays the app and a docked sidebar chat side by side, and shares open state via `useAgent`. Takes the same props as AgentChat. */
export function AgentProvider(
  props: AgentChatProps & { children: ReactNode; className?: string; style?: React.CSSProperties },
) {
  const { children, className, style, ...chat } = props;
  return (
    <ProviderPanel {...withToken(chat)} className={className} style={style}>
      {children}
    </ProviderPanel>
  );
}
