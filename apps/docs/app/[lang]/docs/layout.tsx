import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { baseOptions } from '@/lib/layout.shared';
import { toClientPageTree } from '@/lib/client-page-tree';

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;
  
  return (
    <DocsLayout
      // The trimmed copy: this prop is serialised into every docs page, see
      // `lib/client-page-tree.ts` for what is dropped and why nothing reads it.
      tree={toClientPageTree(source.pageTree[lang])}
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  );
}
