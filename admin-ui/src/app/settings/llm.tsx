// Settings, LLM: the host's built-in model (when it has one) or the integrator's own OpenAI-compatible provider.
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import type { AgentDetail } from "@shared/api";
import { updateLlm } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, CardFooter, Callout, Field, OptionGroup, Section } from "~/app/ui";
import { useApply, SaveFooter } from "~/app/settings/form";
import { LlmCheckResult, checkPassed, useLlmCheck } from "~/app/settings/llm-check";
import { formatNumber, useLocale, useT } from "~/i18n";

const DEFAULT_CUSTOM = { baseUrl: "https://api.openai.com/v1", model: "", embeddingModel: "text-embedding-3-small" };

// A titled group of fields; without a title (the settings tab) it only stacks them.
function FieldGroup({ title, children }: { title?: string; children: ReactNode }) {
  if (!title) return <>{children}</>;
  return (
    <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
      <legend className="float-left mb-4 w-full text-[13px] font-semibold tracking-wide text-ink-muted uppercase">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * The LLM form. With `onDone` (guided setup) the footer is "Test connection" and "Save & Continue": both save what
 * changed first, then run the connection test; Continue moves on only when the test passes.
 */
export function Llm({ detail, onDone }: { detail: AgentDetail; onDone?: () => void }) {
  const { agent, builtin } = detail;
  const {
    common,
    settings: { llm: t, tabs },
  } = useT();
  const locale = useLocale();
  const apply = useApply(agent.id);
  const check = useLlmCheck(agent.id);
  const form = useRef<HTMLFormElement>(null);
  const setup = onDone !== undefined;
  const saved = agent.llm;
  const savedCustom = saved?.provider === "custom" ? saved : DEFAULT_CUSTOM;
  const savedProvider = saved?.provider ?? "custom";
  const [provider, setProvider] = useState<"builtin" | "custom">(savedProvider);
  const [baseUrl, setBaseUrl] = useState(savedCustom.baseUrl);
  const [model, setModel] = useState(savedCustom.model);
  const [embeddingModel, setEmbeddingModel] = useState(savedCustom.embeddingModel);
  const [replacing, setReplacing] = useState(!agent.llmKey);
  const [apiKey, setApiKey] = useState("");
  const save = useMutation({
    mutationFn: () =>
      updateLlm(
        agent.id,
        provider === "builtin"
          ? { provider }
          : {
              provider,
              baseUrl: baseUrl.trim(),
              model: model.trim(),
              embeddingModel: embeddingModel.trim(),
              ...(apiKey && { apiKey: apiKey.trim() }),
            },
      ),
    onSuccess: async (d) => {
      setApiKey("");
      setReplacing(false);
      await apply(d);
    },
  });
  const errors = fieldErrors(save.error) ?? {};
  const busy = save.isPending || check.isPending;
  const dirty =
    !saved ||
    provider !== savedProvider ||
    (provider === "custom" &&
      (baseUrl.trim() !== savedCustom.baseUrl ||
        model.trim() !== savedCustom.model ||
        embeddingModel.trim() !== savedCustom.embeddingModel ||
        apiKey.length > 0));
  const embeddingsMove =
    agent.knowledge.sources > 0 &&
    (provider !== savedProvider ||
      (provider === "custom" &&
        (baseUrl.trim() !== savedCustom.baseUrl || embeddingModel.trim() !== savedCustom.embeddingModel)));
  const { used, limit, month } = builtin?.usage ?? { used: 0, limit: 0, month: new Date().toISOString().slice(0, 7) };
  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString(locale, { month: "long", timeZone: "UTC" });
  const [usedText, limitText] = [formatNumber(used, locale), formatNumber(limit, locale)];

  function reset() {
    setProvider(savedProvider);
    setBaseUrl(savedCustom.baseUrl);
    setModel(savedCustom.model);
    setEmbeddingModel(savedCustom.embeddingModel);
    setApiKey("");
    setReplacing(!agent.llmKey);
  }

  // Setup: save what changed, then test the saved settings. True when the test passed.
  async function saveAndTest() {
    if (!form.current?.reportValidity()) return false;
    try {
      if (dirty) await save.mutateAsync();
      return checkPassed(await check.mutateAsync());
    } catch {
      return false;
    }
  }

  const fields = (
    <>
      {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error, common.notSaved)}</Alert>}
      {builtin && (
        <OptionGroup
          legend={t.provider}
          value={provider}
          onChange={setProvider}
          options={[
            {
              value: "builtin",
              title: t.builtin,
              description: (
                <>
                  <span className="font-mono">{builtin.model}</span>
                  {t.builtinDescription(limitText)}
                </>
              ),
            },
            { value: "custom", title: t.custom, description: t.customDescription },
          ]}
        />
      )}

      {builtin && provider === "builtin" ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-ink-muted">{t.usageIn(monthName)}</span>
          <span className="text-[24px] font-semibold">
            {usedText} <span className="text-[14px] font-normal text-ink-muted">{t.of(limitText)}</span>
          </span>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-selected"
            role="img"
            aria-label={t.usageLabel(usedText, limitText, monthName)}
          >
            <div className="h-full bg-ink" style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 100}%` }} />
          </div>
          <p className="hint mt-0">{t.capHint}</p>
        </div>
      ) : (
        <>
          <FieldGroup title={setup ? t.groups.connection : undefined}>
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
          </FieldGroup>
          <FieldGroup title={setup ? t.groups.models : undefined}>
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
          </FieldGroup>
        </>
      )}
      {dirty && embeddingsMove && <Callout tone="warn">{t.reindexWarning(agent.knowledge.sources)}</Callout>}
    </>
  );

  return (
    <form
      ref={form}
      className="card m-0"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault();
        if (!setup) save.mutate();
        else if (await saveAndTest()) onDone();
      }}
    >
      {setup ? (
        <div id="llm" className="flex flex-col gap-6 p-6">
          {fields}
          <LlmCheckResult check={check} />
        </div>
      ) : (
        <Section id="llm" title={tabs.llm} explanation={t.explanation}>
          {fields}
        </Section>
      )}
      {setup ? (
        <CardFooter>
          <button type="button" className="btn" disabled={busy} onClick={() => void saveAndTest()}>
            {check.isPending ? t.checking : t.check}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {save.isPending ? common.saving : t.saveContinue}
          </button>
        </CardFooter>
      ) : (
        <SaveFooter dirty={dirty} pending={save.isPending} onDiscard={reset} />
      )}
    </form>
  );
}
