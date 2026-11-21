/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useDeferredValue, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, BookOpen, Loader2, Search } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { filterActiveApps, useMetadata, useServedAppLabel } from '@object-ui/app-shell';
import { DocShell } from './DocShell';
import { useBookData } from './use-book-data';
import { buildBookCards, type BookCard } from './book-nav';
import { groupBooksByApp, searchDocs, type DocsIndexApp, type DocSearchHit } from './docs-index';
import { useDocContents } from './useDocContents';

/** An app record as `/meta/app` serves it, the members the page reads. */
type ServedApp = { name: string; label?: unknown; _packageId?: unknown; navigation?: unknown; areas?: unknown } & Record<string, unknown>;

/** The page's search query, in the URL so a search can be shared and survives a reload. */
const SEARCH_PARAM = 'q';

/**
 * `/docs` — "All documentation", the platform-level portal (ADR-0046 §6).
 *
 * The portal is organised by `book`: authored books plus an implicit
 * per-package book for every package that has docs but no authored one (§6.4).
 * objectstack#35424 — the books are grouped by the apps that carry them, named
 * as the launcher names them (`groupBooksByApp`), with no package id on any
 * card; a platform package's books are listed only under an app the caller's
 * app list includes. 「Search all documentation」 searches every article's
 * title, summary and body (`searchDocs`), over one lazily asked
 * `GET /meta/doc?include=content`. Each card opens that book's grouped reader
 * at `/docs/<slug>`; the single-doc reader lives at `/docs/<slug>/<name>`.
 */
export default function DocsIndex() {
  const { t } = useObjectTranslation();
  const { books, docs, state, error } = useBookData();
  const { apps } = useMetadata();
  const { appLabel } = useServedAppLabel();
  const [params, setParams] = useSearchParams();
  const query = params.get(SEARCH_PARAM) ?? '';
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim().length > 0;

  const cards = useMemo(() => buildBookCards(books, docs), [books, docs]);
  const indexApps = useMemo<DocsIndexApp[]>(
    () =>
      filterActiveApps(apps as ServedApp[] | undefined)
        .filter((app) => typeof app.name === 'string' && app.name !== '')
        .map((app) => ({
          name: app.name,
          label: appLabel(app),
          _packageId: typeof app._packageId === 'string' ? app._packageId : undefined,
          navigation: app.navigation,
          areas: app.areas,
        })),
    [apps, appLabel],
  );
  const groups = useMemo(() => groupBooksByApp(books, cards, docs, indexApps), [books, cards, docs, indexApps]);
  const listedBooks = useMemo(() => new Set(groups.flatMap((g) => g.cards.map((c) => c.name))), [groups]);

  const contents = useDocContents(searching);
  const hits = useMemo(
    () => (searching && contents.state === 'ready' ? searchDocs(deferredQuery, contents.docs, books, docs, listedBooks) : []),
    [searching, contents, deferredQuery, books, docs, listedBooks],
  );

  const setQuery = (next: string) => {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set(SEARCH_PARAM, next);
    else nextParams.delete(SEARCH_PARAM);
    setParams(nextParams, { replace: true });
  };

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
        <h1 className="text-lg font-semibold">{t('help.loadDocsFailed', { defaultValue: 'Failed to load documentation' })}</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  const searchLabel = t('help.searchAllDocs', { defaultValue: 'Search all documentation' });

  return (
    <DocShell>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{t('help.documentation', { defaultValue: 'Documentation' })}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('help.docsIndexSubtitle', { defaultValue: 'Guides that come with your installed apps.' })}
            </p>
          </div>
          <div role="search" className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchLabel}
              aria-label={searchLabel}
              data-testid="docs-search-all"
              className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </header>

        {searching ? (
          <SearchResults state={contents.state} error={contents.error} hits={hits} />
        ) : groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
            <BookOpen className="h-10 w-10" />
            <p className="text-sm">{t('help.noDocsInstalled', { defaultValue: 'No documentation is installed yet.' })}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {groups.map((group) => (
              <section key={group.app ?? '_other'} aria-labelledby={`docs-group-${group.app ?? '_other'}`} data-testid="docs-group">
                <h2 id={`docs-group-${group.app ?? '_other'}`} className="mb-3 text-sm font-semibold text-foreground/90">
                  {group.label ?? t('help.otherDocs', { defaultValue: 'Other documentation' })}
                </h2>
                <ul className="grid items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.cards.map((card) => (
                    <li key={card.name} className="h-full">
                      <BookCardLink card={card} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </DocShell>
  );
}

function BookCardLink({ card }: { card: BookCard }) {
  const { t } = useObjectTranslation();
  return (
    <Link
      to={`/docs/${card.slug}`}
      className="flex h-full flex-col gap-1 rounded-lg border border-border p-4 hover:bg-muted/50"
    >
      <span className="text-sm font-semibold">{card.label}</span>
      {card.description ? <span className="line-clamp-2 text-sm text-muted-foreground">{card.description}</span> : null}
      <span className="mt-auto pt-1 text-xs text-muted-foreground/80">
        {t('help.articleCount', {
          count: card.docCount,
          defaultValue: card.docCount === 1 ? '{{count}} article' : '{{count}} articles',
        })}
      </span>
    </Link>
  );
}

function SearchResults({
  state,
  error,
  hits,
}: {
  state: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  hits: DocSearchHit[];
}) {
  const { t } = useObjectTranslation();
  if (state === 'error') {
    return (
      <p className="py-10 text-center text-sm text-destructive" role="alert">
        {t('help.docsSearchFailed', { defaultValue: 'Could not search the documentation: {{message}}', message: error ?? '' })}
      </p>
    );
  }
  if (state !== 'ready') {
    return (
      <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {t('help.searchingDocs', { defaultValue: 'Searching…' })}
      </p>
    );
  }
  if (hits.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground" role="status">
        {t('help.noDocsMatch', { defaultValue: 'No articles match.' })}
      </p>
    );
  }
  return (
    <section aria-live="polite">
      <p className="mb-3 text-sm text-muted-foreground" role="status">
        {t('help.searchResultCount', {
          count: hits.length,
          defaultValue: hits.length === 1 ? '{{count}} article found' : '{{count}} articles found',
        })}
      </p>
      <ul className="flex flex-col divide-y rounded-lg border" data-testid="docs-search-results">
        {hits.map((hit) => (
          <li key={`${hit.bookSlug}/${hit.doc}`}>
            <Link to={`/docs/${hit.bookSlug}/${hit.doc}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-muted/50">
              <span className="text-sm font-medium text-primary">{hit.label}</span>
              <span className="text-xs text-muted-foreground">{hit.bookLabel}</span>
              {hit.snippet.length > 0 ? (
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {hit.snippet.map((part, i) =>
                    part.match ? (
                      <mark key={i} className="rounded-sm bg-primary/15 px-0.5 text-foreground">
                        {part.text}
                      </mark>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
