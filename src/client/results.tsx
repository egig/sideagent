import type { ReactNode } from "react";

const MAX_ROWS = 50;
const MAX_COLS = 8;
const MAX_CELL = 80;

/** "createdAt" / "created_at" -> "Created at" */
export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString() : String(v);
  if (typeof v === "string") {
    if (ISO.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return v.length <= 10 ? d.toLocaleDateString() : d.toLocaleString();
    }
    return v.length > MAX_CELL ? `${v.slice(0, MAX_CELL)}…` : v;
  }
  const j = JSON.stringify(v);
  return j.length > MAX_CELL ? `${j.slice(0, MAX_CELL)}…` : j;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPrimitive = (v: unknown) => v === null || typeof v !== "object";

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const cols = keys.slice(0, MAX_COLS);
  const shown = rows.slice(0, MAX_ROWS);
  const numeric = new Set(cols.filter((c) => shown.every((r) => r[c] == null || typeof r[c] === "number")));
  return (
    <div className="sa-result">
      <div className="sa-table-wrap">
        <table className="sa-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} className={numeric.has(c) ? "sa-num" : undefined} scope="col">
                  {humanize(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={i}>
                {cols.map((c) => (
                  <td key={c} className={numeric.has(c) ? "sa-num" : undefined}>
                    {formatCell(r[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(rows.length > shown.length || keys.length > cols.length) && (
        <div className="sa-more">
          {rows.length > shown.length && `+${rows.length - shown.length} more rows. `}
          {keys.length > cols.length && `+${keys.length - cols.length} more columns.`}
        </div>
      )}
    </div>
  );
}

function Fields({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj).slice(0, 30);
  return (
    <dl className="sa-fields">
      {entries.map(([k, v]) => (
        <div key={k} className="sa-field">
          <dt>{humanize(k)}</dt>
          <dd>{formatCell(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Turns an API result into a readable view. Plain text only: nothing here renders HTML. */
export function ResultView({ result }: { result: unknown }): ReactNode {
  if (result === null || result === undefined || (Array.isArray(result) && result.length === 0)) {
    return <div className="sa-more">No results.</div>;
  }
  if (isRecord(result) && result.rejected === true) return <div className="sa-more">You rejected this action.</div>;
  if (isRecord(result) && typeof result.error === "string") return <div className="sa-error">{result.error}</div>;
  if (Array.isArray(result)) {
    if (result.every(isRecord)) return <Table rows={result as Record<string, unknown>[]} />;
    if (result.every(isPrimitive)) {
      return (
        <ul className="sa-list">
          {result.slice(0, MAX_ROWS).map((v, i) => (
            <li key={i}>{formatCell(v)}</li>
          ))}
        </ul>
      );
    }
  }
  if (isRecord(result)) {
    // A wrapper like { items: [...], total: 3 }: show the one array as a table.
    const arrays = Object.entries(result).filter(([, v]) => Array.isArray(v) && v.length > 0 && v.every(isRecord));
    if (arrays.length === 1) {
      const rest = Object.fromEntries(Object.entries(result).filter(([k]) => k !== arrays[0]![0]));
      return (
        <>
          {Object.keys(rest).length > 0 && <Fields obj={rest} />}
          <Table rows={arrays[0]![1] as Record<string, unknown>[]} />
        </>
      );
    }
    return <Fields obj={result} />;
  }
  return <div>{formatCell(result)}</div>;
}
