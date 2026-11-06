import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import { createI18n } from "./i18n";
import "./styles.css";

const i18n = createI18n();
document.documentElement.setAttribute("lang", i18n.language);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App i18n={i18n} />
    </BrowserRouter>
  </StrictMode>,
);
