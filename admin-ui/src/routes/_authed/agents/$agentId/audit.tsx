import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { AuditEvent } from "@shared/api";
import { auditQuery, type AuditFilters } from "~/app/api/agents";
import { useFormatDate } from "~/app/display";
import { Spans, TracingBar } from "~/app/traces";
import { Alert, Page, SelectInput } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/_authed/agents/$agentId/audit")({
  component: AuditLog,
});

// Events that are a turn of the agent: the only ones a trace can exist for.
const TURNS = new Set(["chat.turn", "preview.turn"]);

const INITIAL: AuditFilters = { result: "", event: "", user: "", range: "7d", page: 1 };

const BADGE: Record<AuditEvent["result"], string> = {
  ok: "badge-ok",
  denied: "badge-bad",
  limited: "badge-warn",
  error: "badge-bad",
};

// Our own fixed reasons (worker/data/router.ts) and event names are put in words by t.audit.reasons and t.audit.eventNames.

function AuditLog() {
  const { agentId } = Route.useParams();
  const { common, audit: t } = useT();
  const formatDate = useFormatDate();
  const [f, setF] = useState(INITIAL);
  const { data, isPending, isError, isPlaceholderData } = useQuery(auditQuery(agentId, f));
  // A filter change returns to page 1.
  const set = <K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) =>
    setF((p) => ({ ...p, [key]: value, page: key === "page" ? (value as number) : 1 }));

  const total = data?.total ?? 0;
  const size = data?.pageSize ?? 25;
  const first = total === 0 ? 0 : (f.page - 1) * size + 1;
  const last = Math.min(total, f.page * size);

  return (
    <Page title={t.title}>
      <p className="m-0 text-ink-muted">{t.lead}</p>
      <TracingBar agentId={agentId} />
      <section className="card" aria-labelledby="events-heading">
        <h2 id="events-heading" className="sr-only">
          {t.events}
        </h2>
        <form className="m-0 flex flex-wrap items-end gap-3 px-5 py-4" onSubmit={(e) => e.preventDefault()}>
          <Filter id="f-range" label={t.time}>
            <SelectInput
              id="f-range"
              value={f.range}
              onChange={(v) => set("range", v)}
              options={[
                { value: "1h", label: t.lastHour },
                { value: "24h", label: t.last24h },
                { value: "7d", label: t.last7d },
                { value: "30d", label: t.last30d },
              ]}
            />
          </Filter>
          <Filter id="f-result" label={t.result}>
            <SelectInput
              id="f-result"
              value={f.result}
              onChange={(v) => set("result", v)}
              options={[
                { value: "", label: common.any },
                { value: "ok", label: t.results.ok },
                { value: "denied", label: t.results.denied },
                { value: "limited", label: t.results.limited },
                { value: "error", label: t.results.error },
              ]}
            />
          </Filter>
          <Filter id="f-event" label={t.event}>
            <SelectInput
              id="f-event"
              value={f.event}
              onChange={(v) => set("event", v)}
              options={[
                { value: "", label: common.any },
                { value: "chat.turn", label: t.eventNames["chat.turn"] },
                { value: "request", label: t.eventNames.request },
              ]}
            />
          </Filter>
          <Filter id="f-user" label={t.user}>
            <input
              id="f-user"
              className="input"
              placeholder={t.userId}
              value={f.user}
              maxLength={256}
              onChange={(e) => set("user", e.target.value.trim())}
            />
          </Filter>
        </form>
        {isPending ? (
          <p className="m-0 border-t border-line px-5 py-4 text-ink-muted">{common.loading}</p>
        ) : isError ? (
          <div className="border-t border-line px-5 py-4">
            <Alert>{t.loadFailed}</Alert>
          </div>
        ) : data.events.length === 0 ? (
          <p className="m-0 border-t border-line px-5 py-4 text-ink-muted">
            {f.result || f.event || f.user ? t.noMatch : t.empty}
          </p>
        ) : (
          <div className={`relative overflow-x-auto ${isPlaceholderData ? "opacity-60" : ""}`}>
            <table className="w-full border-collapse text-left">
              <thead className="bg-canvas text-[12px] text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t.time}</th>
                  <th className="px-4 py-2.5 font-medium">{t.user}</th>
                  <th className="px-4 py-2.5 font-medium">{t.event}</th>
                  <th className="px-4 py-2.5 font-medium">{t.result}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t.duration}</th>
                  <th className="px-4 py-2.5 font-medium">
                    <span className="sr-only">{t.trace}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((e) => (
                  <AuditRow key={e.id} agentId={agentId} e={e} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-ink-muted">
          <span>{t.showing(first, last, total, data?.retentionDays ?? 30)}</span>
          <div className="flex gap-2">
            <button type="button" className="btn" disabled={f.page <= 1} onClick={() => set("page", f.page - 1)}>
              {common.previous}
            </button>
            <button type="button" className="btn" disabled={last >= total} onClick={() => set("page", f.page + 1)}>
              {common.next}
            </button>
          </div>
        </div>
      </section>
      <p className="hint m-0">{t.footnote}</p>
    </Page>
  );
}

function AuditRow({ agentId, e }: { agentId: string; e: AuditEvent }) {
  const { common, audit: t } = useT();
  const formatDate = useFormatDate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr className="border-t border-line align-top">
        <td className="whitespace-nowrap px-4 py-3">{formatDate(e.at)}</td>
        <td className="px-4 py-3">
          {e.userId ? (
            <span className="font-mono text-[13px]">{e.userId}</span>
          ) : (
            <span className="text-ink-muted">{t.anonymous}</span>
          )}
        </td>
        <td className="px-4 py-3">{t.eventNames[e.event] ?? e.event}</td>
        <td className="px-4 py-3">
          <span className={`badge ${BADGE[e.result]}`}>{t.results[e.result]}</span>
          {e.reason && <div className="mt-1 text-[13px] text-ink-muted">{t.reasons[e.reason] ?? e.reason}</div>}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
          {e.durationMs === null ? common.none : `${e.durationMs} ms`}
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          {e.traceId ? (
            <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? t.hideTrace : t.showTrace}
            </button>
          ) : (
            TURNS.has(e.event) && <span className="text-[13px] text-ink-subtle">{t.noTrace}</span>
          )}
        </td>
      </tr>
      {open && e.traceId && (
        <tr>
          <td colSpan={6} className="p-0">
            <Spans agentId={agentId} traceId={e.traceId} />
          </td>
        </tr>
      )}
    </>
  );
}

function Filter({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-[140px] flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}
