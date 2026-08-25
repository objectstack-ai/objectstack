import { getPageImage, source } from '@/lib/source';
import type { Metadata } from 'next';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { File, Folder, Files } from 'fumadocs-ui/components/files';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { LLMCopyButton, ViewOptions } from '@/components/ai/page-actions';
import { gitConfig } from '@/lib/layout.shared';
import { absoluteUrl } from '@/lib/site';

export default async function Page(props: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const params = await props.params;
  const page = source.getPage(params.slug ?? [], params.lang);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
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
