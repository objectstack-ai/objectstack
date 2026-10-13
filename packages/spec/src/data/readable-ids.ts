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
 *
 * ## Two more declarations the composition reads (ADR-0139 D2)
 *
 * The engine composes each leaf from the parent object's read scope,
 * `getReadFilter(P, caller)`, immediately before the driver call. Two things
 * that composition needs live here, beside the leaf, because the engine, the
 * security service and the drivers all import this package and none of them
 * can import each other:
 *
 *  - {@link RLS_DENY_FILTER}, the deny sentinel `getReadFilter` answers when
 *    the caller may read no row of `P`. D2 step 2 answers it `$in: []`, and it
 *    recognises it BY IDENTITY, so every producer returns this one object.
 *  - {@link ComposedReadableIds}, the composed leaf of D2 step 3,
 *    `{ object: P, scope }`, built only by {@link ReadableIds.compose} and
 *    told apart from the uncomposed leaf by {@link isComposedReadableIds}. The
 *    two recognisers are DISJOINT: {@link isReadableIds} answers `false` for a
 *    composed leaf, so "an uncomposed leaf reached this driver" is the one
 *    question `isReadableIds` asks, and a driver refuses on it (D2's last
 *    paragraph, D3).
 */

import type { FilterCondition } from './filter.zod';

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
 * [ADR-0139 D2 step 2] The RLS deny sentinel — the read scope that means "this
 * caller may read no row of this object", declared once for the whole tree.
 *
 * **Its reader is ADR-0139 D2 step 2.** When the engine composes a
 * {@link ReadableIds} leaf for parent object `P`, it asks
 * `getReadFilter(P, caller)` (`../contracts/security-service.ts`); an answer
 * that IS this object is answered `$in: []` — FALSE on every driver — and never
 * becomes a {@link ComposedReadableIds} ({@link ReadableIds.compose} refuses
 * it). The engine recognises it **by identity** (`scope === RLS_DENY_FILTER`),
 * never by comparing its value or its shape.
 *
 * **So every producer returns this object by reference.** The security service
 * answers it from `getReadFilter`'s fail-closed branches, from the tenant wall's
 * deny (Layer 0) and from the RLS compiler's "every applicable policy dropped"
 * path; `@objectstack/plugin-security` re-exports it under the same name and
 * holds no second literal. ⛔ Never spread or clone it (`{ ...RLS_DENY_FILTER }`):
 * a copy still matches zero rows, so nothing visibly breaks, but it is no
 * longer the sentinel, and D2 step 2 then composes a subquery that matches
 * nothing instead of answering `$in: []`.
 *
 * **It is also an ordinary predicate, and that is the fail direction.** The
 * value is an `id` equality against a UUID-shaped string no record carries, so
 * a consumer that never heard of the sentinel — the analytics raw-SQL compiler,
 * a driver, the explain engine's record pass — evaluates it to zero rows. The
 * value is published (the explain engine's `readFilter`, a bound SQL parameter
 * in analytics) and is unchanged by this declaration.
 *
 * Frozen, so no holder of the reference can edit it, and so no read-scope merge
 * boundary can stamp a provenance mark on it
 * (`./filter-subtree-provenance.ts#markFilterSubtreeProvenance` leaves a
 * frozen subtree unmarked, which withholds).
 */
export const RLS_DENY_FILTER: Readonly<{ id: string }> = Object.freeze({
  id: '__rls_deny__:00000000-0000-0000-0000-000000000000',
});

/**
 * The symbol key the {@link ComposedReadableIds} brand lives under — a key of
 * its own, never {@link READABLE_IDS_BRAND}, so the composed and the uncomposed
 * leaf are told apart by which brand they carry.
 *
 * Exported for the same reason as {@link READABLE_IDS_BRAND}. Everything else
 * asks {@link isComposedReadableIds}.
 */
export const COMPOSED_READABLE_IDS_BRAND: unique symbol = Symbol.for('objectstack.filter.readableIds.composed');

/**
 * [ADR-0139 D2 step 3] A COMPOSED `ReadableIds` leaf: "the ids of the records
 * of {@link ComposedReadableIds.object} matching
 * {@link ComposedReadableIds.scope}", which is what the engine hands a driver
 * in place of the {@link ReadableIds} leaf it composed.
 *
 * Built only by {@link ReadableIds.compose}, at the engine's executor boundary,
 * after the comparand doors have run; no door admits it (the comparand-shape
 * door's `admitReadableIds` admits the uncomposed leaf only), so a composed
 * leaf handed to the engine from outside is refused as a non-list comparand,
 * never trusted as a scope someone else already resolved.
 *
 * Still branded, as D2 says, under {@link COMPOSED_READABLE_IDS_BRAND}: a JSON
 * round-trip, a structured clone or a spread produce the unbranded
 * `{ object, scope }`, which no driver may evaluate as a composed leaf.
 *
 * **The tenant wall is not in `scope`** (D2 step 3): the driver applies its own
 * tenant scope to `object`'s table with the outer read's options (D3).
 */
