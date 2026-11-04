import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { LocaleProvider, usePreferredLocale } from "~/i18n";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: Root,
});

function Root() {
  const { queryClient } = Route.useRouteContext();
  const locale = usePreferredLocale();
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleProvider locale={locale}>
        <Outlet />
      </LocaleProvider>
    </QueryClientProvider>
  );
}
