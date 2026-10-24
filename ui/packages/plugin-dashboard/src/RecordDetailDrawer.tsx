/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * RecordDetailDrawer — the drill-to-record surface for dashboard table / list
 * widgets.
 *
 * When a row in a table / list widget is clicked (and drill-down is enabled),
 * this opens a side drawer (or dialog) showing that single record's fields,
 * read-only. It mirrors Salesforce's list-view row → record preview and Power
 * BI's "see records" row drill: the row already *is* a record, so there is no
 * filter to derive — we just present the record we already fetched.
 *
 * The record object is supplied directly by the table (it was fetched with all
 * columns), so the drawer renders without an additional round-trip. Field
 * labels and value formatting come from the shared {@link recordFields} helpers
 * so a value reads identically in the table cell and in this drawer.
 */

import React, { useMemo } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  EmptyValue,
} from '@object-ui/components';
import { useSafeFieldLabel, useLocalization, useDisplayLocale } from '@object-ui/i18n';
import { MaskedCellRenderer } from '@object-ui/fields';
import {
  indexObjectFields,
  buildFieldMeta,
  renderFieldValue,
  isSystemField,
  isNumericFieldMeta,
} from './recordFields';
import { humanizeFieldKey } from './utils';

/**
 * Props of the dashboard's read-only drill drawer.
 *
 * Named `DashboardRecordDetailDrawerProps`, not `RecordDetailDrawerProps`:
 * `@object-ui/plugin-detail` publishes `RecordDetailDrawerProps` for its own
 * record drawer, a different component. That drawer is editable, deletes, and
 * resizes, and it takes an `open` flag, a `recordId` and a `dataSource`. This
 * one only shows a record the table already fetched. Neither package depends
 * on the other, so the two could not share one declaration, and the narrower
 * drawer has the specific name (objectui#6349, batch 8).
 */
export interface DashboardRecordDetailDrawerProps {
  /** The record to display, or `null` when nothing is selected. */
  record: Record<string, any> | null;
  /** Object the record belongs to (drives label translation + field meta). */
  objectName?: string;
  /** Object schema (field metadata) for labels / formatting. Optional. */
  objectSchema?: any;
  /**
   * Optional whitelist of field accessors to show (e.g. `drillDown.columns`).
   * When omitted, all non-system fields are shown in schema declaration order
   * (falling back to the record's own keys when no schema is available).
   */
  fields?: string[];
  /** Explicit drawer/dialog title; defaults to the record's display name. */
  title?: string;
  /** Where to open. Defaults to `'drawer'` (right-side Sheet). */
  target?: 'drawer' | 'dialog';
  /** Called when the drawer requests to close. */
  onClose: () => void;
  /**
   * Are the object's field types still unknown (objectui#10657)? The owning
   * table's reading: its definition is in flight, or its read failed. A value
   * is drawn from its field type, so with none in hand every value here is
   * drawn WITHHELD, as the mask — a `password` / `secret` field would
   * otherwise be printed as text — exactly as the table's own cells are.
   */
  objectTypesPending?: boolean;
}

/** Candidate fields, in priority order, used to title the drawer. */
const NAME_FIELDS = ['name', 'title', 'label', 'subject', 'display_name', 'full_name'];

function resolveRecordTitle(record: Record<string, any>, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit;
  for (const f of NAME_FIELDS) {
    const v = record[f];
    if (typeof v === 'string' && v.trim()) return v;
  }
  // Last resort: a record id keeps the drawer from being titled "Record".
  const id = record.id ?? record._id;
  return id != null ? String(id) : 'Record';
}

export const RecordDetailDrawer: React.FC<DashboardRecordDetailDrawerProps> = ({
  record,
  objectName,
  objectSchema,
  fields,
  title,
  target = 'drawer',
  onClose,
  objectTypesPending = false,
}) => {
  const { fieldLabel, fieldOptionLabel } = useSafeFieldLabel();
  const { currency: tenantCurrency } = useLocalization();
  // objectui#4553: see ObjectDataTable — formatted in the memo, so it is a dep.
  const displayLocale = useDisplayLocale();

  const rows = useMemo(() => {
    if (!record) return [];
    const fieldsByName = indexObjectFields(objectSchema);

    // Which fields, in which order: explicit whitelist → schema declaration
    // order → record's own keys. System / audit fields are hidden unless the
    // author explicitly listed them.
    let keys: string[];
    if (fields && fields.length > 0) {
      keys = fields;
    } else if (Object.keys(fieldsByName).length > 0) {
      keys = Object.keys(fieldsByName).filter((k) => !isSystemField(k, fieldsByName[k]));
    } else {
      keys = Object.keys(record).filter((k) => !k.startsWith('_') && !isSystemField(k));
    }

    return keys.map((key) => {
      const def = fieldsByName[key];
      // Same shape as `ObjectDataTable`'s `buildHeader` half, function for
      // function: `humanizeFieldKey` derives the fallback and the i18n wrapper
      // (bundle entry wins, this is only its fallback) and the `objectName`
      // guard are unchanged. This line used to carry a FOURTH inline spelling
      // that upper-cased only the first word, so one key rendered as
      // `Close Date` in the column the user clicked and `Close date` in the
      // field this drawer opened — one key, two spellings, one uninterrupted
      // interaction (objectui#9055; the class `56f4e34c0` ruled out).
      //
      // The KEY prefixer stays distinct from `humanizeLabel`, the VALUE
      // prefixer in `@object-ui/core` — see `utils/humanize-label.ts`, whose
      // docblock gives the per-input difference table and rules that
      // converging the two "is a decision, not a refactor … it needs its own
      // card". This card adopts the KEY convention; it does not merge them.
      const humanized = humanizeFieldKey(key);
      const label = objectName ? fieldLabel(objectName, key, humanized) : humanized;
      const fieldMeta = buildFieldMeta({ accessorKey: key, label, def, objectName, fieldOptionLabel });
      return {
        key,
        label,
        // Withheld while the field types are unknown (objectui#10657): the
        // mask, never the value, and so for good after a failed read.
        node: objectTypesPending
          ? <MaskedCellRenderer value={record[key]} />
          : renderFieldValue(record[key], fieldMeta, tenantCurrency, displayLocale),
        numeric: !objectTypesPending && isNumericFieldMeta(fieldMeta),
      };
    });
  }, [record, objectSchema, objectName, fields, fieldLabel, fieldOptionLabel, tenantCurrency, displayLocale, objectTypesPending]);

  if (!record) return null;

  const heading = resolveRecordTitle(record, title);

  const body = (
    <dl className="divide-y divide-border/60" data-testid="record-detail-body">
      {rows.map((row) => (
        <div key={row.key} className="grid grid-cols-3 gap-3 py-2.5">
          <dt className="text-xs font-medium text-muted-foreground self-center">{row.label}</dt>
          <dd className={`col-span-2 text-sm break-words ${row.numeric ? 'tabular-nums' : ''}`}>
            {row.node === '' || row.node == null
              ? <EmptyValue />
              : row.node}
          </dd>
        </div>
      ))}
    </dl>
  );

  if (target === 'dialog') {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{heading}</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] overflow-auto">{body}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg flex flex-col">
        <SheetHeader><SheetTitle>{heading}</SheetTitle></SheetHeader>
        <div className="flex-1 overflow-auto mt-2 pr-1">{body}</div>
      </SheetContent>
    </Sheet>
  );
};
