// Settings, User auth: how the agent identifies end users (data-plane auth mode).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { Agent, AuthConfig, AuthMode } from "@shared/api";
import { ALGORITHMS, DEFAULT_ALGORITHMS, type Algorithm } from "@shared/limits";
import { updateAuth } from "~/app/api/agents";
import { errorMessage, fieldErrors } from "~/app/api/client";
import { Alert, Callout, Checkbox, Field, OptionGroup, Section } from "~/app/ui";
import { useApply, SaveFooter } from "~/app/settings/form";
import { TestToken } from "~/app/preview/preview";
import { useT } from "~/i18n";

type Answer = "jwt" | "opaque" | "public";
// The wording of each answer is in t.settings.auth.answers.
const ANSWERS: { value: Answer; mode: AuthMode | null }[] = [
  { value: "jwt", mode: "jwks" },
  { value: "opaque", mode: "userinfo" },
  { value: "public", mode: "anonymous" },
];
const ANSWER_FOR: Record<AuthMode, Answer> = { jwks: "jwt", userinfo: "opaque", anonymous: "public" };

export function UserAuth({ agent }: { agent: Agent }) {
  const {
    common,
    modes,
    settings: { auth: t, tabs },
  } = useT();
  const apply = useApply(agent.id);
  const saved = agent.auth;
  const [answer, setAnswer] = useState<Answer | null>(saved ? ANSWER_FOR[saved.mode] : null);
  const mode = ANSWERS.find((a) => a.value === answer)?.mode ?? null;
  const pick = <M extends AuthMode>(m: M) => (saved?.mode === m ? (saved as Extract<AuthConfig, { mode: M }>) : null);
  const jwks = pick("jwks");
  const userinfo = pick("userinfo");

  const [jwksUrl, setJwksUrl] = useState(jwks?.jwksUrl ?? "");
  const [issuer, setIssuer] = useState(jwks?.issuer ?? "");
  const [audience, setAudience] = useState(jwks?.audience ?? "");
  const [anyAudience, setAnyAudience] = useState(jwks?.acceptAnyAudience ?? false);
  const [claim, setClaim] = useState(jwks?.userIdClaim ?? "sub");
  const [algorithms, setAlgorithms] = useState<Algorithm[]>(jwks?.algorithms ?? [...DEFAULT_ALGORITHMS]);
  const [userinfoUrl, setUserinfoUrl] = useState(userinfo?.url ?? "");
  const [field, setField] = useState(userinfo?.userIdField ?? "sub");
  const [ttl, setTtl] = useState(String(userinfo?.cacheTtlSeconds ?? 60));

  const input = (): (Partial<AuthConfig> & { mode: AuthMode }) | null => {
    switch (mode) {
      case "jwks":
        return {
          mode,
          jwksUrl: jwksUrl.trim(),
          issuer: issuer.trim(),
          audience: audience.trim(),
          acceptAnyAudience: anyAudience,
          userIdClaim: claim.trim(),
          algorithms,
        };
      case "userinfo":
        return { mode, url: userinfoUrl.trim(), userIdField: field.trim(), cacheTtlSeconds: Number(ttl) };
      case "anonymous":
        return { mode };
      default:
        return null;
    }
  };

  const save = useMutation({ mutationFn: () => updateAuth(agent.id, input()!), onSuccess: apply });
  const errors = fieldErrors(save.error) ?? {};
  const switching = saved && mode && saved.mode !== mode;
  const dirty = mode !== null && JSON.stringify(input()) !== JSON.stringify(saved && { ...saved });

  return (
    <div className="flex flex-col gap-6">
      <form
        className="card m-0"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode) save.mutate();
        }}
      >
        <Section id="auth" title={tabs.auth} explanation={t.explanation}>
          {save.error && !Object.keys(errors).length && <Alert>{errorMessage(save.error, common.notSaved)}</Alert>}
          <OptionGroup
            legend={t.question}
            value={answer}
            onChange={setAnswer}
            options={ANSWERS.map((a) => ({
              value: a.value,
              title: t.answers[a.value].title,
              description: t.answers[a.value].description,
            }))}
          />

          {mode === "jwks" && (
            <>
              <Field id="jwks-url" label="JWKS URL" error={errors.jwksUrl}>
                <input
                  id="jwks-url"
                  className="input font-mono"
                  type="url"
                  required
                  placeholder="https://auth.example.com/.well-known/jwks.json"
                  value={jwksUrl}
                  onChange={(e) => setJwksUrl(e.target.value)}
                />
              </Field>
              <Field id="issuer" label={t.issuer} hint={t.issuerHint} error={errors.issuer}>
                <input
                  id="issuer"
                  className="input font-mono"
                  required
                  value={issuer}
                  onChange={(e) => setIssuer(e.target.value)}
                />
              </Field>
              <Field id="audience" label={t.audience} hint={t.audienceHint} error={errors.audience}>
                <input
                  id="audience"
                  className="input font-mono"
                  disabled={anyAudience}
                  required={!anyAudience}
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                />
              </Field>
              <label className="flex items-start gap-2.5">
                <Checkbox checked={anyAudience} onChange={setAnyAudience} />
                <span>
                  <span className="font-medium">{t.anyAudience}</span>
                  <span className="block text-[13px] text-warning">{t.anyAudienceWarning}</span>
                </span>
              </label>
              <Field id="claim" label={t.claim} error={errors.userIdClaim}>
                <input
                  id="claim"
                  className="input font-mono"
                  required
                  value={claim}
                  onChange={(e) => setClaim(e.target.value)}
                />
              </Field>
              <fieldset className="m-0 border-0 p-0">
                <legend className="label">{t.algorithms}</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-2">
                  {ALGORITHMS.map((alg) => (
                    <label key={alg} className="flex min-h-8 items-center gap-2 font-mono text-[13px]">
                      <Checkbox
                        checked={algorithms.includes(alg)}
                        onChange={(checked) =>
                          setAlgorithms(checked ? [...algorithms, alg] : algorithms.filter((a) => a !== alg))
                        }
                      />
                      {alg}
                    </label>
                  ))}
                </div>
                {errors.algorithms && <p className="mt-1.5 mb-0 text-[13px] text-danger">{errors.algorithms}</p>}
                <p className="hint">{t.algorithmsHint}</p>
              </fieldset>
              <Callout>{t.revokedNote}</Callout>
            </>
          )}

          {mode === "userinfo" && (
            <>
              <Field id="userinfo-url" label="Userinfo URL" hint={t.userinfoHint} error={errors.url}>
                <input
                  id="userinfo-url"
                  className="input font-mono"
                  type="url"
                  required
                  value={userinfoUrl}
                  onChange={(e) => setUserinfoUrl(e.target.value)}
                />
              </Field>
              <Field id="userinfo-field" label={t.field} hint={t.fieldHint} error={errors.userIdField}>
                <input
                  id="userinfo-field"
                  className="input font-mono"
                  required
                  value={field}
                  onChange={(e) => setField(e.target.value)}
                />
              </Field>
              <Field id="userinfo-ttl" label={t.cacheFor} hint={t.cacheHint} error={errors.cacheTtlSeconds}>
                <div className="relative max-w-[200px]">
                  <input
                    id="userinfo-ttl"
                    className="input pr-12"
                    type="number"
                    min={0}
                    max={300}
                    required
                    value={ttl}
                    onChange={(e) => setTtl(e.target.value)}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[13px] text-ink-muted">
                    {t.sec}
                  </span>
                </div>
              </Field>
            </>
          )}

          {switching && (
            <Callout tone="warn">{t.switching(modes[saved.mode].toLowerCase(), modes[mode].toLowerCase())}</Callout>
          )}
        </Section>
        <SaveFooter
          dirty={dirty}
          pending={save.isPending}
          label={switching ? t.switchAndSave : common.saveChanges}
          onDiscard={() => setAnswer(saved ? ANSWER_FOR[saved.mode] : null)}
        />
      </form>
      {(saved?.mode === "jwks" || saved?.mode === "userinfo") && <TestToken agentId={agent.id} />}
    </div>
  );
}
