// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D1] `SharedRecordIds` — one branded comparand value meaning *"the
 * ids of the records of object `object` that `sys_record_share` grants to the
 * user `recipient`"*: at every access level (the read form), or at the levels
 * it names (the write form, ADR-0155 ③ ruled A).
 *
 * It sits where today's list of granted ids sits, as the comparand of `$in` on
 * the object's `id`:
 *
 * ```ts
 * { id: { $in: SharedRecordIds.read('account', 'u1') } }
 * ```
 *
 * It denotes ADR-0155 D-0's set G(object, recipient, levels), the whole of it:
 * the `record_id` values of the `sys_record_share` rows with that
 * `object_name`, `recipient_type = 'user'`, that `recipient_id`, a `record_id`
 * that is neither NULL nor empty and, on the write form, an `access_level` in
 * the levels it carries. Read with system authority, with no organization
 * predicate (ADR-0155 ① ruled A), with no cap and no ordering. The list the
 * share arm binds today holds at most 5,000 members of G; the leaf is G at every
 * count. A SQL driver compiles it in the list's own position, as
 * {@link SharedRecordIds.innerRead} describes:
 *
 * ```sql
 * id IN (SELECT record_id FROM sys_record_share
 *        WHERE object_name = :object AND recipient_type = 'user' AND recipient_id = :recipient
 *          AND record_id IS NOT NULL AND record_id <> '')
 * -- the write form adds, inside the subquery:  AND access_level IN (:levels)
 * ```
 *
 * This module declares the value and nothing else: no operator, no schema, no
 * evaluation. ⛔ No `EXISTS`, no correlated form and no join (D1): the leaf
 * sits in the list's own position, so `find`, `count` and `aggregate` agree by
 * construction, and a record matched by several grant rows is still one row.
 *
 * ## Its own brand
 *
 * It is not a mode of `ReadableIds` (`./readable-ids.ts`) and not a mode of
 * ADR-0147's leaf: one brand carries one meaning, so no composer has to ask
 * which meaning it holds (ADR-0147 D-a, read from ADR-0139 D1). The brand
 * device is ADR-0139 D1's, unchanged:
 *
 *  - The key is `Symbol.for(…)` (the global registry), so a duplicated copy of
 *    this package resolves the same key.
 *  - The brand is non-enumerable, non-writable and non-configurable, so
 *    `JSON.stringify`, structured clone, a serializing wire and an object
 *    spread all produce an UNBRANDED copy, `{ object, recipient }`.
 *  - An unbranded copy is a plain object in a `$in` comparand, and the
 *    comparand-shape door refuses it as a non-list comparand (`INVALID_FILTER`
 *    / 400). ⛔ It is never dropped and never read as an empty list: dropping
 *    the `$in` would leave the rest of the branch standing alone, and an empty
 *    list would take away every grant.
 *  - The value is frozen, and so is the level list it carries, so a holder of
 *    the reference cannot re-point it at another object or another user after
 *    the engine's seam has judged it.
 *
 * ## What it carries: the inputs of G and nothing else
 *
 * The object's name, the recipient's user id, and the admitted access levels:
 * none on the read form, which admits every level, and the producer's write
 * levels on the write form. The producer supplies the levels (plugin-sharing's
 * `WRITE_ACCESS_LEVELS`), so the level vocabulary keeps its one home and this
 * package never restates it. `recipient_type = 'user'` is fixed, not carried.
 * It carries no organization, no caller scope and no reading context. The
 * inputs are ordinary enumerable properties, as `ReadableIds`' object name is,
 * so two users' leaves never compare or serialise as equal; only the brand is
 * non-enumerable.
 *
 * **The recipient is the producer's.** It is captured from the context the
 * scope is built for, where today's `recipient_id` comes from. ⛔ No seam and no
 * driver re-derives it from the reading context: the engine's seam (ADR-0155
 * D4) compares it with the reading context's user and delegator and never
 * replaces it.
 *
 * ## It arrives composed
 *
 * Unlike `ReadableIds`, the engine composes nothing for this leaf: it asks no
 * security service and its set is fixed by its inputs. The engine's executor
 * seam checks its position, its verb and its recipient and hands it to the
 * driver as it stands (ADR-0155 D4). The shared pieces it has in common with
 * ADR-0147's leaf (the comparand door's option, the fixed inner read's
 * description, the conformance case-set) live in `./fixed-read-leaf.ts` and
 * `./fixed-read-leaf-conformance.ts`, built once in the two-leaf shape.
 *
 * ## Where it is legal (the engine's rule, ADR-0155 D1)
 *
 * Only as the `$in` comparand of `id` on the object it names: directly in that
 * object's `where`, or inside the composed scope of a `ReadableIds` leaf whose
 * parent is that object, under `$and`, `$or` and `$not` like any `$in`. The
 * read form on `find`, `findOne`, `count` and `aggregate` (`where` only); the
 * write form in the `where` of a predicate `update`. On `delete`, in a
 * `having`, or at any other position, the engine refuses it loudly with ADR-0139
 * D3's composition-fault envelope (`INTERNAL_ERROR` / 500).
 *
 * ## No request can spell it
 *
 * No operator joins `FieldOperatorsSchema` or `VALID_AST_OPERATORS`
 * (`./filter.zod.ts`), and there is no CEL function and no lint vocabulary. One
 * producer writes it: plugin-sharing's read-scope builder, and its write-scope
 * builder. Until that producer's switch lands (ADR-0155 plan step 6) nothing
 * writes it, and no caller of the comparand-shape door admits it.
 *
 * Like `./readable-ids.ts`, the module is tolerant of bare, un-parsed input:
 * {@link isSharedRecordIds} accepts `unknown` and answers `false` for every
 * degraded shape.
 *
 * @see ./fixed-read-leaf.ts for the description type and the door's brand dispatch
 * @see ./fixed-read-leaf-conformance.ts for the per-driver case-set
 */

