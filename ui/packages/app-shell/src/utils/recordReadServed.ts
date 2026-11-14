/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Whether the server serves a single-record read (`get`) of an object — the
 * read a record surface (the record page, the record drawer) opens with.
 *
 * An object whose served operations leave `get` out — `enable.apiMethods:
 * ['list']`, a list-only object — has no record surface: its record page and
 * drawer could only answer `OBJECT_API_METHOD_NOT_ALLOWED`. So nothing opens
 * one for it: not its list rows, not a related list, not a link to one of its
 * records. Its row menu (`list_item` actions) is not a record surface and
 * stays.
 *
 * The verdict reads the effective operation set the server hands down
 * (`/me/permissions` `apiOperations`, through `usePermissions()`), never the
 * raw `apiMethods`; nothing here makes a request. An object with no set —
 * unrestricted, an old backend, no provider mounted, the answer not held yet —
 * keeps the default-allow answer, as every other affordance does.
 */
export function servesRecordRead(
  objectName: string | null | undefined,
  perms: RecordReadPrincipal | null | undefined,
): boolean {
  if (!objectName) return true;
  const ops = perms?.getObjectApiOperations?.(objectName);
  return !Array.isArray(ops) || ops.includes('get');
}

/** The subset of `usePermissions()` {@link servesRecordRead} reads. */
export interface RecordReadPrincipal {
  getObjectApiOperations?(object: string): readonly string[] | undefined;
}
