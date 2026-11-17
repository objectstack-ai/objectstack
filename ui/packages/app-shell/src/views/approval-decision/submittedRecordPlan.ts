/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Which fields of a submitted record the request page draws, in which
 * section, and which of them changed after submission (objectstack#34588).
 * Pure: the reader's field permissions are applied to both rows before they
 * get here. The rules are in `SubmittedRecord.tsx`'s header.
 */

import { FILE_REFERENCE_TYPES } from '@objectstack/spec/data';
import { isSystemManagedField } from '@object-ui/types';

/** One field's declaration as the object definition serves it. */
export type FieldDef = Readonly<Record<string, unknown>>;

/** An object's declared fields, keyed by field name. */
export type FieldDefs = Readonly<Record<string, FieldDef | undefined>>;

/**
 * One section of the object's default record page, already resolved: its
 * heading (absent for the untitled primary section), its column count when
 * the derivation names one, and its member field names in page order.
 */
export interface SubmittedSectionInput {
  key: string;
  label?: string;
  /** The field group's declared icon (`fieldGroups[].icon`), drawn beside the heading. */
  icon?: string;
  columns?: number;
  fields: readonly string[];
}

/** One drawn field: the submitted value and, when it changed, the current one. */
export interface SubmittedField {
  key: string;
  /** The value as submitted (`undefined` when the snapshot holds no such key). */
  value: unknown;
  /** True only when the current row was read, holds the key, and differs. */
  changed: boolean;
  /** The current value; read only when `changed`. */
  current: unknown;
}

export interface SubmittedSection {
  key: string;
  label?: string;
  icon?: string;
  columns?: number;
  fields: SubmittedField[];
}

export interface SubmittedRecordPlan {
  sections: SubmittedSection[];
  /**
   * The attachment fields (`FILE_REFERENCE_TYPES`) that hold a file in the
   * snapshot or in the current row, in page order. Drawn in the page's
   * attachments card, not in the field grid.
   */
  attachments: SubmittedField[];
  /** How many drawn fields (attachments included) changed after submission. */
  changedCount: number;
}

/** Field types whose values are numbers, compared as numbers. */
const NUMERIC_TYPES: ReadonlySet<string> = new Set([
  'number', 'currency', 'percent', 'rating', 'slider', 'autonumber', 'summary', 'formula',
]);

/** Field types whose values are instants or days, compared as instants. */
const TEMPORAL_TYPES: ReadonlySet<string> = new Set(['date', 'datetime', 'time']);

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Keys sorted at every depth, so two equal objects serialize alike. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * One value's comparable form. A reference is compared by the record it
 * names, whether it is stored as an id or served expanded (`{ id, … }`); a
 * number by its numeric value; a date by its instant; a list as a set of its
 * members' forms; empty (absent, null, blank, an empty list) as one value.
 */
function comparable(def: FieldDef | undefined, value: unknown): string | null {
  if (isEmpty(value)) return null;
  if (Array.isArray(value)) {
    const members = value
      .map((member) => comparable(def, member))
      .filter((m): m is string => m !== null)
      .sort();
    return members.length === 0 ? null : `[${members.join(',')}]`;
  }
  if (typeof value === 'object') {
    const ref = (value as { id?: unknown; _id?: unknown }).id ?? (value as { _id?: unknown })._id;
    if (typeof ref === 'string' || typeof ref === 'number') return `ref:${ref}`;
    return `obj:${stableStringify(value)}`;
  }
  const type = typeof def?.type === 'string' ? def.type : '';
  if (TEMPORAL_TYPES.has(type) && typeof value === 'string') {
    const at = Date.parse(value);
    if (Number.isFinite(at)) return `t:${at}`;
  }
  if (typeof value === 'number' || (NUMERIC_TYPES.has(type) && typeof value === 'string')) {
    const n = Number(value);
    if (Number.isFinite(n)) return `n:${n}`;
  }
  // A bare id or name compares with its expanded form's id above.
  return typeof value === 'string' ? `ref:${value}` : `v:${String(value)}`;
}

/** Whether a field's current value differs from its submitted one. */
export function valuesDiffer(def: FieldDef | undefined, submitted: unknown, current: unknown): boolean {
  return comparable(def, submitted) !== comparable(def, current);
}

function isAttachmentField(def: FieldDef): boolean {
  return typeof def.type === 'string' && FILE_REFERENCE_TYPES.has(def.type);
}

/**
 * The plan for one submitted record.
 *
 * - `snapshot` is the request's `payload`, already narrowed for the reader by
 *   the service and by the reader's field permissions.
 * - `current` is the record as it reads now, narrowed the same way, or null
 *   when it was not read (no data source, refused, gone, still loading): then
 *   nothing is marked changed and only the snapshot's keys are drawn.
 */
export function planSubmittedRecord(
  sections: readonly SubmittedSectionInput[],
  fields: FieldDefs,
  snapshot: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>> | null,
): SubmittedRecordPlan {
  const seen = new Set<string>();
  const attachments: SubmittedField[] = [];
  let changedCount = 0;

  const fieldOf = (key: string): SubmittedField | null => {
    if (seen.has(key)) return null; // one field, one place
    const def = fields[key];
    if (!def || typeof def !== 'object') return null; // not a field of this object
    if (def.hidden === true) return null; // hidden from the default UI
    if (isSystemManagedField(key, def as { system?: boolean })) return null; // bookkeeping
    const inSnapshot = Object.prototype.hasOwnProperty.call(snapshot, key);
    const inCurrent = current !== null && Object.prototype.hasOwnProperty.call(current, key);
    // Neither answer serves the key to this reader: nothing to draw.
    if (!inSnapshot && !inCurrent) return null;
    seen.add(key);
    const value = inSnapshot ? snapshot[key] : undefined;
    const changed = inCurrent && valuesDiffer(def, value, current![key]);
    if (changed) changedCount += 1;
    return { key, value, changed, current: changed ? current![key] : undefined };
  };

  const planned: SubmittedSection[] = [];
  for (const section of sections) {
    const drawn: SubmittedField[] = [];
    for (const key of section.fields) {
      const field = fieldOf(key);
      if (!field) continue;
      if (isAttachmentField(fields[key]!)) {
        if (!isEmpty(field.value) || field.changed) attachments.push(field);
        continue;
      }
      drawn.push(field);
    }
    if (drawn.length > 0) {
      planned.push({
        key: section.key,
        ...(section.label ? { label: section.label } : {}),
        ...(section.icon ? { icon: section.icon } : {}),
        ...(section.columns ? { columns: section.columns } : {}),
        fields: drawn,
      });
    }
  }
  return { sections: planned, attachments, changedCount };
}

/**
 * Two rows never share a label: every row whose label is shared names its
 * field key as well, and if a qualified label still matches another row's
 * plain label, every row is qualified. Field keys are unique, so the result is.
 */
export function distinctLabels(rows: ReadonlyArray<{ key: string; label: string }>): string[] {
  const qualify = (pick: (r: { key: string; label: string }) => boolean) =>
    rows.map((r) => (pick(r) ? `${r.label} (${r.key})` : r.label));
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.label, (count.get(r.label) ?? 0) + 1);
  const once = qualify((r) => (count.get(r.label) ?? 0) > 1);
  return new Set(once).size === once.length ? once : qualify(() => true);
}