import type { FixedInnerRead } from './fixed-read-leaf';

/**
 * The symbol key the `SharedRecordIds` brand lives under — a key of its own,
 * never `READABLE_IDS_BRAND` or `COMPOSED_READABLE_IDS_BRAND`.
 *
 * Exported so a consumer that cannot import {@link isSharedRecordIds} (a
 * duplicated package instance) can resolve the same key through `Symbol.for`.
 * Everything else asks {@link isSharedRecordIds}, and a caller of the
 * comparand-shape door names it in `admitFixedReadLeaves`.
 */
export const SHARED_RECORD_IDS_BRAND: unique symbol = Symbol.for('objectstack.filter.sharedRecordIds');

/**
 * A `SharedRecordIds` leaf: the ids of the records of
 * {@link SharedRecordIds.object} that `sys_record_share` grants to the user
 * {@link SharedRecordIds.recipient}.
 *
 * Built only by {@link SharedRecordIds.read} and {@link SharedRecordIds.write}.
 * The brand is part of the type, so an object literal does not type-check as
 * one.
 */
export interface SharedRecordIds {
  /** The machine name of the object whose shared record ids the leaf stands for (`object_name`). */
  readonly object: string;
  /** The user id the grants are to (`recipient_id`, with `recipient_type = 'user'` fixed). The producer's. */
  readonly recipient: string;
  /**
   * The admitted access levels (`access_level IN …`), on the WRITE form only:
   * a non-empty, frozen list the producer supplies. Absent on the read form,
   * which admits every level — absent, not empty: an empty list would admit no
   * grant at all.
   */
  readonly accessLevels?: readonly string[];
  /** The brand. Non-enumerable at runtime, so a copy of the leaf drops it. */
  readonly [SHARED_RECORD_IDS_BRAND]: true;
}

/** The own string keys a `SharedRecordIds` leaf may carry; the read form carries the first two. */
const LEAF_KEYS: ReadonlySet<string> = new Set(['object', 'recipient', 'accessLevels']);

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** A non-empty, frozen list of non-empty strings: the write form's level list. */
function isLevelList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length > 0 && Object.isFrozen(value) && value.every(isNonEmptyString);
}

/**
 * Is `value` a branded `SharedRecordIds` leaf?
 *
 * Own symbol key only, holding only the declared value `true`, and no other
 * symbol-keyed property beside it, so no value answers to two leaf brands; a
 * frozen value; `object` and `recipient` non-empty strings; no own string key
 * but `object`, `recipient` and `accessLevels`; and `accessLevels`, when it is
 * an own key, a non-empty frozen list of non-empty strings. A copy that lost
 * the brand (JSON, structured clone, a spread), a brand holding any other
 * value, a value that also carries the `ReadableIds` brand or the composed one,
 * an unfrozen look-alike, `null` and every primitive answer `false`.
 */
export function isSharedRecordIds(value: unknown): value is SharedRecordIds {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length !== 1 || symbols[0] !== SHARED_RECORD_IDS_BRAND) return false;
  if ((value as Record<symbol, unknown>)[SHARED_RECORD_IDS_BRAND] !== true) return false;
  if (!Object.isFrozen(value)) return false;
  const keys = Object.keys(value);
  if (!keys.every((key) => LEAF_KEYS.has(key))) return false;
  const leaf = value as { object?: unknown; recipient?: unknown; accessLevels?: unknown };
  if (!isNonEmptyString(leaf.object) || !isNonEmptyString(leaf.recipient)) return false;
  return !Object.prototype.hasOwnProperty.call(value, 'accessLevels') || isLevelList(leaf.accessLevels);
}

/** How a refused argument is named in a factory's `TypeError`. */
function describeArgument(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length === 0 ? 'an empty array' : 'an array';
  if (typeof value === 'string') return value.length === 0 ? 'an empty string' : 'a string';
  return typeof value;
}

