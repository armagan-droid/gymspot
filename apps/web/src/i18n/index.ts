import i18next, { type i18n } from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import tr from "./tr.json";

// Turkish is the default, English the second language (CLAUDE.md "Dil").
export const LANGUAGES = ["tr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "tr";
export const resources = { tr: { translation: tr }, en: { translation: en } } as const;

const STORAGE_KEY = "gymspot.language";

export function storedLanguage(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): Language {
  const v = storage?.getItem(STORAGE_KEY);
  return (LANGUAGES as readonly string[]).includes(v ?? "") ? (v as Language) : DEFAULT_LANGUAGE;
}

export function createI18n(lng: Language = storedLanguage()): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false }, // React escapes
    initAsync: false,
  });
  instance.on("languageChanged", (l) => {
    globalThis.localStorage?.setItem(STORAGE_KEY, l);
    globalThis.document?.documentElement.setAttribute("lang", l);
  });
  return instance;
}
