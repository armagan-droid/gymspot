import { useTranslation } from "react-i18next";
import { LANGUAGES } from "../i18n";
import { useTheme } from "../theme";

/** Language and theme switches (AC-8.4) plus the mandatory disclaimer (specs/07). */
export function SettingsPanel() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <section aria-labelledby="settings-title" className="settings">
      <h2 id="settings-title">{t("settings.title")}</h2>
      <label>
        {t("settings.language")}
        <select value={i18n.language} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("settings.theme")}
        <select value={theme} onChange={(e) => setTheme(e.target.value as "dark" | "light")}>
          <option value="dark">{t("settings.themeDark")}</option>
          <option value="light">{t("settings.themeLight")}</option>
        </select>
      </label>
      <p className="disclaimer">{t("legal.medicalDisclaimer")}</p>
    </section>
  );
}
