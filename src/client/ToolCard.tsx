import {
  CheckCircledIcon,
  ChevronRightIcon,
  CrossCircledIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { httpUrl, pretty } from "./format.js";

/** Knowledge search shows where the answer came from. Links only for http(s) URLs from your config. */
function Sources({ result }: { result: unknown }) {
  const sources = ((result as any)?.sources ?? []) as { id: string; title: string; url?: string }[];
  if (typeof (result as any)?.error === "string") return <div className="sa-error">{(result as any).error}</div>;
  if (!sources.length) return <div className="sa-more">No relevant sources found.</div>;
  return (
    <ul className="sa-sources">
      {sources.map((s) => {
        const href = s.url ? httpUrl(s.url) : null;
        return (
          <li key={s.id}>
            <FileTextIcon />
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {s.title} <ExternalLinkIcon />
              </a>
            ) : (
              <span>{s.title}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Only present when the host opted in (exposeKnowledge), e.g. an owner previewing their agent. */
function Passages({ result }: { result: unknown }) {
  const hits = ((result as any)?.hits ?? []) as { title: string; score: number; text: string }[];
  if (!hits.length) return null;
  return (
    <details className="sa-details">
      <summary>
        <ChevronRightIcon /> Passages ({hits.length})
      </summary>
      {hits.map((h, i) => (
        <div key={i} className="sa-passage">
          <div className="sa-more">
            {h.title} · {h.score.toFixed(2)}
          </div>
          <pre>{h.text}</pre>
        </div>
      ))}
    </details>
  );
}

/** The one tool the model has is the knowledge search, so this card is its sources. */
export function ToolCard(props: { args: unknown; result?: unknown }) {
  const { args, result } = props;
  const failed = typeof (result as any)?.error === "string";
  const running = result === undefined;
  return (
    <div className="sa-tool" data-state={running ? "running" : failed ? "error" : "done"}>
      <div className="sa-tool-head">
        {running ? <ReloadIcon className="sa-spin" /> : failed ? <CrossCircledIcon /> : <CheckCircledIcon />}
        <span>Sources</span>
      </div>
      {!running && (
        <>
          <Sources result={result} />
          <Passages result={result} />
        </>
      )}
      <details className="sa-details">
        <summary>
          <ChevronRightIcon /> Details
        </summary>
        <pre>{pretty(args)}</pre>
        {!running && <pre>{pretty(result)}</pre>}
      </details>
    </div>
  );
}
