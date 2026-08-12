// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonicalization: convert a spec object into a stable JSON
 * representation suitable for content-addressable hashing.
 *
 * Guarantees:
 *
 * 1. **Key order independence.** Object keys are sorted lexicographically.
 *    `{a:1, b:2}` and `{b:2, a:1}` produce the same canonical form.
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

/** Stable JSON serialisation. See module-level doc for guarantees. */
export function canonicalize(value: unknown): string {
  // `''` is the key `JSON.stringify` hands a root-position `toJSON`.
  return JSON.stringify(normalise(value, ''));
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
 */
function normalise(rawValue: unknown, key: string): unknown {
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
    return value.map((element, index) => normalise(element, String(index)));
  }

  // Plain object: sort keys, drop undefineds.
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const k of keys) {
      const v = normalise(obj[k], k);
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
 */
export function hashSpec(value: unknown): string {
  const json = canonicalize(value);
  const digest = createHash('sha256').update(json, 'utf8').digest('hex');
  return `sha256:${digest}`;
}
