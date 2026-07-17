import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Bricolage_Grotesque, IBM_Plex_Mono } from 'next/font/google';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions, gitConfig } from '@/lib/layout.shared';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-l-display',
});

const mono = IBM_Plex_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-l-mono',
});

export const metadata: Metadata = {
  title: {
    absolute: 'ObjectStack — AI writes the app. ObjectStack is what it writes.',
  },
  description:
    'The open target format and runtime for AI-written business apps. Agents write compact typed metadata — a complete CRM is under 2,000 lines, so the whole app fits in an agent\'s context — strict TypeScript, Zod, and a validation gate catch mistakes at authoring time, and the runtime derives the database, REST API, UI, and MCP server. Your business ontology as an open protocol.',
};

const VOCABULARY: { tag: string; title: string; copy: string }[] = [
  { tag: 'object', title: 'Objects & fields', copy: 'Typed schemas with relations, validation, formulas, and files.' },
  { tag: 'permission', title: 'Permissions', copy: 'RBAC plus row- and field-level security, enforced by the runtime.' },
  { tag: 'flow', title: 'Automation', copy: 'DAG flows, record triggers, scheduled jobs, and webhooks.' },
  { tag: 'approval', title: 'Approvals', copy: 'Multi-step approval chains with queues and a full audit trail.' },
  { tag: 'view', title: 'Views', copy: 'Lists, kanban boards, calendars, gantt, galleries — declared, not coded.' },
  { tag: 'dashboard', title: 'Dashboards & reports', copy: 'Charts, aggregations, and KPIs bound to live data.' },
  { tag: 'action', title: 'Actions', copy: 'Permission-checked buttons and server operations.' },
  { tag: 'api', title: 'APIs & SDK', copy: 'Generated REST and realtime endpoints with a typed client SDK.' },
  { tag: 'mcp', title: 'AI tools', copy: 'Every object and action doubles as a governed MCP tool.' },
  { tag: 'i18n', title: 'Translations', copy: 'Labels and UI text as metadata, per locale.' },
  { tag: 'seed', title: 'Seed data', copy: 'Fixtures and demo datasets that ship with the app.' },
  { tag: 'driver', title: 'Datasources', copy: 'Postgres, MySQL, SQLite, MongoDB, or in-memory.' },
];

const GATES: { title: string; copy: string }[] = [
  { title: 'Typed', copy: 'Strict TypeScript + Zod — shape errors die in the editor, seconds after the agent writes them.' },
  { title: 'Validated', copy: 'os validate rejects metadata that would fail silently at runtime — before it ships.' },
  { title: 'Reviewed', copy: 'You approve a small readable diff in the Console — not fifty thousand lines of glue.' },
  { title: 'Governed', copy: 'Permissions and audit are enforced by the runtime on every call. Even a wrong app stays inside the fence.' },
];

const STEPS: { num: string; title: string; cmd: string; copy: string }[] = [
  {
    num: '01',
    title: 'Create a project',
    cmd: 'npx create-objectstack my-app',
    copy: 'A typed project skeleton — spec, seed data, and the Console already wired.',
  },
  {
    num: '02',
    title: 'Describe the requirement',
    cmd: 'claude · os validate ✓',
    copy: 'Tell Claude Code what the business needs. It writes compact typed metadata, and the validation gate rejects anything that would fail silently.',
  },
  {
    num: '03',
    title: 'Preview in the browser',
    cmd: 'os dev',
    copy: 'The Console renders it live — records, boards, dashboards. Requirement changed? Same loop: describe, validate, preview.',
  },
];

