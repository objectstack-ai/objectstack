import type { ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { notFound } from 'next/navigation';
import { i18n, isSupportedLanguage } from '@/lib/i18n';

// Language display names mapping
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  cn: '中文',
};

export default async function LanguageLayout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;

  // `[lang]` is a catch-all: it matches ANY single path segment. Paths that
  // contain a dot reach it unrewritten, because `proxy.ts`'s matcher excludes
  // them from locale rewriting on purpose (static assets must not be
  // rewritten) -- so `/ads.txt`, `/anything.html` and `/sitemap_index.xml`
  // arrive here with `lang` set to that literal segment. Without this check
  // every one of them renders the homepage under a 200, publishing an
  // unbounded set of duplicate homepages at exactly the URLs crawlers probe.
  // Declared locales are the contract; reject anything else.
  if (!isSupportedLanguage(lang)) notFound();
  
  return (
    <RootProvider
      i18n={{
        locale: lang,
        locales: i18n.languages.map((l) => ({
          name: LANGUAGE_NAMES[l] || l,
          locale: l,
        })),
      }}
    >
      {children}
    </RootProvider>
  );
}

export async function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}
