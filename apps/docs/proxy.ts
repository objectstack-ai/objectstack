import { NextRequest, NextResponse } from 'next/server';
import Negotiator from 'negotiator';
import { i18n } from '@/lib/i18n';

const LOCALE_COOKIE = 'FD_LOCALE';

/**
 * Supported languages extracted from i18n configuration
 */
const SUPPORTED_LANGUAGES = i18n.languages as readonly string[];

/**
 * Set locale cookie with consistent options
 */
function setLocaleCookie(response: NextResponse, locale: string): void {
  response.cookies.set(LOCALE_COOKIE, locale, {
    sameSite: 'lax',
    path: '/',
  });
}

/**
 * Get the preferred language from the request
 */
function getPreferredLanguage(request: NextRequest): string {
  // Check cookie first
  const cookieLocale = request.cookies.get(LOCALE_COOKIE)?.value;
  if (cookieLocale && SUPPORTED_LANGUAGES.includes(cookieLocale)) {
    return cookieLocale;
  }

  // Then check Accept-Language header
  const negotiatorHeaders = Object.fromEntries(request.headers.entries());
  const negotiator = new Negotiator({ headers: negotiatorHeaders });
  const browserLanguages = negotiator.languages();

  // Find the first match
  for (const lang of browserLanguages) {
    if (SUPPORTED_LANGUAGES.includes(lang)) {
      return lang;
    }
  }
  
  return i18n.defaultLanguage;
}

/**
 * Proxy (Next `proxy` file convention) for automatic language detection and
 * redirection
 * 
 * This proxy:
 * - Detects the user's preferred language from browser settings or cookies
 * - Redirects users to the appropriate localized version
 * - For the default language (en): keeps URL as "/" (with internal rewrite)
 * - Stores language preference as a cookie
 *
 * The docs are English-only by decision (2026-07); the i18n plumbing stays so a
 * future language only needs entries in lib/i18n.ts and content, not new routing.
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if the pathname already has a locale
  const pathnameHasLocale = i18n.languages.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );

  if (pathnameHasLocale) {
    // Extract the locale from the pathname
    const locale = pathname.split('/')[1];
    
    // If it's the default locale and hideLocale is 'default-locale', redirect to remove locale prefix
    if (locale === i18n.defaultLanguage && i18n.hideLocale === 'default-locale') {
      const url = new URL(request.url);
      // Remove locale prefix more precisely to avoid issues with partial matches
      url.pathname = pathname.replace(new RegExp(`^/${i18n.defaultLanguage}(/|$)`), '$1') || '/';
      const response = NextResponse.redirect(url);
      setLocaleCookie(response, locale);
      return response;
    }
    
    return NextResponse.next();
  }

  // Pathname doesn't have a locale, determine preferred language
  const preferredLanguage = getPreferredLanguage(request);

  // If preferred language is the default, rewrite internally (keep URL clean)
  if (preferredLanguage === i18n.defaultLanguage && i18n.hideLocale === 'default-locale') {
    const url = new URL(request.url);
    // Handle root path specially to avoid double slashes
    url.pathname = pathname === '/' ? `/${i18n.defaultLanguage}` : `/${i18n.defaultLanguage}${pathname}`;
    return NextResponse.rewrite(url);
  }

  // For non-default languages, redirect to the localized path
  const url = new URL(request.url);
  // Handle root path specially to avoid double slashes
  url.pathname = pathname === '/' ? `/${preferredLanguage}` : `/${preferredLanguage}${pathname}`;
  const response = NextResponse.redirect(url);
  setLocaleCookie(response, preferredLanguage);
  return response;
}

export const config = {
  // Match all routes except:
  // - API routes (/api/*)
  // - Next.js static files (/_next/static/*)
  // - Next.js image optimization (/_next/image/*)
  // - Favicon and other static assets
  //
  // The `.*\..*` limb -- exclude any path containing a DOT -- is load-bearing
  // for two surfaces beyond static assets, and neither is visible from here:
  //
  // - `apps/docs/lib/source.ts`'s `getPageImage()` appends an `image.png`
  //   marker to every Open Graph card URL. That marker's dot is the ONLY reason
  //   `/og/docs/<page>/image.png` is not rewritten to `/en/og/docs/...`, which
  //   is not a route -- the `app/og/` tree is top-level, not under
  //   `app/[lang]/`. Widening this pattern 404s every `og:image` on the site at
  //   once, and nothing fetches those URLs, so the break is silent. Already
  //   ruled out as a surface to widen for the same reason from the other end:
  //   it would also 404 `/llms.txt`, `/llms-full.txt`, `/og/**` and
  //   `/docs/**.mdx`.
  // - Conversely, BECAUSE dotted paths skip this proxy they reach `app/[lang]/`
  //   with `lang` set to the literal segment (`robots.txt`, `ads.txt`), which is
  //   why `apps/docs/lib/i18n.ts` carries the `isSupportedLanguage` guard.
  //
  // `pnpm check:docs-locale-catch-all` gates both halves.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
