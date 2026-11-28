import { getPageImage, source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { generate as DefaultImage } from 'fumadocs-ui/og';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return new ImageResponse(
    <DefaultImage
      title={page.data.title}
      description={page.data.description}
      site="ObjectStack Protocol"
    />,
    {
      width: 1200,
      height: 630,
    },
  );
}

/**
 * Only the prerendered cards, one per docs page, exist; an unknown slug is a static 404 instead of
 * a call into an on-demand fallback function uploaded with every deploy. The
 * reasoning is spelled out once, in `app/[lang]/docs/[[...slug]]/page.tsx`.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    slug: getPageImage(page).segments,
  }));
}
