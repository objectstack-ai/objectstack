/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * RecordPreviewCard — a compact card for any `(objectName, recordId)` pair
 * (objectui#12029, the A2 child of objectui#2763).
 *
 * Polymorphic references are everywhere in the console — an approval request's
 * target, an audit row, an activity entry, a comment — and until now nothing
 * rendered one as a RECORD: the Approvals Inbox shows the target as a bare
 * title. This card resolves the target object's definition and draws the
 * record the way the record page's own header draws it.
 *
 * ## Module-internal on purpose
 *
 * Nothing re-exports this file from the package entry and it registers no
 * component type. Registering it as a type page metadata can reference is the
 * job of the first card that consumes it (objectui#2763's B1), which also owns
 * any spec type that registration might need.
 *
 * ## No rule of its own: it composes the record page's rules
 *
 * - **Title** — `getRecordDisplayName` from `@object-ui/core`, the one ADR-0079
 *   ladder (`nameField`, then its deprecated alias, then `titleFormat`, then
 *   type-aware derivation, then `Record #<id>`). The record page's H1 and
 *   breadcrumb read the same function.
 * - **Key fields** — `deriveHighlightFields(def, detectStatusField(def))` from
 *   `@object-ui/plugin-detail`, the exact call the synthesized record page uses
 *   for its highlights strip (`buildDefaultHighlights`): the object's declared
 *   `highlightFields` (ADR-0085) first, else the same heuristic.
 * - **Field values** — `HeaderHighlight`, the strip the record page draws those
 *   fields with, so a value reads here exactly as it reads on the record page.
 * - **Field-level security** — the served row passes through
 *   `withoutDeniedFields` before the title and the fields read it, as every
 *   surface that builds a display value from a whole row does (objectui#10594),
 *   and the `$expand` list is gated the way the record page gates its own
 *   (objectui#7230).
 *
 * The strip runs inside its own read-only `InlineEditProvider`. Without it a
 * card mounted on a record page would join THAT page's edit session: the
 * host's draft would be laid over this record's values, and an editable chip
 * would write into the host record's draft.
 *
 * ## The four states, and what the card may say about each
 *
 * - `absent` — the pair addresses nothing (no object name or no record id).
 *   Nothing is read; the card renders the shared empty-value placeholder.
 * - `loading` — the definition or the record read has not answered yet.
 * - `readable` — the record read returned the record.
 * - `unreadable` — every other answer: the object's definition is unavailable,
 *   there is no data source, the by-id read resolved with no record, or it was
 *   rejected (refused or failed). ONE rendering for all of them, and it says
 *   nothing about why — the Approvals Inbox's rule (objectui#5211,
 *   objectui#8631, objectui#11878; see `recordReadability.ts` and
 *   `unresolvableRecordReference.ts` in `apps/console`). The platform answers a
 *   by-id read of a record outside the viewer's row set with the same 404 it
 *   gives a deleted one, on purpose, so a card that told "deleted" apart from
 *   "not visible" would be an existence oracle. That is also why `absent` is
 *   about the REFERENCE and never about the record: the card cannot learn from
 *   its own read that a record is gone. A deletion the platform asserts (an
 *   approval's `record_deleted`) is the caller's to render, not this card's.
 *
 * ## The link: `readable` only, built by the host (objectui#12557)
 *
 * In its `readable` state the card's title links to the record's page, as the
 * Approvals Inbox sheet links the same reference. No other state links: the
 * card has no record in hand there, and a refused or unresolvable target
 * never yields a link (objectui#11878).
 *
 * The URL is not built here. The card asks the host's record-URL builder,
 * `recordHref` / `openRecord` on `RelatedRecordActionsContext`, the one the
 * lookup values on the same page link through (`ReferencedRecordLink` in
 * `@object-ui/fields`). On a record page that is the console's
 * `RelatedRecordActionsBridge`: the app-scoped record path, in the current
 * app. A host that publishes no builder, or one that cannot route to the
 * target object, answers no href, and the title is drawn as plain text.
 *
 * The link is drawn the way that one is: a real `href`, so a middle-click or a
 * modifier click opens a new tab, and a plain left click handed to the host
 * for in-app navigation. It wraps the title, never the card: the highlight
 * strip draws a lookup value as a link of its own under the same host, and a
 * link wrapping the card would nest one anchor inside another. The details
 * grid's row carries its own click and key handlers (copy the value), so the
 * link keeps its click and its Enter to itself.
 *
 * ## Cost
 *
 * - The definition comes from `useMetadataItem('object', name)`: a cache hit
 *   when the console already holds that object, otherwise one by-name read that
 *   `MetadataProvider` de-duplicates in flight and caches, so N cards for one
 *   object share a single definition read.
 * - The record is one `findOne` per card, the request shape the record page
 *   sends: no params, or `$expand` naming only the reference fields the card
 *   shows. The ObjectStack adapter shares concurrent identical reads
 *   (objectui#11699), but N cards for N different ids are N reads — a list that
 *   renders many cards should weigh that before it does.
 * - The card re-reads in place when the record is invalidated on the data bus
 *   (`useDataInvalidation`), keeping what it shows until the answer lands.
 */

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, EmptyValue, cn } from '@object-ui/components';
import { buildExpandFields, getRecordDisplayName, withoutDeniedFields } from '@object-ui/core';
import { deriveHighlightFields, detectStatusField, HeaderHighlight } from '@object-ui/plugin-detail';
import { usePermissions } from '@object-ui/permissions';
import {
  InlineEditProvider,
  useDataInvalidation,
  useMetadataItem,
  useObjectLabel,
  useObjectTranslation,
  useRelatedRecordActions,
} from '@object-ui/react';
import type { QueryParams } from '@object-ui/types';
import { Link2Off, Loader2 } from 'lucide-react';

/**
 * The one read the card makes. Structural, so the console's adapter satisfies
 * it as it is and a test can hand in a counting stub.
 */
export interface RecordPreviewSource {
  findOne(objectName: string, id: string, params?: QueryParams): Promise<unknown>;
}

export interface RecordPreviewCardProps {
  /** The target's object name — the `object_name` half of the pair. */
  objectName?: string | null;
  /** The target's record id — the `record_id` half of the pair. */
  recordId?: string | null;
  /** Where the record is read from. Pass a stable instance (the adapter). */
  dataSource?: RecordPreviewSource | null;
  className?: string;
}

/** One record read's answer, tagged with the target it answered for. */
type ReadAnswer =
  | { key: string; status: 'readable'; record: Record<string, unknown> }
  | { key: string; status: 'unreadable' };

function present(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function RecordPreviewCard({ objectName, recordId, dataSource, className }: RecordPreviewCardProps) {
  // The pair as primitives: every effect below keys on these strings, never on
  // an object rebuilt per render (AGENTS.md #10).
  const targetObject = present(objectName) && present(recordId) ? objectName : null;
  const targetRecord = targetObject !== null ? (recordId as string) : null;
  const targetKey = targetObject !== null ? `${targetObject}::${targetRecord}` : null;

  const { item: fetchedDef, loading: defLoading } = useMetadataItem('object', targetObject);
  // `useMetadataItem` answers for the PREVIOUS name during the one render
  // between a name change and its effect; a definition for another object is
  // treated as not answered yet rather than drawn against this record.
  const def =
    fetchedDef && targetObject !== null && (fetchedDef.name === undefined || fetchedDef.name === targetObject)
      ? fetchedDef
      : null;
  const defPending = targetObject !== null && (defLoading || (!!fetchedDef && !def));
  const defReady = !!def && !defPending;

  const perms = usePermissions();
  const invalidation = useDataInvalidation(targetObject ?? undefined, targetRecord ?? undefined);

  // Memoised for cost only; nothing below depends on the identity returned.
  const highlightNames = useMemo<string[]>(
    () => (def ? deriveHighlightFields(def, detectStatusField(def)) : []),
    [def],
  );
  // What the read SENDS, held as a string so the effect keys on the data it
  // sends rather than on the objects that data is derived from.
  const expandable = def ? buildExpandFields(def.fields, highlightNames) : [];
  const expandKey = JSON.stringify(
    targetObject === null || !perms?.isLoaded
      ? expandable
      : expandable.filter((f) => perms.checkField(targetObject, f, 'read')),
  );

  const [answer, setAnswer] = useState<ReadAnswer | null>(null);

  useEffect(() => {
    if (targetObject === null || targetRecord === null || targetKey === null) return;
    if (!defReady || !dataSource?.findOne) return;
    let cancelled = false;
    const expand: string[] = JSON.parse(expandKey);
    // The executor runs synchronously, so a data source that THROWS rather than
    // rejecting lands in the same branch as a rejection.
    const read = new Promise<unknown>((resolve) => {
      resolve(
        expand.length > 0
          ? dataSource.findOne(targetObject, targetRecord, { $expand: expand })
          : dataSource.findOne(targetObject, targetRecord),
      );
    });
    read.then(
      (record) => {
        if (cancelled) return;
        setAnswer(
          record && typeof record === 'object' && !Array.isArray(record)
            ? { key: targetKey, status: 'readable', record: record as Record<string, unknown> }
            : { key: targetKey, status: 'unreadable' },
        );
      },
      () => {
        // Deliberately not classified: every rejection is drawn as the same
        // cause-free state (see the module header).
        if (!cancelled) setAnswer({ key: targetKey, status: 'unreadable' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [targetObject, targetRecord, targetKey, defReady, expandKey, dataSource, invalidation]);

  const { t } = useObjectTranslation();
  const { objectLabel } = useObjectLabel();
  // The host's record-URL builder (see "The link" in the module header).
  const recordLinks = useRelatedRecordActions();

  if (targetObject === null) {
    return <EmptyValue className={className} data-record-preview="absent" />;
  }

  const current = answer && answer.key === targetKey ? answer : null;
  const loading = defPending || (!!def && !!dataSource?.findOne && current === null);

  if (loading) {
    return (
      <Card
        data-record-preview="loading"
        role="status"
        aria-busy="true"
        className={cn('min-w-0 shadow-none', className)}
      >
        <CardContent className="flex items-center gap-1.5 p-3 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>{t('common.loading', { defaultValue: 'Loading…' })}</span>
        </CardContent>
      </Card>
    );
  }

  if (def && current?.status === 'readable') {
    const row = withoutDeniedFields(current.record, perms, targetObject);
    const title = getRecordDisplayName(def, row);
    const typeLabel = objectLabel({ name: targetObject, label: def.label || targetObject });
    // Asked only here, where the read returned the record (objectui#12557).
    const href =
      targetRecord !== null && recordLinks?.recordHref ? recordLinks.recordHref(targetObject, targetRecord) : null;
    return (
      <Card data-record-preview="readable" className={cn('min-w-0 shadow-none', className)}>
        <CardHeader className="space-y-0.5 p-3">
          <span className="truncate text-xs text-muted-foreground">{typeLabel}</span>
          <CardTitle className="truncate text-sm leading-snug" title={title}>
            {href === null || targetRecord === null ? (
              title
            ) : (
              <a
                href={href}
                className="text-primary underline-offset-4 hover:underline"
                onClick={(e) => {
                  // The details grid's row copies its value on click; following
                  // the record must not also do that.
                  e.stopPropagation();
                  // Modifier and non-primary clicks belong to the browser (new
                  // tab, new window): that is what the real href is for.
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  // No in-app navigator: the anchor navigates on its own.
                  if (!recordLinks?.openRecord) return;
                  e.preventDefault();
                  recordLinks.openRecord(targetObject, targetRecord);
                }}
                onKeyDown={(e) => {
                  // The row's Enter copies and prevents the default, which
                  // would cancel the link's own activation.
                  if (e.key === 'Enter') e.stopPropagation();
                }}
              >
                {title}
              </a>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 empty:hidden">
          <InlineEditProvider canEdit={false}>
            <HeaderHighlight
              // The definition's own label is the fallback the field-label
              // resolver takes when no translation names the field.
              fields={highlightNames.map((name) => ({ name, label: def.fields?.[name]?.label }))}
              data={row}
              objectName={targetObject}
              objectSchema={def}
              className="border-b-0 pb-0"
            />
          </InlineEditProvider>
        </CardContent>
      </Card>
    );
  }

  // `unreadable`: everything that is neither loading nor a returned record.
  // The Approvals Inbox's cause-free sentence (objectui#8631), read from the
  // same key so the two surfaces cannot say different things.
  const unreadableLabel = String(t('approvalsInbox.recordUnresolvable', {
    defaultValue: 'This record cannot be opened',
  }));
  return (
    <Card data-record-preview="unreadable" className={cn('min-w-0 shadow-none', className)}>
      <CardContent className="flex items-center gap-1.5 p-3 text-sm text-muted-foreground" title={unreadableLabel}>
        <Link2Off className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate italic">{unreadableLabel}</span>
      </CardContent>
    </Card>
  );
}
