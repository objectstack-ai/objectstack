// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The keys of this plugin's settings copy tables: the sentences a settings
 * write predicate refuses with, or a settings save answers with, in the
 * caller's language (the allowed-IP refusal, the sign-in floor, the two MFA
 * guards).
 *
 * One key per language on the platform locale table
 * (`@objectstack/spec/system` `PLATFORM_LOCALES`): every surface carries every
 * language on it. The four languages these tables served first keep their
 * older codes (`zh-CN`, `ja-JP`, `es-ES`); the rest use the table's tags. A
 * table looks a caller's code up with core's `resolveLocale`, which reads it
 * through the platform table's read aliases, so `zh-TW` finds `zh-Hant` and
 * never the Simplified entry, `pt` finds `pt-BR`, and a code naming no
 * language here answers `undefined`, which every table serves in English.
 */
export type SettingsCopyLocale =
  'en' | 'zh-CN' | 'zh-Hant' | 'es-ES' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ja-JP' | 'ko';
