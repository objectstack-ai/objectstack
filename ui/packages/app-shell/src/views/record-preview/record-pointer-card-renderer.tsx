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
 */

import { Card, CardContent } from '@object-ui/components';
import { registerFieldRenderer, RECORD_POINTER_CARD_TYPE, type CellRendererProps, type RecordPointer } from '@object-ui/fields';
import { useAdapter } from '@object-ui/react';
import { Trash2 } from 'lucide-react';
import { RecordPreviewCard } from './RecordPreviewCard.js';

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
  const pointer = asRecordPointer(value);
  if (pointer?.deletedLabel !== undefined) return <DeletedRecordPointer label={pointer.deletedLabel} />;
  return (
    <RecordPreviewCard
      objectName={pointer?.objectName}
      recordId={pointer?.recordId}
      dataSource={dataSource}
      className="w-full max-w-md"
    />
  );
}

registerFieldRenderer(RECORD_POINTER_CARD_TYPE, RecordPointerCardRenderer);
