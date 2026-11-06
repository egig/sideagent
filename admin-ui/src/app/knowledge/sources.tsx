// Knowledge sources: the list with its status, and the form that adds a page or pasted text. Used by the
// Knowledge page and by step 2 of setup.
import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent, KnowledgeSource } from "@shared/api";
import { addKnowledge, agentQuery, knowledgeQuery, reindexKnowledge, removeKnowledge } from "~/app/api/agents";
import { useFormatDate } from "~/app/display";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Callout, Field, Icon, Segmented } from "~/app/ui";
import { formatNumber, useLocale, useT } from "~/i18n";

const TEXT_MAX = 200_000;

/** Indexing runs on the agent's embedding model: without one, every source would fail. */
export function NeedsModel({ agent }: { agent: Agent }) {
  const t = useT().knowledge;
  if (agent.llm && (agent.llm.provider === "builtin" || agent.llmKey)) return null;
  return (
    <Callout tone="warn">
      {t.needsModel}{" "}
      <Link to="/agents/$agentId/setup" params={{ agentId: agent.id }} className="font-semibold text-inherit">
        {t.needsModelLink}
      </Link>
    </Callout>
  );
}

export function Sources({ agentId }: { agentId: string }) {
  const { common, knowledge: t } = useT();
  const queryClient = useQueryClient();
  const sources = useQuery(knowledgeQuery(agentId));
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: knowledgeQuery(agentId).queryKey }),
      queryClient.invalidateQueries({ queryKey: agentQuery(agentId).queryKey, exact: true }),
    ]);
  const reindex = useMutation({ mutationFn: () => reindexKnowledge(agentId), onSuccess: refresh });
  const list = sources.data ?? [];

  return (
    <section className="card" aria-labelledby="sources-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex flex-col">
          <h2 id="sources-heading" className="m-0 text-[17px] leading-6 font-semibold">
            {t.sources}
          </h2>
          <span className="text-[13px] text-ink-muted">{t.count(list.length)}</span>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          disabled={list.length === 0 || reindex.isPending}
          onClick={() => reindex.mutate()}
        >
          <Icon name="refresh" />
          {t.reindexAll}
        </button>
      </div>
      {reindex.error && (
        <div className="px-5 pb-4">
          <Alert>{t.reindexFailed}</Alert>
        </div>
      )}
      {sources.isPending ? (
        <p className="m-0 px-5 pb-4 text-ink-muted">{common.loading}</p>
      ) : sources.isError ? (
        <div className="px-5 pb-4">
          <Alert>{t.loadFailed}</Alert>
        </div>
      ) : list.length === 0 ? (
        <p className="m-0 border-t border-line px-5 py-4 text-ink-muted">{t.empty}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="bg-canvas text-[12px] text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t.source}</th>
                <th className="px-4 py-2.5 font-medium">{t.type}</th>
                <th className="px-4 py-2.5 font-medium">{t.status}</th>
                <th className="px-4 py-2.5 font-medium">{t.lastIndexed}</th>
                <th className="px-4 py-2.5 font-medium">
                  <span className="sr-only">{t.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <SourceRow key={s.id} agentId={agentId} source={s} onRemoved={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddSource agentId={agentId} onAdded={refresh} />
    </section>
  );
}

function StatusCell({ source }: { source: KnowledgeSource }) {
  const t = useT().knowledge;
  switch (source.status) {
    case "indexed":
      return <span className="badge badge-ok">{t.indexed}</span>;
    case "failed":
      return (
        <span className="flex flex-col items-start gap-1">
          <span className="badge badge-bad">{t.failed}</span>
          {source.error && <span className="max-w-[280px] text-[13px] text-danger">{source.error}</span>}
        </span>
      );
    case "indexing":
      return <span className="badge badge-mute">{t.indexing}</span>;
    default:
      return <span className="badge badge-mute">{t.queued}</span>;
  }
}

function SourceRow({
  agentId,
  source,
  onRemoved,
}: {
  agentId: string;
  source: KnowledgeSource;
  onRemoved: () => Promise<unknown>;
}) {
  const { common, knowledge: t } = useT();
  const formatDate = useFormatDate();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({ mutationFn: () => removeKnowledge(agentId, source.id), onSuccess: onRemoved });
  const label = source.kind === "url" ? source.url! : source.title;
  return (
    <tr className="border-t border-line">
      <td className="max-w-[420px] px-4 py-3">
        <span className="flex items-center gap-2.5">
          <Icon name={source.kind === "url" ? "globe" : "file"} className="icon text-ink-muted" />
          <span className="min-w-0">
            <span className={`block truncate ${source.kind === "url" ? "font-mono text-[13px]" : ""}`}>{label}</span>
            {source.kind === "url" && source.title !== source.url && (
              <span className="block truncate text-[13px] text-ink-muted">{source.title}</span>
            )}
          </span>
        </span>
      </td>
      <td className="px-4 py-3 whitespace-nowrap">{source.kind === "url" ? t.webPage : t.text}</td>
      <td className="px-4 py-3">
        <StatusCell source={source} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        {source.indexedAt ? formatDate(source.indexedAt) : "—"}
        {source.status === "indexed" && (
          <span className="block text-[13px] text-ink-muted">{t.chunks(source.chunks)}</span>
        )}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        {confirming ? (
          <span className="inline-flex gap-2">
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              {common.cancel}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {common.remove}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-ink-muted hover:bg-selected hover:text-ink"
            aria-label={common.removeLabel(label)}
            onClick={() => setConfirming(true)}
          >
            <Icon name="x" />
          </button>
        )}
        {remove.error && <span className="block text-[13px] text-danger">{t.notRemoved}</span>}
      </td>
    </tr>
  );
}

function AddSource({ agentId, onAdded }: { agentId: string; onAdded: () => Promise<unknown> }) {
  const t = useT().knowledge;
  const locale = useLocale();
  const [kind, setKind] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const add = useMutation({
    mutationFn: () =>
      addKnowledge(agentId, kind === "url" ? { kind, url: url.trim() } : { kind, title: title.trim(), content }),
    onSuccess: async () => {
      setUrl("");
      setTitle("");
      setContent("");
      await onAdded();
    },
  });
  const errors = fieldErrors(add.error) ?? {};

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <form className="m-0 flex flex-col gap-4 rounded-b-xl border-t border-line bg-canvas px-5 py-5" onSubmit={onSubmit}>
      <Segmented
        label={t.sourceType}
        value={kind}
        onChange={(v) => {
          setKind(v);
          add.reset();
        }}
        options={[
          { value: "url", label: t.webPage },
          { value: "text", label: t.pasteText },
        ]}
      />
      {add.error && !Object.keys(errors).length && <Alert>{errorMessage(add.error, t.addFailed)}</Alert>}
      {kind === "url" ? (
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-[1_1_320px]">
            <Field id="source-url" label={t.pageUrl} hint={t.pageUrlHint} error={errors.url}>
              <input
                id="source-url"
                className="input font-mono"
                type="url"
                required
                placeholder="https://docs.your-company.com/faq"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary mt-[26px]" disabled={add.isPending}>
            <Icon name="plus" />
            {add.isPending ? t.adding : t.addSource}
          </button>
        </div>
      ) : (
        <>
          <Field id="source-title" label={t.titleLabel} hint={t.titleHint} error={errors.title}>
            <input
              id="source-title"
              className="input"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field
            id="source-content"
            label={t.text}
            hint={t.textHint(formatNumber(content.length, locale))}
            error={errors.content}
          >
            <textarea
              id="source-content"
              className="input min-h-40 py-2 font-mono text-[13px]"
              required
              maxLength={TEXT_MAX}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </Field>
          <div>
            <button type="submit" className="btn btn-primary" disabled={add.isPending}>
              <Icon name="plus" />
              {add.isPending ? t.adding : t.addSource}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
