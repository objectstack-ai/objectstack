/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * stableIdentity — hold a value's REFERENCE steady while its VALUE has not
 * changed, so a structurally-unchanged object can be a `useEffect` dependency.
 *
 * ## Why this exists (objectui#6460)
 *
 * `ObjectView`'s non-grid fetch effect depended on `activeView`, an element of
 * the caller's `views` prop array. A host that builds that array inline —
 * `views={[{ id: 'cal', type: 'calendar', label: … }]}`, which is how every
 * example in this repo's own docs writes it — produces a fresh element object
 * on every one of its own renders, so the dependency changed identity every
 * render and a new `find()` went out each time (measured: 4 queries where a
 * hoisted array gives 1). "Ask hosts to hoist the array" was considered and
 * REJECTED: this is a published component, so that is a contract change dressed
 * as a bug fix, and it leaves the defect live for every host that does not
 * comply.
 *
 * ## ⚠️ Why NOT a stringified key
 *
 * The obvious cheap mechanism — `JSON.stringify(filter)` as the dependency — is
 * wrong in BOTH directions for the values that actually flow through here
 * (a view's `filter` and `sort`, which are author-supplied metadata this
 * package does not get to constrain):
 *
 *   - It reports EQUAL for values that differ, which is a MISSED re-fetch — the
 *     dangerous direction, and a silent one. `JSON.stringify` drops keys whose
 *     value is `undefined` or a function and renders a `Map`/`Set`/class
 *     instance as `{}`, so `{ a: undefined }`, `{ a: () => 1 }`, `{}` and
 *     `{ a: new Map() }` all serialize to the same four characters. `NaN` and
 *     `Infinity` both become `null`.
 *   - It reports DIFFERENT for values that are the same, which is the very
 *     churn being fixed. Key order is insertion order, not semantics:
 *     `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are the same filter and two
 *     different strings.
 *   - A cyclic value makes it THROW, taking the render down with it.
 *
 * So this compares structurally and never serializes. Key order therefore
 * cannot matter, a `Date` is compared by its instant rather than flattened to a
 * string, and anything this function does not model (functions, `Map`, `Set`,
 * `RegExp`, class instances) falls back to `Object.is` — i.e. to reference
 * identity, which can never call two different values equal.
 *
 * ## The safety invariant
 *
 * **Every uncertainty resolves to "not equal".** An unmodelled type, a
 * differing key count, and a structure deeper than `MAX_DEPTH` all return
 * `false`, which yields a NEW reference and therefore a re-fetch. This function
 * can only ever remove a REDUNDANT query; it can never withhold a needed one.
 * That is what makes it safe to sit under a data dependency.
 */

import { useRef } from 'react';

/**
 * Depth past which comparison gives up and reports "not equal".
 *
 * Bounds the recursion so a cyclic value costs one extra query instead of a
 * stack overflow. View filters and sorts are a handful of levels deep at most
 * (`[{ field, operator, value }]`, or a nested `and`/`or` group), so nothing
 * legitimate reaches this.
 */
const MAX_DEPTH = 12;

/** A value whose own prototype is `Object.prototype` (or null) — not a class instance. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Compare two values by structure, without serializing either.
 *
 * Modelled: primitives (via `Object.is`, so `NaN` equals `NaN`), `Date` (by
 * instant), arrays (element-wise and order-sensitive — a filter's order is
 * semantic), and plain objects (by key SET and value, so key order does not
 * matter). Everything else — functions, `Map`, `Set`, `RegExp`, class
 * instances — is equal only when it is the same reference.
 *
 * @returns `true` only when the two are known to be equivalent. Unknown cases
 *          return `false`, which is the re-fetch direction.
 */
export function isStructurallyEqual(a: unknown, b: unknown, depth = 0): boolean {
  if (Object.is(a, b)) return true;
  if (depth >= MAX_DEPTH) return false;

  // Dates before the plain-object test: they are objects, but their content is
  // not enumerable, so a key-wise comparison would call any two Dates equal.
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isStructurallyEqual(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    // Key COUNT plus presence, so `{ a: undefined }` and `{}` stay distinct —
    // exactly the pair `JSON.stringify` collapses.
    if (aKeys.length !== Object.keys(b).length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!isStructurallyEqual(a[key], b[key], depth + 1)) return false;
    }
    return true;
  }

  // Unmodelled: a function, Map, Set, RegExp, class instance. `Object.is` above
  // already accepted the same-reference case; anything else is "changed".
  return false;
}

/**
 * Return `value`'s reference, replaced only when the value has structurally
 * changed — the identity-preserving half of {@link isStructurallyEqual}.
 *
 * Deriving the returned reference from `(previous, value)` alone makes this
 * idempotent: re-running the render with the same input returns the same
 * reference, so it is safe under StrictMode's double invocation.
 *
 * @param value The value to hold steady. Typically built inline by the caller.
 * @returns The previous reference while structurally unchanged, else `value`.
 */
export function useStableIdentity<T>(value: T): T {
  const held = useRef<T>(value);
  const stable = isStructurallyEqual(held.current, value) ? held.current : value;
  held.current = stable;
  return stable;
}
