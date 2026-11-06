import type { i18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import { AppRoutes } from "./routes";
import { ThemeProvider } from "./theme";

/** Providers shared by the app and tests; the router is supplied by the caller. */
export function App({ i18n }: { i18n: i18n }) {
  return (
    <I18nextProvider i18n={i18n}>
      <ThemeProvider>
        <AppRoutes />
      </ThemeProvider>
    </I18nextProvider>
  );
}
