// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The stored-metadata conversion pass (ADR-0087 D2 addendum, #3903).
 *
 * Every other entry point into the conversion layer serves **authored
 * source** — `normalizeStackInput` for `defineStack`/`validate`/`lint`, the
 * migration chain for `migrate meta`. Metadata **at rest** (`sys_metadata`
 * rows written by Studio or the runtime authoring APIs) is a different
 * compatibility problem: a row written under protocol N sits unchanged while
 * the platform moves to N+1, N+2, … and there is no author in the loop to
 * read a tombstone or run the chain against it.
 *
 * {@link applyConversionsToStoredItem} is the one primitive every stored-row
 * rehydration seam calls, and it encodes the policy for data at rest:
 *
 * - **The full chain replays, including `retiredFromLoadPath` entries.**
 *   Retirement is an *authoring-surface* event — the schema tombstones the
 *   key so a live author is taught the canonical spelling. A stored row has
 *   no author; refusing its historical shape would not teach anyone, it
 *   would only break data that once worked. D3 keeps every conversion
 *   forever precisely so any past major can replay forward — a row at rest
 *   is the perpetual "consumer arriving late".
 * - **Idempotent by construction.** Conversions only rewrite shapes they
 *   positively recognize, so re-converting an already-canonical item is a
 *   no-op — seams may safely stack (e.g. a row converted here and again at
 *   `AutomationEngine.registerFlow`).
 * - **Never throws, never validates.** Like {@link applyConversions}, this
 *   only rewrites; gating stays where it belongs (the write path's schema
 *   gate, and the caller's own parse where execution demands one).
 *
 * The **write** path must NOT use this: `saveMetaItem` rejects off-spec
 * bodies with the current schema (tombstones included), which is what keeps
 * new rows canonical and makes this pass a strictly shrinking concern.
 */

import { applyConversions, type ApplyConversionsOptions } from './apply.js';
import { PLURAL_TO_SINGULAR, SINGULAR_TO_PLURAL } from '../shared/metadata-collection.zod.js';

/**
 * Stored row types whose conversions walk a stack collection the
 * MANIFEST-COLLECTION maps deliberately do not carry (#19620).
 *
 * `translation` is the one: `PLURAL_TO_SINGULAR` has no `translations`
 * spelling because a stack's `translations` entries are locale-keyed BUNDLES,
 * not named metadata items (`manifest-collection-spelling.ts` says why, and
 * `check:stack-collection-maps` holds that map to the stack schema). But the
 * translation conversions walk exactly that collection and are written for
 * BOTH shapes in it — a bundle entry and a bare `translation` item, the shape a
 * stored row is. Without this entry the stored pass had no collection to wrap
 * a `translation` row in and returned it untouched, so no rehydration seam
 * ever replayed a translation conversion over a stored row — which is how an
 * item's `settings`, taken off the item door by #19620, would have gone on
 * reaching the runtime from rows stored before. Kept HERE rather than added to
 * the shared maps, which would advertise `translations` as a named-item stack
 * collection to every other reader of them.
 */
const STORED_ONLY_COLLECTIONS: Readonly<Record<string, string>> = {
  translation: 'translations',
  // The legacy plural row spelling, as the protocol's singular/plural read
  // fallback still finds it.
  translations: 'translations',
};

/**
 * Options for {@link applyConversionsToStoredItem} — everything
 * {@link ApplyConversionsOptions} offers except `includeRetired`, which this
 * seam pins to `true` (the whole point of the stored pass; see module doc).
 */
export type StoredConversionOptions = Omit<ApplyConversionsOptions, 'includeRetired'>;

/**
 * Canonicalize a single stored metadata item of the given type by replaying
 * the **full** ADR-0087 conversion chain (retired entries included) over it.
 *
 * `type` accepts the singular metadata type name (`'object'`, `'view'`,
 * `'action'`, …) or its legacy plural row spelling (`'objects'`) — both map
 * to the stack collection the conversion walkers target. A type with no
 * stack collection (e.g. `'hook'`-adjacent plugin types) and a non-object
 * item pass through unchanged: this seam never manufactures shape.
 *
 * Deliberately NOT applied to `'flow'` by the metadata-protocol seams:
 * flow-node conversions carry an open-namespace conflict guard that needs
 * the live executor registry (`reservedNodeTypes`), which only the
 * automation engine has — flows canonicalize at `registerFlow` instead,
 * with the same full-chain policy. Callers that *do* have the context may
 * pass it via `options.reservedNodeTypes` and convert flows here.
 */
export function applyConversionsToStoredItem<T>(
  type: string,
  item: T,
  options: StoredConversionOptions = {},
): T {
  if (item == null || typeof item !== 'object' || Array.isArray(item)) return item;
  const singular = PLURAL_TO_SINGULAR[type] ?? type;
  const collection = SINGULAR_TO_PLURAL[singular] ?? STORED_ONLY_COLLECTIONS[singular];
  if (!collection) return item;
  const converted = applyConversions(
    { [collection]: [item as Record<string, unknown>] },
    { ...options, includeRetired: true },
  );
  const items = converted[collection];
  return Array.isArray(items) && items.length > 0 ? (items[0] as T) : item;
}
