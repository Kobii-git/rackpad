import { getJsonSetting, putJsonSetting } from './app-settings.js'

export const SUPPORTED_LANGUAGES = ['en', 'fr'] as const
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
  return value === 'fr' ? 'fr' : 'en'
}

function normalizeUiSettings(value: Partial<UiSettings> | UiSettings): UiSettings {
  return {
    defaultLanguage: normalizeLanguage(value.defaultLanguage),
  }
}