/** The frozen, branded leaf over already-judged inputs. */
function brand(fields: { object: string; recipient: string; accessLevels?: readonly string[] }): SharedRecordIds {
  const leaf = { ...fields };
  Object.defineProperty(leaf, SHARED_RECORD_IDS_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(leaf) as SharedRecordIds;
}

/** Refuse an `object` / `recipient` that is not a non-empty string, naming the factory. */
function assertInputs(factory: string, object: unknown, recipient: unknown): void {
  if (!isNonEmptyString(object)) {
    throw new TypeError(
      `SharedRecordIds.${factory}() needs the machine name of an object, received ${describeArgument(object)}.`,
    );
  }
  if (!isNonEmptyString(recipient)) {
    throw new TypeError(
      `SharedRecordIds.${factory}() needs the user id the grants on '${object}' are to, received ` +
        `${describeArgument(recipient)}. The recipient is captured from the context the scope is built for.`,
    );
  }
}

/** The table and columns of the inner read — named once, here. */
const TABLE = 'sys_record_share';
const COLUMN = 'record_id';

/**
 * The `SharedRecordIds` factory. `read(object, recipient)` builds the read
 * form, `write(object, recipient, accessLevels)` the write form, and
 * `innerRead(leaf)` describes the fixed inner read either form denotes.
 */
export const SharedRecordIds: {
  /**
   * The READ form: the ids of the records of `object` shared with the user
   * `recipient` at any access level. The read scope's share arm, placed as the
   * comparand of `$in` on `id`.
   *
   * @param object    the machine name of the object the grants are on.
   * @param recipient the user id the grants are to, captured from the context
   *                  the scope is built for.
   * @throws TypeError when either is not a non-empty string.
   */
  readonly read: (object: string, recipient: string) => SharedRecordIds;
  /**
   * The WRITE form (ADR-0155 ③ ruled A): the ids of the records of `object`
   * shared with the user `recipient` at one of `accessLevels`. The predicate
   * update's share arm, placed as the comparand of `$in` on `id`.
   *
   * @param accessLevels the admitted levels, supplied by the producer (the
   *                     write levels of its own vocabulary); copied and frozen.
   * @throws TypeError when `object` or `recipient` is not a non-empty string,
   *         or `accessLevels` is not a non-empty list of non-empty strings: an
   *         empty list would admit no grant, and the read form is the spelling
   *         of "every level".
   */
  readonly write: (object: string, recipient: string, accessLevels: readonly string[]) => SharedRecordIds;
  /**
   * The fixed inner read the leaf denotes, as `./fixed-read-leaf.ts` declares
   * it: what an evaluator compiles or evaluates, so ⛔ no evaluator restates
   * this leaf's predicate by hand (ADR-0155 D4). A fresh frozen value per call.
   *
   * @throws TypeError when `leaf` is not a branded {@link SharedRecordIds} leaf.
   */
  readonly innerRead: (leaf: SharedRecordIds) => FixedInnerRead;
} = Object.freeze({
  read(object: string, recipient: string): SharedRecordIds {
    assertInputs('read', object, recipient);
    return brand({ object, recipient });
  },
  write(object: string, recipient: string, accessLevels: readonly string[]): SharedRecordIds {
    assertInputs('write', object, recipient);
    if (!Array.isArray(accessLevels) || accessLevels.length === 0 || !accessLevels.every(isNonEmptyString)) {
      throw new TypeError(
        `SharedRecordIds.write() needs the access levels a grant on '${object}' must hold, as a non-empty list ` +
          `of non-empty strings, received ${describeArgument(accessLevels)}${
            Array.isArray(accessLevels) && accessLevels.length > 0 ? ' holding a member that is not one' : ''
          }. For every level, build the read form with SharedRecordIds.read().`,
      );
    }
    return brand({ object, recipient, accessLevels: Object.freeze([...accessLevels]) });
  },
  innerRead(leaf: SharedRecordIds): FixedInnerRead {
    if (!isSharedRecordIds(leaf)) {
      throw new TypeError(
        `SharedRecordIds.innerRead() needs a leaf built by SharedRecordIds.read() or .write(), received ` +
          `${describeArgument(leaf)}${leaf !== null && typeof leaf === 'object' ? ' without the SharedRecordIds brand' : ''}.`,
      );
    }
    const memberOf: Record<string, readonly string[]> = {};
    if (leaf.accessLevels !== undefined) memberOf.access_level = Object.freeze([...leaf.accessLevels]);
    return Object.freeze({
      table: TABLE,
      column: COLUMN,
      equals: Object.freeze({ object_name: leaf.object, recipient_type: 'user', recipient_id: leaf.recipient }),
      memberOf: Object.freeze(memberOf),
      tenantScope: 'none' as const,
    });
  },
});
