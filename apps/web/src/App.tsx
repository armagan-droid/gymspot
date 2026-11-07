import type { i18n } from "i18next";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { syncRulePacks } from "./rules";
import { AppRoutes } from "./routes";
import { type AppServices, ServicesProvider, useServices } from "./services";
import { ThemeProvider } from "./theme";

/** Refreshes rule packs from the API on start and whenever the app comes back (T6.3). */
function RulePackSync() {
  const services = useServices();
  useEffect(() => {
    const { api, staff, store, storage } = services;
    const sync = () =>
      void syncRulePacks({
        storage,
        fetch: async () =>
          store.get("device") ? api.exercises("device") : store.get("member") ? api.exercises("member") : store.get("staff") ? staff.exercises() : null,
      });
    sync();
    const onVisible = () => document.visibilityState === "visible" && sync();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [services]);
  return null;
}

/** Providers shared by the app and tests; the router is supplied by the caller. */
export function App({ i18n, services }: { i18n: i18n; services?: AppServices }) {
  return (
    <I18nextProvider i18n={i18n}>
      <ServicesProvider services={services}>
        <RulePackSync />
        <ThemeProvider>
          <AppRoutes />
        </ThemeProvider>
      </ServicesProvider>
    </I18nextProvider>
  );
}
