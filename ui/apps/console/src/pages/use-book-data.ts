/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAdapter } from '@object-ui/app-shell';
import { buildPortalBooks, type Book, type ResolverDoc } from './book-nav';

/**
 * Fetch the `book` + `doc` metadata that drives the portal navigation
 * (ADR-0046 §6). Both are loaded through the ordinary metadata API the doc
 * pages already use (`meta.getItems`), so this works the moment the backend
 * serves these types — no new endpoint required.
 *
 * Degrades softly: a backend that doesn't serve `book` yet (or returns an
 * error for it) yields `books: []`, letting callers fall back to the legacy
 * package-grouped view rather than failing the whole page.
 */
export interface BookData {
  /** Authored books exactly as published. */
  authoredBooks: Book[];
  /**
   * The portal's full book set: authored books plus a synthetic implicit book
   * for any package that has docs but no authored book (ADR-0046 §6.4). This
   * is what the portal navigates — there is no "flat vs book" fork.
   */
  books: Book[];
  docs: ResolverDoc[];
  state: 'loading' | 'ready' | 'error';
  error?: string;
}

function unwrapList(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  const r = result as any;
  if (Array.isArray(r?.items)) return r.items;
  if (Array.isArray(r?.value)) return r.value;
  return [];
}

function toBook(it: any): Book | null {
  if (!it || typeof it.name !== 'string' || !it.name) return null;
  return {
    name: it.name,
    label: it.label,
    description: it.description,
    slug: it.slug,
    icon: it.icon,
    order: typeof it.order === 'number' ? it.order : undefined,
    audience: it.audience,
    groups: Array.isArray(it.groups) ? it.groups : [],
    packageId: it._packageId ?? it.packageId,
  };
}

function toDoc(it: any): ResolverDoc | null {
  if (!it || typeof it.name !== 'string' || !it.name) return null;
  return {
    name: it.name,
    label: it.label,
    description: it.description,
    order: typeof it.order === 'number' ? it.order : undefined,
    group: typeof it.group === 'string' ? it.group : undefined,
    tags: Array.isArray(it.tags) ? it.tags : undefined,
    packageId: it._packageId ?? it.packageId,
  };
}

interface RawState {
  authoredBooks: Book[];
  docs: ResolverDoc[];
  state: 'loading' | 'ready' | 'error';
  error?: string;
}

/**
 * Fetch the book + doc metadata once. Used by {@link BookDataProvider} at the
 * `/docs` layout route so the whole docs section shares a single fetch, rather
 * than each page (index, book landing, reader) re-fetching independently.
 */
function useBookDataFetch(): BookData {
  const adapter = useAdapter();
  const [data, setData] = useState<RawState>({ authoredBooks: [], docs: [], state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!adapter) return;
      const client: any = adapter.getClient();
      if (!client?.meta?.getItems) {
        setData({ authoredBooks: [], docs: [], state: 'error', error: 'meta.getItems is not available' });
        return;
      }
      setData((d) => ({ ...d, state: 'loading' }));
      try {
        // Docs are required; books are optional (the type may not be served
        // yet) — so tolerate a book fetch failure without failing the page.
        const docsRaw = await client.meta.getItems('doc');
        let booksRaw: unknown = [];
        try {
          booksRaw = await client.meta.getItems('book');
        } catch {
          booksRaw = [];
        }
        if (cancelled) return;
        const docs = unwrapList(docsRaw).map(toDoc).filter((d): d is ResolverDoc => d !== null);
        const authoredBooks = unwrapList(booksRaw).map(toBook).filter((b): b is Book => b !== null);
        setData({ authoredBooks, docs, state: 'ready' });
      } catch (err: any) {
        if (cancelled) return;
        setData({ authoredBooks: [], docs: [], state: 'error', error: err?.message ?? 'Failed to load documentation' });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [adapter]);

  // Synthesize the portal's implicit per-package books on top of the authored
  // ones, so every package with docs is browsable as a book (ADR-0046 §6.4).
  const books = useMemo(
    () => buildPortalBooks(data.authoredBooks, data.docs),
    [data.authoredBooks, data.docs],
  );

  return { ...data, books };
}

const LOADING: BookData = { authoredBooks: [], books: [], docs: [], state: 'loading' };

/**
 * Shared book/doc data, provided once at the `/docs` layout route (see
 * DocsLayout) and consumed by {@link useBookData}. Exported so the layout's
 * provider — which lives in a `.tsx` file — can supply it.
 */
export const BookDataContext = createContext<BookData | null>(null);

/** The one-time fetcher the layout drives. Internal to the docs section. */
export { useBookDataFetch };

/** Read the shared book/doc data. Returns a loading state outside the provider. */
export function useBookData(): BookData {
  return useContext(BookDataContext) ?? LOADING;
}
