/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * A field's own `visibleWhen` on the record surfaces of this package — the ONE
 * implementation every surface that draws a record's fields calls: the details
 * body (`record:details`), the header highlights strip (`HeaderHighlight`, for
 * `record:highlights` and `DetailView`'s own strip) and `DetailView`'s body and
 * summary chips (the `detail-view` node and the record drawer).
 *
 * Module-internal: not exported from the package barrel.
 */

import {
  columnIdentity,
  resolveFieldRuleState,
  toPredicateRecord,
  type FieldRulePredicate,
} from '@object-ui/core';

/**
 * The record a field's or a field group's `visibleWhen` is evaluated against —
 * assembled the way the entry form assembles its own (objectui#11630).
 *
 * The form's `ruleRecord` (`@object-ui/components`' form renderer) seeds every
 * declared field to `null` and then overlays the DEFINED values it holds, so a
 * predicate naming a column the read did not return compares against `null`
 * instead of faulting on a missing key. This does the same over the object's
 * declared fields and the bound record.
 *
 * Relations are collapsed back to their stored foreign key first
 * (`toPredicateRecord`): the edit form reads its record without `$expand`, so
 * `record.owner == 'u1'` sees the id there, while a record page's record may
 * arrive expanded. Without the collapse one predicate would reach two verdicts
 * on the same record.
 */
export function assemblePredicateRecord(
  data: Record<string, unknown> | null | undefined,
  objectFields: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (objectFields && typeof objectFields === 'object' && !Array.isArray(objectFields)) {
    for (const name of Object.keys(objectFields)) out[name] = null;
  }
  const row = toPredicateRecord(data ?? {}, objectFields) as Record<string, unknown>;
  for (const key of Object.keys(row)) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return out;
}

/**
 * {@link assemblePredicateRecord}, assembled on first use and then reused — so
 * a surface whose fields declare no predicate does no extra work.
 */
export function lazyPredicateRecord(
  data: Record<string, unknown> | null | undefined,
  objectFields: Record<string, unknown> | undefined,
): () => Record<string, unknown> {
  let record: Record<string, unknown> | undefined;
  return () => (record ??= assemblePredicateRecord(data, objectFields));
}

/**
 * Does a FIELD's own `visibleWhen` (`@objectstack/spec` `Field.visibleWhen`:
 * "field is shown only when TRUE (else hidden)") admit its row on this record?
 *
 * ⭐ The form's judge, called the form's way: `resolveFieldRuleState` from
 * `@object-ui/core`, the call the form renderer makes for a field's
 * `visibleWhen`, so the fault direction is the field rule's
 * (`VISIBLE_WHEN_FAULTED`, ADR-0137 D3): a predicate that cannot be evaluated
 * SHOWS the field and warns once. That is the opposite of a field group's gate
 * (fail-closed, `record:details`' `sectionPredicateVisible`), deliberately —
 * each slot keeps the direction the form gives it. The record is bound as
 * `record` AND as `previous`: an edit form binds `previous` to the persisted
 * row, and the row a record surface shows IS the persisted row.
 *
 * Display only, as on the form: the record API serves the field either way.
 */
export function fieldPredicateVisible(
  visibleWhen: FieldRulePredicate,
  record: Record<string, unknown>,
  scope: Record<string, unknown>,
  where: string,
): boolean {
  return resolveFieldRuleState({ visibleWhen }, record, {}, record, scope, where).visible;
}

/** What {@link dropFieldPredicateHidden} judges a list against. */
export interface FieldPredicateGate {
  /** The OBJECT's field declarations — where a field's `visibleWhen` is read, by name. */
  objectFields: Record<string, unknown> | null | undefined;
  /** The record, as {@link lazyPredicateRecord} hands it: asked only when a predicate is declared. */
  record: () => Record<string, unknown>;
  /** The host predicate scope (`usePredicateScope()`): `current_user`, `features`. */
  scope: Record<string, unknown>;
  /** Names the surface in the one-time fault warning, for the field `name`. */
  where: (name: string) => string;
}

/**
 * Drop every entry whose field's own `visibleWhen` is FALSE for the record —
 * see {@link fieldPredicateVisible}. An entry is a field name, a `{ name }` or
 * a `{ field }` descriptor (`columnIdentity`); the predicate is the OBJECT's
 * declaration of that field, never a key on the entry. An entry whose field
 * declares no predicate, or that names no field, is kept as it is.
 */
export function dropFieldPredicateHidden<T>(list: T[], gate: FieldPredicateGate): T[];
export function dropFieldPredicateHidden<T>(list: T[] | undefined, gate: FieldPredicateGate): T[] | undefined;
export function dropFieldPredicateHidden<T>(list: T[] | undefined, gate: FieldPredicateGate): T[] | undefined {
  if (!list) return list;
  return list.filter((entry) => {
    const name = columnIdentity(entry);
    const declared = name ? (gate.objectFields?.[name] as { visibleWhen?: unknown } | undefined) : undefined;
    const visibleWhen = declared?.visibleWhen;
    if (visibleWhen == null) return true;
    return fieldPredicateVisible(
      visibleWhen as FieldRulePredicate,
      gate.record(),
      gate.scope,
      gate.where(name!),
    );
  });
}
