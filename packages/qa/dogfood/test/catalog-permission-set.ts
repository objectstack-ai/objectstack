// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D3, C3 stage 6b-2] Does the security catalog serve this permission
 * set — the fixture precondition that replaced "is its `sys_permission_set`
 * row seeded".
 *
 * No boot writes a `sys_permission_set` row any more: a set is served by name
 * from the registry, and a grant names its set. So a fixture that grants a set
 * asks the catalog the security plugin bound to its engine — the read the
 * authorization resolver itself uses — and gets the definition back, or
 * `undefined` when no reader holds the name.
 */

import { securityCatalogReaderOf } from '@objectstack/core';

/**
 * Typed `any`, as the `ql.findOne` it replaces at every call site was: a fixture
 * asserts the definition exists and then reads its fields.
 */
export async function catalogPermissionSet(ql: unknown, name: string): Promise<any> {
  const reader = securityCatalogReaderOf(ql);
  if (!reader) throw new Error('no security catalog is bound to this engine — is the SecurityPlugin booted?');
  return (await reader.resolve('permission', name))?.definition;
}
