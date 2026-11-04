import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { AuthLayout } from "~/app/ui";
import { useT } from "~/i18n";

export const Route = createFileRoute("/verify")({
  component: Verify,
});

// Only these fragment params are forwarded to better-auth's verify endpoint.
const FORWARDED = ["token", "callbackURL", "newUserCallbackURL", "errorCallbackURL"];

function readFragment(): URLSearchParams | null {
  const all = new URLSearchParams(window.location.hash.slice(1));
  if (!all.get("token")) return null;
  const kept = new URLSearchParams();
  for (const key of FORWARDED) {
    const value = all.get(key);
    if (value) kept.set(key, value);
  }
  return kept;
}

// The emailed link opens this page so that link scanners, which fetch but do
// not click, cannot spend the single-use token.
function Verify() {
  const t = useT();
  const [params] = useState(readFragment);

  useEffect(() => {
    // Drop the token from the address bar and history.
    history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!params) {
    return (
      <AuthLayout>
        <h1 className="m-0 text-[22px] font-semibold">{t.auth.linkIncomplete}</h1>
        <p className="m-0 text-ink-muted">{t.auth.linkIncompleteHint}</p>
        <Link to="/sign-in" className="btn btn-lg btn-primary w-full">
          {t.auth.backToSignIn}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-[22px] font-semibold">{t.auth.confirm}</h1>
        <p className="m-0 text-ink-muted">{t.auth.confirmHint}</p>
      </div>
      <a className="btn btn-lg btn-primary w-full" href={`/api/auth/magic-link/verify?${params}`}>
        {t.auth.continue}
      </a>
    </AuthLayout>
  );
}
