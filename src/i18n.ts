import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import enTranslation from "./locales/en/translation.json";
import ukTranslation from "./locales/uk/translation.json";

export const SUPPORTED_LANGUAGES = ["en", "uk"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const resources = {
  en: {
    translation: enTranslation,
  },
  uk: {
    translation: ukTranslation,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    // Region codes from the OS/webview (uk-UA, en-US) resolve to the base language.
    supportedLngs: [...SUPPORTED_LANGUAGES],
    nonExplicitSupportedLngs: true,
    load: "languageOnly",
    interpolation: {
      escapeValue: false, // React already escapes rendered text
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
    // Ukrainian plural suffixes (_one/_few/_many)
    compatibilityJSON: "v4",
  });

/** The active supported language ("en" | "uk"), never a region code. Use for language selects. */
export function currentLanguage(): SupportedLanguage {
  const lng = i18n.resolvedLanguage ?? i18n.language ?? "en";
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lng) ? (lng as SupportedLanguage) : "en";
}

const syncDocumentLanguage = () => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = currentLanguage();
  }
};
syncDocumentLanguage();
i18n.on("languageChanged", syncDocumentLanguage);

export default i18n;
