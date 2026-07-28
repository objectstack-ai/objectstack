// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3026 follow-up — `sys_approval_delegation` must expose the BATCH shape of
 * the write verbs it already grants.
 *
 * The object is `managedBy: 'system'` but opens generic writes deliberately
 * (`userActions: { create, edit, delete }` — an out-of-office rule is authored
 * by its own user through the plain data endpoint), so the ADR-0103 D3
 * reconciliation strips nothing and its boilerplate CRUD-five whitelist reaches
 * the REST gate as authored. Since the #3391 P1 contract made bulk
 * `bulk ∧ derived(child)`, that whitelist — which never named the `bulk`
 * primitive — 405s every batch route while the single-record verbs stay open.
 */

import { describe, expect, it } from 'vitest';
import { resolveEffectiveApiMethods, isApiOperationAllowed } from '@objectstack/spec/data';
import { SysApprovalDelegation } from './sys-approval-delegation.object';

describe('sys_approval_delegation — batch exposure (#3026 / #3391 P1 companion)', () => {
  it('grants the bulk primitive alongside its single-record write verbs', () => {
    expect(SysApprovalDelegation.enable?.apiMethods).toContain('bulk');
    for (const verb of ['get', 'list', 'create', 'update', 'delete'] as const) {
      expect(SysApprovalDelegation.enable?.apiMethods, `must keep ${verb}`).toContain(verb);
    }
  });

  it('admits createMany / updateMany / deleteMany and /batch', () => {
    const eff = resolveEffectiveApiMethods(SysApprovalDelegation.enable);
    expect(eff.mode).toBe('restricted');
    for (const child of ['create', 'update', 'delete'] as const) {
      expect(isApiOperationAllowed(eff, 'bulk', { bulkChild: child }), `batch ${child}`).toBe(true);
    }
  });

  it('keeps the whitelist explicit so the ADR-0103 D3 backstop still runs', () => {
    // `reconcileManagedApiMethods` early-returns on a non-array `apiMethods`.
    // For a `managedBy` object, deleting the whitelist would silently disable
    // managed-write stripping — it is not an equivalent refactor.
    expect(Array.isArray(SysApprovalDelegation.enable?.apiMethods)).toBe(true);
  });
});
