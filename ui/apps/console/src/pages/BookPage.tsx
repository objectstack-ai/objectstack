/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { BookOpen, FileQuestion, Loader2, Lock } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { DocShell } from './DocShell';
import { useBookData } from './use-book-data';
import { resolveBookTree, bookSlug, firstDoc } from './book-nav';

/**
 * The refusal a member outside a doc's or a book's audience gets on a direct
 * route (objectui#10188): the server answered the single-item read with 401
 * `UNAUTHENTICATED` or 403 `PERMISSION_DENIED` (ADR-0046 §6.7). It is kept apart
 * from "Documentation not found", the server's 404, so the portal never tells a
 * member that an installed doc is not installed. The server's own reason is shown
 * beneath the heading. Shared by `DocsSlug` (a segment the member's lists do not
 * answer) and `DocPage` (the reader).
 */
export function DocRefusal({ name, message }: { name?: string; message?: string }) {
  return (
    <DocShell breadcrumb={name}>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
        <Lock className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">You do not have access to this documentation</h1>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
    </DocShell>
  );
}

/**
 * `/docs/:slug` — a book landing (ADR-0046 §6). Opening a book means starting
 * to read it, so this resolves the book's spine and redirects to its overview
 * doc (`*_index`, else the first doc in order); the reader then shows that doc
 * with the book sidebar. This avoids duplicating the table of contents (the
 * sidebar already is it). A book with no readable docs shows an empty state.
 */
export default function BookPage() {
  const { slug, appName } = useParams<{ slug: string; appName?: string }>();
  const { t } = useObjectTranslation();
  const { books, docs, state } = useBookData();

  const found = useMemo(() => books.find((b) => bookSlug(b) === slug), [books, slug]);
  const opensTo = useMemo(
    () => (found ? firstDoc(resolveBookTree(found, docs)) : undefined),
    [found, docs],
  );

  if (state === 'loading') {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label={t('help.loadingDocumentation', { defaultValue: 'Loading documentation' })} />
      </div>
    );
  }

  if (found && opensTo) {
    const base = appName ? `/apps/${appName}/docs` : '/docs';
    return <Navigate to={`${base}/${slug}/${opensTo}`} replace />;
  }

  // Unknown book, or a book with no readable docs yet.
  return (
    <DocShell breadcrumb={found ? (found.label ?? slug) : slug}>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
        {found ? (
          <>
            <BookOpen className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">{found.label ?? slug}</h1>
            <p className="text-sm text-muted-foreground">This book has no documents yet.</p>
          </>
        ) : (
          <>
            <FileQuestion className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Book not found</h1>
            <p className="text-sm text-muted-foreground">
              No book named <code className="rounded bg-muted px-1 py-0.5">{slug}</code> is installed.
            </p>
          </>
        )}
      </div>
    </DocShell>
  );
}
