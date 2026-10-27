import { ChevronRightIcon, ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { pretty } from "./format.js";
import { humanize } from "./results.js";
import type { ApprovalEvent, Decision } from "./types.js";

/** Primitive top-level values of the request (and its body), shown as plain "Label: value" rows. */
function summaryFields(args: unknown): [string, string][] {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const body = a.body && typeof a.body === "object" && !Array.isArray(a.body) ? (a.body as Record<string, unknown>) : {};
  const { body: _body, ...rest } = a;
  return Object.entries({ ...rest, ...body })
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => [humanize(k), String(v)]);
}

export function ApprovalCard({ event, onDecide }: { event: ApprovalEvent; onDecide: (d: Decision) => void }) {
  const action = humanize(event.operationId).toLowerCase();
  const fields = summaryFields(event.args);
  return (
    <div className="sa-approval" role="alertdialog" aria-label="Approval needed">
      <strong className="sa-approval-title">
        <ExclamationTriangleIcon /> Confirm before I continue
      </strong>
      <p className="sa-approval-text">
        I'd like to <strong>{action}</strong>. Nothing changes until you approve.
      </p>
      {fields.length > 0 && (
        <dl className="sa-fields">
          {fields.map(([k, v]) => (
            <div key={k} className="sa-field">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <details className="sa-details">
        <summary>
          <ChevronRightIcon /> Details
        </summary>
        <pre>
          {event.method} {event.path}
          {"\n"}
          {pretty(event.args)}
        </pre>
      </details>
      <div className="sa-row">
        <button className="sa-btn sa-btn-primary" onClick={() => onDecide("approve")}>
          Approve
        </button>
        <button className="sa-btn" onClick={() => onDecide("reject")}>
          Reject
        </button>
      </div>
    </div>
  );
}