function DiffLine({ children, plain }: { children: React.ReactNode; plain?: boolean }) {
  return (
    <div className="flex gap-3 whitespace-pre">
      <span className={plain ? 'select-none text-fd-muted-foreground/40' : 'select-none text-emerald-500'}>
        {plain ? ' ' : '+'}
      </span>
      <span className={plain ? 'text-fd-muted-foreground' : ''}>{children}</span>
    </div>
  );
}

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
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
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[880px] -translate-x-1/2 rounded-full opacity-25 blur-3xl dark:opacity-20"
          style={{ background: 'radial-gradient(closest-side, #818cf8, transparent 70%)' }}
        />

        {/* ── hero ─────────────────────────────────────────────── */}
        <section className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pt-20 pb-16 md:grid-cols-[1.05fr_0.95fr] md:pt-28 md:pb-24">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
              Open protocol &amp; runtime · Apache-2.0
            </p>
            <h1
              className="mt-5 text-[2.6rem]/[1.06] font-bold tracking-tight text-balance md:text-6xl/[1.04]"
              style={{ fontFamily: 'var(--l-display)' }}
            >
              AI writes the app.{' '}
              <span className="block bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent dark:from-indigo-400 dark:to-purple-400">
                ObjectStack is what it writes.
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-fd-muted-foreground text-pretty">
              The open target format and runtime for AI-written business apps. Your coding agent
              writes models, UI, workflows, and permissions as compact typed metadata — a
              complete CRM is under 2,000 lines, so the whole app fits in the agent's context —
              and strict TypeScript, Zod schemas, and a validation gate catch its mistakes at
              authoring time. The runtime derives the database, REST API, UI, and MCP server,
              and enforces permissions and audit on every call.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/docs/getting-started"
                className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
              >
                Get started
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
              >
                Documentation
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
            <div
              className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-fd-muted-foreground"
              style={{ fontFamily: 'var(--l-mono)' }}
            >
              <span>Fits in an agent's context</span>
              <span aria-hidden className="text-fd-border">|</span>
              <span>Typed, validated, governed</span>
              <span aria-hidden className="text-fd-border">|</span>
              <span>Self-host anywhere</span>
            </div>
          </div>

          {/* the artifact card — requirement → metadata → gate → preview */}
          <figure className="relative">
            <div className="overflow-hidden rounded-xl border border-fd-border bg-fd-card shadow-[0_24px_60px_-24px_rgb(0_0_0/0.35)]">
              <div className="border-b border-fd-border px-4 py-3" style={{ fontFamily: 'var(--l-mono)' }}>
                <p className="text-[11px] tracking-wider text-fd-muted-foreground uppercase">you → claude code</p>
                <p className="mt-1.5 text-[13px]">
                  “Build an expense approval app for a 50-person team.”
                </p>
              </div>
              <div className="px-4 py-3 text-[12.5px]/[1.7]" style={{ fontFamily: 'var(--l-mono)' }}>
                <p className="mb-2 text-[11px] tracking-wider text-fd-muted-foreground uppercase">expense.object.ts</p>
                <DiffLine>{`export const Expense = ObjectSchema.create({`}</DiffLine>
                <DiffLine>{`  name: 'expense_request',`}</DiffLine>
                <DiffLine>{`  fields: {`}</DiffLine>
                <DiffLine>{`    amount: Field.currency({ required: true }),`}</DiffLine>
                <DiffLine>{`    status: Field.select({ options: [...] }),`}</DiffLine>
                <DiffLine>{`    approver: Field.lookup('sys_user'),`}</DiffLine>
                <DiffLine>{`  },`}</DiffLine>
                <DiffLine>{`});`}</DiffLine>
              </div>
              <div
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-fd-border bg-fd-muted/50 px-4 py-2.5 text-[12px] text-fd-muted-foreground"
                style={{ fontFamily: 'var(--l-mono)' }}
              >
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-500" />
                  os validate
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Check className="size-3.5 text-emerald-500" />
                  types · permissions · flows
                </span>
                <span className="inline-flex items-center gap-1.5">
                  os dev
                  <ArrowRight className="size-3.5" />
                  Console preview
                </span>
              </div>
            </div>
            <figcaption
              className="mt-3 text-center text-[12px] text-fd-muted-foreground"
              style={{ fontFamily: 'var(--l-mono)' }}
            >
              one definition → tables · REST API · Console UI · MCP tools
            </figcaption>
          </figure>
        </section>

        {/* ── 01 · the loop ────────────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
          <div className="flex items-baseline gap-4 border-t border-fd-border pt-8">
            <span className="text-xs tracking-[0.18em] text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
              01 · The loop
            </span>
          </div>
          <h2 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl" style={{ fontFamily: 'var(--l-display)' }}>
            From requirement to running app
          </h2>
          <div className="mt-10 grid gap-8 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.num} className="group relative">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-fd-muted-foreground" style={{ fontFamily: 'var(--l-mono)' }}>{s.num}</span>
                  <div className="h-px flex-1 bg-fd-border" aria-hidden />
                </div>
                <h3 className="mt-4 text-lg font-semibold" style={{ fontFamily: 'var(--l-display)' }}>{s.title}</h3>
                <p
                  className="mt-2 inline-block rounded-md border border-fd-border bg-fd-muted/50 px-2.5 py-1 text-[12.5px] text-fd-muted-foreground"
                  style={{ fontFamily: 'var(--l-mono)' }}
                >
                  {s.cmd}
                </p>
                <p className="mt-3 text-[15px] text-fd-muted-foreground text-pretty">{s.copy}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 02 · four gates ──────────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
          <div className="flex items-baseline gap-4 border-t border-fd-border pt-8">
            <span className="text-xs tracking-[0.18em] text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
              02 · The gates
            </span>
          </div>
          <h2 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl" style={{ fontFamily: 'var(--l-display)' }}>
            Four gates between the agent and production
          </h2>
          <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-fd-border bg-fd-border sm:grid-cols-2 lg:grid-cols-4">
            {GATES.map((g, i) => (
              <div key={g.title} className="bg-fd-card p-5 transition-colors hover:bg-fd-accent/60">
                <p className="text-xs text-fd-muted-foreground" style={{ fontFamily: 'var(--l-mono)' }}>
                  {String(i + 1).padStart(2, '0')}
                </p>
                <h3 className="mt-2 font-semibold" style={{ fontFamily: 'var(--l-display)' }}>{g.title}</h3>
                <p className="mt-2 text-sm text-fd-muted-foreground text-pretty">{g.copy}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 03 · the vocabulary ──────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-6 py-16 md:py-20">
          <div className="flex items-baseline gap-4 border-t border-fd-border pt-8">
            <span className="text-xs tracking-[0.18em] text-fd-muted-foreground uppercase" style={{ fontFamily: 'var(--l-mono)' }}>
              03 · The vocabulary
            </span>
          </div>
          <h2 className="mt-4 max-w-2xl text-3xl font-bold tracking-tight md:text-4xl" style={{ fontFamily: 'var(--l-display)' }}>
            What can it actually build?
          </h2>
          <p className="mt-4 max-w-3xl text-fd-muted-foreground text-pretty">
            Point an agent at an empty repo and you get a one-off codebase — every screen
            hand-invented, every mistake yours to find at runtime. ObjectStack gives the agent
            a <em>vocabulary</em> instead: typed, validated primitives for everything enterprise
            software needs. The agent composes the definition; the runtime already knows how to
            run it.
          </p>
          <div className="mt-10 grid gap-x-10 md:grid-cols-2">
            {VOCABULARY.map((v) => (
              <div key={v.tag} className="group flex items-baseline gap-4 border-b border-fd-border py-3.5">
                <span
                  className="w-24 shrink-0 text-[12px] text-fd-muted-foreground transition-colors group-hover:text-fd-foreground"
                  style={{ fontFamily: 'var(--l-mono)' }}
                >
                  {v.tag}
                </span>
                <div>
                  <span className="font-medium">{v.title}</span>
                  <span className="text-fd-muted-foreground"> — {v.copy}</span>
                </div>
              </div>
            ))}
          </div>
          <div
            className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-fd-muted-foreground"
            style={{ fontFamily: 'var(--l-mono)' }}
          >
            <span>1,600+ typed schemas</span>
            <span aria-hidden className="text-fd-border">|</span>
            <span>5 database drivers</span>
            <span aria-hidden className="text-fd-border">|</span>
            <span>7 framework adapters</span>
            <span aria-hidden className="text-fd-border">|</span>
            <span>MCP built-in</span>
          </div>
          <Link
            href="/docs"
            className="mt-8 inline-flex items-center gap-2 text-sm font-medium underline underline-offset-4 transition-colors hover:text-fd-primary"
          >
            Browse the full vocabulary in the docs
            <ArrowRight className="size-4" />
          </Link>
        </section>

        {/* ── closing ──────────────────────────────────────────── */}
        <section className="relative mx-auto w-full max-w-6xl px-6 pt-8 pb-20 md:pb-28">
          <div className="rounded-xl border border-fd-border bg-fd-card/60 px-6 py-8 text-center md:px-10">
            <p className="mx-auto max-w-2xl text-sm text-fd-muted-foreground text-pretty">
              Your objects, permissions, and flows are your business ontology — the definition
              layer of the AI era should be an open protocol you own.{' '}
              <a
                href="https://www.objectos.ai/en/blog/ai-ontology-open-protocol/"
                className="inline-flex items-center gap-1 font-medium text-fd-foreground underline underline-offset-4 transition-colors hover:text-fd-primary"
              >
                Read why
                <ArrowRight className="size-3.5" />
              </a>
            </p>
            <p className="mt-3 text-sm text-fd-muted-foreground">
              Want it governed and hosted, with Build &amp; Ask AI built in?{' '}
              <a
                href="https://www.objectos.ai"
                className="inline-flex items-center gap-1 font-medium text-fd-foreground underline underline-offset-4 transition-colors hover:text-fd-primary"
              >
                Try ObjectOS
                <ArrowRight className="size-3.5" />
              </a>
            </p>
          </div>
        </section>
      </div>
    </HomeLayout>
  );
}
