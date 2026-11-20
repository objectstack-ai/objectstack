/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Is `value` a plain object of ANOTHER realm (an iframe, a `vm` context)?
 *
 * Its prototype is that realm's `Object.prototype`: not this realm's
 * `Object.prototype` and not `null`, a prototype whose own prototype is
 * `null`, and whose `constructor` is named `Object`. All three are needed:
 *
 * - `Object.create(somePlainObject)` is of THIS realm and its constructor is
 *   `Object`, but its prototype's prototype is `Object.prototype`, not `null`;
 * - `Object.create(Object.create(null))` has a prototype whose prototype is
 *   `null`, but that prototype has no `constructor`.
 *
 * Neither is a foreign plain object, and neither is filter structure here.
 *
 * The spec's filter walk (`isFilterNode`) and the engine's
 * `isNoOperatorObject` read only this realm's `Object.prototype` or `null` as
 * filter structure, so a foreign plain object is a comparand to both. ONE test
 * for both faces: the filter converter refuses it as a field's whole condition,
 * and `ValueDataSource` refuses it in comparand position, each naming it with
 * this answer.
 *
 * Every read is guarded: the answer feeds a refusal sentence, and a refusal
 * must never itself throw (a revoked `Proxy` throws on `getPrototypeOf`).
 */
export function isForeignRealmPlainObject(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    const proto = Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null;
    if (proto === null || proto === Object.prototype) return false;
    if (Object.getPrototypeOf(proto) !== null) return false;
    return proto.constructor?.name === 'Object';
  } catch {
    return false;
  }
}
