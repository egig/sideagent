// Agent preview (D-31): the sideagent chat UI, docked inside the agent's pages, talking to
// POST /api/agents/:id/preview. It sits inside the dashboard assistant's own dock, so the
// assistant stays the outermost panel on the right. Dogfooding: this is the library's AgentProvider,
// nothing else. The test token lives in this component's state only: never storage, never a URL.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AgentProvider, useAgent } from "sideagent";
import { agentQuery } from "~/app/api/agents";
import { ApiError, api } from "~/app/api/client";
import { Callout, HeaderActionsContext, Section } from "~/app/ui";
import { useT } from "~/i18n";

type Check = "idle" | "checking" | "ok" | { reason: string };

// Shares the test token with the settings page, where the "Test token" panel lives (User auth).
const TokenContext = createContext<{ token: string; setToken: (v: string) => void }>({ token: "", setToken: () => {} });

export function PreviewProvider({ agentId, children }: { agentId: string; children: ReactNode }) {
  const { data } = useQuery(agentQuery(agentId));
  const t = useT();
  const [token, setToken] = useState("");
  // Bumped by "Clear": remounts the chat so it starts a new conversation. The panel was open, so it stays open.
  const [epoch, setEpoch] = useState(0);
  const version = data?.agent.configVersion;
  // The version is part of the endpoint, so a thread never outlives the config it was tested on.
  const endpoint = `/api/agents/${agentId}/preview?v=${version ?? 0}`;
  const headers = useMemo(() => (token.trim() ? { authorization: `Bearer ${token.trim()}` } : undefined), [token]);

  return (
    <AgentProvider
      key={epoch}
      className="preview-chat"
      endpoint={endpoint}
      credentials="include"
      headers={headers}
      mode="sidebar"
      defaultOpen={epoch > 0}
      // Opened only from the page header's "Open preview"; no launcher bubble, no remembered conversations.
      launcher={false}
      history={false}
      newChatButton={false}
      headerActions={
        <>
          <span className="sa-preview-badge">{t.preview.badge}</span>
          <PreviewClear agentId={agentId} onCleared={() => setEpoch((n) => n + 1)} />
        </>
      }
      title={data?.agent.name ?? t.preview.title}
      placeholder={t.preview.placeholder}
    >
      <TokenContext.Provider value={{ token, setToken }}>
        <HeaderActionsContext.Provider value={<PreviewToggle />}>{children}</HeaderActionsContext.Provider>
      </TokenContext.Provider>
    </AgentProvider>
  );
}

// Lives in the page header's right-hand actions (see Page in ui.tsx).
function PreviewToggle() {
  const { open, setOpen } = useAgent();
  const t = useT();
  return (
    <button type="button" className="btn" aria-pressed={open} onClick={() => setOpen(!open)}>
      {open ? t.preview.close : t.preview.open}
    </button>
  );
}

// Lives in the chat panel's header (the library's `headerActions`).
function PreviewClear({ agentId, onCleared }: { agentId: string; onCleared: () => void }) {
  const t = useT();
  const [error, setError] = useState(false);

  async function clear() {
    setError(false);
    try {
      await api(`/agents/${agentId}/preview/threads`, { method: "DELETE" });
      onCleared();
    } catch {
      setError(true);
    }
  }

  return (
    <>
      {error && <span className="text-[12px] text-danger">{t.common.retry}</span>}
      <button
        type="button"
        className="sa-btn sa-icon-btn"
        onClick={clear}
        title={t.preview.clear}
        aria-label={t.preview.clear}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v5M14 11v5" />
        </svg>
      </button>
    </>
  );
}

// Rendered in Settings, User auth: only when the agent identifies users by token.
export function TestToken({ agentId }: { agentId: string }) {
  const { token, setToken } = useContext(TokenContext);
  const t = useT();
  const [check, setCheck] = useState<Check>("idle");

  async function checkToken() {
    setCheck("checking");
    try {
      await api(`/agents/${agentId}/preview`, {
        method: "POST",
        body: JSON.stringify({ action: "threads.list" }),
        headers: { authorization: `Bearer ${token.trim()}` },
      });
      setCheck("ok");
    } catch (e) {
      const reason =
        e instanceof ApiError && e.status === 401 ? (e.body as { reason?: string } | null)?.reason : undefined;
      setCheck({ reason: reason ?? "other" });
    }
  }

  return (
    <div className="card m-0">
      <Section id="test-token" title={t.preview.tokenLabel} explanation={t.preview.tokenHint}>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="preview-token"
            type="password"
            aria-label={t.preview.tokenLabel}
            autoComplete="off"
            spellCheck={false}
            className="input min-w-0 flex-1"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setCheck("idle");
            }}
          />
          <button type="button" className="btn" disabled={!token.trim() || check === "checking"} onClick={checkToken}>
            {t.preview.checkToken}
          </button>
        </div>
        {check === "ok" && <Callout tone="note">{t.preview.tokenOk}</Callout>}
        {typeof check === "object" && <Callout tone="warn">{t.preview.tokenReason(check.reason)}</Callout>}
      </Section>
    </div>
  );
}
