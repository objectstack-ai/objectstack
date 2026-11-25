/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useCallback, useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight, Library, Search } from 'lucide-react';
import { filterActiveApps, useMetadata, useServedAppLabel } from '@object-ui/app-shell';
import { buildBookCards } from './book-nav';
import { groupBooksByApp, type DocsIndexApp } from './docs-index';
import { useObjectTranslation } from '@object-ui/i18n';
import { AppDocsBackLink } from './AppDocsBackLink';
import { useAppDocsBackTo, type AppDocsBackTo } from './useAppDocsBackTo';
import { BookSidebar } from './BookSidebar';
import { bookArticles, filterBookArticles } from './docs-reading';
import { bookSlug, labelUncategorized, pkgOfBook, resolveBookTree, type ResolvedBook } from './book-nav';
import { useBookData } from './use-book-data';

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
  sections,
  allDocsFirst = false,
  allDocsActive = false,
}: {
  books: readonly DocsNavBook[];
  /** MOCKUP (objectstack#37197) — the portal's tree: the books under their app's heading. */
  sections?: readonly { key: string; label: string; books: readonly DocsNavBook[] }[];
  /** MOCKUP (objectstack#37197) — 「All documentation」 as the tree's first row, not its foot. */
  allDocsFirst?: boolean;
  allDocsActive?: boolean;
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
  const filterBooks = (list: readonly DocsNavBook[]) =>
    list
      .map((entry) => ({ ...entry, filtered: filterBookArticles(entry.book, query) }))
      .filter((entry) => !searching || entry.filtered.groups.length > 0);
  const shownSections = (sections ?? [{ key: '_all', label: '', books }])
    .map((section) => ({ ...section, shown: filterBooks(section.books) }))
    .filter((section) => section.shown.length > 0);
  const shown = shownSections.flatMap((section) => section.shown);
  const searchLabel = t('help.searchDocs', { defaultValue: 'Search docs' });

  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="docs-nav">
      {backTo ? <AppDocsBackLink backTo={backTo} /> : null}
      {allDocsFirst ? (
        <Link
          to={allDocsHref}
          data-testid="docs-nav-all-docs"
          aria-current={allDocsActive ? 'page' : undefined}
          className={`-mb-1 flex items-center gap-2 rounded-md px-2 py-1.5 font-medium transition-colors ${allDocsActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'}`}
        >
          <Library className="h-4 w-4 shrink-0" aria-hidden />
          <span>{t('help.allDocs', { defaultValue: 'All documentation' })}</span>
        </Link>
      ) : null}
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
        <div className="flex flex-col gap-3">
        {shownSections.map((section) => (
        <div key={section.key}>
        {section.label ? (
          <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">{section.label}</div>
        ) : null}
        <ul className="flex flex-col gap-1">
          {section.shown.map(({ slug, book, filtered }) => {
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
        </div>
        ))}
        </div>
      )}
      {allDocsFirst ? null : (
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
      )}
    </div>
  );
}

/**
 * Every book of package `pkg`, resolved for the column (objectstack#35424):
 * the reader's books, and those of an app's other docs pages. Empty with no
 * package.
 */
export function usePackageDocsNavBooks(pkg: string | undefined): DocsNavBook[] {
  const { t } = useObjectTranslation();
  const { books, authoredBooks, docs } = useBookData();
  const uncategorizedLabel = t('help.uncategorized', { defaultValue: 'Uncategorized' });
  return useMemo(() => {
    if (!pkg) return [];
    return books
      .filter((b) => pkgOfBook(b) === pkg)
      .map((b) => ({
        slug: bookSlug(b),
        book: labelUncategorized(resolveBookTree(b, docs, undefined, authoredBooks), uncategorizedLabel),
      }));
  }, [books, authoredBooks, docs, pkg, uncategorizedLabel]);
}

/**
 * The column as the shell sidebar carries it (objectstack#37150): the same
 * column, under its own navigation landmark.
 */
export function DocsNavLandmark({ children }: { children: ReactNode }) {
  const { t } = useObjectTranslation();
  return (
    <nav aria-label={t('help.docsNavigation', { defaultValue: 'Documentation navigation' })} className="pt-2">
      {children}
    </nav>
  );
}

/**
 * The column of an app's docs page other than the reader (the app's docs
 * index, a book with no articles, a book or doc not found): the app's books,
 * the way back to the app and all documentation. The reader builds its own,
 * from the book its article is in.
 */
export function AppDocsNav() {
  const { appName, slug } = useParams<{ appName?: string; slug?: string }>();
  const books = usePackageDocsNavBooks(appName);
  const backTo = useAppDocsBackTo();
  const docHref = useCallback(
    (bookSegment: string, doc: string) => `/apps/${appName}/docs/${bookSegment}/${doc}`,
    [appName],
  );
  return (
    <DocsNav books={books} currentSlug={slug} docHref={docHref} backTo={backTo} allDocsHref="/docs" />
  );
}

/**
 * DESIGN MOCKUP (objectstack#37197) — the portal's tree in the app-less
 * shell's sidebar: 「All documentation」 first (the portal's index), the
 * title filter, then every book, under its app's heading as the index groups
 * them; the open book is the one being read.
 */
export function PortalDocsNav({ currentSlug, activeDoc }: { currentSlug?: string; activeDoc?: string }) {
  const { t } = useObjectTranslation();
  const { pathname } = useLocation();
  const { books, authoredBooks, docs } = useBookData();
  const { apps } = useMetadata();
  const { appLabel } = useServedAppLabel();
  const uncategorizedLabel = t('help.uncategorized', { defaultValue: 'Uncategorized' });
  const otherLabel = t('help.otherDocs', { defaultValue: 'Other documentation' });
  const sections = useMemo(() => {
    const indexApps: DocsIndexApp[] = filterActiveApps(apps as any)
      .filter((app: any) => typeof app.name === 'string' && app.name !== '')
      .map((app: any) => ({
        name: app.name,
        label: appLabel(app),
        _packageId: typeof app._packageId === 'string' ? app._packageId : undefined,
        navigation: app.navigation,
        areas: app.areas,
      }));
    const cards = buildBookCards(books, docs);
    const byName = new Map(books.map((b) => [b.name, b]));
    return groupBooksByApp(books, cards, docs, indexApps).map((group) => ({
      key: group.app ?? '_other',
      label: group.label ?? otherLabel,
      books: group.cards
        .map((card) => byName.get(card.name))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => ({
          slug: bookSlug(b),
          book: labelUncategorized(resolveBookTree(b, docs, undefined, authoredBooks), uncategorizedLabel),
        })),
    }));
  }, [apps, appLabel, books, docs, authoredBooks, uncategorizedLabel, otherLabel]);
  const docHref = useCallback((bookSegment: string, doc: string) => `/docs/${bookSegment}/${doc}`, []);
  return (
    <DocsNav
      books={[]}
      sections={sections}
      currentSlug={currentSlug}
      activeDoc={activeDoc}
      docHref={docHref}
      allDocsHref="/docs"
      allDocsFirst
      allDocsActive={pathname === '/docs' || pathname === '/docs/'}
    />
  );
}
