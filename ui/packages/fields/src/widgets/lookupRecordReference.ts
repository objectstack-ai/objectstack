/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The picker half of `@objectstack/spec`'s `lookupFilters` comparand
 * `{ $record: 'path' }` — a value of the RECORD BEING EDITED, which the picker
 * puts in place of the reference before the candidate query leaves the
 * browser (`LookupFilterRecordReferenceSchema` in `field.zod.ts` states the
 * contract; this module is its one reader).
 *
 * Invariants:
 * - A path is a field of the edited record (`quote_date`) or one lookup hop
 *   from it (`account.cb_market`).
 * - The picker resolves a reference only where its host SAYS a single record
 *   is being edited: a record form stamps that on the field it hands the
 *   widget (`withRecordBeingEdited`). Every other host — a bulk action over
 *   selected rows, an action's parameter dialog, inline edit on a record
 *   page — leaves every `{ $record }` entry out, whatever values it passes the widget: the values
 *   such a host passes are not the record the author's path names.
 * - An entry whose referenced value is empty — null, unset, `''`, an empty
 *   list, a hop whose lookup is unset — is left out of the query, the rule an
 *   unset `dependsOn` parent follows.
 * - A hop whose row cannot be read is left out the same way: the picker
 *   narrows the choice only, and the save is the server's to judge.
 * - ⛔ No `{ $record }` value ever reaches the wire: `lookupFiltersToRecord`
 *   drops one that was never resolved.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { SchemaRendererContext } from '@object-ui/react';
import { referenceTargetOf } from '@objectstack/spec/data';
import type { Field as SpecField, LookupFilterRecordReference } from '@objectstack/spec/data';

/** One authored `lookupFilters` entry, typed by reference to the spec row. */
export type LookupFilterEntry = NonNullable<SpecField['lookupFilters']>[number];

/**
 * The key a record form stamps on a lookup field whose `lookupFilters` read
 * `{ $record }`, the host's statement that a single record is being edited
 * here. Its value names the object each hop's lookup points at
 * (`{ hopObjects: { account: 'account' } }`): a widget receives one field,
 * not the object it is drawn for, so it could not otherwise name the object
 * to read `account`'s row from. The same hand-off shape as
 * `FOLLOWED_PARENT_OBJECT_KEY` (`currency.ts`) and `FORM_OBJECT_KEY`.
 *
 * ⛔ Opt-in: a widget whose field carries no stamp resolves no `{ $record }`.
 */
export const RECORD_BEING_EDITED_KEY = 'recordBeingEdited';

/** What a record form stamps under {@link RECORD_BEING_EDITED_KEY}. */
export interface RecordBeingEdited {
  hopObjects: Readonly<Record<string, string>>;
}

/** One `{ $record }` hop: the lookup on the edited record and the field read on its target. */
export interface RecordReferenceHop {
  via: string;
  field: string;
}

/** Is `value` a `{ $record: path }` comparand? Shape only, as the spec's refinement reads it. */
export function isRecordReference(value: unknown): value is LookupFilterRecordReference {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, '$record');
}

function recordPath(value: unknown): string | undefined {
  if (!isRecordReference(value)) return undefined;
  const path = (value as { $record?: unknown }).$record;
  return typeof path === 'string' && path !== '' ? path : undefined;
}

/** Does any entry read the edited record? */
export function readsRecord(filters: readonly LookupFilterEntry[] | undefined): boolean {
  return !!filters?.some((f) => isRecordReference(f?.value));
}

/** The one-hop paths the entries name, one per distinct `via.field`. */
export function recordReferenceHops(filters: readonly LookupFilterEntry[] | undefined): RecordReferenceHop[] {
  const hops: RecordReferenceHop[] = [];
  const seen = new Set<string>();
  for (const f of filters ?? []) {
    const path = recordPath(f?.value);
    const dot = path ? path.indexOf('.') : -1;
    if (!path || dot < 0 || seen.has(path)) continue;
    seen.add(path);
    hops.push({ via: path.slice(0, dot), field: path.slice(dot + 1) });
  }
  return hops;
}

