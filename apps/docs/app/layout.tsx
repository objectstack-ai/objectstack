import './global.css';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

export const metadata: Metadata = {
  /**
   * The origin every relative URL in this site's metadata resolves against —
   * canonical links today, the Open Graph / Twitter image paths next. Left unset,
   * Next resolves them against a build-time guess of the deployment's own origin,
   * so a preview build would advertise itself as the real site.
   *
   * `new URL(...)` at the point of use, so `lib/site.ts` keeps exporting an
   * immutable string rather than a `URL` instance shared across every route.
   */
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    template: '%s | ObjectStack',
    default: 'ObjectStack',
  },
  description:
    'The open target format and runtime for AI-written business apps — agents write compact typed metadata, the runtime derives the database, API, UI, and MCP server.',
  icons: {
    icon: '/logo.svg',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">{children}</body>
    </html>
  );
}
