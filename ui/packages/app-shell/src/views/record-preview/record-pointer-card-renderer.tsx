/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record details grid's face for a `referenceVia` pointer pair
 * (objectui#12045, B1 of objectui#2763): `RecordPreviewCard` (A2), registered
 * under `@object-ui/fields`' `RECORD_POINTER_CARD_TYPE`.
 *
 * `@object-ui/fields` owns the rule (`resolveRecordPointer`) and the key, and
 * keeps a default under it that draws the record id as text. `fields` cannot
 * import this package, so the card is registered from here, through the
 * published `registerFieldRenderer`, and imported for its side effect from the
 * package entry (`src/index.ts`). A field that declares `referenceVia` then
 * draws the record it points at wherever the details grid shows it:
 * `sys_approval_request.record_id`, both pairs on `sys_activity`, and the other
 * pointer fields the spec declares, with no page node and no authorable key.
 *
 * The card reads the target through the console's adapter, the same instance
 * every other record read on the page goes through. It says nothing about why
 * a target cannot be read; see the card's own header for why that matters.
 *
 * ## The tombstone: this renderer is the caller the card defers to (objectui#12489)
 *
 * The card's header leaves "a deletion the platform asserts" to its caller.
 * This renderer is that caller. When the pair arrives with `deletedLabel`
 * (the field's `referenceDeletedWhen` predicate held on this row, decided by
 * `resolveRecordPointer`), it draws the tombstone in that label and does not
 * mount the card: no read of the target, no link. The text is the declared
 * option's own label, as the details grid's options spell it; this package
 * authors no string for it. Every other pair draws the card exactly as before.
 *
 * ## The link: the record's own app when the page cannot route to it (objectstack#32667)
 *
 * The card links its title through the host's record-URL builder. On a record
 * page that is the page's bridge, which routes only to the objects its route
 * scope holds; a pointer names a record of ANY object, chosen per row, so the
 * scope of the page that holds it (an approval request's: the request and its
 * timeline) need not hold the target, and the bridge answers no href. The card
 * then drew its title as plain text: an approval request's record could not be
 * opened from it.
 *
 * So this renderer is also the caller that completes the link. Under a router,
 * it hands the card the host's builder unchanged for every target the host can
 * route to, and for the pointer's own target where the host answers none, the
 * record's route under the app that owns it (`useObjectHostAppSegment`: the
 * page's app when it lists the object, else the first app that does, else
 * Setup, else the page's app). The card still asks only in its `readable`
 * state, so a target the reader cannot read still yields no link.
 */

import { useMemo, type ReactNode } from 'react';
import { useHref, useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent } from '@object-ui/components';
import { registerFieldRenderer, RECORD_POINTER_CARD_TYPE, type CellRendererProps, type RecordPointer } from '@object-ui/fields';
import {
  RelatedRecordActionsProvider,
  useAdapter,
  useRelatedRecordActions,
  type RelatedRecordActionsValue,
} from '@object-ui/react';
import { Trash2 } from 'lucide-react';
import { RecordPreviewCard } from './RecordPreviewCard.js';
import { documentHref } from '../documentHref.js';
import { useObjectHostAppSegment } from '../../utils/objectHostApp.js';

/** The pair `resolveRecordPointer` hands the renderer as its `value`. */
function asRecordPointer(value: unknown): RecordPointer | null {
  if (value == null || typeof value !== 'object') return null;
  const { objectName, recordId, deletedLabel } = value as Partial<RecordPointer>;
  if (typeof objectName !== 'string' || typeof recordId !== 'string') return null;
  return typeof deletedLabel === 'string' ? { objectName, recordId, deletedLabel } : { objectName, recordId };
}

/**
 * The tombstone for a target the platform asserted deleted: the declared
 * option's label, beside a wastebasket, in the card's frame. It reads nothing
 * and links nothing, and it does not show the record id.
 */
function DeletedRecordPointer({ label }: { label: string }) {
  return (
    <Card data-record-pointer="deleted" className="w-full max-w-md min-w-0 shadow-none">
      <CardContent className="flex items-center gap-1.5 p-3 text-sm text-muted-foreground" title={label}>
        <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate italic">{label}</span>
      </CardContent>
    </Card>
  );
}

/**
 * Draws the record a pointer pair names as `RecordPreviewCard`, or the
 * tombstone when the pair says the platform deleted the target. A value that
 * is not a pair addresses nothing, and the card draws its `absent` state for it.
 */
export function RecordPointerCardRenderer({ value }: CellRendererProps) {
  const dataSource = useAdapter();
  const inRouter = useInRouterContext();
  const pointer = asRecordPointer(value);
  if (pointer?.deletedLabel !== undefined) return <DeletedRecordPointer label={pointer.deletedLabel} />;
  const card = (
    <RecordPreviewCard
      objectName={pointer?.objectName}
      recordId={pointer?.recordId}
      dataSource={dataSource}
      className="w-full max-w-md"
    />
  );
  if (!inRouter || !pointer) return card;
  return <OwnerAppRecordLinks objectName={pointer.objectName}>{card}</OwnerAppRecordLinks>;
}

/** A host value with no handlers of its own, for a card drawn under no host. */
const NO_HOST_HANDLERS: RelatedRecordActionsValue['resolve'] = () => ({});

/**
 * The host's record-URL builder, completed for the pointer's target: the
 * host's answer wherever it has one, and otherwise, for `objectName` alone, the
 * record route under the app that owns it (see "The link" above).
 */
function OwnerAppRecordLinks({ objectName, children }: { objectName: string; children: ReactNode }) {
  const host = useRelatedRecordActions();
  const owner = useObjectHostAppSegment(objectName);
  const { appName } = useParams<{ appName?: string }>();
  const segment = owner ?? appName;
  const navigate = useNavigate();
  const rootHref = useHref('/');

  const value = useMemo<RelatedRecordActionsValue>(() => {
    const hostHref = (target: string, recordId: string | number): string | null =>
      host?.recordHref ? host.recordHref(target, recordId) : null;
    const ownerPath = (target: string, recordId: string | number): string | null =>
      target === objectName && segment
        ? `/apps/${segment}/${target}/record/${encodeURIComponent(String(recordId))}`
        : null;
    return {
      ...host,
      resolve: host?.resolve ?? NO_HOST_HANDLERS,
      recordHref: (target, recordId) => {
        const href = hostHref(target, recordId);
        if (href !== null) return href;
        const path = ownerPath(target, recordId);
        return path === null ? null : documentHref(rootHref, path);
      },
      openRecord: (target, recordId) => {
        const href = hostHref(target, recordId);
        if (href !== null) {
          // A host with no in-app navigator: follow its href, as its anchor would.
          if (host?.openRecord) host.openRecord(target, recordId);
          else window.location.assign(href);
          return;
        }
        const path = ownerPath(target, recordId);
        if (path !== null) navigate(path);
      },
    };
  }, [host, objectName, segment, rootHref, navigate]);

  return <RelatedRecordActionsProvider value={value}>{children}</RelatedRecordActionsProvider>;
}

registerFieldRenderer(RECORD_POINTER_CARD_TYPE, RecordPointerCardRenderer);