const isRow = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** Empty by the `dependsOn` gate's own test. */
function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

/** A related record as the query compares it: an expanded row collapses to its id. */
function collapseReference(v: unknown): unknown {
  if (!isRow(v) || v instanceof Date) return v;
  return v.id ?? v._id ?? v;
}

/** The id a record's lookup holds — bare, or under an expanded row. */
function referencedId(v: unknown): string | undefined {
  const id = collapseReference(v);
  if (typeof id === 'string' && id !== '') return id;
  if (typeof id === 'number') return String(id);
  return undefined;
}

/**
 * `def` stamped under {@link RECORD_BEING_EDITED_KEY}: the record form's
 * statement that the widget is drawn for a single record being edited, with
 * the object each `{ $record }` hop's lookup references (read off `fields`,
 * the edited object's field map). `def` itself when its filters read no
 * record. Only a host that edits one record calls this.
 *
 * A hop's object is the spec's `referenceTargetOf` — the one arbiter the
 * `$record` path rule of the object linter also asks — so a hop through a
 * field whose target the type fixes (`user` → `sys_user`, with no
 * `reference` written) is named like one through a `lookup`.
 */
export function withRecordBeingEdited<T extends object>(
  def: T,
  fields: Readonly<Record<string, unknown>> | null | undefined,
): T {
  const filters = (def as { lookupFilters?: LookupFilterEntry[] }).lookupFilters;
  if (!readsRecord(filters)) return def;
  const hopObjects: Record<string, string> = {};
  for (const { via } of recordReferenceHops(filters)) {
    const target = referenceTargetOf(fields?.[via]);
    if (target) hopObjects[via] = target;
  }
  const stamp: RecordBeingEdited = { hopObjects };
  return { ...def, [RECORD_BEING_EDITED_KEY]: stamp };
}

/** The record-being-edited stamp a form put on `field`, or `undefined` when none did. */
export function readRecordBeingEdited(field: unknown): RecordBeingEdited | undefined {
  const value = (field as Record<string, unknown> | null | undefined)?.[RECORD_BEING_EDITED_KEY];
  if (!isRow(value)) return undefined;
  const hopObjects = isRow(value.hopObjects) ? (value.hopObjects as Record<string, string>) : {};
  return { hopObjects };
}

/**
 * The value a `{ $record }` path names, or `undefined` when it is empty or
 * cannot be read. `hopRows` holds the rows read for each hop's lookup, by
 * `via`; an expanded row on the record itself is read first, so a host that
 * already holds the related record costs no request.
 */
function readRecordPath(
  path: string,
  record: Readonly<Record<string, unknown>>,
  hopRows: Readonly<Record<string, Record<string, unknown> | undefined>>,
): unknown {
  const dot = path.indexOf('.');
  if (dot < 0) {
    const v = collapseReference(record[path]);
    return isEmptyValue(v) ? undefined : v;
  }
  const via = path.slice(0, dot);
  const field = path.slice(dot + 1);
  const held = record[via];
  if (isEmptyValue(held)) return undefined;
  const row = isRow(held) && Object.prototype.hasOwnProperty.call(held, field) ? held : hopRows[via];
  if (!row) return undefined;
  const v = collapseReference(row[field]);
  return isEmptyValue(v) ? undefined : v;
}

/**
 * `filters` with every `{ $record }` value replaced by the value it names on
 * `record`, and every entry whose value is empty or unreadable left out.
 * Literal entries pass through untouched, in order.
 */
export function resolveLookupFilters(
  filters: readonly LookupFilterEntry[],
  record: Readonly<Record<string, unknown>>,
  hopRows: Readonly<Record<string, Record<string, unknown> | undefined>> = {},
): LookupFilterEntry[] {
  const out: LookupFilterEntry[] = [];
  for (const f of filters) {
    if (!isRecordReference(f.value)) {
      out.push(f);
      continue;
    }
    const path = recordPath(f.value);
    const value = path ? readRecordPath(path, record, hopRows) : undefined;
    if (value !== undefined) out.push({ ...f, value });
  }
  return out;
}

const warnedHops = new Set<string>();

