/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isMultiValueField, type ValueShapeFieldDef } from '@objectstack/spec/data';

/**
 * Minimal object-schema field shape needed to decide single- vs multi-value
 * semantics: the spec's own `ValueShapeFieldDef` with every key optional,
 * because that is what an indexed lookup into the meta API's `fields` map
 * yields — a miss produces `undefined`, not a def carrying a `type`.
 */
export type MultiValueFieldDef = Partial<ValueShapeFieldDef>;

/**
 * Whether the given object-schema field stores an array of scalars.
 *
 * Renamed off the spec's `isMultiValueField` (objectui#3161, objectstack#4115
 * ledger batch 7), and reduced to what it actually is: a lookup-tolerant
 * wrapper. It answered a weaker question than the spec's function of the same
 * name — the spec's takes a def whose `type` is REQUIRED, this one is called as
 * `hasMultiValueShape(objectFields?.[p.name])`, routinely with `undefined` — so
 * the two were never interchangeable while the shared name said they were. A
 * same-name function with a different PRECONDITION is worse than a plain fork:
 * an import swapped between the two modules keeps compiling and changes
 * behaviour only on the missing-field path.
 *
 * The classification itself is no longer restated. It delegates to the spec's
 * `isMultiValueField` — the same arbiter the server-side write pipeline uses
 * (framework#2552) — instead of re-deriving it from `MULTI_OPTION_TYPES` /
 * `MULTI_CAPABLE_TYPES`, which is how a helper documented as "consumed instead
 * of restated" (objectui#3017) came to restate the two-line rule anyway.
 */
export function hasMultiValueShape(def: MultiValueFieldDef | undefined | null): boolean {
  if (typeof def?.type !== 'string') return false;
  return isMultiValueField(def as ValueShapeFieldDef);
}

/**
 * Return a copy of `patch` where any lone scalar aimed at a multi-value
 * field (per the object schema) is wrapped into a single-element array.
 * A scalar written verbatim silently corrupts the column shape for every
 * array-consumer (#2204); the server normalizes too (objectstack-ai/objectstack#2552), but
 * the client should never emit the wrong shape in the first place.
 *
 * Only unambiguous scalars (string/number/boolean) are wrapped — arrays
 * pass through untouched and anything else is left for server validation.
 */
export function normalizeMultiValuePatch(
  patch: Record<string, unknown>,
  fields: Record<string, MultiValueFieldDef> | undefined | null,
): Record<string, unknown> {
  if (!fields) return patch;
  let out: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || Array.isArray(value)) continue;
    if (!hasMultiValueShape(fields[key])) continue;
    const t = typeof value;
    if (t === 'string' || t === 'number' || t === 'boolean') {
      if (!out) out = { ...patch };
      out[key] = [value];
    }
  }
  return out ?? patch;
}
