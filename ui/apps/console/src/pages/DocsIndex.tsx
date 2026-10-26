/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BookOpen, Loader2 } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { DocShell } from './DocShell';
import { useBookData } from './use-book-data';
import { buildBookCards } from './book-nav';

/**
 * `/docs` — the platform-level documentation portal (ADR-0046 §6).
 *
 * The portal is organised entirely by `book`: authored books plus an implicit
 * per-package book for every package that has docs but no authored one (§6.4 —
 * there is no "flat vs book" fork; a flat package is just its implicit book).
 * Each card opens that book's grouped reader at `/docs/<slug>`; the single-doc
 * reader lives at `/docs/<slug>/<name>`.
 */
export default function DocsIndex() {
  const { t } = useObjectTranslation();
  const { books, docs, state, error } = useBookData();

  // Cards carry the book's url slug so links match the `/docs/:slug` route.
  const cards = useMemo(() => buildBookCards(books, docs), [books, docs]);

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label={t('help.loadingDocumentation', { defaultValue: 'Loading documentation' })} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
        <AlertCircle className="h-10 w-10 text-destructive" />
        <h1 className="text-lg font-semibold">Failed to load documentation</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <DocShell>
      <div className="mx-auto max-w-4xl p-4 sm:p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Documentation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Books and guides from your installed packages.
          </p>
        </header>
        {cards.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <BookOpen className="h-10 w-10" />
            <p className="text-sm">
              No documentation is installed. Packages ship docs as flat
              <code className="mx-1 rounded bg-muted px-1 py-0.5">src/docs/*.md</code>
              files, organised by a <code className="rounded bg-muted px-1 py-0.5">book</code> (ADR-0046).
            </p>
          </div>
        ) : (
          <ul className="grid items-stretch gap-3 sm:grid-cols-2">
            {cards.map((card) => (
              <li key={card.name} className="h-full">
                <Link
                  to={`/docs/${card.slug}`}
                  className="flex h-full items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
                >
                  <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{card.label}</div>
                    {card.description ? (
                      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {card.description}
                      </div>
                    ) : card.subtitle ? (
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/70">
                        {card.subtitle}
                      </div>
                    ) : null}
                    <div className="mt-1 text-xs text-muted-foreground/80">
                      {card.docCount} {card.docCount === 1 ? 'article' : 'articles'}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DocShell>
  );
}