/**
 * Said once per hop: the entry is left out, so the picker offers more than the
 * author wrote — visible here rather than only as a wider list.
 */
function warnUnreadableHop(via: string, field: string, object: string | undefined): void {
  if ((globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV === 'production') return;
  const key = `${via}.${field}`;
  if (warnedHops.has(key)) return;
  warnedHops.add(key);
  console.warn(
    `[LookupField] lookupFilters { $record: "${key}" } is left out of the candidate query: `
      + (object
        ? `no data source here can read ${object} rows.`
        : `the record holds "${via}" as an id, and this host did not name the object it points at `
          + `(a record form stamps it with withRecordBeingEdited).`),
  );
}

interface HopSource {
  findOne?: (resource: string, id: string, params?: Record<string, unknown>) => Promise<unknown>;
}

/** One hop read the record currently calls for: the row of `object` with id `id`. */
interface HopRead {
  via: string;
  object: string;
  id: string;
  fields: string[];
  key: string;
}

/**
 * Read the rows the `{ $record }` hops of `filters` need, once per lookup id:
 * the target's hop fields alone. A hop the record already holds expanded, an
 * unset lookup, and a hop whose object no form stamped are not read.
 *
 * `pending` is true while a read the record calls for has not landed, so the
 * caller holds its candidate query and sends it once, with the value in it.
 */
export function useRecordHopRows(
  filters: readonly LookupFilterEntry[] | undefined,
  record: Readonly<Record<string, unknown>>,
  hopObjects: Readonly<Record<string, string>> | undefined,
  dataSource: unknown,
): { rows: Readonly<Record<string, Record<string, unknown> | undefined>>; pending: boolean } {
  const ctx = useContext(SchemaRendererContext);
  const source = (dataSource ?? ctx?.dataSource) as HopSource | null | undefined;
  const canRead = typeof source?.findOne === 'function';

  const reads: HopRead[] = [];
  const byVia = new Map<string, HopRead>();
  for (const { via, field } of recordReferenceHops(filters)) {
    const held = record[via];
    if (isRow(held) && Object.prototype.hasOwnProperty.call(held, field)) continue;
    const object = hopObjects?.[via];
    const id = referencedId(held);
    if (id !== undefined && (!object || !canRead)) warnUnreadableHop(via, field, object);
    if (!object || id === undefined || !canRead) continue;
    const existing = byVia.get(via);
    if (existing) {
      existing.fields.push(field);
      continue;
    }
    const read: HopRead = { via, object, id, fields: [field], key: '' };
    byVia.set(via, read);
    reads.push(read);
  }
  for (const read of reads) read.key = `${read.object}\u0000${read.id}\u0000${read.fields.join(',')}`;
  // The reads as one primitive: the effect below keys on it, never on an array identity.
  const readsKey = reads.map((r) => `${r.via}\u0001${r.key}`).join('\u0002');

  // Answers are keyed by object, id and fields, so one that lands after the
  // record moved on is kept for that key and never read for another.
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown> | null>>({});
  const requested = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!readsKey || !source?.findOne) return;
    for (const entry of readsKey.split('\u0002')) {
      const [, key] = entry.split('\u0001');
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      const [object, id, fields] = key.split('\u0000');
      const settle = (row: Record<string, unknown> | null) => {
        if (mounted.current) setAnswers((a) => ({ ...a, [key]: row }));
      };
      source.findOne(object, id, { $select: ['id', ...fields.split(',')] }).then(
        (row) => settle(isRow(row) ? row : null),
        () => settle(null),
      );
    }
  }, [readsKey, source]);

  const rows: Record<string, Record<string, unknown> | undefined> = {};
  let pending = false;
  for (const read of reads) {
    if (!(read.key in answers)) {
      pending = true;
      continue;
    }
    rows[read.via] = answers[read.key] ?? undefined;
  }
  const rowsKey = JSON.stringify(rows);
  // Stable across renders that read the same rows (AGENTS.md #10: keyed on the payload).
  const stableRows = useMemo(() => JSON.parse(rowsKey) as typeof rows, [rowsKey]);
  return { rows: stableRows, pending };
}
