/**
 * Canonical identity of the documentation site — the origin it names itself by,
 * and the shared cover asset it presents itself with.
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

/**
 * The hero cover — the one image this site presents itself with.
 *
 * Three consumers, one declaration: the homepage's click-to-play video poster
 * (`app/[lang]/page.tsx`), the homepage's Open Graph / Twitter card and JSON-LD
 * `image` (same file), and the blog's card for the index and every post
 * (`app/[lang]/blog/[[...slug]]/page.tsx`). Before this constant the path was
 * spelled as a literal in all three, and two of them do not read as image
 * references at all — they read as SEO config — so a re-encode had to find them
 * by memory. It is declared here, next to `SITE_ORIGIN`, because the cover is
 * part of the site's identity in the same way the origin is: one asset, named
 * once, that every self-description reads.
 *
 * ⚠️ `width` / `height` are emitted as `og:image:width` / `og:image:height`. A
 * declared size that disagrees with the bytes is worse than no declaration — a
 * crawler reserves the wrong box and some renderers reject the card outright —
 * so anything that changes the asset's pixel dimensions must change these in the
 * same commit. They are correct only because the re-encode below deliberately
 * kept 2400x1200.
 *
 * ## Provenance — how to re-encode it
 *
 * The master is `docs/screenshots/hero-cover-dark.png` (2400x1200, 406,703 B),
 * which the README embeds directly from the repo and which is NOT served by this
 * site. This file is a lossy WebP derived from that master, and the derivation is
 * the whole reason it is small enough to sit above the fold:
 *
 *   sharp('docs/screenshots/hero-cover-dark.png')
 *     .webp({ quality: 80, effort: 6 })            // sharp 0.35.3 / libwebp 1.6.0
 *     .toFile('apps/docs/public/hero-cover-dark.webp')
 *
 * 83,272 B — 20.5% of the PNG. Re-encode from the master, never from this file:
 * a lossy re-encode of a lossy source compounds. And do not "restore" the PNG
 * alongside it — a `public/` holding both is how the next re-encode picks the
 * wrong one.
 *
 * Format is a constraint, not a preference. It is a plain `<img>` with no
 * `<picture>` fallback and it is also the og:image, so it must be a format every
 * browser AND every unfurler decodes. WebP is; AVIF is measurably better per byte
 * on this image and was rejected because it is not.
 */
export const HERO_COVER = {
  url: '/hero-cover-dark.webp',
  width: 2400,
  height: 1200,
  alt: 'ObjectStack — the metadata framework for AI-written apps',
} as const;
