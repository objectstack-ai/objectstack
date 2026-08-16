// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8371] The FILTER axis' dotted-path verdict — which HEAD types make a
 * dotted filter key (`'project_id.name'`, `'is_open.x'`, `'title.x'`)
 * refusable, and which deliberately keep it unjudged.
 *
 * ONE classification shared by the two doors that must agree on it:
 *
 * - the INGRESS gate (`@objectstack/metadata-protocol`
 *   `assertFilterFieldsExist`), covering everything that reaches `findData`;
 * - the ENGINE seam (`@objectstack/objectql` `assertFilterIsMaterializable`),
 *   which saved reports, flows and dashboard widgets reach directly.
 *
 * The same one-source move #4254 made between the search gate and the engine
 * and #8296 made for the virtual-field verdict on this same axis: two
 * hand-copied ladders drifting by one type would let the doors answer one
 * spelling two ways.
 *
 * ## The ruling this encodes (#8371, maintainer-delegated, 2026-08-15)
 *
 * Measured across all three drivers (the #8371 measurement table): a dotted
 * filter key whose head is a relation, a virtual `formula`, or a plain scalar
 * matches ZERO rows on `driver-memory`, `driver-sql` AND `driver-mongodb` —
 * a lookup stores the related record's scalar id (Mongo's dotted paths
 * traverse embedded documents, not references), a formula materialises no
 * column anywhere, and a scalar has nothing beneath it. Every one of those
 * answers was a silent `200` + empty list, indistinguishable from an empty
 * table. Those three head classes are therefore REFUSED at both doors, with
 * the existing `INVALID_FIELD` / 400 identity and the SORT axis' #4256
 * denormalise remedy — no new mechanism, no new error class.
 *
 * A dotted path into a nested STORED value (`'address.city'`, head in
 * {@link STRUCTURED_JSON_TYPES}) is the one spelling the drivers DISAGREE on:
 * live on memory and mongodb (2 rows in the measurement), silently empty on
 * sql. ⛔ It stays deliberately UNJUDGED (`null`) — refusing it for symmetry
 * would delete a working capability on two of three backends; declaring it a
 * capability (JSON-path filtering) waits for a real consumer.
 *
 * ## Fail-open by classification, never by drift
 *
 * Every type NOT positively classified below answers `null` (unjudged): file
 * and media types (legacy stored form is an inline metadata object a dotted
 * path CAN reach on two backends), inherently-multi option types and
 * `multiple: true` scalars (arrays, which Mongo/mingo index paths CAN reach),
 * and any future type this module has not met. That is the same failure
 * direction the collectors on both doors document: a hole, not a false 400 —
 * a gate that exists to stop wrong answers must not invent new ones.
 */

import {
  BOOLEAN_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  CLOCK_TIME_TYPES,
  INSTANT_TYPES,
  NUMERIC_VALUE_TYPES,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  STRING_VALUE_TYPES,
  STRUCTURED_JSON_TYPES,
  COMPUTED_VALUE_TYPES,
} from './field-value.zod';
import { SEARCH_VIRTUAL_TYPES } from './search-fields';

/** The slice of field metadata the dotted-head classification reads. */
export interface DottedFilterHeadMeta {
  type?: string;
  multiple?: boolean;
}

/**
 * Head types that store ONE SCALAR VALUE — nothing beneath them for a dotted
 * path to reach, on any backend. Derived from the ADR-0104 value-shape classes
 * rather than minted here, so a new field type joins by declaring its value
 * shape, never by someone remembering this list. The computed-but-stored
 * members (`summary`, `autonumber`) are the same two the #8296 virtual verdict
 * deliberately does NOT refuse undotted: both get real scalar columns, which
 * is exactly why a dotted path under them reaches nothing.
 */
export const SCALAR_FILTER_HEAD_TYPES: ReadonlySet<string> = new Set([
  ...STRING_VALUE_TYPES,
  ...NUMERIC_VALUE_TYPES,
  ...BOOLEAN_VALUE_TYPES,
  ...CALENDAR_DATE_TYPES,
  ...INSTANT_TYPES,
  ...CLOCK_TIME_TYPES,
  ...SINGLE_OPTION_TYPES,
  ...[...COMPUTED_VALUE_TYPES].filter((t) => !SEARCH_VIRTUAL_TYPES.has(t)),
]);

/**
 * The verdict class of a dotted filter key's head segment.
 *
 * - `'relation'` — the head points at ANOTHER record (`lookup` /
 *   `master_detail` / `user` / `tree`); the stored value is a scalar id, so
 *   the path traverses nothing on any backend.
 * - `'virtual'`  — the head is computed on read (`formula`); no driver
 *   materialises a column, so there is nothing beneath it. The #8296 verdict
 *   finally reaching the spelling that evaded it.
 * - `'scalar'`   — the head stores a single scalar value; a dotted path into
 *   it can only match zero records.
 * - `null`       — deliberately unjudged: structured/JSON heads (the ruled
 *   carve-out), array-valued heads, file heads, unknown heads and unreadable
 *   types. The door lets these through unchanged.
 */
export type DottedFilterHeadClass = 'relation' | 'virtual' | 'scalar' | null;

/**
 * Classify a dotted filter key's HEAD field for the #8371 verdict — the ONE
 * judgment behind both doors' refusals.
 *
 * A head whose `type` is unreadable is NOT judged: unresolvable is not wrong
 * (ADR-0072 D1, the same answer `isVirtualSearchField` gives), and an unknown
 * head is the ingress gate's FIRST verdict rather than this one's. A
 * `multiple: true` head is not judged either — the stored value is an array,
 * which numeric-index dotted paths genuinely reach on two backends, the same
 * measured reason the structured/JSON carve-out exists.
 */
export function classifyDottedFilterHead(
  meta: DottedFilterHeadMeta | undefined | null,
): DottedFilterHeadClass {
  if (!meta || typeof meta.type !== 'string') return null;
  const { type } = meta;
  if (SEARCH_VIRTUAL_TYPES.has(type)) return 'virtual';
  if (REFERENCE_VALUE_TYPES.has(type)) return 'relation';
  if (STRUCTURED_JSON_TYPES.has(type)) return null;
  if (meta.multiple === true) return null;
  if (SCALAR_FILTER_HEAD_TYPES.has(type)) return 'scalar';
  return null;
}
