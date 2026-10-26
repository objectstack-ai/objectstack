/**
 * ObjectUI — the field-read rule for a single record
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The two members of a loaded permission policy the field-read rule asks.
 *
 * Structural on purpose: `usePermissions()` from `@object-ui/permissions`
 * satisfies it as it is, and so does any caller-supplied policy of the same
 * shape, so this package depends on neither React nor the permissions package.
 */
interface FieldReadPolicy {
  /** False until a policy has loaded; also false with no provider mounted. */
  readonly isLoaded: boolean;
  /** May the viewer READ `field` on `object`? */
  checkField(object: string, field: string, action: 'read'): boolean;
}

/**
 * `record` as the viewer may READ it on `objectName`: every field the loaded
 * `policy` denies is removed, which leaves the row ObjectStack's `FieldMasker`
 * already serves (objectui#10594).
 *
 * The renderer-side field-level-security rulings (objectui#7215 /
 * objectui#7230) say FLS gates the OUTPUT: a value the loaded policy denies is
 * not drawn, even when a backend serves it. Every surface that builds a display
 * value from a whole row (a record title, a lookup label, a search-hit label, a
 * person's name) calls this one function, so a denied field reads as an absent
 * field on every surface at once, and the display ladder falls through to its
 * next source exactly as it does for the stripped row. Field-LIST filters (which
 * columns to head, which relations to `$expand`) are a different shape and are
 * not this function.
 *
 * - `id` and `_id` are never judged, nor is any key in `extraKeep` (a declared
 *   id field): an id addresses the record and is not a field value the policy
 *   withholds, and the `Record #<id>` floor reads it.
 * - Before a policy loads, with no policy, with no object to judge the fields
 *   against, or for a value that is not an object, `record` comes back as it
 *   is.
 * - When nothing is withheld, the SAME object comes back, so a caller can tell
 *   "nothing withheld" from "something withheld" by identity and a cache keyed
 *   on the served row keeps hitting.
 *
 * Pure: it reads `policy.checkField` and never writes to `record`.
 */
export function withoutDeniedFields<T>(
  record: T,
  policy: FieldReadPolicy | null | undefined,
  objectName: string | undefined,
  extraKeep?: readonly string[],
): T {
  if (!policy?.isLoaded || !objectName || !record || typeof record !== 'object') return record;
  const shown: Record<string, unknown> = {};
  let withheld = false;
  for (const [key, value] of Object.entries(record)) {
    if (
      key === 'id' ||
      key === '_id' ||
      extraKeep?.includes(key) ||
      policy.checkField(objectName, key, 'read')
    ) {
      shown[key] = value;
    } else {
      withheld = true;
    }
  }
  return withheld ? (shown as T) : record;
}
