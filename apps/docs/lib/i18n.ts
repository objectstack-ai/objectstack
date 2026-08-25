import { defineI18n } from 'fumadocs-core/i18n';

/**
 * i18n Configuration for ObjectStack Documentation
 *
 * Supported Languages:
 * - en: English (Default)
 *
 * The docs are English-only by decision (2026-07). To add a language later,
 * list it here and provide content — routing already handles the rest.
 */
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en'],
  // Hide locale prefix for default language (e.g., /docs instead of /en/docs)
  hideLocale: 'default-locale',
});

/**
 * True when `value` is one of the locales declared above.
 *
 * The `[lang]` route segment is a catch-all: without this check it matches ANY
 * single path segment and renders the homepage under it. Paths containing a dot
 * are the reachable case, because `proxy.ts`'s matcher deliberately excludes
 * them from locale rewriting (static assets must not be rewritten), so they
 * arrive at `[lang]` with `lang` set to the literal segment — `"robots.txt"`,
 * `"ads.txt"`, `"anything.html"`. Declared locales are the contract; this is
 * where it is enforced.
 */
export function isSupportedLanguage(value: string): boolean {
  return (i18n.languages as readonly string[]).includes(value);
}
