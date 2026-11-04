import { useState, type FormEvent } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  SIGN_IN_REDIRECTS,
  authClient,
  providersQuery,
  requestMagicLink,
  savePendingEmail,
  sessionQuery,
  type MagicLinkError,
  type Provider,
} from "~/app/auth";
import { Alert, AuthLayout, Icon } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" ? { error: search.error } : {},
  beforeLoad: async ({ context }) => {
    if (await context.queryClient.fetchQuery(sessionQuery)) throw redirect({ to: "/" });
  },
  component: SignIn,
});

const PROVIDER_NAMES: Record<Provider, string> = {
  github: "GitHub",
  google: "Google",
};

function SignIn() {
  const t = useT();
  const { error: linkError } = Route.useSearch();
  const navigate = useNavigate();
  const { data: providers } = useQuery(providersQuery);
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  // A key of t.auth, so the message follows a language change.
  const [error, setError] = useState<MagicLinkError | "linkInvalid" | "providerUnavailable" | null>(
    linkError ? "linkInvalid" : null,
  );

  const enabled = (Object.keys(PROVIDER_NAMES) as Provider[]).filter((p) => providers?.[p]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const message = await requestMagicLink(email.trim());
    setPending(false);
    if (message) return setError(message);
    savePendingEmail(email.trim());
    await navigate({ to: "/check-email" });
  }

  async function social(provider: Provider) {
    setError(null);
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: SIGN_IN_REDIRECTS.callbackURL,
      errorCallbackURL: SIGN_IN_REDIRECTS.errorCallbackURL,
    });
    if (error) setError("providerUnavailable");
  }

  return (
    <AuthLayout footer={providers?.signup ? t.auth.signInFooter : undefined}>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 text-[22px] font-semibold">{t.common.signIn}</h1>
        <p className="m-0 text-ink-muted">{t.auth.signInLead}</p>
      </div>
      {error && <Alert>{t.auth[error]}</Alert>}
      {enabled.length > 0 && (
        <>
          <div className="flex flex-col gap-2.5">
            {enabled.map((p) => (
              <button key={p} className="btn btn-lg w-full" type="button" onClick={() => social(p)}>
                {t.auth.continueWith(PROVIDER_NAMES[p])}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[13px] text-ink-muted">
            <span className="h-px flex-1 bg-line" />
            {t.auth.or}
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}
      <form className="m-0 flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="label" htmlFor="email">
            {t.auth.workEmail}
          </label>
          <input
            className="input input-lg"
            id="email"
            type="email"
            required
            placeholder={t.auth.emailPlaceholder}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <button className="btn btn-lg btn-primary w-full" type="submit" disabled={pending}>
          <Icon name="mail" />
          {pending ? t.auth.sending : t.auth.sendLink}
        </button>
      </form>
      <p className="m-0 text-[13px] text-ink-muted">{t.auth.noPassword}</p>
    </AuthLayout>
  );
}
