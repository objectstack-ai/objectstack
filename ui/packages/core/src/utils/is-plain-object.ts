/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Is `value` a key/value bag: a non-null object that is not an array?
 *
 * The shared spelling of the check most packages wrote privately as
 * `isPlainObject` / `isRecord` (objectui#13458). A file that already carries a
 * local copy switches to this one when it is next touched; there is no sweep
 * and no lint rule.
 *
 * ⚠️ This is the `typeof` reading, not the prototype reading: a `Date`, a `Map`
 * or a class instance passes. A local that reads the prototype instead
 * (`Object.getPrototypeOf(value) === Object.prototype`), or one that lets an
 * array through, answers a different question — keep that local rather than
 * swapping it for this one, or the call site's behaviour changes.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
