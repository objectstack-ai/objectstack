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

/**
 * The public URL path for a route path: the hidden default-locale prefix
 * removed (`/en/blog/x` → `/blog/x`, `/en` → `/`); any other path unchanged.
 *
 * Every page lives under `app/[lang]/`, so a page prerendered at build time is
 * rendered at its internal path — `/en/blog/x` — and that is what Next's
 * `usePathname()` answers during the prerender. A visitor never sees that path:
 * `proxy.ts` rewrites `/blog/x` to it and redirects `/en/...` away, and the
 * browser-side `usePathname()` answers the public `/blog/x`. Every URL fumadocs
 * compares a pathname against (nav links, the docs page tree) is public too, so
 * the server-side comparison missed on every prerendered page and hydration
 * never repainted the result. This is the same mapping as the proxy's
 * `/en/...` redirect, read from the same config.
 */
export function toPublicPath(pathname: string): string {
  if (i18n.hideLocale !== 'default-locale') return pathname;
  const prefix = `/${i18n.defaultLanguage}`;
  if (pathname === prefix) return '/';
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : pathname;
}
