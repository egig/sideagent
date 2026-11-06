// The Overview's numbers for a live agent: chat turns, success rate, median reply time and refused requests, each
// against the window before it. Counted from the audit log by the server (GET /api/agents/:id/stats).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { StatsRange, UsageWindow } from "@shared/api";
import { statsQuery } from "~/app/api/agents";
import { Alert, Segmented } from "~/app/ui";
import { formatNumber, useLocale, useT, type Locale } from "~/i18n";

type Better = "up" | "down";

interface Metric {
  id: string;
  label: string;
  value: string;
  /** The change against the window before, already worded; null when there is nothing to compare with. */
  delta: string | null;
  /** Whether the change is good news, bad news or neither. */
  tone: "good" | "bad" | "flat";
}

const rate = (w: UsageWindow) => (w.turns ? w.ok / w.turns : null);

function compare(now: number | null, before: number | null, better: Better, word: (d: number) => string) {
  if (now === null || before === null) return { delta: null, tone: "flat" as const };
  const d = now - before;
  if (Math.abs(d) < 1e-9) return { delta: word(0), tone: "flat" as const };
  const good = better === "up" ? d > 0 : d < 0;
  return { delta: word(d), tone: good ? ("good" as const) : ("bad" as const) };
}

const signed = (n: string, d: number) => (d > 0 ? `+${n}` : d < 0 ? `−${n}` : n);

export function metrics(
  current: UsageWindow,
  previous: UsageWindow,
  locale: Locale,
  t: ReturnType<typeof useT>["stats"],
): Metric[] {
  const num = (n: number) => formatNumber(n, locale);
  const pct = (r: number) => `${formatNumber(Math.round(r * 1000) / 10, locale)}%`;
  // Under a second in ms, above it in seconds with one decimal.
  const secs = (ms: number) =>
    ms < 1000 ? `${formatNumber(Math.round(ms), locale)} ms` : `${formatNumber(Math.round(ms / 100) / 10, locale)} s`;
  const hasBefore = previous.turns > 0 || previous.refused > 0 || previous.limited > 0;
  const turns = compare(current.turns, hasBefore ? previous.turns : null, "up", (d) => signed(num(Math.abs(d)), d));
  const success = compare(rate(current), rate(previous), "up", (d) =>
    t.points(signed(formatNumber(Math.round(Math.abs(d) * 1000) / 10, locale), d)),
  );
  const median = compare(current.medianMs, previous.medianMs, "down", (d) => signed(secs(Math.abs(d)), d));
  const refused = compare(current.refused, hasBefore ? previous.refused : null, "down", (d) =>
    signed(num(Math.abs(d)), d),
  );
  const r = rate(current);
  return [
    { id: "turns", label: t.turns, value: num(current.turns), ...turns },
    { id: "success", label: t.success, value: r === null ? "–" : pct(r), ...success },
    { id: "median", label: t.median, value: current.medianMs === null ? "–" : secs(current.medianMs), ...median },
    { id: "refused", label: t.refused, value: num(current.refused), ...refused },
  ];
}

const TONE = { good: "text-success", bad: "text-danger", flat: "text-ink-muted" } as const;

export function Stats({ agentId }: { agentId: string }) {
  const { stats: t } = useT();
  const locale = useLocale();
  const [range, setRange] = useState<StatsRange>("7d");
  const { data, isError, isPlaceholderData } = useQuery(statsQuery(agentId, range));
  return (
    <section className="flex flex-col gap-3" aria-labelledby="stats-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="stats-heading" className="m-0 text-[17px] leading-6 font-semibold">
          {t.heading}
        </h2>
        <Segmented
          label={t.range}
          value={range}
          onChange={setRange}
          options={[
            { value: "24h", label: t.ranges["24h"] },
            { value: "7d", label: t.ranges["7d"] },
          ]}
        />
      </div>
      {isError ? (
        <Alert>{t.loadFailed}</Alert>
      ) : (
        <dl
          className={`m-0 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 ${isPlaceholderData ? "opacity-60" : ""}`}
        >
          {(data ? metrics(data.current, data.previous, locale, t) : []).map((m) => (
            <div key={m.id} data-stat={m.id} className="card flex flex-col gap-1.5 p-5">
              <dt className="text-[13px] leading-[18px] text-ink-muted">{m.label}</dt>
              <dd className="m-0 text-[28px] leading-8 font-semibold tracking-[-0.01em] tabular-nums">{m.value}</dd>
              <dd className="m-0 text-[13px] leading-[18px] text-ink-muted">
                {m.delta === null ? (
                  t.noEarlier
                ) : (
                  <>
                    <span className={`font-semibold ${TONE[m.tone]}`}>{m.delta}</span> {t.vsBefore[range]}
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
