// Traces page (D-35): the recording level, and one row per turn that opens into its model and tool calls.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { TraceLevel, TraceSpan, TraceSummary } from "@shared/api";
import { agentQuery, traceQuery, tracesQuery, updateTracing } from "~/app/api/agents";
import { useFormatDate } from "~/app/display";
import { useApply } from "~/app/settings/form";
import { Alert, Segmented, SelectInput } from "~/app/ui";
import { useT } from "~/i18n";

const BADGE: Record<TraceSummary["status"], string> = { ok: "badge-ok", error: "badge-bad" };

export function Traces({ agentId }: { agentId: string }) {
  const { common, traces: t } = useT();
  const formatDate = useFormatDate();
  const apply = useApply(agentId);
  const { data: detail } = useQuery(agentQuery(agentId));
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, isPending, isError, isPlaceholderData } = useQuery(tracesQuery(agentId, page, status));
  const level = detail?.agent.tracing;
  const save = useMutation({ mutationFn: (next: TraceLevel) => updateTracing(agentId, next), onSuccess: apply });

  const total = data?.total ?? 0;
  const size = data?.pageSize ?? 25;
  const first = total === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(total, page * size);

  return (
    <section className="card" aria-labelledby="traces-heading">
      <div className="flex flex-col gap-3 px-5 py-4">
        <h2 id="traces-heading" className="sr-only">
          {t.title}
        </h2>
        <p className="m-0 text-ink-muted">{t.lead}</p>
        {save.error && <Alert>{t.levelFailed}</Alert>}
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          {level && (
            <div className="flex flex-col gap-1.5">
              <span className="label">{t.level}</span>
              <Segmented
                label={t.level}
                value={level}
                onChange={(v) => v !== level && save.mutate(v)}
                options={(["off", "metadata", "full"] as const).map((v) => ({ value: v, label: t.levels[v] }))}
              />
            </div>
          )}
          <div className="flex min-w-[140px] flex-col gap-1.5">
            <label htmlFor="t-status" className="label">
              {t.status}
            </label>
            <SelectInput
              id="t-status"
              value={status}
              onChange={(v) => (setStatus(v), setPage(1))}
              options={[
                { value: "", label: common.any },
                { value: "ok", label: t.statuses.ok },
                { value: "error", label: t.statuses.error },
              ]}
            />
          </div>
        </div>
        {level && (
          <p className="hint m-0">
            {t.levelHints[level]} {t.levelNote}
          </p>
        )}
      </div>
      {isPending ? (
        <p className="m-0 border-t border-line px-5 py-4 text-ink-muted">{common.loading}</p>
      ) : isError ? (
        <div className="border-t border-line px-5 py-4">
          <Alert>{t.loadFailed}</Alert>
        </div>
      ) : data.traces.length === 0 ? (
        <p className="m-0 border-t border-line px-5 py-4 text-ink-muted">
          {status ? t.noMatch : level === "off" ? t.off : t.empty}
        </p>
      ) : (
        <ul className={`m-0 list-none border-t border-line p-0 ${isPlaceholderData ? "opacity-60" : ""}`}>
          {data.traces.map((row) => (
            <TraceRow key={row.id} agentId={agentId} row={row} formatDate={formatDate} />
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-ink-muted">
        <span>{t.showing(first, last, total, data?.retentionDays.metadata ?? 7, data?.retentionDays.full ?? 3)}</span>
        <div className="flex gap-2">
          <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {common.previous}
          </button>
          <button type="button" className="btn" disabled={last >= total} onClick={() => setPage(page + 1)}>
            {common.next}
          </button>
        </div>
      </div>
    </section>
  );
}

function TraceRow({
  agentId,
  row,
  formatDate,
}: {
  agentId: string;
  row: TraceSummary;
  formatDate: (iso: string) => string;
}) {
  const { common, traces: t, audit } = useT();
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer flex-wrap items-center gap-x-5 gap-y-1 border-0 bg-transparent px-5 py-3 text-left font-[inherit] text-ink hover:bg-surface-subtle"
      >
        <span className="w-[10.5rem] whitespace-nowrap">{formatDate(row.at)}</span>
        <span className="min-w-[8rem] flex-1">
          {row.userId ? (
            <span className="font-mono text-[13px]">{row.userId}</span>
          ) : (
            <span className="text-ink-muted">{audit.anonymous}</span>
          )}
        </span>
        <span className={`badge ${BADGE[row.status]}`}>{t.statuses[row.status]}</span>
        <span className="text-[13px] text-ink-muted">
          {row.llmCalls} {t.model.toLowerCase()} · {row.toolCalls} {t.tools.toLowerCase()}
        </span>
        <span className="text-[13px] text-ink-muted">{t.inOut(row.inputTokens, row.outputTokens)}</span>
        <span className="ml-auto whitespace-nowrap tabular-nums">{row.durationMs} ms</span>
        <span className="sr-only">{open ? common.cancel : t.open}</span>
      </button>
      {open && <Spans agentId={agentId} traceId={row.id} />}
    </li>
  );
}

/** The model and tool calls of one turn; also opened from a row of the audit log. */
export function Spans({ agentId, traceId }: { agentId: string; traceId: string }) {
  const { common, traces: t } = useT();
  const { data, isPending, isError } = useQuery(traceQuery(agentId, traceId));
  if (isPending) return <p className="m-0 px-5 pb-4 text-ink-muted">{common.loading}</p>;
  if (isError)
    return (
      <div className="px-5 pb-4">
        <Alert>{t.spansFailed}</Alert>
      </div>
    );
  const total = Math.max(1, data.durationMs);
  const depth = (s: TraceSpan): number => {
    let d = 0;
    for (let p = s.parentId; p; d++) p = data.spans.find((x) => x.id === p)?.parentId ?? null;
    return d;
  };
  return (
    <div className="flex flex-col gap-3 bg-surface-subtle px-5 py-4">
      {data.threadId && (
        <div className="text-[13px] text-ink-muted">
          {t.thread}: <span className="font-mono">{data.threadId}</span>
        </div>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {data.spans.map((s) => (
          <li
            key={s.id}
            style={{ marginLeft: `${depth(s) * 16}px` }}
            className="rounded-[10px] border border-line bg-surface-raised p-3"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="badge">{t.kinds[s.kind]}</span>
              <span className="font-mono text-[13px]">{s.name}</span>
              <span className={`badge ${BADGE[s.status]}`}>{t.statuses[s.status]}</span>
              {(s.inputTokens !== undefined || s.outputTokens !== undefined) && (
                <span className="text-[13px] text-ink-muted">
                  {t.inOut(s.inputTokens ?? null, s.outputTokens ?? null)}
                </span>
              )}
              <span className="ml-auto whitespace-nowrap text-[13px] tabular-nums">{s.durationMs} ms</span>
            </div>
            <div className="mt-2 h-1.5 rounded-full bg-selected" aria-hidden>
              <div
                className="h-full rounded-full bg-primary"
                style={{
                  marginLeft: `${(s.startMs / total) * 100}%`,
                  width: `${Math.max(1, (s.durationMs / total) * 100)}%`,
                }}
              />
            </div>
            {s.error && <div className="mt-2 text-[13px] text-danger">{s.error}</div>}
            {data.level === "full" ? (
              <>
                {s.input && <Text label={t.input} text={s.input} />}
                {s.output && <Text label={t.output} text={s.output} />}
              </>
            ) : null}
          </li>
        ))}
      </ol>
      {data.level === "metadata" && <p className="hint m-0">{t.noText}</p>}
    </div>
  );
}

function Text({ label, text }: { label: string; text: string }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[13px] text-ink-muted">{label}</summary>
      <pre className="m-0 mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-canvas p-3 font-mono text-[12px]">
        {text}
      </pre>
    </details>
  );
}
