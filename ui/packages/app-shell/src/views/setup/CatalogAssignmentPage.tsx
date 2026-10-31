// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shape both Setup assignment pages share (ADR-0146 D7): the catalog items
 * of one registry type on the left, the picked item's assignment section on
 * the right. The picked item lives in the URL (AGENTS.md #8), so a refreshed
 * or shared link opens it again.
 *
 * Honesty: a failed read of the catalog is said as a failure with a retry,
 * never drawn as "no items" — the metadata store answers a failed list with
 * an empty one and records the failure on the type's status.
 *
 * Who may add or remove is not judged here. The section asks the caller's
 * grant on the assignment object and the server judges every write, its
 * delegated-administration gate included; this page only picks the item.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button,
  Empty,
  EmptyDescription,
  EmptyTitle,
  Input,
  Skeleton,
  cn,
} from '@object-ui/components';
import { useMetadata } from '@object-ui/react';
import { AlertCircle } from 'lucide-react';
import { PageHeader } from '../../layout/PageHeader.js';
import { catalogEntries, filterCatalogEntries, type CatalogEntry } from './peopleAssignments.js';

export interface CatalogAssignmentCopy {
  title: string;
  subtitle: string;
  listLabel: string;
  filterPlaceholder: string;
  emptyTitle: string;
  emptyBody: string;
  pick: string;
  loadFailed: string;
  noMatch: string;
  notFound: (name: string) => string;
  retry: string;
  refresh: string;
}

export interface CatalogAssignmentPageProps {
  /** The registry type whose items are picked (`position`, `permission`). */
  type: string;
  /** The page-scoped query parameter that names the picked item. */
  param: string;
  icon: React.ReactNode;
  copy: CatalogAssignmentCopy;
  /** The assignment section for the picked item. */
  renderSection: (name: string) => React.ReactNode;
  testId: string;
}

type CatalogRead = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; entries: CatalogEntry[] };

export function CatalogAssignmentPage({ type, param, icon, copy, renderSection, testId }: CatalogAssignmentPageProps) {
  const metadata = useMetadata();
  // Read through a ref: the store's context value is rebuilt whenever any
  // cached type settles, and AGENTS.md #10 forbids keying the read on it.
  const metadataRef = React.useRef(metadata);
  metadataRef.current = metadata;

  const [read, setRead] = React.useState<CatalogRead>({ kind: 'loading' });
  const [nonce, setNonce] = React.useState(0);
  const [query, setQuery] = React.useState('');
  const [search, setSearch] = useSearchParams();
  const picked = search.get(param) ?? '';

  React.useEffect(() => {
    let live = true;
    setRead({ kind: 'loading' });
    metadataRef.current.ensureType(type).then((items) => {
      if (!live) return;
      if (metadataRef.current.getTypeStatus?.(type) === 'error') setRead({ kind: 'failed' });
      else setRead({ kind: 'ready', entries: catalogEntries(items) });
    });
    return () => {
      live = false;
    };
  }, [type, nonce]);

  /** Read the catalog again, past the store's cache and its failure cooldown. */
  const reload = React.useCallback(() => {
    setRead({ kind: 'loading' });
    void metadataRef.current.refresh(type).finally(() => setNonce((n) => n + 1));
  }, [type]);

  const pick = (name: string) => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(param, name);
        return next;
      },
      { replace: true },
    );
  };

  const entries = read.kind === 'ready' ? read.entries : [];
  const shown = filterCatalogEntries(entries, query);
  const pickedKnown = entries.some((e) => e.name === picked);

  let list: React.ReactNode;
  if (read.kind === 'loading') {
    list = (
      <div className="space-y-2 p-3" data-testid={`${testId}-loading`}>
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  } else if (read.kind === 'failed') {
    list = (
      <div role="alert" data-testid={`${testId}-load-failed`} className="space-y-2 p-3 text-sm">
        <div className="flex items-start gap-2 text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{copy.loadFailed}</span>
        </div>
        <Button variant="outline" size="sm" onClick={reload}>
          {copy.retry}
        </Button>
      </div>
    );
  } else if (entries.length === 0) {
    list = (
      <Empty data-testid={`${testId}-empty`}>
        <EmptyTitle>{copy.emptyTitle}</EmptyTitle>
        <EmptyDescription>{copy.emptyBody}</EmptyDescription>
      </Empty>
    );
  } else {
    list = (
      <div className="space-y-2 p-3">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.filterPlaceholder}
          aria-label={copy.filterPlaceholder}
          className="h-8 text-sm"
        />
        {shown.length === 0 ? (
          <p className="px-1 py-2 text-xs text-muted-foreground">{copy.noMatch}</p>
        ) : (
          <ul aria-label={copy.listLabel} className="space-y-0.5">
            {shown.map((e) => (
              <li key={e.name}>
                <button
                  type="button"
                  onClick={() => pick(e.name)}
                  aria-current={e.name === picked ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                    e.name === picked && 'bg-muted font-medium',
                  )}
                >
                  <span className="block truncate">{e.label}</span>
                  {e.label !== e.name && (
                    <code className="block truncate font-mono text-xs text-muted-foreground">{e.name}</code>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  let detail: React.ReactNode;
  if (!picked) {
    detail = <p className="text-sm text-muted-foreground" data-testid={`${testId}-pick`}>{copy.pick}</p>;
  } else if (read.kind === 'ready' && !pickedKnown) {
    detail = (
      <p role="status" className="text-sm text-muted-foreground" data-testid={`${testId}-not-found`}>
        {copy.notFound(picked)}
      </p>
    );
  } else if (read.kind !== 'ready') {
    detail = null;
  } else {
    const entry = entries.find((e) => e.name === picked)!;
    detail = (
      <div>
        <h2 className="text-base font-semibold">{entry.label}</h2>
        <code className="font-mono text-xs text-muted-foreground">{entry.name}</code>
        {entry.description && <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>}
        {/* Keyed by the item: the section's state is that item's, never carried to the next one. */}
        <React.Fragment key={entry.name}>{renderSection(entry.name)}</React.Fragment>
      </div>
    );
  }

  return (
    <div data-testid={testId}>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        icon={icon}
        refresh={{ onRefresh: reload, label: copy.refresh, busy: read.kind === 'loading' }}
      />
      <div className="grid gap-4 p-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <nav aria-label={copy.listLabel} className="min-w-0 rounded-md border">
          {list}
        </nav>
        <section className="min-w-0">{detail}</section>
      </div>
    </div>
  );
}
