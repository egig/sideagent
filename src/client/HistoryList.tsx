import { ArrowLeftIcon, TrashIcon } from "@radix-ui/react-icons";
import { useEffect, useState } from "react";
import type { ThreadMeta } from "../protocol.js";
import { ago } from "./format.js";
import { callJson, type GetHeaders } from "./transport.js";

export function HistoryList(props: {
  endpoint: string;
  credentials?: RequestCredentials;
  headers?: Record<string, string>;
  getHeaders?: GetHeaders;
  onOpen: (id: string) => void;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const [threads, setThreads] = useState<ThreadMeta[] | null>(null);
  const [error, setError] = useState(false);
  const opts = {
    endpoint: props.endpoint,
    credentials: props.credentials,
    headers: props.headers,
    getHeaders: props.getHeaders,
  };
  useEffect(() => {
    callJson<{ threads: ThreadMeta[] }>({ action: "threads.list" }, opts)
      .then((r) => (r.data?.threads ? setThreads(r.data.threads) : setError(true)))
      .catch(() => setError(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const remove = async (id: string) => {
    await callJson({ action: "threads.delete", threadId: id }, opts);
    setThreads((t) => t?.filter((x) => x.id !== id) ?? null);
    props.onDeleted(id);
  };
  return (
    <div className="sa-viewport sa-history">
      <button className="sa-btn sa-back" onClick={props.onClose}>
        <ArrowLeftIcon /> Back to chat
      </button>
      {error && <div className="sa-error">Could not load history.</div>}
      {threads === null && !error && <div className="sa-more">Loading…</div>}
      {threads?.length === 0 && <div className="sa-empty">No conversations yet.</div>}
      {threads?.map((t) => (
        <div key={t.id} className="sa-thread">
          <button className="sa-thread-open" onClick={() => props.onOpen(t.id)}>
            <span className="sa-thread-title">{t.title}</span>
            <span className="sa-more">{ago(t.updatedAt)}</span>
          </button>
          <button
            className="sa-btn sa-icon-btn"
            aria-label="Delete conversation"
            title="Delete"
            onClick={() => void remove(t.id)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
