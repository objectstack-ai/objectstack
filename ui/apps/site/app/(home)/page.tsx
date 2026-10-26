import type { Metadata } from 'next';
import Link from 'next/link';
import { LiveSplitDemo } from '@/app/components/LiveSplitDemo';
import { ReactVsObjectUI } from '@/app/components/ReactVsObjectUI';

const TITLE = 'Object UI — schema-driven UI engine for React';
const DESCRIPTION =
  'AI writes the schema; Object UI renders it — production React from JSON, Tailwind and Shadcn native, any backend.';

// The route had no metadata at all, so the homepage shipped with no <title>,
// no description and no link-preview fields. Open Graph and Twitter carry no
// image: the site ships none, and naming one it does not serve would render a
// broken preview. Nothing here resolves against an origin, so this object needs
// no `metadataBase` of its own; `app/layout.tsx` sets one for the docs pages,
// whose OG images are site-relative.
export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
};

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden bg-gradient-to-br from-fd-background via-fd-background to-fd-muted/20 px-6 py-24 sm:py-32 lg:px-8">
        <div className="relative mx-auto max-w-7xl">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-8 inline-flex items-center rounded-full border border-fd-primary/20 bg-fd-primary/10 px-4 py-1.5 text-sm font-medium text-fd-primary">
              ✨ The Universal Schema-Driven UI Engine
            </div>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-fd-foreground sm:text-5xl md:text-6xl lg:text-7xl">
              From JSON to
              <span className="bg-gradient-to-r from-blue-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-violet-400"> World-Class UI </span>
              in Minutes
            </h1>
            <p className="mb-10 text-lg leading-8 text-fd-muted-foreground">
              Build beautiful, production-ready interfaces without writing React code. 
              Just define your UI in JSON and let ObjectUI handle the rest with Tailwind CSS and Shadcn UI.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/docs"
                className="inline-flex items-center justify-center rounded-lg bg-fd-primary px-8 py-3.5 text-base font-semibold text-fd-primary-foreground shadow-lg transition-all hover:bg-fd-primary/90 hover:shadow-xl"
              >
                Get Started
                <svg className="ml-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </Link>
              <a
                href="https://github.com/objectstack-ai/objectui"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-lg border border-fd-border bg-fd-card px-8 py-3.5 text-base font-semibold text-fd-foreground shadow-sm transition-all hover:bg-fd-accent hover:shadow-md"
              >
                <svg className="mr-2 h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.111.82-.261.82-.577 0-.286-.011-1.244-.017-2.257-3.338.726-4.042-1.416-4.042-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.085 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.93 0-1.31.469-2.382 1.236-3.222-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.398 3.003-.403 1.02.005 2.047.137 3.006.403 2.29-1.553 3.297-1.23 3.297-1.23.653 1.652.242 2.873.118 3.176.77.84 1.235 1.911 1.235 3.222 0 4.61-2.807 5.62-5.479 5.92.43.371.815 1.103.815 2.222 0 1.606-.014 2.898-.014 3.293 0 .319.218.694.825.576C20.565 21.797 24 17.298 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
                Star on GitHub
              </a>
            </div>

            {/* Trust strip — version, downloads, license, etc. via shields.io */}
            <ul
              aria-label="Project stats"
              className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-sm"
            >
              {[
                {
                  href: 'https://www.npmjs.com/package/@object-ui/react',
                  src: 'https://img.shields.io/npm/v/@object-ui/react?label=npm&color=cb3837',
                  alt: 'Latest npm version',
                },
                {
                  href: 'https://www.npmjs.com/package/@object-ui/react',
                  src: 'https://img.shields.io/npm/dm/@object-ui/react?label=downloads&color=4c1',
                  alt: 'Monthly npm downloads',
                },
                {
                  href: 'https://github.com/objectstack-ai/objectui/stargazers',
                  src: 'https://img.shields.io/github/stars/objectstack-ai/objectui?style=flat&color=fbca04',
                  alt: 'GitHub stars',
                },
                {
                  href: 'https://github.com/objectstack-ai/objectui/graphs/contributors',
                  src: 'https://img.shields.io/github/contributors/objectstack-ai/objectui?color=informational',
                  alt: 'Contributors',
                },
                {
                  href: 'https://github.com/objectstack-ai/objectui/actions/workflows/ci.yml?query=branch%3Amain',
                  src: 'https://img.shields.io/github/actions/workflow/status/objectstack-ai/objectui/ci.yml?branch=main&label=CI',
                  alt: 'CI status',
                },
                {
                  href: 'https://github.com/objectstack-ai/objectui/blob/main/LICENSE',
                  src: 'https://img.shields.io/github/license/objectstack-ai/objectui?color=informational',
                  alt: 'MIT licensed',
                },
              ].map((b) => (
                <li key={b.alt}>
                  <a
                    href={b.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block transition hover:opacity-80"
                  >
                    {/* Plain <img>, not next/image: these are third-party badge
                        endpoints that render their own SVG and need no optimisation. */}
                    <img
                      src={b.src}
                      alt={b.alt}
                      loading="lazy"
                      decoding="async"
                      height={20}
                      className="h-5"
                    />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Live Split View — JSON in, UI out */}
          <div className="mx-auto mt-16 max-w-6xl">
            <LiveSplitDemo />
          </div>
        </div>
      </section>

      {/* React vs ObjectUI — the same dashboard, written both ways */}
      <ReactVsObjectUI />

      {/* Features Section */}
      <section className="py-24 sm:py-32 bg-fd-muted/30">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
              Why Choose ObjectUI?
            </h2>
            <p className="mt-4 text-lg text-fd-muted-foreground">
              Stop writing repetitive UI code. Build faster with better results.
            </p>
          </div>
          
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {/* Feature 1 */}
            <div className="relative rounded-2xl border border-fd-border bg-fd-card p-8 shadow-sm transition-all hover:shadow-lg">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-fd-foreground">
                Blazing Fast
              </h3>
              <p className="text-fd-muted-foreground">
                Lazy-loaded plugins and tree-shakable packages: a page pays for the components it renders, nothing else.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="relative rounded-2xl border border-fd-border bg-fd-card p-8 shadow-sm transition-all hover:shadow-lg">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fd-accent/10 text-fd-accent">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-fd-foreground">
                Beautiful by Default
              </h3>
              <p className="text-fd-muted-foreground">
                Professional designs using Tailwind CSS and Shadcn UI. Light/dark theme support, fully customizable, and WCAG 2.1 AA accessible.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="relative rounded-2xl border border-fd-border bg-fd-card p-8 shadow-sm transition-all hover:shadow-lg">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-fd-foreground">
                Developer Friendly
              </h3>
              <p className="text-fd-muted-foreground">
                TypeScript-first with complete type definitions. Zero learning curve if you know React. Works with existing tools and workflows.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="relative rounded-2xl border border-fd-border bg-fd-card p-8 shadow-sm transition-all hover:shadow-lg">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fd-accent/10 text-fd-accent">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-fd-foreground">
                Production Ready
              </h3>
              <p className="text-fd-muted-foreground">
                TypeScript end to end, a CI suite on every change, and documentation that is gated against the code.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="relative rounded-2xl border border-fd-border bg-fd-card p-8 shadow-sm transition-all hover:shadow-lg">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-fd-foreground">
                Modular Architecture
              </h3>
              <p className="text-fd-muted-foreground">
                Tree-shakable packages and lazy-loaded plugins. Only load what you need.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="relative rounded-2xl border border-fd-border bg-fd-card p-8 shadow-sm transition-all hover:shadow-lg">
              <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-fd-accent/10 text-fd-accent">
                <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              </div>
              <h3 className="mb-2 text-xl font-semibold text-fd-foreground">
                Backend Agnostic
              </h3>
              <p className="text-fd-muted-foreground">
                Works with any backend through universal DataSource interface. REST, GraphQL, Firebase, or custom adapters.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 sm:py-32">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-blue-600 to-violet-600 px-8 py-16 text-center shadow-2xl sm:px-16 dark:from-blue-700 dark:to-violet-700">
            <div className="relative z-10">
              <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Ready to Build Something Amazing?
              </h2>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-white/90">
                Join developers who are building faster with ObjectUI. Get started in minutes with our comprehensive documentation.
              </p>
              <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
                <Link
                  href="/docs"
                  className="rounded-lg bg-fd-background px-8 py-3.5 text-base font-semibold text-fd-foreground shadow-lg transition-all hover:bg-fd-background/90"
                >
                  Get Started Now
                </Link>
                <Link
                  href="/docs/guide/schema-catalog"
                  className="rounded-lg border border-white/40 px-8 py-3.5 text-base font-semibold text-white transition-all hover:bg-white/10"
                >
                  Browse the schema catalog
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-fd-border">
        <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
          <p className="text-center text-sm text-fd-muted-foreground">
            Built with ❤️ by the{' '}
            <a href="https://github.com/objectstack-ai" className="font-medium hover:text-fd-foreground">
              ObjectStack Team
            </a>
          </p>
        </div>
      </footer>
    </>
  )
}
