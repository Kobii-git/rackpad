import { getJsonSetting, putJsonSetting } from './app-settings.js'

export const SUPPORTED_LANGUAGES = [
  'en',
  'fr',
  'de',
  'nl',
  'es',
  'pt',
  'it',
  'pl',
  'zh',
  'zh-TW',
  'ja',
  'ko',
  'hi',
  'bn',
  'th',
  'he',
  'fa',
  'ar',
  'ru',
  'uk',
  'tr',
  'vi',
  'id',
  'af',
] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export interface UiSettings {
  defaultLanguage: SupportedLanguage
}

const UI_SETTINGS_KEY = 'uiSettings'

export const DEFAULT_UI_SETTINGS: UiSettings = {
  defaultLanguage: 'en',
}

export function loadUiSettings() {
  return normalizeUiSettings(getJsonSetting<UiSettings>(UI_SETTINGS_KEY, DEFAULT_UI_SETTINGS))
}

export function saveUiSettings(value: Partial<UiSettings>) {
  const next = normalizeUiSettings({
    ...loadUiSettings(),
    ...value,
  })
  putJsonSetting(UI_SETTINGS_KEY, next)
  return next
}

export function normalizeLanguage(value: unknown): SupportedLanguage {
  if (
    typeof value === 'string' &&
    (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
  ) {
    return value as SupportedLanguage
  }
  return 'en'
}

function normalizeUiSettings(value: Partial<UiSettings> | UiSettings): UiSettings {
  return {
    defaultLanguage: normalizeLanguage(value.defaultLanguage),
  }
}
