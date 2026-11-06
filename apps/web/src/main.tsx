import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { createGymApi, localCredentialStore } from "./api/client";
import { installErrorReporting } from "./errors";
import { createI18n } from "./i18n";
import "./styles.css";

const i18n = createI18n();

// scrubbed reports of uncaught errors (specs/02, 07)
const reporter = createGymApi({ baseUrl: import.meta.env.VITE_API_URL ?? "/api", store: localCredentialStore() });
installErrorReporting(window, {
  send: reporter.reportError,
  tags: () => ({ route: location.pathname, release: import.meta.env.VITE_APP_VERSION ?? "dev", browser: navigator.userAgent.slice(0, 120) }),
});
document.documentElement.setAttribute("lang", i18n.language);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App i18n={i18n} />
    </BrowserRouter>
  </StrictMode>,
);
