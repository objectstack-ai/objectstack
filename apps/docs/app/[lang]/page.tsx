import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Bricolage_Grotesque, IBM_Plex_Mono } from 'next/font/google';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions, gitConfig, PRODUCT_SITE_URL } from '@/lib/layout.shared';
import { absoluteUrl, HERO_COVER, SITE_ORIGIN } from '@/lib/site';
import {
  APACHE_2_0_URL,
  GITHUB_REPO_URL,
  JsonLd,
  ORGANIZATION,
  ORGANIZATION_REF,
  SOFTWARE_ID,
  type JsonLdNode,
} from '@/lib/structured-data';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-l-display',
});

const mono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-l-mono',
});

/**
 * This is the developer site. The product site (`PRODUCT_SITE_URL`) carries the
 * hero, the editions, pricing and the one blog; this page carries one line of
 * positioning, the start command, the docs entry points, the "Run it" strip and
 * the GitHub link — nothing that sells. The slogan stays as the kicker above the
 * positioning line: it is the project's one sentence, not a marketing hero.
 */
const KICKER = 'The ontology is the software.';
const POSITIONING =
  'ObjectStack is the open protocol and SDK that ObjectOS is built on: one typed business ontology, and the database, API, Console and MCP tools derive from it.';

const HOME_TITLE = 'The open protocol and SDK ObjectOS is built on';
const HOME_DESCRIPTION = POSITIONING;

/**
 * The homepage's metadata. Its social card is the shared hero cover,
 * `HERO_COVER` from `lib/site.ts`.
 *
 * ⚠️ Deliberately NOT the docs card generator. `app/og/docs/[...slug]/route.tsx`
 * renders from a `source.getPage()` result, and the homepage has no MDX file
 * behind it — there is no slug to hand it. It reuses the hero cover instead,
 * which is already shipped, so the shared card costs no extra bytes and no
 * extra route. The reasons a re-encode has to be careful live in `lib/site.ts`.
 *
 * Left site-relative: `metadataBase` in `app/layout.tsx` absolutises it.
 */
export const metadata: Metadata = {
  title: HOME_TITLE,
  description: HOME_DESCRIPTION,
  /**
   * `/` is the one indexable spelling of the homepage: `proxy.ts` rewrites `/` to
   * this route internally, and the prefixed form `/en` 307s back to `/`. Every
   * other spelling a crawler reaches it by — query strings, tracking parameters —
   * points here.
   */
  alternates: { canonical: absoluteUrl('/') },
  openGraph: {
    type: 'website',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    // Same absolute URL as the canonical link — see the docs route for why the
    // two must not drift.
    url: absoluteUrl('/'),
    images: [HERO_COVER],
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    images: [HERO_COVER.url],
  },
};

/**
 * The homepage's structured data.
 *
 * ⚠️ **`SoftwareSourceCode`, not `SoftwareApplication`.** Both are `CreativeWork`
 * subtypes that carry `license`, so either satisfies the card; the choice is
 * about what the validator does with it. Google's Software App rich result
 * *requires* `offers`, `aggregateRating` or `review` — ObjectStack is an
 * Apache-2.0 runtime with no price, no store listing and no ratings, so a
 * `SoftwareApplication` node here would report missing-required-property errors
 * in the very test this card is accepted against, in exchange for a rich result
 * it can never be eligible for. `SoftwareSourceCode` has no Google rich-result
 * feature and therefore no required properties, and `codeRepository` /
 * `programmingLanguage` / `runtimePlatform` describe what this project actually
 * is.
 *
 * Every field is drawn from something already on this page or in `lib/`: the
 * title and description are the same constants `metadata` uses, the image is
 * `HERO_COVER`, the licence is the repo's own, and the `sameAs` links are the
 * organisation's.
 */
function homeGraph(): JsonLdNode[] {
  return [
    ORGANIZATION,
    {
      '@type': 'SoftwareSourceCode',
      '@id': SOFTWARE_ID,
      name: 'ObjectStack',
      url: absoluteUrl('/'),
      // Same two strings `metadata` above emits, so the page cannot describe
      // itself one way to a crawler and another way to a social card.
      headline: HOME_TITLE,
      description: HOME_DESCRIPTION,
      image: absoluteUrl(HERO_COVER.url),
      codeRepository: GITHUB_REPO_URL,
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'Node.js',
      license: APACHE_2_0_URL,
      author: ORGANIZATION_REF,
      maintainer: ORGANIZATION_REF,
    },
  ];
}

