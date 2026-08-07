// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3026 follow-up — `sys_approval_delegation` must expose the BATCH shape of
 * the write verbs it already grants.
 *
 * The object is `managedBy: 'system-data'` (#3355 — it was `'system'` plus a
 * `userActions: { create, edit, delete }` re-open block until v17 renamed the
 * bucket and made create/edit/delete/exportCsv the default; CSV import is opt-in
 * per object since #4671) and grants generic writes deliberately:
 * an out-of-office rule is authored by its own user through the plain data
 * endpoint. So the ADR-0103 D3 reconciliation strips nothing and its boilerplate
 * CRUD-five whitelist reaches the REST gate as authored. Since the #3391 P1
 * contract made bulk `bulk ∧ derived(child)`, that whitelist — which never named
 * the `bulk` primitive — 405s every batch route while the single-record verbs
 * stay open.
 */

import { describe, expect, it } from 'vitest';
import { resolveEffectiveApiMethods, isApiOperationAllowed, resolveCrudAffordances } from '@objectstack/spec/data';
import { SysApprovalDelegation } from './sys-approval-delegation.object';

/**
 * #3355 — this object's half of the `system` → `system-data` equivalence pin.
 * See `plugin-security/src/objects/managed-by-system-data.test.ts` for the full
 * rationale; the contract asserted here is identical.
 */
describe('#3355 — sys_approval_delegation moves to `system-data` with its affordances intact', () => {
  const V16_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };
  /**
   * Byte-identical to {@link V16_EXPECTED} since #4671 narrowed the bucket
   * default's `import` to opt-in — kept as its own constant so a future move of
   * EITHER side shows up as a diff rather than being absorbed by a shared literal.
   */
  const V17_EXPECTED = { create: true, import: false, edit: true, delete: true, exportCsv: true };
  /**
   * The v16 shape, reconstructed via `engine-owned` — which ADR-0103 D5 gave the
   * byte-identical locked default row `system` carried in v16. The retired
   * literal cannot be used: v17 deleted its row from `CRUD_AFFORDANCE_DEFAULTS`,
   * so it would fall through to the `platform` default and reconstruct the wrong
   * baseline. The `toEqual(V16_EXPECTED)` assertion below keeps it honest.
   */
  const asV16 = { managedBy: 'engine-owned', userActions: { create: true, edit: true, delete: true } };

  it('declares the new bucket and no longer carries a redundant `userActions` block', () => {
    expect(SysApprovalDelegation.managedBy).toBe('system-data');
    expect(SysApprovalDelegation.userActions).toBeUndefined();
  });

  it('resolves create / edit / delete / exportCsv — but NOT import — from the bucket default alone', () => {
    expect(resolveCrudAffordances(SysApprovalDelegation as never)).toEqual(V17_EXPECTED);
  });

  it('is affordance-equivalent to its v16 self on EVERY verb, import included (#4671)', () => {
    const v16 = resolveCrudAffordances(asV16 as never);
    const v17 = resolveCrudAffordances(SysApprovalDelegation as never);
    expect(v16).toEqual(V16_EXPECTED);
    for (const verb of ['create', 'import', 'edit', 'delete', 'exportCsv'] as const) {
      expect(v17[verb], `sys_approval_delegation.${verb} must not move`).toBe(v16[verb]);
    }
    expect(v17).toEqual(v16);
  });

  it('keeps CSV import opt-IN — off by bucket default, reachable only by declaring it (#4671)', () => {
    expect(resolveCrudAffordances(SysApprovalDelegation as never).import).toBe(false);
    const optedIn = resolveCrudAffordances({ ...SysApprovalDelegation, userActions: { import: true } } as never);
    expect(optedIn.import).toBe(true);
    expect({ ...optedIn, import: false }).toEqual(V17_EXPECTED);
  });
});

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