export interface ComposedReadableIds {
  /** The machine name of the parent object whose ids the leaf stands for. */
  readonly object: string;
  /**
   * The parent's read scope, lowered and marked `'policy'` by the engine
   * (D2 step 2), or `undefined`: the caller has no row restriction on
   * `object`. Never the {@link RLS_DENY_FILTER} sentinel, which D2 step 2
   * answers `$in: []` instead.
   */
  readonly scope: FilterCondition | undefined;
  /** The brand. Non-enumerable at runtime, so a copy of the leaf drops it. */
  readonly [COMPOSED_READABLE_IDS_BRAND]: true;
}

/**
 * Is `value` a branded {@link ComposedReadableIds} leaf?
 *
 * Own symbol key only, and only the declared value `true`; `object` a
 * non-empty string; `scope` an own key holding `undefined` or a plain,
 * non-array object. Every copy that lost the brand, every hand-built shape that
 * breaks one of those, an uncomposed {@link ReadableIds} leaf, `null` and every
 * primitive answer `false`.
 *
 * Disjoint from {@link isReadableIds}: no value answers `true` to both.
 */
export function isComposedReadableIds(value: unknown): value is ComposedReadableIds {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!Object.prototype.hasOwnProperty.call(value, COMPOSED_READABLE_IDS_BRAND)) return false;
  if ((value as Record<symbol, unknown>)[COMPOSED_READABLE_IDS_BRAND] !== true) return false;
  const object = (value as { object?: unknown }).object;
  if (typeof object !== 'string' || object.length === 0) return false;
  if (!Object.prototype.hasOwnProperty.call(value, 'scope')) return false;
  return isComposableScope((value as { scope?: unknown }).scope);
}

/** `undefined` (no restriction) or a plain, non-array object — the scope's two declared spellings. */
function isComposableScope(scope: unknown): boolean {
  return scope === undefined || (scope !== null && typeof scope === 'object' && !Array.isArray(scope));
}

/** How a refused argument is named in a factory's `TypeError`. */
function describeArgument(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return value.length === 0 ? 'an empty string' : 'a string';
  return typeof value;
}

/**
 * The `ReadableIds` factory. `ReadableIds.of(object)` builds the frozen,
 * branded leaf for `object`; `ReadableIds.compose(leaf, scope)` builds the
 * composed leaf the engine hands a driver in its place.
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
  /**
   * [ADR-0139 D2 step 3] The composed leaf for `leaf` under the parent's read
   * scope: frozen, branded under {@link COMPOSED_READABLE_IDS_BRAND}, carrying
   * `{ object: leaf.object, scope }`.
   *
   * The engine's executor boundary is the caller (ADR-0139 D2); a driver's
   * conformance suite (D3) builds one the same way. The function judges its
   * arguments and nothing else: it asks no security service, lowers nothing
   * and marks nothing.
   *
   * @param leaf  the uncomposed leaf being composed; its `object` is the
   *              composed leaf's `object`.
   * @param scope the parent's lowered read scope, or `undefined` for "no row
   *              restriction" (`getReadFilter`'s own spelling of it).
   * @throws TypeError when `leaf` is not a branded {@link ReadableIds} leaf;
   *         when `scope` is neither `undefined` nor a plain, non-array object;
   *         or when `scope` IS {@link RLS_DENY_FILTER}, which D2 step 2
   *         answers `$in: []` and never composes.
   */
  readonly compose: (leaf: ReadableIds, scope: FilterCondition | undefined) => ComposedReadableIds;
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
  compose(leaf: ReadableIds, scope: FilterCondition | undefined): ComposedReadableIds {
    if (!isReadableIds(leaf)) {
      throw new TypeError(
        `ReadableIds.compose() needs a leaf built by ReadableIds.of(), received ${describeArgument(leaf)}` +
          `${leaf !== null && typeof leaf === 'object' ? ' without the ReadableIds brand' : ''}.`,
      );
    }
    if (!isComposableScope(scope)) {
      throw new TypeError(
        `ReadableIds.compose() needs the read scope of '${leaf.object}' as a filter object, or undefined for ` +
          `no row restriction, received ${describeArgument(scope)}.`,
      );
    }
    if ((scope as unknown) === RLS_DENY_FILTER) {
      throw new TypeError(
        `ReadableIds.compose() was handed the RLS deny sentinel as the read scope of '${leaf.object}'. A caller ` +
          'who may read no row of the parent is answered $in: [] (ADR-0139 D2 step 2), never a composed leaf.',
      );
    }
    const composed = { object: leaf.object, scope };
    Object.defineProperty(composed, COMPOSED_READABLE_IDS_BRAND, {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return Object.freeze(composed) as ComposedReadableIds;
  },
});
