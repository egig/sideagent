import { useState } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { Agent, AgentDetail, ReadinessItem } from "@shared/api";
import { agentQuery, agentsQuery, setActive } from "~/app/api/agents";
import type { SettingsTab } from "~/app/settings/tabs";
import { errorMessage } from "~/app/api/client";
import { statsQuery } from "~/app/api/agents";
import { Stats } from "~/app/overview/stats";
import { Embed } from "~/app/embed";
import { useSetupProgress } from "~/app/setup/progress";
import { Alert, Callout, CopyButton, Icon, Page } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/_authed/agents/$agentId/")({
  component: Overview,
});

// Where each readiness item is fixed.
type Fix = { to: "/agents/$agentId/knowledge" } | { to: "/agents/$agentId/settings"; search: { tab: SettingsTab } };
const FIX: Record<ReadinessItem["id"], Fix> = {
  content: { to: "/agents/$agentId/knowledge" },
  origins: { to: "/agents/$agentId/settings", search: { tab: "general" } },
  llm: { to: "/agents/$agentId/settings", search: { tab: "llm" } },
  auth: { to: "/agents/$agentId/settings", search: { tab: "auth" } },
};

function Overview() {
  const { agentId } = Route.useParams();
  const { data } = useSuspenseQuery(agentQuery(agentId));
  const { agent, readiness } = data;
  const { status, common, overview: t } = useT();
  const queryClient = useQueryClient();
  const missing = readiness.filter((r) => !r.ok);
  const [needsSetup, setNeedsSetup] = useState(false);
  const active = agent.status === "active";
  const toggle = useMutation({
    mutationFn: (next: boolean) => setActive(agent.id, next),
    onSuccess: async (detail) => {
      queryClient.setQueryData(agentQuery(agent.id).queryKey, detail);
      await queryClient.invalidateQueries({ queryKey: agentsQuery.queryKey, exact: true });
    },
  });
  const flip = () => {
    if (!active && missing.length > 0) setNeedsSetup(true);
    else toggle.mutate(!active);
  };

  return (
    <Page
      title={agent.name}
      actions={
        <button
          type="button"
          role="switch"
          aria-checked={active}
          aria-label={t.activeLabel}
          className="btn"
          disabled={toggle.isPending}
          onClick={flip}
        >
          <span aria-hidden="true" className={`size-2 rounded-full ${active ? "bg-success" : "bg-ink-muted"}`} />
          {active ? status.active : status.inactive}
        </button>
      }
    >
      {toggle.error && <Alert>{errorMessage(toggle.error, active ? t.deactivateFailed : t.activateFailed)}</Alert>}
      {!active && <SetupCallout agentId={agentId} detail={data} />}
      {active && <Attention agentId={agentId} failed={agent.knowledge.failed} />}
      {active && <Stats agentId={agentId} />}
      <AlertDialog.Root open={needsSetup} onOpenChange={setNeedsSetup}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="fixed inset-0 z-40 bg-scrim" />
          <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-[20px] border border-line bg-surface-raised p-6 shadow-lg outline-none">
            <AlertDialog.Title className="m-0 text-[17px] leading-6 font-semibold">
              {t.setupNeededTitle}
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 mb-0 text-ink-muted">{t.setupNeededBody}</AlertDialog.Description>
            <ul className="mt-3 mb-0 flex list-none flex-col gap-2 p-0">
              {missing.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <span>{r.label}</span>
                  <Link {...FIX[r.id]} params={{ agentId }} className="btn" onClick={() => setNeedsSetup(false)}>
                    {t.fixItem}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end">
              <AlertDialog.Close className="btn">{common.cancel}</AlertDialog.Close>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
      <KeysAndEndpoint agent={agent} />
      <Embed agent={agent} />
    </Page>
  );
}

function KeysAndEndpoint({ agent }: { agent: Agent }) {
  const { common, overview: t } = useT();
  return (
    <section className="card flex flex-col gap-4 p-5" aria-labelledby="keys-heading">
      <h2 id="keys-heading" className="m-0 text-[17px] leading-6 font-semibold">
        {t.keysHeading}
      </h2>
      <div className="flex flex-col gap-1.5">
        <span className="label m-0">{t.publishableKey}</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex min-h-10 min-w-0 flex-1 items-center overflow-x-auto rounded-[10px] border border-line bg-surface-subtle px-3 font-mono text-[13px] whitespace-nowrap">
            {agent.publishableKey}
          </code>
          <CopyButton value={agent.publishableKey} label={common.copyLabel(t.publishableKey)} />
        </div>
        <p className="m-0 text-[13px] text-ink-muted">{t.publishableHint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="label m-0">{t.endpoint}</span>
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex min-h-10 min-w-0 flex-1 items-center overflow-x-auto rounded-[10px] border border-line bg-surface-subtle px-3 font-mono text-[13px] whitespace-nowrap">
            POST {agent.endpoint}
          </code>
          <CopyButton value={agent.endpoint} label={common.copyLabel(t.endpoint)} />
        </div>
        <p className="m-0 text-[13px] text-ink-muted">
          {!agent.auth ? (
            t.noAuthHint
          ) : agent.auth.mode === "anonymous" ? (
            t.anonymousHint
          ) : (
            <>
              {t.tokenHintBefore}
              <code className="font-mono">Authorization: Bearer</code>
              {t.tokenHintAfter}
            </>
          )}
        </p>
      </div>
      <p className="m-0 font-mono text-[13px] text-ink-muted">
        {agent.id} · config v{agent.configVersion}
      </p>
    </section>
  );
}

function SetupCallout({ agentId, detail }: { agentId: string; detail: AgentDetail }) {
  const t = useT().overview;
  const progress = useSetupProgress(detail);
  return (
    <Callout>
      <span className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {t.inactiveNote} {t.setupProgress(progress.count, progress.total)}
        </span>
        <Link to="/agents/$agentId/setup" params={{ agentId }} className="btn btn-primary">
          {t.continueSetup}
        </Link>
      </span>
    </Callout>
  );
}

// What to fix on a live agent, each with the place to fix it.
function Attention({ agentId, failed }: { agentId: string; failed: number }) {
  const t = useT().overview;
  const { data } = useQuery(statsQuery(agentId, "7d"));
  const denied = data?.current.refused ?? 0;
  if (!failed && !denied) return null;
  return (
    <section className="card" aria-labelledby="attention-heading">
      <h2 id="attention-heading" className="m-0 border-b border-line px-5 py-4 text-[15px] font-semibold">
        {t.attention}
      </h2>
      <ul className="m-0 list-none p-0">
        {failed > 0 && (
          <li className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
            <Icon name="alert" className="icon text-danger" />
            <span className="flex-1">{t.failedSources(failed)}</span>
            <Link to="/agents/$agentId/knowledge" params={{ agentId }} className="btn btn-sm">
              {t.view}
            </Link>
          </li>
        )}
        {denied > 0 && (
          <li className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0">
            <Icon name="alert" className="icon text-warning" />
            <span className="flex-1">{t.refusedRequests(denied)}</span>
            <Link to="/agents/$agentId/audit" params={{ agentId }} className="btn btn-sm">
              {t.view}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
