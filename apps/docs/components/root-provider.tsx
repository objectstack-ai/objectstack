'use client';

import { type Framework, FrameworkProvider } from 'fumadocs-core/framework';
import { RootProvider as BaseRootProvider, type RootProviderProps } from 'fumadocs-ui/provider/base';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { toPublicPath } from '@/lib/i18n';

/** Next's pathname, as the visitor's URL spells it — see `toPublicPath()`. */
function usePublicPathname(): string {
  return toPublicPath(usePathname());
}

/**
 * `fumadocs-ui/provider/next`'s `RootProvider`, with one difference: the
 * pathname every fumadocs component reads is the PUBLIC path.
 *
 * That provider is `NextProvider` (Next's hooks, `next/link`, `next/image`)
 * around the base `RootProvider`; this is the same composition with
 * `usePathname` swapped for `usePublicPathname`. (The two casts: Next's
 * `href`/`src` are required where fumadocs' prop types leave them optional;
 * `NextProvider` hands these same two components to these same props.)
 *
 * Without it, a page prerendered under `app/[lang]/` renders its nav and sidebar
 * against `/en/...` while every link they match is public, so the top nav's
 * `Blog` (nested-url) and `Why` (url) entries never lit on a blog post, and the
 * docs sidebar's current page was unmarked in the server HTML.
 *
 * In the browser Next already answers the public path — `proxy.ts` redirects
 * any `/en/...` URL away — so the mapping changes nothing there; it only makes
 * the prerender agree with what hydration reads.
 */
export function RootProvider(props: RootProviderProps) {
  return (
    <FrameworkProvider
      usePathname={usePublicPathname}
      useRouter={useRouter}
      useParams={useParams}
      Link={Link as Framework['Link']}
      Image={Image as Framework['Image']}
    >
      <BaseRootProvider {...props} />
    </FrameworkProvider>
  );
}
