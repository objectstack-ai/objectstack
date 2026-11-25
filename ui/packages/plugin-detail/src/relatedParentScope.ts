/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isMultiValueRelationship, parentRelationshipFieldDef, type FieldContainerLike } from '@object-ui/core';

/** A parent's value a child's `dependsOn` field is compared with. */
export type DependsOnValue = string | number | boolean;

/**
 * A relationship lookup's `dependsOn`, read from the parent's side: each
 * child `field` with the parent's `param` value. `[]` when the lookup declares
 * none, `undefined` when an entry cannot be resolved (malformed, or the
 * parent's value is empty or not read).
 *
 * `dependsOn` scopes the lookup's candidates by equality — a `{ field, param }`
 * entry (a bare string names both) sends the child's `field` value as the
 * parent object's `param` (`LookupField`'s `dependentFilter`). Reversed, a
 * child names this parent only when its `field` equals the parent's `param`.
 * The related tab reads the pairs twice: as the derived picker's scope
 * (`parentScopeOf` in `RelatedList`, objectstack#36707) and as the values a
 * child created there opens with (`relatedCreateSeedOf`, objectstack#37246).
 */
export function dependsOnFromParent(
  dependsOn: unknown,
  parentRecord: Record<string, unknown> | undefined,
): Array<[string, DependsOnValue]> | undefined {
  if (!Array.isArray(dependsOn) || dependsOn.length === 0) return [];
  const pairs: Array<[string, DependsOnValue]> = [];
  for (const entry of dependsOn) {
    const field = typeof entry === 'string' ? entry : (entry as { field?: unknown } | null)?.field;
    const param = typeof entry === 'string' ? entry : ((entry as { param?: unknown }).param ?? field);
    if (typeof field !== 'string' || field === '' || typeof param !== 'string' || param === '') return undefined;
    const value = referenceValueOf(parentRecord?.[param]);
    if (value === undefined) return undefined;
    pairs.push([field, value]);
  }
  return pairs;
}

/**
 * The values a child created under this parent opens with beside the link
 * itself (objectstack#37246): each `dependsOn` field of the relationship
 * lookup takes the parent's value. A create form that opened with the parent
 * alone drew its lookup gated (「Select Account first」), or emptied it the
 * moment its `lookupAutofill` filled the field it depends on, and saved the
 * child unlinked. Seeded, the parent is a candidate the lookup lists, and
 * nothing moves under it.
 *
 * `{}` when there is nothing to seed: no such relationship, a multi-valued
 * one, no `dependsOn`, or a `dependsOn` value the parent does not answer (no
 * child could name it from there: the picker's rule). Only text values are
 * seeded: the console carries them in the URL (`formLink`), where a value of
 * any other type would arrive as text.
 */
export function relatedCreateSeedOf(
  childFields: unknown,
  referenceField: string | undefined,
  parentRecord: Record<string, unknown> | undefined,
): Record<string, string> {
  const fields = childFields as FieldContainerLike;
  const rel = parentRelationshipFieldDef(fields, referenceField) as { type?: unknown; dependsOn?: unknown } | undefined;
  if (!rel || (rel.type !== 'lookup' && rel.type !== 'master_detail') || isMultiValueRelationship(fields, referenceField)) {
    return {};
  }
  const seed: Record<string, string> = {};
  for (const [field, value] of dependsOnFromParent(rel.dependsOn, parentRecord) ?? []) {
    if (typeof value === 'string' && field !== referenceField) seed[field] = value;
  }
  return seed;
}

/** A record field's value as a comparand: an expanded reference reads as its id. */
function referenceValueOf(raw: unknown): DependsOnValue | undefined {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? ((raw as { id?: unknown; _id?: unknown }).id ?? (raw as { _id?: unknown })._id)
    : raw;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return typeof value === 'string' && value !== '' ? value : undefined;
}
