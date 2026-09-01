import { docs, blog as blogCollection } from 'fumadocs-mdx:collections/server';
import { type InferPageType, loader } from 'fumadocs-core/source';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { i18n } from '@/lib/i18n';
import { navTitlePlugin } from '@/lib/nav-title';

/**
 * The docs page tree.
 *
 * `navTitlePlugin()` is what lets a page carry a short sidebar label
 * (`navTitle`) distinct from the `title` every other consumer reads; it is the
 * ONLY place the page tree's labels are resolved, and `apps/docs/lib/nav-title.ts`
 * carries the contract and the authoring instructions. Nothing below this line
 * -- and nothing in `app/**` -- reads `navTitle`; `scripts/check-docs-nav-label.mjs`
 * holds that.
 */
export const source = loader({
  baseUrl: '/docs',
  i18n,
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin(), navTitlePlugin()],
});

export const blog = loader({
  baseUrl: '/blog',
  source: blogCollection.toFumadocsSource(),
});

/**
 * The Open Graph card URL for a page: `/og/docs/<...page.slugs>/image.png`.
 *
 * The trailing `image.png` marker is load-bearing TWICE, and only the first is
 * visible from this file:
 *
 * 1. `app/og/docs/[...slug]/route.tsx` resolves the page with
 *    `source.getPage(slug.slice(0, -1))` -- the marker is the sacrificial
 *    segment that slice discards. Its NAME does not matter to that.
 * 2. Its DOT is what keeps this URL out of the locale rewriter. The matcher in
 *    `apps/docs/proxy.ts` excludes any path containing a dot, so a dotted final
 *    segment skips the proxy and reaches the route above. A marker WITHOUT a
 *    dot is rewritten to `/en/og/docs/...`, which is not a route at all --
 *    `app/og/` is top-level, not under `app/[lang]/`.
 *
 * Measured: `/og/docs/ai/agents` -> 404, `/og/docs/ai/agents/x.png` -> 200. So
 * the marker's name is free; the presence of a dot is everything. Rename it to
 * anything dotless -- or widen the proxy matcher on the other side -- and every
 * `og:image` on the site 404s at once, which is worse than emitting none
 * (crawlers fall back to scraping whatever else the page offers). Nothing
 * fetches these URLs, so no test, type or link check would notice.
 *
 * `pnpm check:docs-locale-catch-all` gates the dot from here; the matcher half
 * is commented on in `apps/docs/proxy.ts`.
 */
export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: `/og/docs/${segments.join('/')}`,
  };
}

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText('processed');

  return `# ${page.data.title}

${processed}`;
}
