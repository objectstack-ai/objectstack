// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3026 follow-up — `sys_view_definition` must expose the BATCH shape of the
 * write verbs it already grants.
 *
 * Since the #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`, a
 * boilerplate CRUD-five whitelist (`get,list,create,update,delete`) denies
 * `/batch`, `createMany`, `updateMany` and `deleteMany` while leaving the same
 * verbs open one record at a time. The companion fix that added the `bulk`
 * primitive to explicitly-whitelisted objects covered `platform-objects` only,
 * so this one — the sole object carrying a whitelist in `metadata-core` — kept
 * the gap.
 *
 * Unlike the RBAC objects reclaimed alongside it, this object has no
 * `managedBy`, so the ADR-0103 D3 reconciliation never applies and deleting the
 * whitelist would be behaviourally equivalent. It stays explicit on purpose: a
 * metadata-plane object that is ALSO reachable through the generic data API is
 * worth naming its exposed surface rather than inheriting whatever the
 * primitive set grows into.
 */

import { describe, expect, it } from 'vitest';
import { resolveEffectiveApiMethods, isApiOperationAllowed } from '@objectstack/spec/data';
import { SysViewDefinitionObject } from './sys-view-definition.object.js';

describe('sys_view_definition — batch exposure (#3026 / #3391 P1 companion)', () => {
  it('grants the bulk primitive alongside its single-record write verbs', () => {
    expect(SysViewDefinitionObject.enable?.apiMethods).toContain('bulk');
    for (const verb of ['get', 'list', 'create', 'update', 'delete'] as const) {
      expect(SysViewDefinitionObject.enable?.apiMethods, `must keep ${verb}`).toContain(verb);
    }
  });

  it('admits createMany / updateMany / deleteMany and /batch', () => {
    const eff = resolveEffectiveApiMethods(SysViewDefinitionObject.enable);
    expect(eff.mode).toBe('restricted');
    for (const child of ['create', 'update', 'delete'] as const) {
      expect(isApiOperationAllowed(eff, 'bulk', { bulkChild: child }), `batch ${child}`).toBe(true);
    }
  });
});
