/**
 * ObjectUI — served per-column sortability projection (consumer side)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The consumer half of objectstack#10235 (maintainer ruling A, 2026-08-23):
 * the platform serves an explicit per-column sortability signal, and a grid
 * reads THAT to decide whether a header offers a sort click — it never
 * re-derives "virtual ⇒ unsortable" from the field's `type`.
 *
 * ## What the platform serves
 *
 * `GET /api/v1/meta/object/:name` answers `GetMetaItemResponseSchema`, whose
 * ENVELOPE (never the document under `item` — `FieldSchema` is a
 * `strictObject`, so the key must stay un-authorable) carries an optional
 * `sortability` key when the served type is `object`, on every serving branch
 * including the cached one:
 *
 * ```jsonc
 * { "type": "object", "name": "crm_opportunity", "item": { … },
 *   "sortability": { "fields": {
 *     "amount":           { "sortable": true },
 *     "expected_revenue": { "sortable": false, "reason": "virtual-type" },
 *     "remote_anchor":    { "sortable": true,  "caveat": "unprovisioned-anchor" }
 *   } } }
 * ```
 *
 * Shape verified against the MERGED upstream change, not against a description
 * of it: `@objectstack/spec`'s `ObjectSortabilitySchema` /
 * `FieldSortabilitySchema` and `GetMetaItemResponseSchema.sortability`.
 *
 * ## The contract, and the asymmetry that makes it easy to get backwards
 *
 * Offer a sort affordance on a column **iff the projection has an entry for
 * the column's field name AND that entry says `sortable: true`**.
 *
 * ABSENCE OF AN ENTRY MEANS "no platform sort behind this name" — never
 * "assume sortable". The projection's domain is exactly the served field map
 * plus the always-provisioned `id`, so an unknown name, a dotted path
 * (`account.name`) and an unprovisioned audit column all arrive as absence,
 * and all three are refused by the runtime doors. A `!== false` test — the
 * spelling every other optional flag in this repo uses — answers `true` for
 * absence and so gets exactly that family backwards. {@link isPlatformSortableField}
 * is the only spelling of this test; do not inline a comparison at a call site.
 *
 * ## Present-vs-absent PROJECTION is a different question
 *
 * `readObjectSortability` returns `undefined` when the served metadata carried
 * no `sortability` key at all — a backend older than the upstream change, an
 * inline/mock data source, a fixture. That is NOT "every column is unsortable":
 * it is "no signal was served", and the caller decides what it did before the
 * signal existed. The two are deliberately different types (`undefined` vs an
 * empty `fields` map) so a caller cannot conflate them by accident.
 *
 * ## `caveat: 'unprovisioned-anchor'` is NOT a refusal
 *
 * Platform-injected anchors on ADR-0015 `external` objects come back
 * `sortable: true, caveat: 'unprovisioned-anchor'`: the runtime ACCEPTS the
 * sort, but silently drops it (`asc` === `desc` under a `200`) when the remote
 * table carries no such column — a degradation the platform cannot prove
 * either way at serve time. This module treats the caveat as advisory and the
 * `sortable` verdict as the enforcement fact, so a caveated column keeps its
 * click. Refusing what the platform does not refuse would recreate
 * declared-≠-enforced drift in mirror image; whether to badge or withhold on
 * the caveat is an open affordance question, not something to settle here.
 */

/**
 * The served shape is the SPEC's, re-exported rather than restated.
 *
 * `FIELD_UNSORTABLE_VIRTUAL_TYPE` / `FIELD_SORTABLE_UNPROVISIONED_ANCHOR` are
 * the two string literals the projection can carry, and `FieldSortability` /
 * `ObjectSortability` are the wire types themselves (`z.input` of the
 * schemas the REST layer answers with). Re-exporting is the point of a
 * contract-first consumer: a local declaration under a spec export's name is
 * read by the next agent as the spec's own definition, and then drifts from
 * it — which is what `check:spec-symbols` guards, and what it caught here.
 */
export {
  FIELD_UNSORTABLE_VIRTUAL_TYPE,
  FIELD_SORTABLE_UNPROVISIONED_ANCHOR,
} from '@objectstack/spec/api';
export type { FieldSortability, ObjectSortability } from '@objectstack/spec/api';

import type { FieldSortability, ObjectSortability } from '@objectstack/spec/api';

/**
 * Where the projection rides on the client-side object schema.
 *
 * A GLOBAL-REGISTRY SYMBOL, deliberately — the same carrier shape
 * `INFLIGHT_GET_REGISTRY_KEY` uses in `@object-ui/types`. Three properties
 * this signal needs and a string key would not give it:
 *
 *  - `JSON.stringify` drops symbol-keyed properties, so a schema object that
 *    is ever round-tripped back at a metadata WRITE endpoint cannot carry the
 *    projection into a document the server parses `strict` and rejects by
 *    name. The upstream change kept the key off `item` for exactly that
 *    reason; stamping a string key here would undo it one repo away.
 *  - `Object.keys` / spread / `for…in` do not see it, so every existing reader
 *    that enumerates the schema (column generators, diffing, form builders)
 *    is unchanged by its presence.
 *  - `Symbol.for` is the cross-realm registry, so two copies of this module
 *    (a workspace build and a published one in the same graph) agree on the
 *    key rather than silently reading past each other.
 */
