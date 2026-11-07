// Trace of one turn (D-35), drawn as a Gantt chart: a row per model call, search and relevance check on a shared
// time axis. Opened from a row of the audit log. Selecting a row shows its details under the chart.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Trace, TraceLevel, TraceSpan } from "@shared/api";
import { agentQuery, traceQuery, updateTracing } from "~/app/api/agents";
import { useApply } from "~/app/settings/form";
import { Alert, Segmented } from "~/app/ui";
import { useT } from "~/i18n";

const BADGE: Record<TraceSpan["status"], string> = { ok: "badge-ok", error: "badge-bad" };
const VERDICT_BADGE: Record<NonNullable<TraceSpan["verdict"]>, string> = {
  grounded: "badge-ok",
  uncertain: "badge-warn",
  off: "badge-bad",
};
/** One colour per kind; an error is always red, so a failed call stands out in the chart. */
const BAR: Record<TraceSpan["kind"], string> = { llm: "bg-primary", tool: "bg-info", gate: "bg-warning" };

/**
 * The recording level, apart from the table's filters: it is a setting, not a filter. Collapsed it is one line
 * saying what is recorded; "Change" opens the control.
 */
export function TracingBar({ agentId }: { agentId: string }) {
  const { common, traces: t } = useT();
  const apply = useApply(agentId);
  const { data } = useQuery(agentQuery(agentId));
  const [editing, setEditing] = useState(false);
  const level = data?.agent.tracing;
  const save = useMutation({
    mutationFn: (next: TraceLevel) => updateTracing(agentId, next),
    onSuccess: (r) => (apply(r), setEditing(false)),
  });
  if (!level) return null;
  return (
    <section
      aria-label={t.level}
      className="flex flex-col gap-3 rounded-[12px] border border-line bg-surface-subtle px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[13px] text-ink-muted">{t.level}</span>
        <span className={`badge ${level === "off" ? "" : level === "full" ? "badge-warn" : "badge-ok"}`}>
          {t.levels[level]}
        </span>
        <span className="min-w-[14rem] flex-1 text-[13px] text-ink-muted">{t.levelHints[level]}</span>
        <button type="button" className="btn" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          {editing ? common.cancel : t.change}
        </button>
      </div>
      {editing && (
        <div className="flex flex-col gap-2">
          {save.error && <Alert>{t.levelFailed}</Alert>}
          <Segmented
            label={t.level}
            value={level}
            onChange={(v) => v !== level && save.mutate(v)}
            options={(["off", "metadata", "full"] as const).map((v) => ({ value: v, label: t.levels[v] }))}
          />
          <p className="hint m-0">{t.levelNote}</p>
        </div>
      )}
    </section>
  );
}

const ticksOf = (total: number) => [0, 0.25, 0.5, 0.75, 1].map((f) => ({ f, ms: Math.round(total * f) }));

/** The nesting depth of a span: how many recorded spans sit above it. */
function depthOf(spans: TraceSpan[], s: TraceSpan): number {
  let d = 0;
  for (let p = s.parentId; p && d < 20; d++) p = spans.find((x) => x.id === p)?.parentId ?? null;
  return d;
}

/** The model, search and relevance-check calls of one turn, on one time axis. */
export function Spans({ agentId, traceId }: { agentId: string; traceId: string }) {
  const { common, traces: t } = useT();
  const { data, isPending, isError } = useQuery(traceQuery(agentId, traceId));
  const [picked, setPicked] = useState<string | null>(null);
  if (isPending) return <p className="m-0 px-5 pb-4 text-ink-muted">{common.loading}</p>;
  if (isError)
    return (
      <div className="px-5 pb-4">
        <Alert>{t.spansFailed}</Alert>
      </div>
    );
  const total = Math.max(1, data.durationMs);
  // A failed span opens first: it is what the owner came to find.
  const selected = data.spans.find((s) => s.id === (picked ?? data.spans.find((x) => x.status === "error")?.id));
  return (
    <div className="flex flex-col gap-4 bg-surface-subtle px-5 py-4">
      <Summary trace={data} />
      <div className="overflow-x-auto">
        <div className="min-w-[36rem]">
          <div className="grid grid-cols-[minmax(9rem,14rem)_1fr_4.5rem] items-end gap-x-3 text-[12px] text-ink-muted">
            <span />
            <div className="relative h-5" aria-hidden>
              {ticksOf(total).map(({ f, ms }) => (
                <span
                  key={f}
                  className="absolute top-0 -translate-x-1/2 whitespace-nowrap tabular-nums first:translate-x-0 last:-translate-x-full"
                  style={{ left: `${f * 100}%` }}
                >
                  {ms} ms
                </span>
              ))}
            </div>
            <span />
          </div>
          <ol className="m-0 list-none p-0" aria-label={t.title}>
            {data.spans.map((s) => (
              <Row
                key={s.id}
                span={s}
                depth={depthOf(data.spans, s)}
                total={total}
                active={selected?.id === s.id}
                onPick={() => setPicked(s.id)}
              />
            ))}
          </ol>
        </div>
      </div>
      {selected && <Details span={selected} level={data.level} />}
      {data.level === "metadata" && <p className="hint m-0">{t.noText}</p>}
    </div>
  );
}

