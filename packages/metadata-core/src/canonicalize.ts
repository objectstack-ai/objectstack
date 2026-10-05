// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonicalization: convert a spec object into a stable JSON
 * representation suitable for content-addressable hashing.
 *
 * Guarantees:
 *
 * 1. **Key order independence.** Object keys are sorted lexicographically.
 *    `{a:1, b:2}` and `{b:2, a:1}` produce the same canonical form — for
 *    every map EXCEPT the ones guarantee 8 names, whose order is content.
 * 2. **Whitespace independence.** No incidental whitespace.
 * 3. **Type preservation.** `undefined` properties are dropped (matching
 *    JSON.stringify), `null` is preserved, arrays preserve order.
 * 4. **Number normalisation.** Numbers serialised via `Number.prototype
 *    .toString` (the JSON default). NaN/Infinity are rejected because
 *    they cannot survive a JSON round trip.
 * 5. **Idempotence.** `canonicalize(canonicalize(x))` === `canonicalize(x)`.
 * 6. **Pure.** No side-effects, no mutation of input.
 * 7. **Serialized-form identity (#7856).** The hash describes the bytes a
 *    value serialises to, never the in-memory object graph that produced
 *    them. Formally, for every `x` this module accepts:
 *
 *        canonicalize(x) === canonicalize(JSON.parse(JSON.stringify(x)))
 *
 *    This is the guarantee that makes a repository's
 *    `put(spec).version === get().hash` hold: `put` hashes the value it
 *    was handed, `get` hashes what it parsed back off the disk, and
 *    guarantee 7 says those are one hash.
 *
 *    It is delivered by honouring `toJSON` exactly as `JSON.stringify`
 *    does — consulted once per position, its result serialised as-is and
 *    never re-consulted. Before #7856 `normalise` ignored `toJSON` and
 *    walked own enumerable keys instead, so a `Date` canonicalised to a
 *    key-less `{}` while the bytes on disk held an ISO string, and the two
 *    hashed differently: the version handed to a caller did not identify
 *    the bytes stored, and re-reading one's own write looked like an
 *    external edit.
 *
 *    Values carrying no `toJSON` anywhere in the graph — ordinary specs —
 *    are untouched by this: their canonical form is byte-identical to what
 *    it was before, so no already-stored version changes meaning.
 *
 * 8. **Declared map order (#21790).** A map whose key order the spec
 *    declares meaningful keeps its insertion order instead of being sorted,
 *    so a pure reorder of it is a change. Which maps those are is a fact
 *    about the metadata TYPE, so it applies only when the caller names the
 *    type (`canonicalize(body, type)`); see {@link orderedMapKeys} for the
 *    table and the spec text behind each row. Everything else in the body —
 *    the keys AROUND an ordered map and the keys INSIDE each of its values —
 *    stays key-order independent (guarantee 1). With no type, or a type with
 *    no row, the canonical form is byte-identical to what it was before.
 *
 *    Guarantees 5 and 7 hold unchanged: `JSON.stringify` emits own keys in
 *    the order `Object.keys` reports them and `JSON.parse` recreates them in
 *    that order, so the order kept here survives every serialisation round
 *    trip, and the canonical output of an ordered map re-canonicalises to
 *    itself.
 *
 *    The cost is the hashes already stored: a body whose ordered map is not
 *    already in sorted key order hashes differently under this rule than
 *    under the old one. A stamp written before #21790 still names its row —
 *    it is the row's version token, and the optimistic lock compares a
 *    caller's token with that stored stamp, never with a re-derivation — so
 *    the comparison that needed teaching is "is this write a no-op?", which
 *    must compare CONTENT under the current rule rather than a stored stamp
 *    taken under an older one (`SysMetadataRepository.put`).
 *
 * Non-goals (deliberately not supported):
 *
 * - Functions and symbols. These have no canonical JSON form. Callers must
 *   serialise out-of-band (e.g. for formula fields, use the CEL string,
 *   not the compiled function).
 * - Class instances *without* a `toJSON`. One that has a `toJSON` is
 *   supported by guarantee 7 and hashes as whatever it serialises to;
 *   one that does not still hashes as its own enumerable keys, which is
 *   exactly what `JSON.stringify` writes for it.
 * - BigInt. Rejected because there is no agreed-upon JSON representation.
 */

import { createHash } from 'node:crypto';

const NO_ORDERED_MAPS: readonly string[] = Object.freeze([]);

/**
 * Guarantee 8's table — per metadata type, the top-level keys of its body
 * whose value is a map with MEANINGFUL KEY ORDER.
 *
 * A row is owed only where `packages/spec` declares the order; ⛔ never an
 * order inferred from what a renderer happens to do with a map, because a
 * row here turns every reorder of that map into a new version.
 *
 *   - `object` → `fields`. `ObjectSchema.fields` is a name-keyed record whose
 *     traversal order IS the field order the platform presents: the
 *     `ObjectFieldGroupSchema` contract (`data/object.zod.ts`) sets "the
 *     in-group display order equals the traversal order of
 *     `ObjectSchema.fields`" and lays ungrouped fields out "preserving their
 *     field declaration order"; `fieldGroups` repeats it ("fields are
 *     displayed in their `ObjectSchema.fields` declaration order"); the
 *     `record` field type it is authored through declares "Insertion order =
 *     display order" (`data/field.zod.ts`); and the display-name derivation
 *     picks the first title-eligible field "by declaration order"
 *     (`data/display-name.ts`). A hash blind to that order called a pure
 *     reorder "no change", and the object designer's publish was dropped.
 *
 * Keyed by the canonical (singular) type name the repositories write under.
 * A `Map`, so a type name that happens to be an `Object.prototype` member
 * reads as "no row" rather than as an inherited function.
 */
const ORDERED_MAPS: ReadonlyMap<string, readonly string[]> = new Map([
  ['object', Object.freeze(['fields'])],
]);

/**
 * The top-level keys of a `type` body whose map value keeps its key order in
 * the canonical form (guarantee 8). Empty when `type` is omitted or has no
 * declared ordered map — the case in which canonicalization is exactly the
 * type-blind form it has always been.
 */
export function orderedMapKeys(type?: string): readonly string[] {
  return (type === undefined ? undefined : ORDERED_MAPS.get(type)) ?? NO_ORDERED_MAPS;
}

/**
 * Stable JSON serialisation. See module-level doc for guarantees.
 *
 * @param type The metadata type of `value`, when it is a metadata body.
 *             Decides which maps keep their order (guarantee 8); omit it for
 *             a value that is not one, which sorts every map.
 */
export function canonicalize(value: unknown, type?: string): string {
  // `''` is the key `JSON.stringify` hands a root-position `toJSON`.
  return JSON.stringify(normalise(value, '', orderedMapKeys(type), false));
}

/**
 * Resolve one position's value the way `JSON.stringify` does: if it carries
 * a callable `toJSON`, that is what gets serialised.
 *
 * Applied ONCE per position, per the `SerializeJSONProperty` algorithm — the
 * returned value is serialised as-is and is never itself re-examined for a
 * `toJSON`. `normalise` therefore calls this on entry and then dispatches on
 * the result, recursing (and so re-applying it) only for child positions.
 */
function resolveToJson(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return value;
  const toJson = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJson !== 'function') return value;
  return (toJson as (this: unknown, key: string) => unknown).call(value, key);
}

/**
 * Convert a value into a canonical, JSON-serialisable form.
 *
 * @param value Raw value at this position.
 * @param key   The position's key — `''` at the root, the property name
 *              inside an object, the stringified index inside an array.
 *              Passed to `toJSON` because `JSON.stringify` passes it.
 * @param orderedChildren Keys of THIS position's object whose values keep
 *              their own key order (guarantee 8). Non-empty only at the root;
 *              every deeper position receives none.
 * @param keepOwnOrder Whether THIS position, when it is an object, keeps its
 *              keys in insertion order instead of sorting them. Applies to
 *              this level only — its values are normalised as usual.
 */
function normalise(
  rawValue: unknown,
  key: string,
  orderedChildren: readonly string[],
  keepOwnOrder: boolean,
): unknown {
  const value = resolveToJson(rawValue, key);
  if (value === null) return null;
  if (typeof value === 'undefined') return undefined; // caller-dropped
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('canonicalize: NaN/Infinity not representable as JSON');
    }
    return value;
  }
  if (typeof value === 'bigint') {
    throw new Error('canonicalize: BigInt not supported');
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    throw new Error(`canonicalize: ${typeof value} cannot be serialised`);
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value;

  if (Array.isArray(value)) {
    // NOT `value.map(normalise)` — `Array.prototype.map` passes the index as
    // the second argument, which is this function's `key` parameter. The
    // index is the right key, but it has to arrive as the string
    // `JSON.stringify` would hand a `toJSON`, not as a number.
    return value.map((element, index) =>
      normalise(element, String(index), NO_ORDERED_MAPS, false),
    );
  }

  // Plain object: sort keys (unless this is a declared ordered map), drop
  // undefineds.
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // `Object.keys` order is the order `JSON.stringify` writes, so keeping it
    // is what keeps guarantee 7 for an ordered map.
    const keys = keepOwnOrder ? Object.keys(obj) : Object.keys(obj).sort();
    for (const k of keys) {
      const v = normalise(obj[k], k, NO_ORDERED_MAPS, orderedChildren.includes(k));
      if (typeof v === 'undefined') continue;
      out[k] = v;
    }
    return out;
  }

  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}

/**
 * Compute the canonical sha256 hash of a spec, returned as
 * `"sha256:<64-hex>"`. Equal hashes imply equal canonical forms.
 *
 * @param type The metadata type of `value` — a repository passes its
 *             `ref.type`, so a reorder of a declared ordered map is a new
 *             version (guarantee 8). Omitted, every map is order-blind.
 */
export function hashSpec(value: unknown, type?: string): string {
  const json = canonicalize(value, type);
  const digest = createHash('sha256').update(json, 'utf8').digest('hex');
  return `sha256:${digest}`;
}
