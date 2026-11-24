/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { AppDocsBackLink } from './AppDocsBackLink';
import type { AppDocsBackTo } from './useAppDocsBackTo';
import { BookSidebar } from './BookSidebar';
import { bookArticles, filterBookArticles } from './docs-reading';
import type { ResolvedBook } from './book-nav';

/** One book of the column: its resolved spine and its URL segment. */
export interface DocsNavBook {
  slug: string;
  book: ResolvedBook;
}

/**
 * The docs reader's one navigation column (objectstack#35424): a way back to
 * the app the reader came from, a title filter, every book of the package
 * (the current one open, the others folded, each with its article count),
 * and a link to all documentation. Inside an app it takes the app menu's
 * place; the shell draws no menu beside it.
 */
export function DocsNav({
  books,
  currentSlug,
  activeDoc,
  docHref,
  backTo,
  allDocsHref,
}: {
  books: readonly DocsNavBook[];
  currentSlug?: string;
  activeDoc?: string;
  docHref: (slug: string, doc: string) => string;
  /** The app to return to; absent outside an app. */
  backTo?: AppDocsBackTo;
  allDocsHref: string;
}) {
  const { t } = useObjectTranslation();
  const [query, setQuery] = useState('');
  // A book the reader folded or unfolded; every other book follows the rule:
  // the current book open, the rest folded.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const searchId = useId();
  const searching = query.trim() !== '';
  const shown = books
    .map((entry) => ({ ...entry, filtered: filterBookArticles(entry.book, query) }))
    .filter((entry) => !searching || entry.filtered.groups.length > 0);
  const searchLabel = t('help.searchDocs', { defaultValue: 'Search docs' });

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="docs-nav">
      {backTo ? <AppDocsBackLink backTo={backTo} /> : null}
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          {searchLabel}
        </label>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchLabel}
          data-testid="docs-nav-search"
          className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-sm placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-2 text-muted-foreground" data-testid="docs-nav-no-match">
          {t('help.noDocsMatch', { defaultValue: 'No articles match.' })}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map(({ slug, book, filtered }) => {
            const open = searching || (toggled[slug] ?? slug === currentSlug);
            const label = book.label ?? book.name;
            const count = bookArticles(book).length;
            const Chevron = open ? ChevronDown : ChevronRight;
            return (
              <li key={slug}>
                <button
                  type="button"
                  aria-expanded={open}
                  disabled={searching}
                  onClick={() => setToggled((prev) => ({ ...prev, [slug]: !open }))}
                  className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left font-medium text-foreground hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="min-w-0 flex-1 break-words">{label}</span>
                  <span className="mt-px shrink-0 text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
                  <Chevron className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
                {open ? (
                  <div className="mt-1 pb-2">
                    <BookSidebar
                      book={filtered}
                      activeDoc={slug === currentSlug ? activeDoc : undefined}
                      docHref={(doc) => docHref(slug, doc)}
                      showLabel={false}
                      groupHeadings="multi"
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <div className="border-t pt-3">
        <Link
          to={allDocsHref}
          data-testid="docs-nav-all-docs"
          className="inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium text-primary hover:bg-muted/50"
        >
          <span>{t('help.allDocs', { defaultValue: 'All documentation' })}</span>
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
        </Link>
      </div>
    </div>
  );
}
