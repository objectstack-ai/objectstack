/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { BookOpen, Loader2 } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { DocShell } from './DocShell';
import { useBookData } from './use-book-data';
import { buildBookCards, pkgOfBook, type Book } from './book-nav';

/**
 * `/apps/:appName/docs` — the app-scoped documentation index (ADR-0046 §6 /
 * ADR-0048). The package-scoped sibling of the platform `/docs` portal: it
 * shows the books owned by the app whose container this route renders inside
 * (`:appName` is the package-id segment).
 *
 * Book-driven like the portal: a package always has at least its implicit book
 * (§6.4). The common single-book case lands straight on that book's grouped
 * reader; a package with several books lists them. Reads the shared book/doc
 * data provided by the `/docs` layout — no separate fetch.
 */
export default function AppDocsIndex() {
  const { appName } = useParams<{ appName?: string }>();
  const { t } = useObjectTranslation();
  const { books, docs, state } = useBookData();

  const myBooks = useMemo<Book[]>(
    () => books.filter((b) => pkgOfBook(b) === appName),
    [books, appName],
  );
  const cards = useMemo(() => buildBookCards(myBooks, docs), [myBooks, docs]);

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label={t('help.loadingDocumentation', { defaultValue: 'Loading documentation' })} />
      </div>
    );
  }

  // One book (the usual case) → land directly on its grouped reader.
  if (cards.length === 1) {
    return <Navigate to={`/apps/${appName}/docs/${cards[0].slug}`} replace />;
  }

  return (
    <DocShell>
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <BookOpen className="h-10 w-10" />
            <p className="text-sm">This app does not ship any documentation yet.</p>
            <Link to="/docs" className="text-sm font-medium text-primary hover:underline">
              Browse all documentation
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {cards.map((card) => (
              <li key={card.name}>
                <Link
                  to={`/apps/${appName}/docs/${card.slug}`}
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
