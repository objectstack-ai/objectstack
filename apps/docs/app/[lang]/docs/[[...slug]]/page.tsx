import { getPageImage, source } from '@/lib/source';
import type { Metadata } from 'next';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { getBreadcrumbItems } from 'fumadocs-core/breadcrumb';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { File, Folder, Files } from 'fumadocs-ui/components/files';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { LLMCopyButton, ViewOptions } from '@/components/ai/page-actions';
import { gitConfig } from '@/lib/layout.shared';
import { absoluteUrl } from '@/lib/site';
import {
  breadcrumbList,
  compact,
  type Crumb,
  JsonLd,
  type JsonLdNode,
  ORGANIZATION,
  ORGANIZATION_REF,
  sitemapLastModified,
} from '@/lib/structured-data';

/** The site root, first crumb of every trail. */
const SITE_CRUMB: Crumb = { name: 'ObjectStack', url: absoluteUrl('/') };

/** A page the loader actually resolved — `source.getPage()` minus its `undefined`. */
type DocPage = NonNullable<ReturnType<typeof source.getPage>>;

/**
 * Ancestor chain for a doc page, read out of `source.pageTree` — the same tree
 * `app/[lang]/docs/layout.tsx` hands to the sidebar, so a crumb and its sidebar
 * entry are the same node with the same label.
 *
 * `getBreadcrumbItems()` is fumadocs' own tree walk (`fumadocs-core/breadcrumb`),
 * not a path split: it locates the page node and returns the folders above it,
 * each labelled from that folder's `meta.json` title and linked to that folder's
 * `index` node. ⛔ Nothing here splits `page.url` on `/`, and nothing constructs a
 * URL the loader has not already produced.
 *
 * ⚠️ **An ancestor can arrive without a URL, and this drops it.** Fumadocs
 * attaches a folder's `index.mdx` as that folder's `index` node only when the
 * folder's `meta.json` does **not** list `"index"` in `pages`; a folder that
 * lists it reaches this walk with a `name` and no `url`. That was once 17 of the
 * 35 `meta.json` files under `content/docs`, shortening 172 of 404 trails. 16 of
 * the 17 were fixed producer-side (#12352) and 8 short trails remain, all under
 * `content/docs/releases/` — a directory AGENTS.md fences off, so its `meta.json`
 * still lists `"index"`. The condition is therefore live, just rare.
 *
 * ⛔ The missing URL is deliberately **not** reconstructed here — that fence is
 * the reason #12352 was fixable at all. The folder's index page exists, is in the
 * sitemap and answers 200 — the defect is in the content config that hides it
 * from the tree, not in this consumer, and a lookup that re-derived it would make
 * a producer bug invisible and permanent. Google requires `item` on every crumb
 * but the last, so a name-only crumb is not an option either.
 *
 * Two things the tree cannot supply are added around it, both from data this
 * page already holds:
 *
 * - the site root and the docs root, which sit above the tree rather than in it
 *   (`getBreadcrumbItems`' own `includeRoot` fires only for folders marked
 *   `root: true` in `meta.json`, which this tree has none of);
 * - the page itself as the final crumb, if the walk did not end there — the leaf
 *   is the one entry a `BreadcrumbList` must not be missing, and `page.data.title`
 *   with the page's canonical URL is the same pair the `<title>` and the canonical
 *   link are built from.
 *
 * Names are `ReactNode` in fumadocs' type; anything that is not a plain string is
 * dropped rather than stringified, because `[object Object]` in a crumb is worse
 * than a shorter trail.
 */
function docsTrail(
  page: DocPage,
  lang: string,
  canonical: string,
): Crumb[] {
  const tree = source.pageTree[lang];
  const rootName = typeof tree?.name === 'string' ? tree.name : 'Documentation';

  const trail: Crumb[] = [SITE_CRUMB, { name: rootName, url: absoluteUrl('/docs') }];

  if (tree) {
    for (const item of getBreadcrumbItems(page.url, tree, { includePage: true })) {
      if (typeof item.name !== 'string' || !item.url) continue;
      const url = absoluteUrl(item.url);
      // The docs root is already the second crumb; the tree's own entry for
      // `/docs` (the collection's `index.mdx`) must not repeat it.
      if (trail.some((crumb) => crumb.url === url)) continue;
      trail.push({ name: item.name, url });
    }
  }

  if (trail[trail.length - 1]?.url !== canonical) {
    trail.push({ name: page.data.title, url: canonical });
  }

  return trail;
}

/**
 * `TechArticle` + `BreadcrumbList` for one doc page.
 *
 * Every value comes from the same `page` object `generateMetadata()` below reads,
 * so the two layers describe one page rather than two: same title, same
 * description, same canonical URL, same Open Graph card as the article `image`.
 *
 * `dateModified` is read from `app/sitemap.ts`'s own output rather than derived a
 * second time — see `sitemapLastModified()`. Pages the sitemap ships without a
 * `<lastmod>` get no `dateModified` here either.
 */
function docsGraph(
  page: DocPage,
  lang: string,
): JsonLdNode[] {
  const canonical = absoluteUrl(page.url);

  return [
    ORGANIZATION,
    compact({
      '@type': 'TechArticle',
      '@id': `${canonical}#article`,
      headline: page.data.title,
      name: page.data.title,
      description: page.data.description,
      url: canonical,
      mainEntityOfPage: canonical,
      inLanguage: lang,
      image: absoluteUrl(getPageImage(page).url),
      dateModified: sitemapLastModified(page.url),
      author: ORGANIZATION_REF,
      publisher: ORGANIZATION_REF,
    }),
    breadcrumbList(`${canonical}#breadcrumb`, docsTrail(page, lang, canonical)),
  ];
}

export default async function Page(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug ?? [], params.lang);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <JsonLd graph={docsGraph(page, params.lang)} />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <LLMCopyButton markdownUrl={`${page.url}.mdx`} />
        <ViewOptions
          markdownUrl={`${page.url}.mdx`}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
            Step,
            Steps,
            File,
            Folder,
            Files,
            FileTree: Files,
            Tab,
            Tabs,
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug ?? [], params.lang);
  if (!page) notFound();

  /**
   * `app/og/docs/[...slug]/route.tsx` already prerenders a 1200x630 card for every
   * page this loader returns -- its `generateStaticParams` maps over
   * `source.getPages()` through this very function. Calling `getPageImage()` here
   * too is what makes the card *reachable*: the generator and the reference are
   * then the same expression, so a slug shape that stops matching breaks the build
   * rather than emitting an `og:image` that 404s. A 404ing card is worse than no
   * card at all, because the crawler falls back to scraping whatever else it finds.
   *
   * The URL is left site-relative on purpose: `metadataBase` in `app/layout.tsx`
   * absolutises it, so the origin stays spelled in exactly one place.
   */
  const image = getPageImage(page);
  /**
   * `page.url` is the same locale-stripped route fumadocs uses for in-site links
   * and that `app/sitemap.ts` lists, so the canonical link and the sitemap entry
   * cannot drift apart. `absoluteUrl()` throws rather than emit a URL on another
   * host if that ever stops being a site-relative path.
   */
  const canonical = absoluteUrl(page.url);

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical },
    openGraph: {
      type: 'article',
      title: page.data.title,
      description: page.data.description,
      // Same absolute URL as the canonical link, deliberately: `og:url` is the
      // identity a social platform de-duplicates shares by, and pointing it at a
      // different spelling than the canonical splits one page into two.
      url: canonical,
      images: [
        {
          url: image.url,
          width: 1200,
          height: 630,
          alt: page.data.title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: [image.url],
    },
  };
}
