import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { config } from "~/config";
import { useT } from "~/i18n";
import { routeTree } from "./routeTree.gen";

function NotFound() {
  const t = useT();
  return (
    <main className="mx-auto max-w-5xl px-4 py-24">
      <h1 className="text-3xl font-bold tracking-tight">{t.common.pageNotFound}</h1>
      <p className="mt-4">
        <a href={`${config.basePath}/`}>{t.common.backHome}</a>
      </p>
    </main>
  );
}

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: config.basePath || "/",
    context: { queryClient: new QueryClient() },
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultNotFoundComponent: NotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
