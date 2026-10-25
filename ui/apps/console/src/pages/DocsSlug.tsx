/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { FileQuestion, Loader2 } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '@object-ui/app-shell';
import { DocShell } from './DocShell';
import BookPage, { DocRefusal } from './BookPage';
import { useBookData } from './use-book-data';
import { bookNamedBy, bookSlug, homeBook } from './book-nav';

/** What the server says about one segment the member's lists do not answer. */
type SegmentAnswer = { slug: string; refusal: string | null };

/**
 * objectui#10188 — ask the server about ONE name: the doc, then the book. The
 * member's `doc` / `book` lists are pruned per caller (ADR-0046 §6.7), so a name
 * missing from them is either absent or refused, and only the single-item read
 * tells the two apart: 401 / 403 is the audience gate refusing this member, and
 * the server's reason comes back as the answer; anything else (404, a served
 * item) leaves the portal's own answer standing. `@objectstack/client` rejects a
 * non-2xx read with the status in `httpStatus`.
 */
async function refusalFor(
  client: { meta: { getItem: (type: string, name: string, options?: { packageId?: string }) => Promise<unknown> } },
  name: string,
  options: { packageId?: string } | undefined,
): Promise<string | null> {
  for (const type of ['doc', 'book'] as const) {
    try {
      await client.meta.getItem(type, name, options);
      return null; // served: not a refusal
    } catch (err) {
      const status = (err as { httpStatus?: unknown } | null)?.httpStatus;
      if (status === 401 || status === 403) return (err as Error)?.message ?? '';
      if (status !== 404) return null;
    }
  }
  return null;
}

/**
 * `/docs/:slug` — resolves a single segment under the portal to either a book
 * landing or a legacy doc permalink (ADR-0046).
 *
 * Books and docs share the `/docs/<segment>` space deliberately: a doc's
 * identity stays single-coordinate (`<name>`, ADR §4) while a book occupies a
 * `slug` portal segment (ADR §6). When the segment is a book slug we render its
 * landing; otherwise we treat it as a flat doc name and redirect to its
 * canonical in-book URL `/docs/<homeBook>/<name>` — every doc has a home book
 * (its package's authored or implicit book, §6.4), so this resolves for any
 * installed doc. An unknown segment degrades to a "not found" notice.
 *
 * A segment that is a book's NAME rather than its slug — what a
 * `{ type: 'doc', book }` navigation entry links to (objectui#11197) — redirects
 * to that book's canonical slug URL. It is looked up only AFTER the two answers
 * that stand today (a book slug, then an installed doc's name), and before the
 * name-prefix fallback, whose redirect for a name no installed doc carries lands
 * on "not found". So nothing that resolves today changes its answer.
 *
 * A segment none of the member's lists answers is asked about ONCE, by name, before
 * that fallback (objectui#10188): a doc or book the member may not read renders the
 * refusal, in place, and a name nothing carries keeps every answer above.
 */
export default function DocsSlug() {
  const { slug, appName } = useParams<{ slug: string; appName?: string }>();
  const { t } = useObjectTranslation();
  const { books, docs, state } = useBookData();
  const adapter = useAdapter();

  // Answered by the member's own lists: a book slug, a readable doc, a book NAME.
  const unanswered =
    state === 'ready' &&
    !!slug &&
    !books.some((b) => bookSlug(b) === slug) &&
    !docs.some((d) => d.name === slug) &&
    !bookNamedBy(slug, books);
  const [answer, setAnswer] = useState<SegmentAnswer | null>(null);
  useEffect(() => {
    if (!unanswered || !slug || !adapter) return;
    let cancelled = false;
    void refusalFor(adapter.getClient(), slug, appName ? { packageId: appName } : undefined).then(
      (refusal) => {
        if (!cancelled) setAnswer({ slug, refusal });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [unanswered, slug, appName, adapter]);

  if (state === 'loading' || (unanswered && !!adapter && answer?.slug !== slug)) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-label={t('help.loadingDocumentation', { defaultValue: 'Loading documentation' })} />
      </div>
    );
  }

  // A book slug → render its landing (BookPage reads the same `:slug` param).
  if (slug && books.some((b) => bookSlug(b) === slug)) {
    return <BookPage />;
  }

  // Otherwise a flat doc permalink → redirect to its canonical in-book URL.
  const base = appName ? `/apps/${appName}/docs` : '/docs';
  const hb = slug ? homeBook(slug, books, docs) : null;
  if (hb && slug && docs.some((d) => d.name === slug)) {
    return <Navigate to={`${base}/${bookSlug(hb)}/${slug}`} replace />;
  }

  // A book NAME that is not its slug → the book's canonical URL (objectui#11197).
  const named = slug ? bookNamedBy(slug, books) : null;
  if (named) {
    return <Navigate to={`${base}/${bookSlug(named)}`} replace />;
  }

  // A doc or book the member may not read: the server's refusal, in place. No
  // answer for this segment (none was asked, or it was not a refusal) leaves the
  // portal's own answer below standing.
  const refusal = answer !== null && answer.slug === slug ? answer.refusal : null;
  if (refusal !== null) {
    return <DocRefusal name={slug} message={refusal} />;
  }

  // The name-prefix fallback for a name no installed doc carries (unchanged).
  if (hb && slug) {
    return <Navigate to={`${base}/${bookSlug(hb)}/${slug}`} replace />;
  }

  return (
    <DocShell breadcrumb={slug}>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 p-10 text-center">
        <FileQuestion className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Documentation not found</h1>
        <p className="text-sm text-muted-foreground">
          No book or document named <code className="rounded bg-muted px-1 py-0.5">{slug}</code> is installed.
        </p>
      </div>
    </DocShell>
  );
}
