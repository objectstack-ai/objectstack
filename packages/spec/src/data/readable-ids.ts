// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D1] `ReadableIds` — one branded comparand value meaning *"the ids
 * of the records of object `object` that the reading caller may read"*.
 *
 * It sits where a list of ids sits today, as the comparand of `$in` on a
 * pointer field:
 *
 * ```ts
 * { record_id: { $in: ReadableIds.of('cpz_doc') } }
 * ```
 *
 * The engine replaces it with a scope it composes from the caller's read
 * access before any driver sees the filter (ADR-0139 D2). This module declares
 * the value and nothing else: no operator, no schema, no evaluation.
 *
 * ## No request can spell it
 *
 * The leaf adds no operator to `FieldOperatorsSchema` or `VALID_AST_OPERATORS`
 * (`./filter.zod.ts`), and its brand is a symbol-keyed property, which no JSON
 * document can carry. A request's `where` holding `{ "$in": { "object": "x" } }`
 * is a plain object in a list slot, and the comparand-shape door
 * (`packages/spec/src/data/filter-comparand-shape.ts#assertListComparandShapes`) refuses it as a
 * non-list comparand (`INVALID_FILTER` / 400). That refusal existed before this
 * leaf did, and it stays THE refusal: nothing new is refused at ingress.
 *
 * ## Losing the brand fails closed
 *
 * The brand mirrors the device `./filter-subtree-provenance.ts` uses for its
 * mark, and for the same reason: every operation that would have invalidated
 * the leaf drops it.
 *
 *  - The key is `Symbol.for(…)` (the global registry), so a duplicated copy of
 *    this package resolves the same key.
 *  - The brand is non-enumerable, non-writable and non-configurable, so
 *    `JSON.stringify`, structured clone, a serializing wire and an object
 *    spread all produce an UNBRANDED copy, `{ object: 'cpz_doc' }`.
 *  - An unbranded copy is a plain object in a `$in` comparand, and the door
 *    refuses it as a non-list comparand. ⛔ It is never dropped: dropping the
 *    `$in` would leave the rest of the branch (`{ object_name: P }`) standing
 *    alone and serve every row of P.
 *  - The value is frozen, so a holder of the reference cannot re-point
 *    `object` at another table after construction.
 *
 * ## The door admits it only where a composer stands behind it
 *
 * The comparand-shape door is shared by many callers (the authoring lowering
 * `parseFilterAST`, the save door, the analytics doors, the RLS compiler). It
 * admits a branded leaf only when its caller passes `admitReadableIds: true`,
 * and only as a `$in` comparand. The engine's filter seam is the one caller
 * that passes it. Every other caller keeps refusing the leaf as a non-list
 * comparand, so no path that cannot compose the leaf can let it through.
 *
 * Like `./filter-subtree-provenance.ts`, the module is tolerant of bare,
 * un-parsed input: {@link isReadableIds} accepts `unknown` and answers `false`
 * for every degraded shape.
 */

/**
 * The symbol key the `ReadableIds` brand lives under.
 *
 * Exported so a consumer that cannot import {@link isReadableIds} (a
 * duplicated package instance) can resolve the same key through `Symbol.for`.
 * Everything else asks {@link isReadableIds}.
 */
export const READABLE_IDS_BRAND: unique symbol = Symbol.for('objectstack.filter.readableIds');

/**
 * A `ReadableIds` leaf: the ids of the records of {@link ReadableIds.object}
 * that the reading caller may read.
 *
 * Built only by {@link ReadableIds.of}. The brand is part of the type, so an
 * object literal `{ object: 'cpz_doc' }` does not type-check as one.
 */
export interface ReadableIds {
  /** The machine name of the object whose readable ids this leaf stands for. */
  readonly object: string;
  /** The brand. Non-enumerable at runtime, so a copy of the leaf drops it. */
  readonly [READABLE_IDS_BRAND]: true;
}

/**
 * Is `value` a branded `ReadableIds` leaf?
 *
 * Own symbol key only, and only the declared value `true`. A copy that lost the
 * brand (JSON, structured clone, a spread), a brand holding any other value,
 * a leaf whose `object` is not a non-empty string, `null` and every primitive
 * answer `false`.
 */
export function isReadableIds(value: unknown): value is ReadableIds {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Object.prototype.hasOwnProperty.call(value, READABLE_IDS_BRAND)) return false;
  if ((value as Record<symbol, unknown>)[READABLE_IDS_BRAND] !== true) return false;
  const object = (value as { object?: unknown }).object;
  return typeof object === 'string' && object.length > 0;
}

/**
 * The `ReadableIds` factory. `ReadableIds.of(object)` builds the frozen,
 * branded leaf for `object`.
 */
export const ReadableIds: {
  /**
   * The leaf standing for the ids of the records of `object` that the reading
   * caller may read. Place it as the comparand of `$in` on the pointer field.
   *
   * @param object the machine name of the object whose ids the leaf stands for.
   * @throws TypeError when `object` is not a non-empty string: a leaf that
   *         names no object can never be composed.
   */
  readonly of: (object: string) => ReadableIds;
} = Object.freeze({
  of(object: string): ReadableIds {
    if (typeof object !== 'string' || object.length === 0) {
      throw new TypeError(
        `ReadableIds.of() needs the machine name of an object, received ${
          typeof object === 'string' ? 'an empty string' : object === null ? 'null' : typeof object
        }.`,
      );
    }
    const leaf = { object };
    Object.defineProperty(leaf, READABLE_IDS_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return Object.freeze(leaf) as ReadableIds;
  },
});
