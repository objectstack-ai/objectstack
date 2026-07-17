import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions, gitConfig } from '@/lib/layout.shared';

export const metadata: Metadata = {
  title: {
    absolute: 'ObjectStack — a metadata protocol and TypeScript toolkit for AI-native business apps',
  },
  description:
    'Describe objects, permissions, workflows, APIs, UI, and AI tools once as typed Zod metadata — ObjectStack derives the TypeScript types, REST API, client SDK, UI, and MCP tools.',
};

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <section className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center md:py-32">
        <span className="mb-6 rounded-full border border-fd-border px-3 py-1 text-xs font-medium text-fd-muted-foreground">
          Open source · Apache-2.0
        </span>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance md:text-5xl">
          A metadata protocol and TypeScript toolkit for AI-native business apps
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-fd-muted-foreground text-pretty">
          Describe your objects, permissions, workflows, APIs, UI, and AI tools once as typed,
          version-controlled Zod metadata. ObjectStack derives the TypeScript types, REST API,
          client SDK, UI, and MCP tools from that single definition.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/docs/getting-started"
            className="inline-flex items-center gap-2 rounded-full bg-fd-primary px-6 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
          >
            Get started
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/docs"
            className="inline-flex items-center rounded-full border border-fd-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            Documentation
          </Link>
          <a
            href={`https://github.com/${gitConfig.user}/${gitConfig.repo}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center rounded-full border border-fd-border px-6 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
          >
            GitHub
          </a>
        </div>
        <p className="mt-16 text-sm text-fd-muted-foreground">
          ObjectStack is the open-source developer framework.{' '}
          Need the official hosted runtime with AI built in?{' '}
          <a
            href="https://www.objectos.ai"
            className="inline-flex items-center gap-1 font-medium text-fd-foreground underline underline-offset-4 transition-colors hover:text-fd-primary"
          >
            Try ObjectOS
            <ArrowRight className="size-3.5" />
          </a>
        </p>
      </section>
    </HomeLayout>
  );
}
