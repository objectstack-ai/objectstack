/**
 * @object-ui/i18n — text direction, without any catalogue payload.
 *
 * Split out of `locales/index.ts` by objectui#7479. That barrel statically
 * imports all ten catalogues, so anything reaching `isRTL` through it dragged
 * ~1.8 MB of raw translation data along with two constants. Direction is a
 * property OF a language code, not of its catalogue, so it belongs in a module
 * that holds no catalogue at all.
 *
 * `locales/index.ts` re-exports both names, so the historical import path keeps
 * working for the consumers that genuinely want all ten packs.
 */

/**
 * List of RTL language codes.
 *
 * Deliberately wider than the built-in catalogue set: `he`, `fa` and `ur` have
 * no pack here, but an app that supplies one through `config.resources` or a
 * `loadLanguage` loader still needs the right direction.
 */
export const RTL_LANGUAGES = ['ar', 'he', 'fa', 'ur'] as const;

/**
 * Check if a language code is RTL.
 */
export function isRTL(lang: string): boolean {
  return (RTL_LANGUAGES as readonly string[]).includes(lang);
}
