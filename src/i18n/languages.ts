export const LANGUAGE_OPTIONS = [
  { code: "en", bcp47: "en", nativeName: "English", rtl: false },
  { code: "fr", bcp47: "fr-FR", nativeName: "Français", rtl: false },
  { code: "de", bcp47: "de", nativeName: "Deutsch", rtl: false },
  { code: "nl", bcp47: "nl", nativeName: "Nederlands", rtl: false },
  { code: "es", bcp47: "es", nativeName: "Español", rtl: false },
  { code: "pt", bcp47: "pt", nativeName: "Português", rtl: false },
  { code: "it", bcp47: "it", nativeName: "Italiano", rtl: false },
  { code: "pl", bcp47: "pl", nativeName: "Polski", rtl: false },
  { code: "zh", bcp47: "zh-CN", nativeName: "简体中文", rtl: false },
  { code: "zh-TW", bcp47: "zh-TW", nativeName: "繁體中文", rtl: false },
  { code: "ja", bcp47: "ja-JP", nativeName: "日本語", rtl: false },
  { code: "ko", bcp47: "ko-KR", nativeName: "한국어", rtl: false },
  { code: "hi", bcp47: "hi-IN", nativeName: "हिन्दी", rtl: false },
  { code: "bn", bcp47: "bn", nativeName: "বাংলা", rtl: false },
  { code: "th", bcp47: "th", nativeName: "ไทย", rtl: false },
  { code: "he", bcp47: "he", nativeName: "עברית", rtl: true },
  { code: "fa", bcp47: "fa", nativeName: "فارسی", rtl: true },
  { code: "ar", bcp47: "ar", nativeName: "العربية", rtl: true },
  { code: "ru", bcp47: "ru", nativeName: "Русский", rtl: false },
  { code: "uk", bcp47: "uk", nativeName: "Українська", rtl: false },
  { code: "tr", bcp47: "tr", nativeName: "Türkçe", rtl: false },
  { code: "vi", bcp47: "vi", nativeName: "Tiếng Việt", rtl: false },
  { code: "id", bcp47: "id", nativeName: "Bahasa Indonesia", rtl: false },
  { code: "af", bcp47: "af", nativeName: "Afrikaans", rtl: false },
] as const;

export type SupportedLanguage = (typeof LANGUAGE_OPTIONS)[number]["code"];

export const SUPPORTED_LANGUAGES = LANGUAGE_OPTIONS.map(
  (option) => option.code,
) as SupportedLanguage[];

export const LANGUAGE_NATIVE_NAMES = Object.fromEntries(
  LANGUAGE_OPTIONS.map((option) => [option.code, option.nativeName]),
) as Record<SupportedLanguage, string>;

export const LANGUAGE_BCP47 = Object.fromEntries(
  LANGUAGE_OPTIONS.map((option) => [option.code, option.bcp47]),
) as Record<SupportedLanguage, string>;

export const RTL_LANGUAGES = new Set<SupportedLanguage>(
  LANGUAGE_OPTIONS.filter((option) => option.rtl).map((option) => option.code),
);
