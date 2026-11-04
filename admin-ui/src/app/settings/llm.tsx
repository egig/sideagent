// Settings, LLM: the integrator's own OpenAI-compatible provider.
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AgentDetail } from "@shared/api";
import { updateLlm } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Callout, Field, Section } from "~/app/ui";
import { useApply, SaveFooter } from "~/app/settings/form";
import { useT } from "~/i18n";

const DEFAULT_CUSTOM = { baseUrl: "https://api.openai.com/v1", model: "", embeddingModel: "text-embedding-3-small" };

export function Llm({ detail }: { detail: AgentDetail }) {
  const { agent } = detail;
  const {
    common,
    settings: { llm: t, tabs },
  } = useT();
  const apply = useApply(agent.id);
  const saved = agent.llm;
  const savedCustom = saved ?? DEFAULT_CUSTOM;
  const [baseUrl, setBaseUrl] = useState(savedCustom.baseUrl);
  const [model, setModel] = useState(savedCustom.model);
  const [embeddingModel, setEmbeddingModel] = useState(savedCustom.embeddingModel);
  const [replacing, setReplacing] = useState(!agent.llmKey);
  const [apiKey, setApiKey] = useState("");
  const save = useMutation({
    mutationFn: () =>
      updateLlm(agent.id, {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        embeddingModel: embeddingModel.trim(),
        ...(apiKey && { apiKey: apiKey.trim() }),
      }),
    onSuccess: async (d) => {
      setApiKey("");
      setReplacing(false);
      await apply(d);
    },
  });
  const errors = fieldErrors(save.error) ?? {};
  const dirty =
    !saved ||
    baseUrl.trim() !== savedCustom.baseUrl ||
    model.trim() !== savedCustom.model ||
    embeddingModel.trim() !== savedCustom.embeddingModel ||
    apiKey.length > 0;
  const embeddingsMove =
    agent.knowledge.sources > 0 &&
    (baseUrl.trim() !== savedCustom.baseUrl || embeddingModel.trim() !== savedCustom.embeddingModel);

  function reset() {
    setBaseUrl(savedCustom.baseUrl);
    setModel(savedCustom.model);
    setEmbeddingModel(savedCustom.embeddingModel);
    setApiKey("");
    setReplacing(!agent.llmKey);
  }

  return (
    <form
      className="card m-0"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Section id="llm" title={tabs.llm} explanation={t.explanation}>
        {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error, common.notSaved)}</Alert>}
        <Field id="llm-base" label={t.baseUrl} hint={t.baseUrlHint} error={errors.baseUrl}>
          <input
            id="llm-base"
            className="input font-mono"
            type="url"
            required
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </Field>
        <Field id="llm-model" label={t.model} error={errors.model}>
          <input
            id="llm-model"
            className="input font-mono"
            required
            placeholder="gpt-4o-mini"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
        </Field>
        <Field id="llm-embedding" label={t.embeddingModel} hint={t.embeddingHint} error={errors.embeddingModel}>
          <input
            id="llm-embedding"
            className="input font-mono"
            required
            value={embeddingModel}
            onChange={(e) => setEmbeddingModel(e.target.value)}
          />
        </Field>
        <Field id="llm-key" label={t.apiKey} hint={t.apiKeyHint} error={errors.apiKey}>
          {replacing ? (
            <input
              id="llm-key"
              className="input font-mono"
              type="password"
              autoComplete="off"
              required={!agent.llmKey}
              placeholder={agent.llmKey ? t.newKey : ""}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          ) : (
            <div className="flex items-center gap-2">
              <span id="llm-key" className="input flex items-center font-mono text-ink-muted">
                •••• •••• {agent.llmKey?.last4}
              </span>
              <button type="button" className="btn whitespace-nowrap" onClick={() => setReplacing(true)}>
                {t.replaceKey}
              </button>
            </div>
          )}
        </Field>
        {dirty && embeddingsMove && <Callout tone="warn">{t.reindexWarning(agent.knowledge.sources)}</Callout>}
      </Section>
      <SaveFooter dirty={dirty} pending={save.isPending} onDiscard={reset} />
    </form>
  );
}
