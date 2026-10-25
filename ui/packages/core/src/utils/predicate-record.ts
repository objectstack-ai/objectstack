/**
 * ObjectUI — predicate record normalization
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Bind a fetched record into an expression scope the way the SERVER binds it —
 * a relation field is its stored foreign key, never the record it points at.
 *
 * ## Why a normalization step exists at all
 *
 * A `lookup` / `master_detail` / `user` / `tree` field stores an id. That is
 * what the server's CEL engine sees in a validation rule, a sharing predicate
 * or a flow condition, and it is what an author writes:
 *
 * ```
 * visible: 'record.owner == os.user.id'
 * ```
 *
 * The client does not necessarily see that. `$expand` (the `populate=` wire
 * param) **replaces the id in place** with the whole related record, so the same
 * field arrives as `'P1'` or as `{ id: 'P1', name: 'Website' }` depending on
 * whether the surface happened to expand it — and views expand exactly the
 * relations they show as COLUMNS (`buildExpandFields`), which is a display
 * decision no predicate author participates in. Measured against a live
 * runtime, one predicate over one field therefore has four different fates:
 *
 * | value in the payload            | `record.owner == "P1"` | `record.owner.id == "P1"` |
 * |---------------------------------|------------------------|---------------------------|
 * | `'P1'` (not expanded)           | **true**               | fault                     |
 * | `{ id: 'P1', … }` (expanded)    | **false**              | true                      |
 * | `null` (empty lookup)           | false                  | fault                     |
 * | absent (outside `$select`)      | fault                  | fault                     |
 *
 * No spelling is right everywhere, and neither failure announces itself: a
 * fault is fail-CLOSED on the row kebab / selection bar (button silently gone)
 * and fail-OPEN on the lenient paths (button shown to everyone). That is the
 * whole of "lookup fields cannot be used in expressions" — the author is not
 * writing the predicate wrong, the operand means two things.
 *
 * Collapsing the expanded form back to its id is what makes the first column
 * of that table the only one: `record.owner` is the id on every surface and on
 * the server, so a predicate authored once reaches one verdict everywhere.
 *
 * ## Why it is schema-driven and not a shape sniff
 *
 * "An object carrying an `id` key" would also catch a genuine `json` field
 * whose payload happens to have one, and silently change what
 * `record.config.id` means. The object's own field types are the authority:
 * only a field DECLARED relational (see `EXPANDABLE_FIELD_TYPES` — the same set
 * that decides what gets expanded in the first place) is collapsed, so the two
 * halves cannot disagree about which fields are relations.
 */

import { EXPANDABLE_FIELD_TYPES } from './expand-fields.js';

/** The two field-container shapes the metadata API serves. */
export type FieldContainerLike =
  | Record<string, { type?: unknown } | unknown>
  | readonly { name?: unknown; type?: unknown }[]
  | null
  | undefined;

/** Names of the fields this object declares as relations (`lookup` / …). */
function relationFieldNames(fields: FieldContainerLike): Set<string> | null {
  if (!fields || typeof fields !== 'object') return null;
  const out = new Set<string>();
  if (Array.isArray(fields)) {
    for (const def of fields) {
      const name = (def as { name?: unknown })?.name;
      const type = (def as { type?: unknown })?.type;
      if (typeof name === 'string' && EXPANDABLE_FIELD_TYPES.has(type as string)) out.add(name);
    }
  } else {
    for (const [name, def] of Object.entries(fields as Record<string, unknown>)) {
      const type = (def as { type?: unknown })?.type;
      if (EXPANDABLE_FIELD_TYPES.has(type as string)) out.add(name);
    }
  }
  return out.size > 0 ? out : null;
}

/** The id an expanded related record is stored under, or `undefined`. */
function expandedId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  const id = rec.id ?? rec._id;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

/**
 * Collapse `record`'s expanded relation values back to the ids they stand for.
 *
 * Returns the input BY REFERENCE when there is nothing to collapse — the common
 * case (no schema, no relations, nothing expanded) allocates nothing and keeps
 * the identity downstream `useMemo` deps rely on.
 *
 * `multiple: true` relations store an ARRAY of ids and expand element-wise, so
 * an array is mapped element-wise too; a member that is not an expanded record
 * (already an id) is left alone.
 *
 * @param record  A fetched row / detail record, as the payload delivered it.
 * @param fields  The object's field definitions (`objectSchema.fields`), in
 *                either served shape. Without them nothing is collapsed —
 *                a caller that cannot name the relations must not guess.
 */
export function toPredicateRecord<T extends Record<string, unknown>>(
  record: T,
  fields: FieldContainerLike,
): T;
export function toPredicateRecord<T extends Record<string, unknown>>(
  record: T | null | undefined,
  fields: FieldContainerLike,
): T | null | undefined;
// Two overloads rather than one `: T`: a null/undefined record is passed
// STRAIGHT THROUGH (a caller with no record loaded yet must be able to tell
// that from an empty one — `page:header` binds the result into an eval scope
// where `{}` and `undefined` are different answers). Declaring the return as
// plain `T` would have been a lie the `as T` cast hid.
export function toPredicateRecord<T extends Record<string, unknown>>(
  record: T | null | undefined,
  fields: FieldContainerLike,
): T | null | undefined {
  if (!record || typeof record !== 'object') return record;
  const relations = relationFieldNames(fields);
  if (!relations) return record;

  let out: Record<string, unknown> | null = null;
  const write = (key: string, value: unknown) => {
    if (!out) out = { ...record };
    out[key] = value;
  };

  for (const name of relations) {
    if (!(name in record)) continue;
    const value = (record as Record<string, unknown>)[name];
    if (Array.isArray(value)) {
      // Only rebuild the array when at least one member was expanded.
      if (!value.some(v => expandedId(v) !== undefined)) continue;
      write(name, value.map(v => expandedId(v) ?? v));
      continue;
    }
    const id = expandedId(value);
    if (id !== undefined) write(name, id);
  }

  return (out ?? record) as T;
}
