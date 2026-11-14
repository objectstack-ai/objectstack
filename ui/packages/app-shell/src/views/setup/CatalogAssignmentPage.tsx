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
 *
 * objectstack#32537 (ADR-0150 D4) — a permission set is identified by
 * `(package, name)`. Given a `holderParam`, a name more than one package holds
 * is listed once per holder, said beside it, and the pick names the holder's
 * package in that parameter; the section is handed the holding. A link that
 * names such a name and no holder the name alone addresses picks nothing: the
 * page asks for a pick among the holders it lists. A name with one holder is
 * listed, linked and handed on as before.
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
import {
  catalogEntries,
  catalogEntryKey,
  entryAnswersPick,
  filterCatalogEntries,
  type CatalogEntry,
} from './peopleAssignments.js';
import { holdingPackage, type PermissionSetHolder } from '../metadata-admin/permission-set-holder.js';

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
  /** How an entry's holder is said, where the page lists more than one holder of a name (`holderParam`). */
  holder?: (packageId: PermissionSetHolder) => string;
}

export interface CatalogAssignmentPageProps {
  /** The registry type whose items are picked (`position`, `permission`). */
  type: string;
  /** The page-scoped query parameter that names the picked item. */
  param: string;
  /**
   * objectstack#32537 — the page-scoped query parameter that names the picked
   * item's package where more than one package holds its name; given, the
   * catalog is listed per holder (module doc).
   */
  holderParam?: string;
  icon: React.ReactNode;
  copy: CatalogAssignmentCopy;
  /** The assignment section for the picked item. */
  renderSection: (name: string, entry: CatalogEntry) => React.ReactNode;
  testId: string;
  /**
   * Narrow the catalog to the items this caller may pick (the recycle-bin
   * page keeps the objects whose bin it manages). Applied to a catalog that
   * read; an item it drops is unknown to the page, as one the catalog lacks.
   */
  select?: (entries: CatalogEntry[]) => CatalogEntry[];
}

type CatalogRead = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; entries: CatalogEntry[] };

export function CatalogAssignmentPage({
  type,
  param,
  holderParam,
  icon,
  copy,
  renderSection,
  testId,
  select,
}: CatalogAssignmentPageProps) {
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
  const pickedPackage = holderParam ? search.get(holderParam) : null;

  React.useEffect(() => {
    let live = true;
    setRead({ kind: 'loading' });
    metadataRef.current.ensureType(type).then((items) => {
      if (!live) return;
      if (metadataRef.current.getTypeStatus?.(type) === 'error') setRead({ kind: 'failed' });
      else setRead({ kind: 'ready', entries: catalogEntries(items, { byHolder: holderParam !== undefined }) });
    });
    return () => {
      live = false;
    };
  }, [type, nonce, holderParam]);

  /** Read the catalog again, past the store's cache and its failure cooldown. */
  const reload = React.useCallback(() => {
    setRead({ kind: 'loading' });
    void metadataRef.current.refresh(type).finally(() => setNonce((n) => n + 1));
  }, [type]);

  const pick = (entry: CatalogEntry) => {
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set(param, entry.name);
        if (holderParam) {
          const packageId = holdingPackage(entry.holding);
          if (packageId) next.set(holderParam, packageId);
          else next.delete(holderParam);
        }
        return next;
      },
      { replace: true },
    );
  };
  const isPicked = (entry: CatalogEntry) => entryAnswersPick(entry, picked, pickedPackage);
  const holderLine = (entry: CatalogEntry) =>
    entry.holding && copy.holder ? (
      <span className="block truncate text-xs text-muted-foreground" data-testid={`${testId}-holder`}>
        {copy.holder(entry.holding.packageId)}
      </span>
    ) : null;

  const entries = read.kind === 'ready' ? (select ? select(read.entries) : read.entries) : [];
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
              <li key={catalogEntryKey(e)}>
                <button
                  type="button"
                  onClick={() => pick(e)}
                  aria-current={isPicked(e) ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                    isPicked(e) && 'bg-muted font-medium',
                  )}
                >
                  <span className="block truncate">{e.label}</span>
                  {e.label !== e.name && (
                    <code className="block truncate font-mono text-xs text-muted-foreground">{e.name}</code>
                  )}
                  {holderLine(e)}
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
    const entry = entries.find(isPicked);
    detail = entry ? (
      <div>
        <h2 className="text-base font-semibold">{entry.label}</h2>
        <code className="font-mono text-xs text-muted-foreground">{entry.name}</code>
        {holderLine(entry)}
        {entry.description && <p className="mt-1 text-sm text-muted-foreground">{entry.description}</p>}
        {/* Keyed by the item: the section's state is that item's, never carried to the next one. */}
        <React.Fragment key={catalogEntryKey(entry)}>{renderSection(entry.name, entry)}</React.Fragment>
      </div>
    ) : (
      // objectstack#32537 — the link names a name more than one package holds,
      // and no holder the name alone addresses: nothing is picked for the
      // administrator; the list shows each holder.
      <p className="text-sm text-muted-foreground" data-testid={`${testId}-pick-holder`}>{copy.pick}</p>
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
