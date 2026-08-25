/**
 * Canonical identity of the documentation site.
 *
 * The origin is a maintainer ruling, not configuration. Every absolute URL this
 * site emits — sitemap entries, the `Sitemap:` line in `robots.txt`, and (as the
 * remaining indexability work lands) `metadataBase`, canonical links and JSON-LD
 * identifiers — must name this host and no other. Hard-coding it twice is how the
 * two halves drift; hence one constant, imported.
 *
 * Deliberately NOT read from an environment variable. A preview deployment that
 * derived its own origin would emit canonical links and a sitemap pointing at the
 * preview host — precisely the duplicate-content signal a canonical link exists to
 * suppress. One host, declared once, here.
 */
export const SITE_ORIGIN = 'https://objectstack.ai';

/**
 * Absolute URL for a **site-relative** path.
 *
 * `path` must start with `/`. Anything else throws at build time rather than
 * quietly emitting a URL on the wrong host: `new URL(path, SITE_ORIGIN)` on its
 * own would hand an already-absolute `https://elsewhere/...` straight back, and a
 * sitemap listing another host is discarded wholesale by search engines rather
 * than reported.
 *
 * Next's `metadataBase` wants a `URL` rather than a string — write
 * `new URL(SITE_ORIGIN)` there, so this file stays the only place the origin is
 * spelled out.
 */
export function absoluteUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new Error(
      `absoluteUrl() expects a site-relative path starting with "/", received ${JSON.stringify(path)}`,
    );
  }

  return new URL(path, SITE_ORIGIN).toString();
}
