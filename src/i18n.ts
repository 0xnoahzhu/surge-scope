import { useEffect, useState } from "react";
import chinese from "./locales/zh.json";
export type Language = "en" | "zh";
export type Translate = (message: string) => string;
export function translate(message: string, language: Language): string {
  return language === "zh"
    ? ((chinese as Record<string, string>)[message] ?? message)
    : message;
}
export function useLanguage() {
  const [language, setLanguage] = useState<Language>(() =>
    localStorage.getItem("language") === "zh" ? "zh" : "en",
  );
  useEffect(() => {
    localStorage.setItem("language", language);
    document.documentElement.lang = language;
  }, [language]);
  return {
    language,
    setLanguage,
    t: (message: string) => translate(message, language),
  };
}