/** The start command, as `content/docs/getting-started` teaches it. */
const START_COMMANDS: string[] = [
  'npm create objectstack@latest my-app',
  'cd my-app',
  'npx os dev --ui',
];

/** The docs entry points, in reading order. Every route exists under `content/docs`. */
const DOCS_ENTRY_POINTS: { title: string; href: string; copy: string }[] = [
  { title: 'Getting started', href: '/docs/getting-started', copy: 'What ObjectStack is, your first project, the anatomy of an app.' },
  { title: 'Concepts', href: '/docs/concepts', copy: 'The business ontology, the runtime, and the principles behind both.' },
  { title: 'Spec', href: '/docs/protocol', copy: 'The protocol: how Data, UI and System layers describe an application.' },
  { title: 'CLI', href: '/docs/deployment/cli', copy: 'The os command — validate, dev, build, start, package.' },
  { title: 'Build with Claude Code', href: '/docs/getting-started/build-with-claude-code', copy: 'The main workflow: an agent writes the app, you verify it in the Console.' },
];

/**
 * The four sections the previous landing carried in full — the idea, the loop,
 * the gates, the vocabulary — now one row of links into the docs pages that
 * already carry that content. Nothing here is a second copy of a docs page.
 */
const DOCS_THEMES: { label: string; title: string; href: string }[] = [
  { label: 'The idea', title: 'Business ontology — the executable definition the runtime runs', href: '/docs/concepts/ontology' },
  { label: 'The loop', title: 'Describe · the agent writes metadata · os validate · you verify in the Console', href: '/docs/getting-started/build-with-claude-code' },
  { label: 'The gates', title: 'Why AI-written app development is safe — the guardrails between the agent and production', href: '/docs/getting-started/how-ai-development-works' },
  { label: 'The vocabulary', title: 'What can it build? — the capabilities, in business language', href: '/docs/capabilities' },
];

/**
 * "Run it": ObjectOS is one product in three editions, and ObjectStack is the
 * protocol and SDK every edition runs on. Community is this repository's own
 * runtime image, so it links into these docs; the hosted and enterprise editions
 * are the product site's to describe.
 */
const EDITIONS: { name: string; copy: string; href: string; cta: string; external: boolean }[] = [
  {
    name: 'ObjectOS Community',
    copy: 'This repository’s runtime image, self-hosted and free: os start, or the container image.',
    href: '/docs/deployment/self-hosting',
    cta: 'Self-hosting guide',
    external: false,
  },
  {
    name: 'ObjectOS Cloud',
    copy: 'Hosted by ObjectOS — nothing to install, build and ask in the browser.',
    href: PRODUCT_SITE_URL,
    cta: 'objectos.ai',
    external: true,
  },
  {
    name: 'ObjectOS Enterprise',
    copy: 'Your infrastructure, your identity provider, with support from the team.',
    href: PRODUCT_SITE_URL,
    cta: 'objectos.ai',
    external: true,
  },
];

