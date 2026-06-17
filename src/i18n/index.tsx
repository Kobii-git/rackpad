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
import {
  af,
  ar,
  bn,
  de,
  en,
  es,
  fa,
  fr,
  he,
  hi,
  id,
  it,
  ja,
  ko,
  nl,
  pl,
  pt,
  ru,
  th,
  tr,
  uk,
  vi,
  zh,
  zhTW,
  type TranslationKey,
  type TranslationMap,
} from "./translations";
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
}

const LANGUAGE_STORAGE_KEY = "rackpad.language";

const dictionaries: Record<SupportedLanguage, TranslationMap> = {
  en,
  fr,
  de,
  nl,
  es,
  pt,
  it,
  pl,
  zh,
  "zh-TW": zhTW,
  ja,
  ko,
  hi,
  bn,
  th,
  he,
  fa,
  ar,
  ru,
  uk,
  tr,
  vi,
  id,
  af,
};

const I18nContext = createContext<I18nContextValue | null>(null);

const SKIP_TRANSLATION_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE",
  "KBD",
  "SAMP",
]);

export function I18nProvider({ children }: { children: ReactNode }) {
  const defaultLanguage = useStore((s) => s.uiSettings.defaultLanguage);
  const [browserLanguage, setBrowserLanguage] = useState<SupportedLanguage | null>(
    () => readStoredLanguage(),
  );
  const language: SupportedLanguage = browserLanguage ?? defaultLanguage ?? "en";

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
      interpolate(dictionaries[language][key] ?? en[key], values),
    [language],
  );

  const setLanguage = useCallback((nextLanguage: SupportedLanguage) => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    setBrowserLanguage(nextLanguage);
  }, []);

  const value = useMemo(
    () => ({ language, setLanguage, t, formatRelativeTime }),
    [language, setLanguage, t, formatRelativeTime],
  );

  useEffect(() => {
    translateStaticDom(language);

    let frame = 0;
    const scheduleTranslate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => translateStaticDom(language));
    };

    const observer = new MutationObserver(scheduleTranslate);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["placeholder", "title", "aria-label", "alt"],
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [language]);

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
        onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
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

function translateStaticDom(language: SupportedLanguage) {
  const root = document.body;
  const dictionary = dictionaries[language];
  const phraseMap = buildPhraseMap();

  translateTextNodes(root, dictionary, phraseMap);
  translateAttributes(root, dictionary, phraseMap);
}

function buildPhraseMap() {
  const map = new Map<string, TranslationKey>();
  for (const dictionary of Object.values(dictionaries)) {
    for (const key of Object.keys(en) as TranslationKey[]) {
      map.set(dictionary[key], key);
    }
  }
  return map;
}

function translateTextNodes(
  root: HTMLElement,
  dictionary: TranslationMap,
  phraseMap: Map<string, TranslationKey>,
) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const original = node.textContent ?? "";
    const trimmed = original.trim();
    const key = phraseMap.get(trimmed);
    if (key) {
      const translated = dictionary[key];
      if (translated !== trimmed) {
        const next = original.replace(trimmed, translated);
        if (next !== original) {
          node.textContent = next;
        }
      }
    }
    node = walker.nextNode();
  }
}

function translateAttributes(
  root: HTMLElement,
  dictionary: TranslationMap,
  phraseMap: Map<string, TranslationKey>,
) {
  const attributes = ["placeholder", "title", "aria-label", "alt"];
  const elements = root.querySelectorAll<HTMLElement>(
    attributes.map((name) => `[${name}]`).join(","),
  );

  for (const element of elements) {
    if (shouldSkipElement(element)) continue;
    for (const attribute of attributes) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const key = phraseMap.get(value.trim());
      if (key) {
        const translated = dictionary[key];
        if (translated !== value) {
          element.setAttribute(attribute, translated);
        }
      }
    }
  }
}

function shouldSkipElement(element: Element) {
  return (
    SKIP_TRANSLATION_TAGS.has(element.tagName) ||
    element.closest("[data-no-i18n]") !== null
  );
}
