import {
  CheckCircledIcon,
  ChevronRightIcon,
  CrossCircledIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import { useContext } from "react";
import { RenderersContext } from "./context.js";
import { httpUrl, pretty } from "./format.js";
import { humanize, ResultView } from "./results.js";

const SEARCH_TOOL = "search_knowledge";

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

export function ToolCard(props: { toolName: string; args: unknown; result?: unknown }) {
  const renderers = useContext(RenderersContext);
  const { toolName, args, result } = props;
  const rejected = (result as any)?.rejected === true;
  const failed = !rejected && typeof (result as any)?.error === "string";
  const running = result === undefined;
  const custom = renderers?.[toolName];
  return (
    <div className="sa-tool" data-state={running ? "running" : rejected ? "rejected" : failed ? "error" : "done"}>
      <div className="sa-tool-head">
        {running ? (
          <ReloadIcon className="sa-spin" />
        ) : rejected || failed ? (
          <CrossCircledIcon />
        ) : (
          <CheckCircledIcon />
        )}
        <span>{toolName === SEARCH_TOOL ? "Sources" : humanize(toolName)}</span>
      </div>
      {!running &&
        (custom ? (
          custom({ operationId: toolName, args, result })
        ) : toolName === SEARCH_TOOL ? (
          <>
            <Sources result={result} />
            <Passages result={result} />
          </>
        ) : (
          <ResultView result={result} />
        ))}
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
