// Guided setup: five steps in the order they depend on each other. The model comes first because indexing needs its
// embedding model; the preview comes before any deployment choice; setup ends when a real request arrives.
import { useEffect, useState, type ReactNode } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useAgent } from "sideagent";
import { agentQuery, auditQuery, setActive } from "~/app/api/agents";
import { errorMessage } from "~/app/api/client";
import { useFormatDate, useReadinessDetail } from "~/app/display";
import { Embed } from "~/app/embed";
import { Instructions } from "~/app/settings/instructions";
import { Llm } from "~/app/settings/llm";
import { Origins } from "~/app/settings/origins";
import { UserAuth } from "~/app/settings/user-auth";
import { useApply } from "~/app/settings/form";
import { Sources } from "~/app/knowledge/sources";
import { STEPS, filters, useSetupProgress, type Step } from "~/app/setup/progress";
import { Alert, Callout, Icon, Page } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/_authed/agents/$agentId/setup")({
  component: Setup,
});

function Setup() {
  const { agentId } = Route.useParams();
  const { data: detail } = useSuspenseQuery(agentQuery(agentId));
  const { agent } = detail;
  const { setup: t, modes } = useT();
  const describe = useReadinessDetail(detail);
  // The step on screen: the first one left to do, until the person picks another or continues.
  const [chosen, setChosen] = useState<Step | null | undefined>(undefined);
  const progress = useSetupProgress(detail, { watch: chosen ?? undefined });
  const { done, unlocked } = progress;
  useEffect(() => {
    if (chosen === undefined && !progress.loading) setChosen(progress.next);
  }, [chosen, progress.loading, progress.next]);
  const open = chosen ?? null;
  // After a step, the next one still to do (later steps first, then any earlier one left open).
  const advance = (from: Step) => {
    const after = STEPS.slice(STEPS.indexOf(from) + 1);
    setChosen(after.find((s) => !done[s]) ?? after[0] ?? null);
  };

  const summary: Record<Step, string> = {
    llm: done.llm ? describe("llm") : t.steps.llm.todo,
    knowledge: done.knowledge
      ? describe("content")
      : unlocked("knowledge")
        ? t.steps.knowledge.todo
        : t.steps.knowledge.locked,
    try: done.try
      ? progress.skipped
        ? t.steps.try.doneSkipped
        : t.steps.try.doneTried
      : unlocked("try")
        ? t.steps.try.todo
        : t.steps.try.locked,
    deploy: done.deploy
      ? t.steps.deploy.done(agent.allowedOrigins.length, agent.auth ? modes[agent.auth.mode] : "")
      : unlocked("deploy")
        ? t.steps.deploy.todo
        : t.steps.deploy.locked,
    live: done.live ? t.steps.live.done : unlocked("live") ? t.steps.live.todo : t.steps.live.locked,
  };

  const card = (step: Step, body: ReactNode) => (
    <StepCard
      key={step}
      n={STEPS.indexOf(step) + 1}
      step={step}
      title={t.steps[step].title}
      summary={summary[step]}
      state={open === step ? "open" : done[step] ? "done" : unlocked(step) ? "todo" : "locked"}
      onOpen={() => setChosen(step)}
    >
      {body}
    </StepCard>
  );

  return (
    <Page title={t.title} actions={<ProgressBar count={progress.count} total={progress.total} />}>
      <p className="m-0 text-ink-muted">{t.lead}</p>
      {progress.next === null && (
        <Callout tone="ok">
          {t.allDone}{" "}
          <Link to="/agents/$agentId" params={{ agentId }} className="font-semibold text-inherit">
            {t.steps.live.toOverview}
          </Link>
        </Callout>
      )}
      <ol className="m-0 flex list-none flex-col gap-4 p-0">
        {card("llm", <Llm key={agentId} detail={detail} onDone={() => advance("llm")} />)}
        {card(
          "knowledge",
          <>
            <Sources agentId={agentId} />
            <Instructions key={agent.id} agent={agent} />
            <StepFooter ready={done.knowledge} hint={t.steps.knowledge.needs} onContinue={() => advance("knowledge")} />
          </>,
        )}
        {card(
          "try",
          <TryStep
            tried={done.try && !progress.skipped}
            onSkip={() => {
              progress.skipTry();
              advance("try");
            }}
            onContinue={() => advance("try")}
          />,
        )}
        {card(
          "deploy",
          <>
            <Origins key={`o-${agent.id}`} agent={agent} />
            <UserAuth key={`a-${agent.id}`} agent={agent} />
            <Embed agent={agent} />
            <StepFooter ready={done.deploy} hint={t.steps.deploy.needs} onContinue={() => advance("deploy")} />
          </>,
        )}
        {card("live", <LiveStep agentId={agentId} live={done.live} />)}
      </ol>
    </Page>
  );
}

