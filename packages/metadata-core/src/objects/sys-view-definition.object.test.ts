// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3026 follow-up — `sys_view_definition` is default-open, and the derivation
 * grants it every operation including the batch routes.
 *
 * The #3391 P1 contract made the bulk gate `bulk ∧ derived(child)`, which turned
 * this object's boilerplate CRUD-five whitelist into a silent denial of
 * `/batch`, `createMany`, `updateMany` and `deleteMany` while the same verbs
 * stayed open one record at a time. #3745 completed the whitelist to all six
 * primitives; #3543's audit rule then applies — a whitelist naming all six is
 * equivalent to no whitelist while NOT tracking future primitives — so the
 * declaration is gone.
 *
 * Deleting it is safe HERE specifically because the object has no `managedBy`:
 * `reconcileManagedApiMethods` (ADR-0103 D3) early-returns on a non-array
 * `apiMethods`, so for a managed object an absent whitelist would take the
 * managed-write backstop with it. That is why the RBAC objects reclaimed by
 * #3745 keep their explicit arrays and this one does not.
 */

import { describe, expect, it } from 'vitest';
import { resolveEffectiveApiMethods, isApiOperationAllowed } from '@objectstack/spec/data';
import { SysViewDefinitionObject } from './sys-view-definition.object.js';

describe('sys_view_definition — API exposure (#3026 / #3543 audit)', () => {
  it('carries no whitelist, so the resolver reports unrestricted', () => {
    // Regression guard both ways: re-adding a whitelist naming all six
    // primitives is a no-op that stops tracking future ones, and any narrower
    // whitelist silently closes routes that are open today.
    expect(SysViewDefinitionObject.enable?.apiMethods).toBeUndefined();
    expect(resolveEffectiveApiMethods(SysViewDefinitionObject.enable).mode).toBe('unrestricted');
  });

  it('admits createMany / updateMany / deleteMany and /batch', () => {
    const eff = resolveEffectiveApiMethods(SysViewDefinitionObject.enable);
    for (const child of ['create', 'update', 'delete'] as const) {
      expect(isApiOperationAllowed(eff, 'bulk', { bulkChild: child }), `batch ${child}`).toBe(true);
    }
  });

  it('derives the data-portability verbs from the primitives', () => {
    const eff = resolveEffectiveApiMethods(SysViewDefinitionObject.enable);
    for (const op of ['import', 'export', 'upsert', 'aggregate'] as const) {
      expect(isApiOperationAllowed(eff, op), op).toBe(true);
    }
  });
});
