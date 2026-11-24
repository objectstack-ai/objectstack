/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import type { ResolvedBook } from './book-nav';

/**
 * The persistent left navigation for a book (ADR-0046 §6) — the resolved
 * spine rendered as grouped links. Used by the book landing page and shown
 * alongside the single-doc reader so a reader can move within the book
 * without losing their place.
 *
 * A long title wraps rather than truncating, so every entry is readable in
 * full (objectstack#35424).
 *
 * Routing is delegated: the parent supplies `docHref` so the same sidebar
 * works under the top-level `/docs/:name` route and the package-scoped
 * `/apps/:appName/docs/:name` route.
 */
export function BookSidebar({
  book,
  activeDoc,
  docHref,
  showLabel = true,
  groupHeadings = 'always',
}: {
  book: ResolvedBook;
  activeDoc?: string;
  docHref: (docName: string) => string;
  /** Draw the book's label above its groups; off where a parent already names the book (the docs column). */
  showLabel?: boolean;
  /** `multi`: a book of one group lists its entries under no heading, the book's name being the heading. */
  groupHeadings?: 'always' | 'multi';
}) {
  const headings = groupHeadings === 'always' || book.groups.length > 1;
  return (
    <nav aria-label={book.label ?? book.name} className="text-sm">
      {showLabel && book.label ? (
        <div className="mb-3 px-2 text-sm font-medium text-foreground">{book.label}</div>
      ) : null}
      <div className={headings ? 'space-y-5' : undefined}>
        {book.groups.map((group) => (
          <div key={group.key}>
            {headings ? (
              <div className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
            ) : null}
            <ul className="space-y-0.5">
              {group.entries.map((entry, i) => {
                if (entry.separator) {
                  return <li key={`sep-${i}`} className="my-1.5 border-t border-border/60" aria-hidden />;
                }
                if (entry.href) {
                  return (
                    <li key={`ext-${i}`}>
                      <a
                        href={entry.href}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 rounded px-2 py-1 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                      >
                        <span className="break-words">{entry.label ?? entry.href}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                      </a>
                    </li>
                  );
                }
                if (!entry.doc) return null;
                const active = entry.doc === activeDoc;
                return (
                  <li key={entry.doc}>
                    <Link
                      to={docHref(entry.doc)}
                      aria-current={active ? 'page' : undefined}
                      className={`block break-words rounded px-2 py-1.5 leading-snug transition ${
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      }`}
                    >
                      {entry.label ?? entry.doc}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
