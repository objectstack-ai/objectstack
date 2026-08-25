import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

/**
 * `/robots.txt`.
 *
 * Before this file existed the path had no route at all, so `app/[lang]/page.tsx`
 * matched it as `lang = "robots.txt"` and answered `200 text/html` with the
 * homepage — a crawler asking for crawl rules got a web page. A literal segment
 * outranks a dynamic one in the app router, so this file takes the path back; the
 * `[lang]` catch-all swallowing *other* dotted paths is a separate defect and is
 * not fixed here.
 *
 * Static: the content depends on nothing per-request.
 *
 * ## No `Disallow` lines, deliberately
 *
 * This file shipped without any and the question was left to the card that owns
 * the duplicate-copy problem. The answer is that it stays without any, because
 * the fix for that problem is an `X-Robots-Tag: noindex` header on the
 * agent-reader endpoints (see the `headers()` block in `next.config.mjs`) and a
 * `Disallow` would defeat it: a crawler that is told not to fetch a URL never
 * sees the header on it, and a disallowed URL can still be indexed URL-only from
 * an inbound link. Allow the crawl, refuse the index. Anything added here later
 * must not cover `/docs/**.mdx`, `/llms.mdx/**`, `/llms.txt` or `/llms-full.txt`.
 *
 * ## Why `llms.txt` is named under `Allow:`
 *
 * `Allow: /` already permits both aggregate endpoints, so these two lines change
 * no crawler's behaviour -- they are declarative, and that is the whole job. The
 * robots.txt grammar has exactly one discovery directive, `Sitemap:`, and these
 * are not sitemaps; naming the paths in the file agents already fetch first is
 * the available way to make them findable on purpose rather than by guessing at
 * a convention. It also records, at the point of the crawl rules, that the
 * `noindex` on those paths is about indexing and not about access.
 */
export const dynamic = 'force-static';
export const revalidate = false;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/llms.txt', '/llms-full.txt'],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
