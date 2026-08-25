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
 */
export const dynamic = 'force-static';
export const revalidate = false;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
