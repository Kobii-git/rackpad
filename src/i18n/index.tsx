import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SupportedLanguage } from "@/lib/types";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { en, type TranslationKey, type TranslationMap } from "./base";
import {
  LANGUAGE_BCP47,
  LANGUAGE_OPTIONS,
  RTL_LANGUAGES,
  SUPPORTED_LANGUAGES,
} from "./languages";

export { LANGUAGE_NATIVE_NAMES, LANGUAGE_OPTIONS } from "./languages";

type TranslationValues = Record<string, string | number | null | undefined>;

interface I18nContextValue {
  language: SupportedLanguage;
  setLanguage: (language: SupportedLanguage) => void;
  t: (key: TranslationKey, values?: TranslationValues) => string;
  formatRelativeTime: (iso: string | undefined) => string;
  translationLoadError: boolean;
  dismissTranslationLoadError: () => void;
}

const LANGUAGE_STORAGE_KEY = "rackpad.language";

const dictionaryLoaders: Record<
  Exclude<SupportedLanguage, "en">,
  () => Promise<TranslationMap>
> = {
  fr: () => import("./locales/fr").then((module) => module.fr),
  de: () => import("./locales/de").then((module) => module.de),
  nl: () => import("./locales/nl").then((module) => module.nl),
  es: () => import("./locales/es").then((module) => module.es),
  pt: () => import("./locales/pt").then((module) => module.pt),
  it: () => import("./locales/it").then((module) => module.it),
  pl: () => import("./locales/pl").then((module) => module.pl),
  zh: () => import("./locales/zh").then((module) => module.zh),
  "zh-TW": () => import("./locales/zh-TW").then((module) => module.zhTW),
  ja: () => import("./locales/ja").then((module) => module.ja),
  ko: () => import("./locales/ko").then((module) => module.ko),
  hi: () => import("./locales/hi").then((module) => module.hi),
  bn: () => import("./locales/bn").then((module) => module.bn),
  th: () => import("./locales/th").then((module) => module.th),
  he: () => import("./locales/he").then((module) => module.he),
  fa: () => import("./locales/fa").then((module) => module.fa),
  ar: () => import("./locales/ar").then((module) => module.ar),
  ru: () => import("./locales/ru").then((module) => module.ru),
  uk: () => import("./locales/uk").then((module) => module.uk),
  tr: () => import("./locales/tr").then((module) => module.tr),
  vi: () => import("./locales/vi").then((module) => module.vi),
  id: () => import("./locales/id").then((module) => module.id),
  af: () => import("./locales/af").then((module) => module.af),
};
const dictionaryCache = new Map<SupportedLanguage, TranslationMap>([
  ["en", en],
]);
const dictionaryLoadPromises = new Map<
  SupportedLanguage,
  Promise<TranslationMap>
>();

function loadDictionary(language: SupportedLanguage) {
  const cached = dictionaryCache.get(language);
  if (cached) return Promise.resolve(cached);
  const pending = dictionaryLoadPromises.get(language);
  if (pending) return pending;
  const promise = dictionaryLoaders[
    language as Exclude<SupportedLanguage, "en">
  ]()
    .then((dictionary) => {
      dictionaryCache.set(language, dictionary);
      dictionaryLoadPromises.delete(language);
      return dictionary;
    })
    .catch((error: unknown) => {
      dictionaryLoadPromises.delete(language);
      throw error;
    });
  dictionaryLoadPromises.set(language, promise);
  return promise;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const defaultLanguage = useStore((s) => s.uiSettings.defaultLanguage);
  const [browserLanguage, setBrowserLanguage] =
    useState<SupportedLanguage | null>(() => readStoredLanguage());
  const requestedLanguage: SupportedLanguage =
    browserLanguage ?? defaultLanguage ?? "en";
  const [language, setActiveLanguage] = useState<SupportedLanguage>("en");
  const [dictionary, setDictionary] = useState<TranslationMap>(en);
  const [translationLoadError, setTranslationLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function activate() {
      try {
        const next = await loadDictionary(requestedLanguage);
        if (cancelled) return;
        setDictionary(next);
        setActiveLanguage(requestedLanguage);
      } catch (error) {
        if (cancelled) return;
        void error;
        window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
        setBrowserLanguage("en");
        setDictionary(en);
        setActiveLanguage("en");
        setTranslationLoadError(true);
      }
    }
    void activate();
    return () => {
      cancelled = true;
    };
  }, [requestedLanguage]);

  useEffect(() => {
    document.documentElement.lang = LANGUAGE_BCP47[language];
    document.documentElement.dir = RTL_LANGUAGES.has(language) ? "rtl" : "ltr";
  }, [language]);

  const formatRelativeTime = useCallback(
    (iso: string | undefined) => formatRelativeTimeForLocale(language, iso),
    [language],
  );

  const t = useCallback(
    (key: TranslationKey, values?: TranslationValues) =>
      interpolate(dictionary[key] ?? en[key], values),
    [dictionary],
  );

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    setTranslationLoadError(false);
    setBrowserLanguage(nextLanguage);
  }, []);

  const dismissTranslationLoadError = useCallback(
    () => setTranslationLoadError(false),
    [],
  );

  const value = useMemo(
    () => ({
      language,
      setLanguage,
      t,
      formatRelativeTime,
      translationLoadError,
      dismissTranslationLoadError,
    }),
    [
      language,
      setLanguage,
      t,
      formatRelativeTime,
      translationLoadError,
      dismissTranslationLoadError,
    ],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return context;
}

export function LanguageSelector({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const { language, setLanguage, t } = useI18n();
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
        {label ?? t("Language")}
      </span>
      <select
        value={language}
        onChange={(event) =>
          setLanguage(event.target.value as SupportedLanguage)
        }
        className="rk-control h-8 w-full rounded-[var(--radius-sm)] px-2.5 text-sm text-[var(--text-primary)] focus-visible:outline-none"
        aria-label={t("Choose language")}
      >
        {LANGUAGE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.nativeName}
          </option>
        ))}
      </select>
    </label>
  );
}

function interpolate(text: string, values?: TranslationValues) {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function formatRelativeTimeForLocale(
  language: SupportedLanguage,
  iso: string | undefined,
) {
  if (!iso) return "—";
  const date = new Date(iso);
  const timestamp = date.getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const diffMs = Date.now() - timestamp;
  const seconds = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(LANGUAGE_BCP47[language], {
    numeric: "auto",
  });

  const absSeconds = Math.abs(seconds);
  if (absSeconds < 60) return rtf.format(-seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(-days, "day");
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(-months, "month");
  const years = Math.round(months / 12);
  return rtf.format(-years, "year");
}

function readStoredLanguage(): SupportedLanguage | null {
  const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isSupportedLanguage(value) ? value : null;
}

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return (
    typeof value === "string" &&
    SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)
  );
}
