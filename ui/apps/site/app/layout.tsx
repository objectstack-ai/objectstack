import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { ObjectUIProvider } from '@/app/components/ObjectUIProvider';

// `app/docs/[[...slug]]/page.tsx` sets `openGraph.images` to the site-relative
// `/og/docs/...` route. Without a `metadataBase` Next resolves that against
// `http://localhost:3000` and says so at build time — so every docs page has
// been shipping an Open Graph image URL pointing at localhost. The origin is
// the one the published packages already name in their `homepage` fields.
export const metadata: Metadata = {
  metadataBase: new URL('https://www.objectui.org'),
};


export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>
          <ObjectUIProvider>{children}</ObjectUIProvider>
        </RootProvider>
      </body>
    </html>
  );
}
