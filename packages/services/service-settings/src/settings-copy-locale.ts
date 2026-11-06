// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The keys of this package's module-local copy tables: sentences composed per
 * request (with counts, names or a namespace) in the caller's language, which
 * the console's translation bundle cannot carry. The currency lock, the "no
 * longer offered" locale option, and the built-in settings action answers.
 *
 * One key per language on the platform locale table
 * (`@objectstack/spec/system` `PLATFORM_LOCALES`): every surface carries every
 * language on it. The four languages these tables served first keep the codes
 * the settings bundle uses (`zh-CN`, `ja-JP`, `es-ES`); the rest use the
 * table's tags. A table looks a caller's code up with core's `resolveLocale`,
 * which reads it through the platform table's read aliases, so `zh-TW` finds
 * `zh-Hant` and never the Simplified entry, `pt` finds `pt-BR`, and a code
 * naming no language here answers `undefined`, which every table serves in
 * English.
 */
export type SettingsCopyLocale =
  'en' | 'zh-CN' | 'zh-Hant' | 'es-ES' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ja-JP' | 'ko';

/** A count of `n` in Arabic, given the noun's five forms (1, 2, 3–10, 11–99, else). */
export function arabicCount(
  n: number,
  forms: { one: string; two: string; few: string; many: string; other: string },
): string {
  const rest = n % 100;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  if (rest >= 3 && rest <= 10) return `${n} ${forms.few}`;
  if (rest >= 11 && rest <= 99) return `${n} ${forms.many}`;
  return `${n} ${forms.other}`;
}

/** A count of `n` in Russian, given the noun's three forms (1, 2–4, 5–20 and the rest). */
export function russianCount(n: number, forms: { one: string; few: string; many: string }): string {
  const rest10 = n % 10;
  const rest100 = n % 100;
  if (rest10 === 1 && rest100 !== 11) return `${n} ${forms.one}`;
  if (rest10 >= 2 && rest10 <= 4 && (rest100 < 12 || rest100 > 14)) return `${n} ${forms.few}`;
  return `${n} ${forms.many}`;
}
