import type { i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import { AppRoutes } from "./routes";
import { type AppServices, ServicesProvider } from "./services";
import { ThemeProvider } from "./theme";

/** Providers shared by the app and tests; the router is supplied by the caller. */
export function App({ i18n, services }: { i18n: i18n; services?: AppServices }) {
  return (
    <I18nextProvider i18n={i18n}>
      <ServicesProvider services={services}>
        <ThemeProvider>
          <AppRoutes />
        </ThemeProvider>
      </ServicesProvider>
    </I18nextProvider>
  );
}