function Summary({ trace }: { trace: Trace }) {
  const { traces: t } = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] text-ink-muted">
      <span className={`badge ${BADGE[trace.status]}`}>{t.statuses[trace.status]}</span>
      <span className="tabular-nums">{trace.durationMs} ms</span>
      <span>
        {trace.llmCalls} {t.model.toLowerCase()} · {trace.toolCalls} {t.tools.toLowerCase()}
      </span>
      <span>{t.inOut(trace.inputTokens, trace.outputTokens)}</span>
      {trace.threadId && (
        <span>
          {t.thread}: <span className="font-mono">{trace.threadId}</span>
        </span>
      )}
    </div>
  );
}

function Row({
  span: s,
  depth,
  total,
  active,
  onPick,
}: {
  span: TraceSpan;
  depth: number;
  total: number;
  active: boolean;
  onPick: () => void;
}) {
  const { traces: t } = useT();
  const left = Math.min(99, (s.startMs / total) * 100);
  const width = Math.max(0.8, Math.min(100 - left, (s.durationMs / total) * 100));
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onClick={onPick}
        className={`grid w-full cursor-pointer grid-cols-[minmax(9rem,14rem)_1fr_4.5rem] items-center gap-x-3 rounded-[8px] border-0 px-0 py-1.5 text-left font-[inherit] text-ink hover:bg-hover ${active ? "bg-selected" : "bg-transparent"}`}
      >
        <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 14 + 6}px` }}>
          <span className={`size-2 shrink-0 rounded-full ${BAR[s.kind]}`} aria-hidden />
          <span className="truncate text-[13px]" title={s.name}>
            {s.kind === "gate" ? t.kinds.gate : s.name}
          </span>
        </span>
        <span className="relative h-4 rounded-[4px] bg-line/40">
          <span
            className={`absolute inset-y-0 rounded-[4px] ${s.status === "error" ? "bg-danger" : BAR[s.kind]}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        </span>
        <span className="pr-2 text-right text-[13px] tabular-nums">{s.durationMs} ms</span>
        <span className="sr-only">
          {t.kinds[s.kind]}, {t.statuses[s.status]}
        </span>
      </button>
    </li>
  );
}

function Details({ span: s, level }: { span: TraceSpan; level: Trace["level"] }) {
  const { traces: t } = useT();
  return (
    <section
      className="flex flex-col gap-2 rounded-[10px] border border-line bg-surface-raised p-4"
      aria-label={t.details}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="badge">{t.kinds[s.kind]}</span>
        <span className="font-mono text-[13px]">{s.name}</span>
        <span className={`badge ${BADGE[s.status]}`}>{t.statuses[s.status]}</span>
        {s.verdict && <span className={`badge ${VERDICT_BADGE[s.verdict]}`}>{t.verdicts[s.verdict]}</span>}
      </div>
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ink-muted">
        <Fact label={t.startedAt} value={`+${s.startMs} ms`} />
        <Fact label={t.duration} value={`${s.durationMs} ms`} />
        {(s.inputTokens !== undefined || s.outputTokens !== undefined) && (
          <Fact label={t.tokens} value={t.inOut(s.inputTokens ?? null, s.outputTokens ?? null)} />
        )}
        {s.found !== undefined && <Fact label={s.kind === "gate" ? t.passages : t.sources} value={String(s.found)} />}
      </dl>
      {s.verdict && <p className="m-0 text-[13px] text-ink-muted">{t.verdictHints[s.verdict]}</p>}
      {s.error && <div className="text-[13px] text-danger">{s.error}</div>}
      {level === "full" && (
        <>
          {s.input && <Text label={t.input} text={s.input} />}
          {s.output && <Text label={t.output} text={s.output} />}
        </>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt>{label}</dt>
      <dd className="m-0 text-ink tabular-nums">{value}</dd>
    </div>
  );
}

function Text({ label, text }: { label: string; text: string }) {
  return (
    <details className="mt-1" open>
      <summary className="cursor-pointer text-[13px] text-ink-muted">{label}</summary>
      <pre className="m-0 mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[8px] bg-canvas p-3 font-mono text-[12px]">
        {text}
      </pre>
    </details>
  );
}