function ProgressBar({ count, total }: { count: number; total: number }) {
  const t = useT().setup;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[13px] whitespace-nowrap text-ink-muted">{t.progress(count, total)}</span>
      <div
        className="h-1.5 w-32 overflow-hidden rounded-full bg-selected"
        role="progressbar"
        aria-label={t.progress(count, total)}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={count}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${(count / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function StepCard({
  n,
  step,
  title,
  summary,
  state,
  onOpen,
  children,
}: {
  n: number;
  step: Step;
  title: string;
  summary: string;
  state: "open" | "done" | "todo" | "locked";
  onOpen: () => void;
  children: ReactNode;
}) {
  const t = useT().setup;
  const mark =
    state === "done"
      ? "bg-success-soft text-success"
      : state === "open"
        ? "bg-primary text-on-primary"
        : "bg-selected text-ink-muted";
  const heading = (
    <>
      <span
        aria-hidden="true"
        className={`flex size-7 flex-none items-center justify-center rounded-full text-[13px] font-semibold ${mark}`}
      >
        {state === "done" ? <Icon name="check" style={{ width: 14, height: 14 }} /> : n}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[17px] leading-6 font-semibold">
          <span className="sr-only">{t.step(n)}: </span>
          {title}
          {state === "done" && <span className="sr-only"> ({t.doneLabel})</span>}
        </span>
        <span className="text-[13px] leading-[18px] text-ink-muted">{summary}</span>
      </span>
    </>
  );
  return (
    <li
      data-step={step}
      data-state={state}
      className={`card overflow-hidden ${state === "open" ? "shadow-md ring-2 ring-primary/25" : ""} ${state === "locked" ? "opacity-60" : ""}`}
    >
      {state === "open" || state === "locked" ? (
        <h2 className="m-0 flex items-start gap-3.5 px-5 py-4 font-[inherit]">{heading}</h2>
      ) : (
        <h2 className="m-0">
          <button
            type="button"
            aria-expanded={false}
            onClick={onOpen}
            className="flex w-full cursor-pointer items-start gap-3.5 border-0 bg-transparent px-5 py-4 text-left font-[inherit] text-ink hover:bg-surface-subtle"
          >
            {heading}
            <span className="self-center text-[13px] font-medium text-ink-muted">
              {state === "done" ? t.edit : t.start}
            </span>
          </button>
        </h2>
      )}
      {state === "open" && <div className="flex flex-col gap-6 border-t border-line bg-canvas p-5">{children}</div>}
    </li>
  );
}

function StepFooter({
  ready,
  hint,
  onContinue,
  label,
}: {
  ready: boolean;
  hint: string;
  onContinue: () => void;
  label?: string;
}) {
  const t = useT().setup;
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      {!ready && <span className="text-[13px] text-ink-muted">{hint}</span>}
      <button type="button" className="btn btn-primary" disabled={!ready} onClick={onContinue}>
        {label ?? t.continue}
      </button>
    </div>
  );
}

function TryStep({ tried, onSkip, onContinue }: { tried: boolean; onSkip: () => void; onContinue: () => void }) {
  const { setup } = useT();
  const t = setup.steps.try;
  const { setOpen } = useAgent();
  return (
    <>
      <div className="card flex flex-col gap-4 p-5">
        <p className="m-0">{t.body}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            {t.open}
          </button>
          <span role="status" className="text-[13px] text-ink-muted">
            {tried ? t.tried : t.waiting}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {!tried && (
          <button type="button" className="btn btn-ghost" onClick={onSkip}>
            {t.skip}
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={!tried} onClick={onContinue}>
          {setup.continue}
        </button>
      </div>
    </>
  );
}

function LiveStep({ agentId, live }: { agentId: string; live: boolean }) {
  const { setup, audit } = useT();
  const t = setup.steps.live;
  const formatDate = useFormatDate();
  const { data } = useSuspenseQuery(agentQuery(agentId));
  const { agent } = data;
  const apply = useApply(agentId);
  const activate = useMutation({ mutationFn: () => setActive(agentId, true), onSuccess: apply });
  const waiting = agent.status === "active" && !live;
  // While waiting, refusals show here: a typo in an origin is visible at once.
  const refused = useQuery({
    ...auditQuery(agentId, filters("request", "denied", "1h")),
    enabled: waiting,
    refetchInterval: waiting ? 3000 : false,
  });

  if (agent.status !== "active") {
    return (
      <div className="flex flex-col gap-3">
        {activate.error && <Alert>{errorMessage(activate.error, t.activateFailed)}</Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 flex-[1_1_320px] text-ink-muted">{t.body}</p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={activate.isPending}
            onClick={() => activate.mutate()}
          >
            {activate.isPending ? t.activating : t.activate}
          </button>
        </div>
      </div>
    );
  }
  if (live) {
    return (
      <Callout tone="ok">
        <span className="font-semibold">{t.liveTitle}</span> {t.liveBody}{" "}
        <Link to="/agents/$agentId" params={{ agentId }} className="font-semibold text-inherit">
          {t.toOverview}
        </Link>
      </Callout>
    );
  }
  const events = refused.data?.events.slice(0, 3) ?? [];
  return (
    <div className="flex flex-col gap-3 rounded-[14px] bg-info-soft p-4" role="status">
      <span className="inline-flex items-center gap-2 font-semibold text-info">
        <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-current" />
        {t.waitingTitle}
      </span>
      <p className="m-0">{t.waiting(agent.allowedOrigins.join(", "))}</p>
      {events.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold">{t.refused}</span>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
            {events.map((e) => (
              <li key={e.id}>
                {formatDate(e.at)} · {(e.reason && audit.reasons[e.reason]) ?? e.reason ?? audit.results.denied}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