/** The two hosts, read from the constants that own them — never spelled twice. */
const THIS_SITE_HOST = new URL(SITE_ORIGIN).host;
const PRODUCT_SITE_HOST = new URL(PRODUCT_SITE_URL).host;

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <JsonLd graph={homeGraph()} />
      <div
        className={`${display.variable} ${mono.variable} relative overflow-hidden`}
        style={{
          ['--l-display' as string]: 'var(--font-l-display), ui-sans-serif, system-ui',
          ['--l-mono' as string]: 'var(--font-l-mono), ui-monospace, monospace',
        }}
      >
        {/* blueprint grid backdrop */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black,transparent)]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-fd-border) 1px, transparent 1px), linear-gradient(to bottom, var(--color-fd-border) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
          }}
        />

        {/* ── positioning ──────────────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-5xl px-6 pt-16 md:pt-20">
          <p className="text-xs font-medium tracking-[0.18em] text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
            Open protocol &amp; runtime · Apache-2.0
          </p>
          <p className="mt-5 text-lg font-semibold tracking-tight text-fd-muted-foreground" style={{ fontFamily: 'var(--l-display)' }}>
            {KICKER}
          </p>
          <h1
            className="mt-3 max-w-4xl text-[1.75rem]/[1.25] font-bold tracking-tight text-balance md:text-4xl/[1.2]"
            style={{ fontFamily: 'var(--l-display)' }}
          >
            {POSITIONING}
          </h1>

          {/* ── start command ────────────────────────────────── */}
          <div className="mt-8 max-w-2xl overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-[0_24px_60px_-24px_rgb(0_0_0/0.35)]">
            <div className="border-b border-fd-border px-4 py-2 text-[11px] tracking-wider text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
              Start here
            </div>
            <div className="overflow-x-auto px-4 py-3 text-[13px]/[1.8]" style={{ fontFamily: 'var(--l-mono)' }}>
              {START_COMMANDS.map((cmd) => (
                <div key={cmd} className="flex gap-3 whitespace-pre">
                  <span aria-hidden className="select-none text-fd-muted-foreground/60">$</span>
                  <code>{cmd}</code>
                </div>
              ))}
            </div>
            <p className="border-t border-fd-border bg-fd-muted/50 px-4 py-2 text-[12px] text-fd-muted-foreground" style={{ fontFamily: 'var(--l-mono)' }}>
              then open http://localhost:3000/_console/ — the Console renders the app the metadata describes
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/docs/getting-started"
              className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
            >
              Get started
              <ArrowRight className="size-4" />
            </Link>
            <a
              href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              GitHub
            </a>
          </div>
        </section>

        {/* ── docs entry points ────────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-6 pt-16 md:pt-20">
          <div className="flex items-baseline gap-4 border-t border-fd-border pt-8">
            <span className="text-xs tracking-[0.18em] text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
              Docs
            </span>
          </div>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-5">
            {DOCS_ENTRY_POINTS.map((d) => (
              <Link key={d.href} href={d.href} className="group bg-fd-card p-5 transition-colors hover:bg-fd-accent/60">
                <h2 className="inline-flex items-center gap-1.5 font-semibold" style={{ fontFamily: 'var(--l-display)' }}>
                  {d.title}
                  <ArrowRight className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                </h2>
                <p className="mt-2 text-sm text-fd-muted-foreground text-pretty">{d.copy}</p>
              </Link>
            ))}
          </div>

          {/* The idea / the loop / the gates / the vocabulary — one row into the docs. */}
          <div className="mt-6 grid gap-x-10 sm:grid-cols-2">
            {DOCS_THEMES.map((t) => (
              <Link key={t.href} href={t.href} className="group flex items-baseline gap-4 border-b border-fd-border py-3.5">
                <span
                  className="w-28 shrink-0 text-[12px] text-fd-muted-foreground transition-colors group-hover:text-fd-foreground"
                  style={{ fontFamily: 'var(--l-mono)' }}
                >
                  {t.label}
                </span>
                <span className="text-sm text-fd-muted-foreground transition-colors group-hover:text-fd-foreground">{t.title}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── run it: the three editions ───────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-6 pt-16 md:pt-20">
          <div className="flex items-baseline gap-4 border-t border-fd-border pt-8">
            <span className="text-xs tracking-[0.18em] text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
              Run it
            </span>
          </div>
          <p className="mt-4 max-w-3xl text-sm text-fd-muted-foreground text-pretty">
            ObjectOS is the product built on this protocol, in three editions. Every edition runs the
            same ObjectStack metadata.
          </p>
          <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border md:grid-cols-3">
            {EDITIONS.map((e) => (
              <div key={e.name} className="bg-fd-card p-5">
                <h2 className="font-semibold" style={{ fontFamily: 'var(--l-display)' }}>{e.name}</h2>
                <p className="mt-2 text-sm text-fd-muted-foreground text-pretty">{e.copy}</p>
                {e.external ? (
                  <a
                    href={e.href}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 transition-colors hover:text-fd-primary"
                  >
                    {e.cta}
                    <ArrowRight className="size-3.5" />
                  </a>
                ) : (
                  <Link
                    href={e.href}
                    className="mt-4 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 transition-colors hover:text-fd-primary"
                  >
                    {e.cta}
                    <ArrowRight className="size-3.5" />
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── the two sites, by role ───────────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-6 pt-16 pb-20 md:pb-28">
          <div
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-fd-border pt-8 text-[12px] text-fd-muted-foreground"
            style={{ fontFamily: 'var(--l-mono)' }}
          >
            <span>
              <span className="text-fd-foreground">{THIS_SITE_HOST}</span> — Developer docs &amp; protocol
            </span>
            <span aria-hidden className="text-fd-border">|</span>
            <a href={PRODUCT_SITE_URL} className="underline underline-offset-4 transition-colors hover:text-fd-primary">
              <span className="text-fd-foreground">{PRODUCT_SITE_HOST}</span> — Product, editions &amp; blog
            </a>
          </div>
        </section>
      </div>
    </HomeLayout>
  );
}