export const OBJECT_SORTABILITY_KEY: unique symbol = Symbol.for('objectui.objectSortability');

/** Narrow one served entry, tolerating an unparsed / hand-built record. */
function asFieldSortability(value: unknown): FieldSortability | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const sortable = (value as { sortable?: unknown }).sortable;
  if (typeof sortable !== 'boolean') return undefined;
  const reason = (value as { reason?: unknown }).reason;
  const caveat = (value as { caveat?: unknown }).caveat;
  // `reason` / `caveat` are typed as closed literal unions by the spec, and
  // this is unparsed input off the wire. Preserve whatever string arrived
  // rather than dropping an annotation a NEWER platform added — the verdict
  // this module acts on is `sortable`, and an unrecognised advisory string is
  // strictly better carried than silently erased. The assertion is the
  // boundary cast that admission implies, and it is confined to this function.
  return {
    sortable,
    ...(typeof reason === 'string' ? { reason } : {}),
    ...(typeof caveat === 'string' ? { caveat } : {}),
  } as FieldSortability;
}

/**
 * Normalize a served `sortability` envelope value into the projection, or
 * `undefined` when the envelope carried nothing usable.
 *
 * Tolerant on purpose (the same contract the upstream resolver carries): the
 * adapter hands this whatever came back over the wire, unparsed.
 */
export function normalizeObjectSortability(served: unknown): ObjectSortability | undefined {
  if (!served || typeof served !== 'object' || Array.isArray(served)) return undefined;
  const rawFields = (served as { fields?: unknown }).fields;
  if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) return undefined;
  const fields: Record<string, FieldSortability> = {};
  for (const [name, entry] of Object.entries(rawFields as Record<string, unknown>)) {
    const verdict = asFieldSortability(entry);
    if (verdict) fields[name] = verdict;
  }
  return { fields };
}

/**
 * Stamp the served projection onto the client-side object schema, under
 * {@link OBJECT_SORTABILITY_KEY}.
 *
 * Non-enumerable and non-writable-by-accident: the property is defined rather
 * than assigned so it never shows up in a spread of the schema and cannot be
 * clobbered by one. Returns the same object it was handed (the adapter caches
 * that instance), and is a no-op when there is nothing usable to attach — so
 * an older backend leaves the schema exactly as it found it rather than
 * stamping an empty projection that would read as "nothing is sortable".
 */
export function attachObjectSortability<T>(schema: T, served: unknown): T {
  const projection = normalizeObjectSortability(served);
  if (!projection || !schema || typeof schema !== 'object') return schema;
  Object.defineProperty(schema, OBJECT_SORTABILITY_KEY, {
    value: projection,
    enumerable: false,
    configurable: true,
    writable: true,
  });
  return schema;
}

/**
 * Read the served projection off a client-side object schema.
 *
 * `undefined` means NO SIGNAL WAS SERVED — not "nothing is sortable". See the
 * module docblock: callers must branch on this before applying the contract.
 */
export function readObjectSortability(schema: unknown): ObjectSortability | undefined {
  if (!schema || typeof schema !== 'object') return undefined;
  const carried = (schema as Record<symbol, unknown>)[OBJECT_SORTABILITY_KEY];
  if (!carried || typeof carried !== 'object') return undefined;
  const fields = (carried as { fields?: unknown }).fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  return carried as ObjectSortability;
}

/**
 * THE contract test: does the platform offer a sort over this field name?
 *
 * `true` iff the projection has an entry for `fieldName` and that entry says
 * `sortable: true`. Every other case — no entry, `sortable: false`, a
 * malformed entry — answers `false`, because absence means "no platform sort
 * behind this name".
 *
 * `sortability` is REQUIRED and non-optional on purpose: a caller holding
 * `undefined` (no signal served) has a different question to answer and must
 * not reach this function with it. See {@link readObjectSortability}.
 */
export function isPlatformSortableField(
  sortability: ObjectSortability,
  fieldName: string | undefined,
): boolean {
  if (typeof fieldName !== 'string' || fieldName.length === 0) return false;
  const entry = sortability.fields?.[fieldName];
  return asFieldSortability(entry)?.sortable === true;
}

/**
 * Drop from a sort list every entry the platform will not order by.
 *
 * The RESTORE leg of the same contract: withholding the header click stops a
 * fresh unsortable sort from being created, but a sort persisted BEFORE the
 * signal existed is already in stored view state, and replaying it would keep
 * a refused `$orderby` alive and re-persist it on the next unrelated edit.
 * Filtering the list at the seam the grid both renders from and emits through
 * means an already-stored entry is inert and is dropped the first time
 * anything writes the sort back.
 */
export function filterPlatformSortableSort<T extends { field?: string }>(
  sort: readonly T[] | undefined,
  sortability: ObjectSortability,
): T[] {
  if (!Array.isArray(sort)) return [];
  return sort.filter((item) => isPlatformSortableField(sortability, item?.field));
}
