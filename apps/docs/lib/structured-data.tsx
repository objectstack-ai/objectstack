import sitemap from '@/app/sitemap';
import { gitConfig } from '@/lib/layout.shared';
import { absoluteUrl } from '@/lib/site';

/**
 * JSON-LD (schema.org) emitted by this site.
 *
 * One module rather than a copy per route, for two reasons that are not style:
 *
 * 1. **One organisation identity.** `Organization` is referenced as the
 *    `author` / `publisher` of every doc page and every blog post. Spelled once
 *    per route it would be three definitions of the same company, free to drift
 *    the first time a logo or a `sameAs` link changes — the exact failure the
 *    "emit from the same page data as the metadata" requirement exists to stop.
 * 2. **One escaping implementation.** The serialiser below is the only thing
 *    standing between page frontmatter and a `</script>` injected into every
 *    page of the site. Three copies is three places for that `.replace()` to
 *    go missing.
 */

/** The YouTube channel — also linked twice from the homepage body. */
export const YOUTUBE_CHANNEL_URL = 'https://www.youtube.com/@objectstack';

/** The GitHub **organisation** (not the repo): what `sameAs` wants. */
export const GITHUB_ORG_URL = `https://github.com/${gitConfig.user}`;

/** The repository the runtime is developed in — `codeRepository`. */
export const GITHUB_REPO_URL = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

/**
 * `license` ranges over `CreativeWork | URL` — **not** `Text`. `"Apache-2.0"`
 * is the SPDX identifier, which is what `package.json` and the repo's `LICENSE`
 * carry, but as a bare string it is not a value this property accepts. The
 * canonical URL of the same licence is, and it is unambiguous.
 */
export const APACHE_2_0_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

/** Stable `@id`s, so the same entity on two pages is one entity to a consumer. */
export const ORGANIZATION_ID = absoluteUrl('/#organization');
export const SOFTWARE_ID = absoluteUrl('/#software');

/** A JSON-LD node. Deliberately loose — schema.org is open-world. */
export type JsonLdNode = Record<string, unknown>;

/**
 * The publisher of everything on this site.
 *
 * Embedded **in full** in every page's `@graph` rather than referenced across
 * pages by bare `@id`: a consumer parses one page at a time, and a dangling
 * `@id` reference resolves to nothing. Carrying the node costs ~200 bytes and
 * makes each page self-describing.
 */
export const ORGANIZATION: JsonLdNode = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: 'ObjectStack',
  url: absoluteUrl('/'),
  logo: absoluteUrl('/logo.svg'),
  sameAs: [GITHUB_ORG_URL, YOUTUBE_CHANNEL_URL],
};

/** A reference to {@link ORGANIZATION}, valid inside the same `@graph`. */
export const ORGANIZATION_REF: JsonLdNode = { '@id': ORGANIZATION_ID };

/**
 * `dateModified`, read from **the sitemap's own output**.
 *
 * `app/sitemap.ts` derives `lastModified` from a single `git log` pass over the
 * content roots, and deliberately omits the field when the date cannot be known.
 * Two answers for one page's date is worse than one absent date, so this does
 * not re-derive anything: it calls that route's default export and indexes the
 * array it returns. The value below and the `<lastmod>` in `/sitemap.xml` are
 * literally the same object, serialised the same way — they cannot disagree.
 *
 * `sitemap()` is called at most once per process; `loadGitDates()` inside it is
 * memoised too, so the `git log` runs once per build worker exactly as it does
 * for the sitemap route itself. When git is unavailable the map is empty and
 * every caller gets `undefined`, which is the honest answer rather than a
 * substituted build time.
 */
let lastModifiedByUrl: Map<string, string> | undefined;

export function sitemapLastModified(path: string): string | undefined {
  lastModifiedByUrl ??= new Map(
    sitemap().flatMap((entry) => {
      if (!entry.lastModified) return [];
      const iso =
        entry.lastModified instanceof Date
          ? entry.lastModified.toISOString()
          : new Date(entry.lastModified).toISOString();
      return [[entry.url, iso] as const];
    }),
  );

  return lastModifiedByUrl.get(absoluteUrl(path));
}

/** Drop keys whose value is `undefined` or an empty array — an absent property beats an empty one. */
export function compact(node: JsonLdNode): JsonLdNode {
  return Object.fromEntries(
    Object.entries(node).filter(
      ([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0),
    ),
  );
}

/** One crumb: a display name and the absolute URL it points at. */
export interface Crumb {
  name: string;
  url: string;
}

/**
 * A `BreadcrumbList` node.
 *
 * `item` is emitted for every entry including the last. Google permits omitting
 * it on the final crumb; emitting it is also permitted and keeps every entry the
 * same shape.
 */
export function breadcrumbList(id: string, trail: Crumb[]): JsonLdNode {
  return {
    '@type': 'BreadcrumbList',
    '@id': id,
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: crumb.url,
    })),
  };
}

/**
 * Render a `@graph` as `<script type="application/ld+json">`.
 *
 * ⚠️ The `.replace()` is load-bearing, not cosmetic. Page titles, descriptions
 * and blog tags reach this function unfiltered; a `</script>` anywhere in them
 * would otherwise close the element and hand the rest of the JSON to the HTML
 * parser as markup. Escaping every `<` to the backslash-u escape for U+003C is
 * valid JSON, parses back to the identical string, and makes that sequence
 * unspellable in the emitted document.
 */
export function JsonLd({ graph }: { graph: JsonLdNode[] }) {
  const document = { '@context': 'https://schema.org', '@graph': graph };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(document).replace(/</g, '\\u003c'),
      }}
    />
  );
}
