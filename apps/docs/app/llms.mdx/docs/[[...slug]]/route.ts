import { getLLMText, source } from '@/lib/source';
import { notFound } from 'next/navigation';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug?: string[] }> },
) {
  const { slug } = await params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return new Response(await getLLMText(page), {
    headers: {
      'Content-Type': 'text/markdown',
    },
  });
}

/**
 * Only the prerendered markdown bodies, one per docs page, exist; an unknown slug is a static 404 instead of
 * a call into an on-demand fallback function uploaded with every deploy. The
 * reasoning is spelled out once, in `app/[lang]/docs/[[...slug]]/page.tsx`.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return source.generateParams();
}
