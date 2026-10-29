/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The `filter-builder` field-type vocabulary — the SINGLE declaration of which
 * `FilterField.type` spellings are accepted and how the renderer draws each.
 *
 * Three readers take it from here instead of restating it, so they cannot drift
 * apart the way objectui#6939, #7562 and #8774 each found them drifted:
 *
 *   - `FilterFieldSchema.type` in `zod/complex.zod.ts` builds its `z.enum` from
 *     {@link FILTER_FIELD_TYPES};
 *   - `FilterField['type']` in `complex.ts` is {@link FilterFieldType};
 *   - `custom/filter-builder.tsx` in `@object-ui/components` picks each column's
 *     operator bucket and value control from the four behaviour buckets below.
 *
 * So a member removed from a bucket narrows all three together, and a member
 * added to the vocabulary without a renderer branch reddens the per-member
 * render measurement in
 * `examples/schema-catalog/test/filter-builder-mirror-6939.test.tsx`. Every
 * member is a spec `FieldType` except the exemptions named in
 * `__tests__/filter-builder-mirror-6939.test.ts`.
 *
 * `text` and `boolean` belong to no bucket: `text` is the renderer's fallthrough
 * family (`fieldType || "text"`), and `boolean` is a family of its own with a
 * two-item Select. `string` is in no list on purpose — the renderer names it
 * nowhere, so it reaches the text control only by the fallthrough (a phantom,
 * `d4493fdbc`).
 */

import { NUMERIC_VALUE_TYPES } from '@objectstack/spec/data';

/**
 * The literal members of the spec's numeric value family, for the TYPE face only.
 * `NUMERIC_VALUE_TYPES` is a `ReadonlySet<string>`, so no compile-time reading of
 * it yields literals; this union is the type-level half, and
 * `__tests__/filter-builder-mirror-6939.test.ts` holds it equal to the spec set
 * member for member. A type the spec adds reaches the runtime list below at once
 * (the zod enum and the renderer follow it) and reddens that pin until it is
 * named here too.
 */
type SpecNumericValueType = 'number' | 'currency' | 'percent' | 'rating' | 'slider' | 'progress' | 'summary';

/**
 * Numeric comparison operators and a number input: the spec's numeric value
 * family, `NUMERIC_VALUE_TYPES` (`@objectstack/spec/data`), taken from that set
 * rather than restated — the same set the server's filter doors read a field as
 * numeric by, so the builder offers a numeric field the operators the server
 * accepts for it (objectstack#27497, ruling C).
 */
export const FILTER_NUMBER_LIKE_TYPES: readonly SpecNumericValueType[] = Object.freeze(
  [...NUMERIC_VALUE_TYPES] as SpecNumericValueType[],
);

/** `before` / `after` / `between` and a date, datetime-local or time input. */
export const FILTER_DATE_LIKE_TYPES = ['date', 'datetime', 'time'] as const;

/** Select operators (`equals` / `in` / `not_in`); a dropdown or checkbox list when options are given. */
export const FILTER_SELECT_LIKE_TYPES = ['select', 'status'] as const;

/**
 * Relational types: lookup operators, a dropdown or checkbox list when options
 * are given, otherwise the remote search picker. `owner` is a RETIRED spelling
 * (objectui#4914) answered by the retirement gate, so it is in no list.
 */
export const FILTER_LOOKUP_LIKE_TYPES = ['lookup', 'master_detail', 'user'] as const;

/**
 * Every `type` a `filter-builder` field may carry: the four buckets plus `text`
 * and `boolean`. `type` stays optional, and absent reads as `text`.
 */
export const FILTER_FIELD_TYPES = [
  'text',
  ...FILTER_NUMBER_LIKE_TYPES,
  ...FILTER_DATE_LIKE_TYPES,
  'boolean',
  ...FILTER_SELECT_LIKE_TYPES,
  ...FILTER_LOOKUP_LIKE_TYPES,
] as const;

/** A `filter-builder` field type — one member of {@link FILTER_FIELD_TYPES}. */
export type FilterFieldType = (typeof FILTER_FIELD_TYPES)[number];
