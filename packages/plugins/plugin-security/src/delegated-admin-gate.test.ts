// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D12 — delegated administration: scoped admin, no self-escalation.

import { describe, it, expect, beforeEach } from 'vitest';
import { mapDataError } from '@objectstack/types';
import { DelegatedAdminGate } from './delegated-admin-gate';
import { isPermissionDeniedError } from './errors.js';
import { bindCatalogFromTables, bindTestSecurityCatalog } from './__tests__/security-catalog.testkit.js';

/**
 * Fixture topology
 *
 *   hq (bu_hq)
 *   ├── east (bu_east)          ← delegate's subtree root
 *   │   └── east_sales (bu_es)
 *   └── west (bu_west)
 *
 * Permission sets: sales_user (allowlisted, plain), finance_admin (NOT
 * allowlisted), sub_admin (carries the delegate's adminScope), admin_full
 * (tenant superuser wildcard).
 * Positions: sales_rep → [sales_user]; mixed_pos → [sales_user, finance_admin];
 * everyone (anchor).
 */

const EAST_SCOPE = {
  businessUnit: 'east',
  includeSubtree: true,
  manageAssignments: true,
  assignablePermissionSets: ['sales_user', 'sub_admin'],
};

function makeHarness() {
  const tables: Record<string, any[]> = {
    sys_business_unit: [
      { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
      { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
      { id: 'bu_es', name: 'east_sales', parent_business_unit_id: 'bu_east' },
      { id: 'bu_west', name: 'west', parent_business_unit_id: 'bu_hq' },
    ],
    sys_position: [
      { id: 'pos_sales', name: 'sales_rep' },
      { id: 'pos_mixed', name: 'mixed_pos' },
      { id: 'pos_everyone', name: 'everyone' },
    ],
    sys_permission_set: [
      { id: 'ps_sales', name: 'sales_user' },
      { id: 'ps_fin', name: 'finance_admin' },
      { id: 'ps_sub', name: 'sub_admin', admin_scope: JSON.stringify(EAST_SCOPE) },
    ],
    sys_position_permission_set: [
      { id: 'b1', position_id: 'pos_sales', permission_set_id: 'ps_sales' },
      { id: 'b2', position_id: 'pos_mixed', permission_set_id: 'ps_sales' },
      { id: 'b3', position_id: 'pos_mixed', permission_set_id: 'ps_fin' },
    ],
    sys_user_position: [
      { id: 'a_prev', user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es' },
    ],
    sys_business_unit_member: [
      { id: 'm1', business_unit_id: 'bu_es', user_id: 'u_east_1' },
      { id: 'm2', business_unit_id: 'bu_west', user_id: 'u_west_1' },
    ],
    sys_user: [
      { id: 'u_delegate' }, { id: 'u_east_1' }, { id: 'u_west_1' },
    ],
  };

  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        return (v as any).$in.includes(row[k]);
      }
      return row[k] === v;
    });

  const ql = {
    tables,
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async findOne(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return rows[0] ?? null;
    },
  } as any;
  // [ADR-0131 D3/D4] The gate reads positions, their bindings and the set
  // bodies from the security catalog: the one these rows convert to.
  bindCatalogFromTables(ql, tables);

  // Resolved permission sets per principal — mirrors what
  // resolvePermissionSetsForContext would return for each context.
  const SETS: Record<string, any[]> = {
    tenant_admin: [{ name: 'admin_full', objects: { '*': { allowRead: true, modifyAllRecords: true } } }],
    delegate: [
      { name: 'member_default', objects: {} },
      { name: 'sub_admin', objects: { sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } }, adminScope: EAST_SCOPE },
    ],
    crud_only: [{ name: 'rbac_crud', objects: { sys_user_position: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } } }],
  };

  const gate = new DelegatedAdminGate({
    ql,
    resolveSets: async (context: any) => SETS[context?.principal ?? ''] ?? [],
  });

  const ctxOf = (principal: string, userId = `u_${principal}`) => ({ principal, userId, positions: [principal] });
  return { gate, ql, tables, ctxOf };
}

let h: ReturnType<typeof makeHarness>;
beforeEach(() => { h = makeHarness(); });

const insertAssignment = (ctx: any, row: any) => h.gate.assert({
  object: 'sys_user_position', operation: 'insert', data: row, context: ctx,
});

describe('DelegatedAdminGate — tenant admins and outsiders', () => {
  it('tenant-level admin (superuser wildcard) passes — the ordinary CRUD/RLS checks decide', async () => {
    await expect(insertAssignment(h.ctxOf('tenant_admin'), {
      user_id: 'u_west_1', position: 'mixed_pos', business_unit_id: 'bu_west',
    })).resolves.toBeUndefined();
  });

  it('plain CRUD on RBAC tables no longer makes a permission administrator', async () => {
    await expect(insertAssignment(h.ctxOf('crud_only'), {
      user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es',
    })).rejects.toThrow(/delegated adminScope/);
  });

  it('principal-less non-system writes to RBAC tables fail closed', async () => {
    await expect(insertAssignment({}, {
      user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es',
    })).rejects.toThrow(/authenticated administrator/);
  });

  // #3712 — a schedule-triggered flow run reaches the data layer carrying only
  // its run id. That is PROVENANCE, not a principal: it must not buy the write
  // anything the same write would not get with no context at all.
  it('a provenance-only context is still principal-less — no run id opens this gate', async () => {
    await expect(insertAssignment({ flowRunId: 'run_1' }, {
      user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es',
    })).rejects.toThrow(/authenticated administrator/);
  });

  it('reads and non-governed objects are untouched', async () => {
    await expect(h.gate.assert({ object: 'sys_user_position', operation: 'find', context: {} }))
      .resolves.toBeUndefined();
    await expect(h.gate.assert({ object: 'task', operation: 'insert', data: {}, context: {} }))
      .resolves.toBeUndefined();
  });
});

// ── [#3697 follow-up] Organization membership is governed, and NOT delegable ──
//
// A `sys_member` row whose `role` is admin-grade is auto-elevated to
// `organization_admin` (`auto-org-admin-grant.ts`), whose wildcard
// `modifyAllRecords` IS `isTenantAdmin()`. Writing one therefore mints a tenant
// admin — the same escalation the invitation role cap closes on the issuance
// path, one layer down at the table.
//
// Unreachable today: every writer is a better-auth path running under
// `isSystem`, which short-circuits the whole security middleware before this
// gate. These cases exist so the chain cannot silently reopen the day a direct
// write surface is added — the defence has to live at the CALL SITE, not in a
// comment (AGENTS.md Prime Directive #10).
describe('DelegatedAdminGate — organization membership (sys_member)', () => {
  const writeMember = (ctx: any, row: any, operation = 'insert') =>
    h.gate.assert({ object: 'sys_member', operation, data: row, context: ctx });

  it('a tenant admin still passes — delegation constrains delegates, not HQ', async () => {
    await expect(
      writeMember(h.ctxOf('tenant_admin'), { user_id: 'u_x', organization_id: 'org_1', role: 'admin' }),
    ).resolves.toBeUndefined();
  });

  it('a DELEGATE holding a real adminScope is refused — membership is not a delegable axis', async () => {
    // The escalation this closes: `role: 'admin'` here resolves to
    // organization_admin, i.e. authority strictly greater than the delegate's.
    await expect(
      writeMember(h.ctxOf('delegate'), { user_id: 'u_east_1', organization_id: 'org_1', role: 'admin' }),
    ).rejects.toThrow(/tenant-level only/);
  });

  it('a delegate is refused even for a plain member row — no adminScope axis approves any of it', async () => {
    await expect(
      writeMember(h.ctxOf('delegate'), { user_id: 'u_east_1', organization_id: 'org_1', role: 'member' }),
    ).rejects.toThrow(/not a delegable capability/);
  });

  it('the refusal points at the delegable path that DOES exist', async () => {
    await expect(
      writeMember(h.ctxOf('delegate'), { user_id: 'u_east_1', organization_id: 'org_1', role: 'member' }),
    ).rejects.toThrow(/invitation/);
  });

  it('plain CRUD on the table buys nothing', async () => {
    await expect(
      writeMember(h.ctxOf('crud_only'), { user_id: 'u_east_1', organization_id: 'org_1', role: 'admin' }),
    ).rejects.toThrow(/tenant-level only/);
  });

  it('a principal-less non-system write fails closed', async () => {
    await expect(
      writeMember({}, { user_id: 'u_east_1', organization_id: 'org_1', role: 'admin' }),
    ).rejects.toThrow(/authenticated administrator/);
  });

  it('every governed mutation verb is covered, not just insert', async () => {
    for (const op of ['update', 'delete', 'transfer', 'restore', 'purge']) {
      await expect(
        writeMember(h.ctxOf('delegate'), { id: 'mem_1', role: 'admin' }, op),
      ).rejects.toThrow(/tenant-level only/);
    }
  });

  it('reads are untouched — this governs writes only', async () => {
    await expect(
      h.gate.assert({ object: 'sys_member', operation: 'find', context: h.ctxOf('delegate') }),
    ).resolves.toBeUndefined();
  });
});

describe('DelegatedAdminGate — assignments (sys_user_position)', () => {
  it('delegate assigns an allowlisted position inside the subtree; granted_by is stamped', async () => {
    const row: any = { user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es' };
    await expect(insertAssignment(h.ctxOf('delegate'), row)).resolves.toBeUndefined();
    expect(row.granted_by).toBe('u_delegate'); // audit stamp
  });

  it('denies when the position distributes a set outside the allowlist', async () => {
    await expect(insertAssignment(h.ctxOf('delegate'), {
      user_id: 'u_east_1', position: 'mixed_pos', business_unit_id: 'bu_es',
    })).rejects.toThrow(/finance_admin.*not in the scope's allowlist/);
  });

  it('denies assignments anchored outside the subtree', async () => {
    await expect(insertAssignment(h.ctxOf('delegate'), {
      user_id: 'u_west_1', position: 'sales_rep', business_unit_id: 'bu_west',
    })).rejects.toThrow(/outside the delegated subtree/);
  });

  it('denies unanchored assignments (no business_unit_id)', async () => {
    await expect(insertAssignment(h.ctxOf('delegate'), {
      user_id: 'u_east_1', position: 'sales_rep',
    })).rejects.toThrow(/no business_unit_id anchor/);
  });

  it('no self-carve-out: delegate self-assigning a non-allowlisted position is denied', async () => {
    await expect(insertAssignment(h.ctxOf('delegate'), {
      user_id: 'u_delegate', position: 'mixed_pos', business_unit_id: 'bu_es',
    })).rejects.toThrow(/allowlist/);
  });

  it('anchors are never assignable — for delegates AND tenant admins', async () => {
    for (const principal of ['delegate', 'tenant_admin']) {
      await expect(insertAssignment(h.ctxOf(principal), {
        user_id: 'u_east_1', position: 'everyone', business_unit_id: 'bu_es',
      })).rejects.toThrow(/audience anchor is implicit/);
    }
  });

  it('update cannot move an assignment out of the subtree', async () => {
    await expect(h.gate.assert({
      object: 'sys_user_position', operation: 'update',
      data: { id: 'a_prev', business_unit_id: 'bu_west' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/outside the delegated subtree/);
  });

  it('delete of an in-subtree assignment is allowed; filter writes are not', async () => {
    await expect(h.gate.assert({
      object: 'sys_user_position', operation: 'delete',
      options: { where: { id: 'a_prev' } },
      context: h.ctxOf('delegate'),
    })).resolves.toBeUndefined();

    await expect(h.gate.assert({
      object: 'sys_user_position', operation: 'delete',
      options: { where: { position: 'sales_rep' } },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/single rows by id/);
  });
});

describe('DelegatedAdminGate — direct grants (sys_user_permission_set)', () => {
  it('delegate grants an allowlisted set to a user inside the subtree; granted_by stamped', async () => {
    const row: any = { user_id: 'u_east_1', permission_set: 'sales_user' };
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert', data: row, context: h.ctxOf('delegate'),
    })).resolves.toBeUndefined();
    expect(row.granted_by).toBe('u_delegate');
  });

  it('denies grants to users outside the subtree', async () => {
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert',
      data: { user_id: 'u_west_1', permission_set: 'sales_user' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/outside the delegated subtree/);
  });

  it('denies non-allowlisted sets — including to the delegate themselves', async () => {
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert',
      data: { user_id: 'u_delegate', permission_set: 'finance_admin' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/not in the scope's allowlist/);
  });

  it('granting a set that carries an adminScope requires STRICT containment (equal scope refused)', async () => {
    // sub_admin carries the delegate's own EXACT scope — lateral propagation banned.
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert',
      data: { user_id: 'u_east_1', permission_set: 'sub_admin' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/not strictly contained/);
  });

  // [#23488] `manageBindings` / `authorEnvironmentSets` are retired: no door
  // honoured either, so the containment comparison reads neither. Both scopes
  // below are what a stored row the D2 conversion has not yet rewritten could
  // hand the gate — the keys are written on purpose, as raw data.
  describe('[#23488] the retired binding/authoring flags count on no containment axis', () => {
    const RETIRED_FLAGS = { manageBindings: true, authorEnvironmentSets: true } as const;
    /** A delegate whose held scope is EAST_SCOPE plus an inert `true` on both retired flags. */
    const gateFor = (adminScope: Record<string, unknown>) => new DelegatedAdminGate({
      ql: h.ql,
      resolveSets: async () => [{ name: 'east_admin', objects: {}, adminScope }] as any[],
    });
    const grantSubAdmin = (gate: DelegatedAdminGate) => gate.assert({
      object: 'sys_user_permission_set', operation: 'insert',
      data: { user_id: 'u_east_1', permission_set: 'sub_admin' },
      context: h.ctxOf('east_delegate', 'u_east_delegate'),
    });

    it('an inert `true` on the delegate\'s side no longer makes an otherwise EQUAL scope strictly contained — 403 PERMISSION_DENIED', async () => {
      // Before the retirement the delegate's `true` against sub_admin's
      // absent flag counted as the strictly-larger axis, so the equal-scope
      // refusal let sub_admin's identical scope through.
      const refusal = await grantSubAdmin(gateFor({ ...EAST_SCOPE, ...RETIRED_FLAGS })).then(
        () => undefined,
        (e: unknown) => e as { code?: string; status?: number; message?: string },
      );
      expect(refusal, 'the grant must be refused').toBeDefined();
      expect(refusal?.code).toBe('PERMISSION_DENIED');
      expect(refusal?.status).toBe(403);
      expect(refusal?.message).toMatch(/would hand out an adminScope not strictly contained by yours/);
    });

    it('CONTROL: the same delegate grants a scope narrower on a REAL axis (the subtree)', async () => {
      // sub_admin's scope stops covering descendants: strictly contained on
      // the tree axis, so the same delegate, retired flags and all, may grant it.
      const row = h.tables.sys_permission_set.find((r: any) => r.name === 'sub_admin');
      row.admin_scope = JSON.stringify({ ...EAST_SCOPE, includeSubtree: false });
      await expect(grantSubAdmin(gateFor({ ...EAST_SCOPE, ...RETIRED_FLAGS }))).resolves.toBeUndefined();
    });

    it('the granted side\'s retired `true` no longer out-reaches a delegate that lacks it', async () => {
      // Before the retirement sub_admin's `manageBindings: true` against the
      // delegate's absent flag failed the rights axis. Narrower on the tree
      // axis and otherwise equal, it is strictly contained now.
      const row = h.tables.sys_permission_set.find((r: any) => r.name === 'sub_admin');
      row.admin_scope = JSON.stringify({ ...EAST_SCOPE, includeSubtree: false, ...RETIRED_FLAGS });
      await expect(grantSubAdmin(gateFor({ ...EAST_SCOPE }))).resolves.toBeUndefined();
    });
  });

  // [ADR-0131 D4] A stored grant's pre-image is judged by the set it NAMES
  // (`permission_set`), read from the catalog by that name; an insert, or an
  // update that re-points the id, is judged by the id it writes, as before.
  describe('[ADR-0131 D4] the pre-image is judged by the name the grant holds', () => {
    const storedGrant = (row: Record<string, unknown>) => {
      for (const set of h.tables.sys_permission_set) set.organization_id ??= null;
      h.tables.sys_user_permission_set = [{ id: 'g1', user_id: 'u_east_1', ...row }];
    };
    const remove = () => h.gate.assert({
      object: 'sys_user_permission_set', operation: 'delete',
      options: { where: { id: 'g1' } }, context: h.ctxOf('delegate'),
    });

    it('a grant naming an allowlisted set may be revoked by the delegate — whatever its id says', async () => {
      storedGrant({ permission_set_id: 'ps_fin', permission_set: 'sales_user' });
      await expect(remove()).resolves.toBeUndefined();
    });

    it('a grant naming a set outside the allowlist is refused — whatever its id says', async () => {
      storedGrant({ permission_set_id: 'ps_sales', permission_set: 'finance_admin' });
      await expect(remove()).rejects.toThrow(/'finance_admin' is not in the scope's allowlist/);
    });

    it('a grant that names NO set is refused: the delegate cannot be shown to hold authority over it', async () => {
      storedGrant({ permission_set_id: 'ps_sales', permission_set: null });
      await expect(remove()).rejects.toThrow(/names no permission set/);
    });

    it('a grant naming a set the security catalog does not hold is refused', async () => {
      storedGrant({ permission_set_id: 'ps_sales', permission_set: 'sales_user_retired' });
      await expect(remove()).rejects.toThrow(/is not in the security catalog/);
    });

    it('an update keeping the set is judged by the stored name; one re-pointing the id by the new id', async () => {
      storedGrant({ permission_set_id: 'ps_sales', permission_set: 'sales_user' });
      await expect(h.gate.assert({
        object: 'sys_user_permission_set', operation: 'update',
        data: { id: 'g1', reason: 'renewed' }, context: h.ctxOf('delegate'),
      })).resolves.toBeUndefined();
      await expect(h.gate.assert({
        object: 'sys_user_permission_set', operation: 'update',
        data: { id: 'g1', permission_set: 'finance_admin' }, context: h.ctxOf('delegate'),
      })).rejects.toThrow(/'finance_admin' is not in the scope's allowlist/);
    });
  });
});

// ── [ADR-0091 D3] Self-service delegation of duty ──────────────────────────

const T0 = Date.parse('2026-07-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * Delegation fixture: a non-admin holder of a `delegatable` position may
 * assign it to a delegate, time-boxed, WITHOUT any adminScope.
 *
 *   approver   (delegatable) → [approve_set]        ← u_boss holds directly
 *   admin_pos  (delegatable) → [sub_admin/adminScope] ← u_boss holds directly
 *   plain_pos  (NOT delegatable)                     ← u_boss holds directly
 *   spare_pos  (delegatable)                         ← u_boss does NOT hold
 *   approver                                         ← u_relay holds via delegation
 *
 * Every holding is owned by {@link DELEGATION_ORG} and every delegation runs in
 * it: a holding takes effect only in its own organization (`resolveAuthzContext`
 * step 4, `grantAppliesInTenant`), so an organization-less holding, or a context
 * carrying no organization, holds nothing to delegate — pinned at the end of
 * the describe below.
 */
const DELEGATION_ORG = 'org_1';

function makeDelegationHarness(nowMs = T0) {
  const tables: Record<string, any[]> = {
    sys_position: [
      { id: 'p_appr', name: 'approver', delegatable: true },
      { id: 'p_admin', name: 'admin_pos', delegatable: true },
      { id: 'p_plain', name: 'plain_pos', delegatable: false },
      { id: 'p_spare', name: 'spare_pos', delegatable: true },
      { id: 'p_everyone', name: 'everyone' },
    ],
    sys_permission_set: [
      { id: 's_appr', name: 'approve_set' },
      { id: 's_sub', name: 'sub_admin', admin_scope: JSON.stringify(EAST_SCOPE) },
    ],
    sys_position_permission_set: [
      { id: 'b_appr', position_id: 'p_appr', permission_set_id: 's_appr' },
      { id: 'b_admin', position_id: 'p_admin', permission_set_id: 's_sub' },
    ],
    sys_user_position: [
      { id: 'h1', user_id: 'u_boss', position: 'approver', organization_id: DELEGATION_ORG },
      { id: 'h2', user_id: 'u_boss', position: 'plain_pos', organization_id: DELEGATION_ORG },
      { id: 'h3', user_id: 'u_boss', position: 'admin_pos', organization_id: DELEGATION_ORG },
      { id: 'h4', user_id: 'u_relay', position: 'approver', delegated_from: 'u_boss', valid_until: iso(nowMs + 20 * DAY), organization_id: DELEGATION_ORG },
    ],
    sys_user: [{ id: 'u_boss' }, { id: 'u_relay' }, { id: 'u_deleg' }],
  };
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  const ql = {
    tables,
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async findOne(object: string, opts: any) {
      return (tables[object] ?? []).filter((r) => matches(r, opts?.where))[0] ?? null;
    },
  } as any;
  bindCatalogFromTables(ql, tables);
  const gate = new DelegatedAdminGate({
    ql,
    resolveSets: async () => [{ name: 'member_default', objects: {} }],
    now: () => nowMs,
  });
  /** `organizationId` null = a context carrying no organization. */
  const delegate = (userId: string, row: any, organizationId: string | null = DELEGATION_ORG) =>
    gate.assert({
      object: 'sys_user_position', operation: 'insert', data: row,
      context: { userId, positions: [], ...(organizationId ? { organizationId } : {}) },
    });
  return { gate, ql, tables, delegate };
}

describe('DelegatedAdminGate — self-service delegation of duty (ADR-0091 D3)', () => {
  it('a direct holder delegates a delegatable position, time-boxed + reasoned; granted_by is stamped', async () => {
    const d = makeDelegationHarness();
    const row: any = { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 10 * DAY), reason: 'vacation stand-in' };
    await expect(d.delegate('u_boss', row)).resolves.toBeUndefined();
    expect(row.granted_by).toBe('u_boss'); // dual audit: writer + authority source
  });

  it('a delegation with no valid_until is rejected (an open-ended delegation is a permanent grant)', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', reason: 'x' }))
      .rejects.toThrow(/requires a valid_until/);
  });

  it('valid_until in the past is rejected', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 - DAY), reason: 'x' }))
      .rejects.toThrow(/not in the future/);
  });

  it('valid_until beyond the 30-day ceiling is rejected; exactly at the ceiling is allowed', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 31 * DAY), reason: 'x' }))
      .rejects.toThrow(/ceiling/);
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 30 * DAY), reason: 'x' }))
      .resolves.toBeUndefined();
  });

  it('a delegation with no reason is rejected (dual audit)', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY) }))
      .rejects.toThrow(/requires a reason/);
  });

  it('you may only delegate authority you hold yourself (delegated_from must be you)', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_other', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/only delegate authority you hold yourself/);
  });

  it('a non-delegatable position cannot be delegated even by a direct holder', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'plain_pos', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/not delegatable/);
  });

  it('you cannot delegate a position you do not hold', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'spare_pos', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/do not currently hold/);
  });

  it('a grant held ONLY via delegation is not re-delegatable (chains are cut)', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_relay', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_relay', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/only via delegation/);
  });

  it('a delegatable position distributing an adminScope set cannot be self-delegated (D12 containment)', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'admin_pos', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/administration cannot be self-delegated/);
  });

  it('you cannot delegate a position to yourself', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_boss', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/to yourself/);
  });

  it('a direct holding that has itself EXPIRED can no longer be delegated (L1 validity threads through)', async () => {
    const d = makeDelegationHarness();
    d.tables.sys_user_position.find((r: any) => r.id === 'h1').valid_until = iso(T0 - DAY); // boss's own approver holding expired
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/do not currently hold/);
  });

  it('a plain assignment (no delegated_from) by the same non-admin still fails closed — the branch triggers only on delegation', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'approver', business_unit_id: 'bu_x' }))
      .rejects.toThrow(/delegated adminScope/);
  });

  it('delegating an audience anchor is rejected by the anchor invariant before delegation rules', async () => {
    const d = makeDelegationHarness();
    await expect(d.delegate('u_boss', { user_id: 'u_deleg', position: 'everyone', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'x' }))
      .rejects.toThrow(/audience anchor/);
  });

  it('an organization-less holding counts nowhere, and a context with no organization holds nothing', async () => {
    const d = makeDelegationHarness();
    const row = () => ({ user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'x' });
    // Control: the holding owned by the organization the request runs in counts.
    await expect(d.delegate('u_boss', row())).resolves.toBeUndefined();
    // The same request from a context that carries no organization holds nothing.
    await expect(d.delegate('u_boss', row(), null)).rejects.toThrow(/do not currently hold/);
    // A holding with no organization — invalid state since the 18.0 ownership
    // ceremony — counts in no organization.
    d.tables.sys_user_position.find((r: any) => r.id === 'h1').organization_id = null;
    await expect(d.delegate('u_boss', row())).rejects.toThrow(/do not currently hold/);
    await expect(d.delegate('u_boss', row(), null)).rejects.toThrow(/do not currently hold/);
  });
});

// ── [cloud#830 follow-up] Self-delegation anchor containment ────────────────
//
// cloud#830 (C1 position-anchor) made sys_user_position.business_unit_id
// visibility LOAD-BEARING: it is the readScope depth anchor, so a
// `unit`/`unit_and_below` holder sees the owner set rooted at that BU (and, for
// unit_and_below, its whole subtree). The self-delegation (D3) path stamped the
// anchor without any subtree/source constraint, so a holder of a delegatable
// non-admin position anchored at a LOW BU could delegate it to a co-conspirator
// with an ANCESTOR/arbitrary-high anchor — leaking that BU's whole subtree,
// beyond the delegator's own range (lateral visibility escalation). The fix
// requires the delegated anchor to fall inside the delegator's OWN effective
// anchor for the position (same spirit as the D12 delegated-admin subtree
// check), fail-closed.
//
// Topology:
//   hq (bu_hq)
//   ├── east (bu_east)          ← u_boss's own approver anchor
//   │   └── east_sales (bu_es)
//   └── west (bu_west)
//
// Every row is owned by DELEGATION_ORG and every delegation runs in it (see
// makeDelegationHarness).
function makeAnchoredDelegationHarness(nowMs = T0) {
  const tables: Record<string, any[]> = {
    sys_business_unit: [
      { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
      { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
      { id: 'bu_es', name: 'east_sales', parent_business_unit_id: 'bu_east' },
      { id: 'bu_west', name: 'west', parent_business_unit_id: 'bu_hq' },
    ],
    sys_position: [{ id: 'p_appr', name: 'approver', delegatable: true }],
    sys_permission_set: [{ id: 's_appr', name: 'approve_set' }],
    sys_position_permission_set: [{ id: 'b_appr', position_id: 'p_appr', permission_set_id: 's_appr' }],
    // u_boss holds approver DIRECTLY, anchored at east.
    sys_user_position: [{ id: 'ha', user_id: 'u_boss', position: 'approver', business_unit_id: 'bu_east' }],
    sys_business_unit_member: [{ id: 'm_boss', user_id: 'u_boss', business_unit_id: 'bu_es' }],
    sys_user: [{ id: 'u_boss' }, { id: 'u_deleg' }],
  };
  for (const object of ['sys_business_unit', 'sys_user_position', 'sys_business_unit_member']) {
    for (const r of tables[object]) r.organization_id = DELEGATION_ORG;
  }
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  const ql = {
    tables,
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async findOne(object: string, opts: any) {
      return (tables[object] ?? []).filter((r) => matches(r, opts?.where))[0] ?? null;
    },
  } as any;
  bindCatalogFromTables(ql, tables);
  const gate = new DelegatedAdminGate({
    ql,
    resolveSets: async () => [{ name: 'member_default', objects: {} }],
    now: () => nowMs,
  });
  const delegate = (userId: string, row: any) =>
    gate.assert({
      object: 'sys_user_position', operation: 'insert', data: row,
      context: { userId, positions: [], organizationId: DELEGATION_ORG },
    });
  const base = (extra: any) => ({
    user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss',
    valid_until: iso(nowMs + 5 * DAY), reason: 'coverage', ...extra,
  });
  return { gate, ql, tables, delegate, base };
}

describe('DelegatedAdminGate — self-delegation anchor containment (cloud#830 follow-up)', () => {
  it('anchor equal to the delegator\'s own anchor (east) is allowed', async () => {
    const d = makeAnchoredDelegationHarness();
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_east' }))).resolves.toBeUndefined();
  });

  it('anchor inside the delegator\'s own subtree (east_sales) is allowed — narrowing', async () => {
    const d = makeAnchoredDelegationHarness();
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_es' }))).resolves.toBeUndefined();
  });

  it('anchor at an ANCESTOR BU (hq) is DENIED — a delegation may not widen visibility', async () => {
    const d = makeAnchoredDelegationHarness();
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_hq' })))
      .rejects.toThrow(/only narrows|never widen/);
  });

  it('anchor at an UNRELATED sibling BU (west) is DENIED — outside your own effective anchor', async () => {
    const d = makeAnchoredDelegationHarness();
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_west' })))
      .rejects.toThrow(/outside your own effective anchor/);
  });

  it('an unanchored delegation row keeps prior behavior (no anchor to widen)', async () => {
    const d = makeAnchoredDelegationHarness();
    await expect(d.delegate('u_boss', d.base({}))).resolves.toBeUndefined();
  });

  it('mutual delegation cannot cross ranges: neither direction may hand out the other\'s BU', async () => {
    // u_boss anchored east may not delegate a west anchor…
    const d = makeAnchoredDelegationHarness();
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_west' })))
      .rejects.toThrow(/outside your own effective anchor/);
    // …and a would-be west holder cannot reach east either (no east holding to source it).
    d.tables.sys_user_position.push({ id: 'hb', user_id: 'u_deleg', position: 'approver', business_unit_id: 'bu_west', organization_id: DELEGATION_ORG });
    await expect(d.delegate('u_deleg', { user_id: 'u_boss', position: 'approver', delegated_from: 'u_deleg', valid_until: iso(T0 + 5 * DAY), reason: 'x', business_unit_id: 'bu_east' }))
      .rejects.toThrow(/outside your own effective anchor/);
  });

  it('when the delegator holds the position UNANCHORED, the anchor is bounded by their MEMBER BU', async () => {
    const d = makeAnchoredDelegationHarness();
    // Drop the anchor on u_boss's own holding; boss is a member of east_sales.
    d.tables.sys_user_position.find((r: any) => r.id === 'ha').business_unit_id = null;
    // Member-BU (east_sales) or below is allowed…
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_es' }))).resolves.toBeUndefined();
    // …but the parent (east) — above the member BU — is not.
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_east' })))
      .rejects.toThrow(/outside your own effective anchor/);
  });

  it('fail-closed: an anchor that cannot be validated (delegator has no resolvable range) is refused', async () => {
    const d = makeAnchoredDelegationHarness();
    // Boss holds approver unanchored AND has no BU membership → no provable range.
    d.tables.sys_user_position.find((r: any) => r.id === 'ha').business_unit_id = null;
    d.tables.sys_business_unit_member.length = 0;
    await expect(d.delegate('u_boss', d.base({ business_unit_id: 'bu_es' })))
      .rejects.toThrow(/cannot be validated/);
  });

  it('a holding acquired VIA delegation cannot source an anchored re-delegation (chains stay cut)', async () => {
    const d = makeAnchoredDelegationHarness();
    // u_relay holds approver only via delegation, anchored east.
    d.tables.sys_user.push({ id: 'u_relay' });
    d.tables.sys_user_position.push({ id: 'hd', user_id: 'u_relay', position: 'approver', business_unit_id: 'bu_east', delegated_from: 'u_boss', valid_until: iso(T0 + 20 * DAY), organization_id: DELEGATION_ORG });
    await expect(d.delegate('u_relay', { user_id: 'u_deleg', position: 'approver', delegated_from: 'u_relay', valid_until: iso(T0 + 5 * DAY), reason: 'x', business_unit_id: 'bu_es' }))
      .rejects.toThrow(/only via delegation/);
  });
});

// ── [ADR-0090 D12 / ADR-0105 D8] describeDelegableScope — the READ half ──────
//
// A picker narrows with this; the gate still decides. So the property that
// matters is AGREEMENT: what the report offers is what `assert()` accepts.
describe('DelegatedAdminGate — describeDelegableScope', () => {
  it('a delegate gets their own subtree and only the positions they may hand out', async () => {
    const report = await h.gate.describeDelegableScope(
      await (h.gate as any).deps.resolveSets({ principal: 'delegate' }),
    );

    expect(report.isTenantAdmin).toBe(false);
    // east + its descendant east_sales — never hq or the west sibling.
    expect([...report.placeableBusinessUnitIds].sort()).toEqual(['bu_east', 'bu_es']);
    // `sales_rep` distributes sales_user (allowlisted). `mixed_pos` also
    // distributes finance_admin, which is NOT — so it is withheld, exactly as
    // assertAssignmentWrite would refuse it.
    expect(report.assignablePositions).toEqual(['sales_rep']);
    // The scope itself is reported for attribution in a UI.
    expect(report.scopes).toHaveLength(1);
    expect(report.scopes[0]).toMatchObject({
      setName: 'sub_admin',
      businessUnit: 'east',
      manageAssignments: true,
      assignablePermissionSets: ['sales_user', 'sub_admin'],
    });
  });

  it('agrees with the gate: every offered (unit, position) pair is one assert() accepts', async () => {
    const report = await h.gate.describeDelegableScope(
      await (h.gate as any).deps.resolveSets({ principal: 'delegate' }),
    );
    for (const business_unit_id of report.placeableBusinessUnitIds) {
      for (const position of report.assignablePositions) {
        await expect(
          insertAssignment(h.ctxOf('delegate'), { user_id: 'u_new', position, business_unit_id }),
        ).resolves.toBeUndefined();
      }
    }
    // …and a withheld position really is refused, so the narrowing is not cosmetic.
    await expect(
      insertAssignment(h.ctxOf('delegate'), {
        user_id: 'u_new', position: 'mixed_pos', business_unit_id: 'bu_east',
      }),
    ).rejects.toThrow(/not in the scope's allowlist/);
  });

  it('a tenant admin is unconstrained — flagged, and everything enumerated for one uniform picker', async () => {
    const report = await h.gate.describeDelegableScope(
      await (h.gate as any).deps.resolveSets({ principal: 'tenant_admin' }),
    );
    expect(report.isTenantAdmin).toBe(true);
    expect([...report.placeableBusinessUnitIds].sort()).toEqual(['bu_east', 'bu_es', 'bu_hq', 'bu_west']);
    // Audience anchors are implicit and can never be assigned (ADR-0090 D9),
    // so they stay out of a picker even for a tenant admin.
    expect(report.assignablePositions).not.toContain('everyone');
    expect([...report.assignablePositions].sort()).toEqual(['mixed_pos', 'sales_rep']);
  });

  it('plain CRUD on the RBAC tables delegates nothing (fail closed)', async () => {
    const report = await h.gate.describeDelegableScope(
      await (h.gate as any).deps.resolveSets({ principal: 'crud_only' }),
    );
    expect(report).toMatchObject({
      isTenantAdmin: false,
      scopes: [],
      placeableBusinessUnitIds: [],
      assignablePositions: [],
    });
  });
});

// ── The organization crossing, on a driver that scopes NOTHING ───────────────
//
// `delegated-admin-gate-cross-organization.test.ts` pins this over a real
// engine and a real `SqlDriver`, where the caller's organization reaches
// `applyTenantScope` and the wrong rows never come back. This half pins the
// OTHER arm of the same repair: the `ql` below ignores `context` entirely —
// the shape of a driver with no tenant scoping at all, and of the driver's own
// deliberate `OR organization_id IS NULL` compatibility arm — so every
// organization's rows are handed to the gate and the row-level selection is
// the only thing standing. `sys_business_unit.name` is not unique, so this is
// not a hypothetical: the gate must pick the caller's own row, not the first
// one it was given.
describe('DelegatedAdminGate — the anchor is picked by organization, not by arrival order', () => {
  const ORG_A = 'org_a_acme';
  /** Sorts first, and is listed first — the row an unscoped read answered with. */
  const ORG_B = 'org_0_globex';

  const SALES_SCOPE = {
    businessUnit: 'sales',
    includeSubtree: true,
    manageAssignments: true,
    assignablePermissionSets: ['sales_user'],
  };
  const DELEGATE_SETS = [
    { name: 'sales_admin', objects: {}, adminScope: SALES_SCOPE },
  ] as any[];

  /** Ignores `context` on purpose — see the block comment above. */
  function unscopedQl() {
    const tables: Record<string, any[]> = {
      sys_business_unit: [
        { id: 'bu_0_sales', name: 'sales', parent_business_unit_id: null, organization_id: ORG_B },
        { id: 'bu_0_sales_east', name: 'sales_east', parent_business_unit_id: 'bu_0_sales', organization_id: ORG_B },
        { id: 'bu_a_sales', name: 'sales', parent_business_unit_id: null, organization_id: ORG_A },
        { id: 'bu_a_sales_east', name: 'sales_east', parent_business_unit_id: 'bu_a_sales', organization_id: ORG_A },
      ],
      sys_position: [{ id: 'pos_a', name: 'sales_rep', organization_id: ORG_A }],
      sys_permission_set: [{ id: 'ps_a', name: 'sales_user', organization_id: ORG_A }],
      sys_position_permission_set: [
        { id: 'bind_a', position_id: 'pos_a', permission_set_id: 'ps_a', organization_id: ORG_A },
      ],
      sys_user_position: [],
      sys_business_unit_member: [],
      sys_user: [],
    };
    const matches = (row: any, where: any): boolean =>
      Object.entries(where ?? {}).every(([k, v]) => {
        // Refuse what this double does not implement, rather than reading a
        // combinator as a field name and answering a quiet `false`.
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
          return (v as any).$in.includes(row[k]);
        }
        return row[k] === v;
      });
    return {
      async find(object: string, opts: any) {
        const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      },
      async findOne(object: string, opts: any) {
        return (tables[object] ?? []).filter((r) => matches(r, opts?.where))[0] ?? null;
      },
    } as any;
  }

  const makeGate = () =>
    new DelegatedAdminGate({
      ql: unscopedQl(),
      resolveSets: async (ctx: any) => (ctx?.principal === 'delegate' ? DELEGATE_SETS : []),
    });
  const ctxA = { principal: 'delegate', userId: 'usr_delegate', tenantId: ORG_A };

  it("resolves the caller's own `sales`, not the first row the driver handed over", async () => {
    const report = await makeGate().describeDelegableScope(DELEGATE_SETS as any, ctxA);
    expect([...report.placeableBusinessUnitIds].sort()).toEqual(['bu_a_sales', 'bu_a_sales_east']);
  });

  it('refuses a delegated write anchored in the other organization', async () => {
    await expect(makeGate().assert({
      object: 'sys_user_position',
      operation: 'insert',
      data: { user_id: 'usr_x', position: 'sales_rep', business_unit_id: 'bu_0_sales_east' },
      context: ctxA,
    })).rejects.toThrow(/outside the delegated subtree/);
  });

  it("approves the same write inside the caller's own organization", async () => {
    await expect(makeGate().assert({
      object: 'sys_user_position',
      operation: 'insert',
      data: { user_id: 'usr_x', position: 'sales_rep', business_unit_id: 'bu_a_sales_east' },
      context: ctxA,
    })).resolves.toBeUndefined();
  });

  it('an anchor that exists ONLY in another organization approves nothing (fail closed)', async () => {
    const sets = [{ name: 'other_admin', objects: {}, adminScope: { ...SALES_SCOPE, businessUnit: 'sales_east' } }] as any[];
    const gate = new DelegatedAdminGate({
      ql: unscopedQl(),
      resolveSets: async () => sets,
    });
    // `sales_east` exists in both organizations; a caller in NEITHER resolves
    // by name as before — the `single`-posture surface, unchanged.
    const orgLess = await gate.describeDelegableScope(sets as any, { userId: 'usr_delegate' });
    expect(orgLess.placeableBusinessUnitIds).toEqual(['bu_0_sales_east']);
    // A caller in a THIRD organization resolves nothing at all.
    const stranger = await gate.describeDelegableScope(sets as any, {
      userId: 'usr_delegate',
      tenantId: 'org_z_initech',
    });
    expect(stranger.placeableBusinessUnitIds).toEqual([]);
    expect(stranger.scopes[0].businessUnitIds).toEqual([]);
  });
});

// ── A position is the security catalog's definition, not an organization's row ─
// [ADR-0131 D3/D4] The two position-keyed authority decisions (delegatable;
// bound sets) read the position's DEFINITION from the environment catalog by
// name. Every organization's `sys_position` rows and junction rows are handed
// to the gate on a context-ignoring double, and none of them is what decides:
// the catalog is one per deployment, and a row is not a position.
describe('DelegatedAdminGate — a position is the catalog definition, not an organization row', () => {
  const ORG_A = 'org_a_acme';
  const ORG_B = 'org_0_globex';
  const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const SALES_SCOPE = {
    businessUnit: 'sales',
    includeSubtree: true,
    manageAssignments: true,
    assignablePermissionSets: ['sales_user'],
  };
  const DELEGATE_SETS = [{ name: 'sales_admin', objects: {}, adminScope: SALES_SCOPE }] as any[];

  /** Ignores `context` on purpose — see the block comment above. */
  function unscopedQl() {
    const tables: Record<string, any[]> = {
      sys_business_unit: [
        { id: 'bu_a_sales', name: 'sales', parent_business_unit_id: null, organization_id: ORG_A },
      ],
      // Rows that SAY otherwise: org B's `closer` is delegatable and bound to
      // the allowlisted set, and `night_shift` exists only as a row.
      sys_position: [
        { id: 'pos_', name: 'night_shift', delegatable: true, organization_id: null },
        { id: 'pos_0_closer', name: 'closer', delegatable: true, organization_id: ORG_B },
        { id: 'pos_0_greeter', name: 'greeter', delegatable: false, organization_id: ORG_B },
      ],
      sys_permission_set: [
        { id: 'ps_0_sales_user', name: 'sales_user', organization_id: ORG_B },
      ],
      sys_position_permission_set: [
        { id: 'bind_0', position_id: 'pos_0_closer', permission_set_id: 'ps_0_sales_user', organization_id: ORG_B },
      ],
      sys_user_position: [
        { id: 'up_1', user_id: 'usr_holder', position: 'closer', organization_id: ORG_A },
        { id: 'up_2', user_id: 'usr_holder', position: 'night_shift', organization_id: ORG_A },
        { id: 'up_3', user_id: 'usr_holder', position: 'greeter', organization_id: ORG_A },
      ],
      sys_business_unit_member: [],
      sys_user: [],
    };
    const matches = (row: any, where: any): boolean =>
      Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
          return (v as any).$in.includes(row[k]);
        }
        return row[k] === v;
      });
    const ql = {
      async find(object: string, opts: any) {
        const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      },
      async findOne(object: string, opts: any) {
        return (tables[object] ?? []).filter((r) => matches(r, opts?.where))[0] ?? null;
      },
    } as any;
    // The catalog: `closer` is NOT delegatable and distributes `finance_user`;
    // `greeter` IS delegatable and distributes `sales_user`; no `night_shift`.
    return bindTestSecurityCatalog(ql, {
      positions: [
        { name: 'closer', permissionSets: ['finance_user'] },
        { name: 'greeter', delegatable: true, permissionSets: ['sales_user'] },
      ],
      permissions: [{ name: 'sales_user' }, { name: 'finance_user' }],
    });
  }

  const makeGate = () =>
    new DelegatedAdminGate({
      ql: unscopedQl(),
      resolveSets: async (ctx: any) => (ctx?.principal === 'delegate' ? DELEGATE_SETS : []),
    });
  const selfDelegate = (position: string) =>
    makeGate().assert({
      object: 'sys_user_position',
      operation: 'insert',
      data: { user_id: 'usr_colleague', position, delegated_from: 'usr_holder', valid_until: FUTURE, reason: 'leave' },
      context: { principal: 'holder', userId: 'usr_holder', tenantId: ORG_A },
    });

  it('refuses a self-delegation the definition never opted in to, whatever a row says', async () => {
    await expect(selfDelegate('closer')).rejects.toThrow(/position 'closer' is not delegatable/);
  });

  it('a position that exists only as a row is not delegatable', async () => {
    await expect(selfDelegate('night_shift')).rejects.toThrow(/position 'night_shift' is not delegatable/);
  });

  it('CONTROL: the definition opts in, a row saying otherwise does not refuse it', async () => {
    await expect(selfDelegate('greeter')).resolves.toBeUndefined();
  });

  it("judges a delegated assignment by the definition's permissionSets, not a junction row", async () => {
    await expect(makeGate().assert({
      object: 'sys_user_position',
      operation: 'insert',
      data: { user_id: 'usr_x', position: 'closer', business_unit_id: 'bu_a_sales' },
      context: { principal: 'delegate', userId: 'usr_delegate', tenantId: ORG_A },
    })).rejects.toThrow(/position 'closer' distributes permission set 'finance_user', which is not in the scope's allowlist/);
  });
});

// ── granted_by is the writer on every admitted insert ─────────────────────
//
// `granted_by` is provenance (`readonly` on both grant tables): the gate stamps
// the writer on every non-system insert it admits, whatever the payload
// carried — a caller-supplied granter is overwritten, not kept, and a
// tenant-level admin's grant is stamped too. What is stored on the real engine
// is pinned in `granted-by-writer-provenance.test.ts`; this block pins the
// gate's own half, path by path.
describe('DelegatedAdminGate — granted_by is the writer on every admitted insert', () => {
  const grantRow = (extra: Record<string, unknown> = {}): any => ({ user_id: 'u_east_1', permission_set: 'sales_user', ...extra });
  const assignmentRow = (extra: Record<string, unknown> = {}): any => ({ user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es', ...extra });

  for (const [object, row] of [
    ['sys_user_position', assignmentRow],
    ['sys_user_permission_set', grantRow],
  ] as const) {
    for (const principal of ['tenant_admin', 'delegate'] as const) {
      it(`${object}: ${principal} naming another user as granter is stamped with the writer`, async () => {
        const data = row({ granted_by: 'u_west_1' });
        await expect(h.gate.assert({ object, operation: 'insert', data, context: h.ctxOf(principal) })).resolves.toBeUndefined();
        expect(data.granted_by).toBe(`u_${principal}`);
      });

      it(`${object}: ${principal} naming no granter is stamped with the writer`, async () => {
        const data = row();
        await expect(h.gate.assert({ object, operation: 'insert', data, context: h.ctxOf(principal) })).resolves.toBeUndefined();
        expect(data.granted_by).toBe(`u_${principal}`);
      });
    }

    it(`${object}: every row of a batch insert is stamped`, async () => {
      const data = [row({ granted_by: 'u_west_1' }), row()];
      await expect(h.gate.assert({ object, operation: 'insert', data, context: h.ctxOf('tenant_admin') })).resolves.toBeUndefined();
      expect(data.map((r: any) => r.granted_by)).toEqual(['u_tenant_admin', 'u_tenant_admin']);
    });

    it(`${object}: a refused insert is not stamped`, async () => {
      const data = row({ granted_by: 'u_west_1' });
      await expect(h.gate.assert({ object, operation: 'insert', data, context: h.ctxOf('crud_only') })).rejects.toThrow(/delegated adminScope/);
      expect(data.granted_by).toBe('u_west_1');
    });

    it(`${object}: an update is not stamped — the column is readonly, so the engine's update strip owns it`, async () => {
      const data = { id: 'a_prev', granted_by: 'u_west_1' };
      await expect(h.gate.assert({ object, operation: 'update', data, context: h.ctxOf('tenant_admin') })).resolves.toBeUndefined();
      expect(data.granted_by).toBe('u_west_1');
    });
  }

  it('a self-delegation naming another user as granter is stamped with the delegator', async () => {
    const d = makeDelegationHarness();
    const row: any = {
      user_id: 'u_deleg', position: 'approver', delegated_from: 'u_boss', valid_until: iso(T0 + 10 * DAY),
      reason: 'vacation stand-in', granted_by: 'u_relay',
    };
    await expect(d.delegate('u_boss', row)).resolves.toBeUndefined();
    expect(row.granted_by).toBe('u_boss');
  });

  it('a governed object with no granted_by column is never given one', async () => {
    const member: any = { user_id: 'u_x', organization_id: 'org_1', role: 'admin' };
    await expect(h.gate.assert({ object: 'sys_member', operation: 'insert', data: member, context: h.ctxOf('tenant_admin') })).resolves.toBeUndefined();
    expect('granted_by' in member).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// [ADR-0090 D12, amended 2026-10-17] Organization-level administration
// ---------------------------------------------------------------------------

/**
 * Organization org_a holds units bu_a1 (and org_b holds bu_b1). The catalog:
 * `in_set` (inside), `org_cap_set` (an org capability, inside), `wild_set`
 * (superuser bit — condition a), `scoped_set` (adminScope — condition b),
 * `plat_cap_set` (a platform capability — condition c), `undeclared_cap_set`
 * (a capability nobody declares — condition c), and the shipped names the ADR
 * keeps outside. Positions: `in_pos` → [in_set], `mixed_pos` → [in_set,
 * wild_set], `ghost_pos` → [missing_set], `self_named` → [in_set] beside a
 * permission set of the position's own name that carries a platform capability
 * — which no assignment grants (#24757), so it is not judged.
 */
function makeOrganizationHarness() {
  const tables: Record<string, any[]> = {
    sys_business_unit: [
      { id: 'bu_a1', name: 'a_ops', parent_business_unit_id: null, organization_id: 'org_a' },
      { id: 'bu_b1', name: 'b_ops', parent_business_unit_id: null, organization_id: 'org_b' },
    ],
    sys_user_position: [
      { id: 'up_a', user_id: 'u_member', position: 'in_pos', organization_id: 'org_a' },
      { id: 'up_a_mixed', user_id: 'u_member', position: 'mixed_pos', organization_id: 'org_a' },
      { id: 'up_b', user_id: 'u_member_b', position: 'in_pos', organization_id: 'org_b' },
      { id: 'up_orgless', user_id: 'u_member', position: 'in_pos', organization_id: null },
    ],
    sys_user_permission_set: [
      { id: 'ups_a', user_id: 'u_member', permission_set: 'in_set', organization_id: 'org_a' },
      { id: 'ups_a_wild', user_id: 'u_member', permission_set: 'wild_set', organization_id: 'org_a' },
    ],
    sys_member: [
      { id: 'm_a', user_id: 'u_member', organization_id: 'org_a', role: 'member' },
      { id: 'm_b', user_id: 'u_member_b', organization_id: 'org_b', role: 'member' },
    ],
  };
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  const ql: any = {
    tables,
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async findOne(object: string, opts: any) {
      return (tables[object] ?? []).find((r) => matches(r, opts?.where)) ?? null;
    },
  };
  bindTestSecurityCatalog(ql, {
    permissions: [
      { name: 'in_set', objects: { crm_account: { allowRead: true, allowCreate: true } } },
      { name: 'org_cap_set', objects: {}, systemPermissions: ['manage_org_users'] },
      { name: 'wild_set', objects: { '*': { allowRead: true, viewAllRecords: true } } },
      { name: 'scoped_set', objects: {}, adminScope: { businessUnit: 'a_ops', manageAssignments: true, assignablePermissionSets: ['in_set'] } },
      { name: 'plat_cap_set', objects: {}, systemPermissions: ['manage_metadata'] },
      { name: 'undeclared_cap_set', objects: {}, systemPermissions: ['qa_nobody_declares_this'] },
      { name: 'self_named', objects: {}, systemPermissions: ['manage_users'] },
      { name: 'admin_full_access', objects: { '*': { allowRead: true, modifyAllRecords: true } } },
      { name: 'organization_admin', objects: { '*': { allowRead: true, modifyAllRecords: true } } },
      { name: 'organization_admin_no_bypass', objects: { '*': { allowRead: true } }, systemPermissions: ['manage_org_users'] },
      { name: 'mcp_agent_data_read', objects: { '*': { allowRead: true } } },
      { name: 'mcp_agent_data_write', objects: { '*': { allowRead: true, allowCreate: true } } },
      { name: 'mcp_agent_restricted', objects: {} },
    ],
    positions: [
      { name: 'in_pos', permissionSets: ['in_set'] },
      { name: 'mixed_pos', permissionSets: ['in_set', 'wild_set'] },
      { name: 'ghost_pos', permissionSets: ['missing_set'] },
      { name: 'self_named', permissionSets: ['in_set'] },
      { name: 'org_owner_like', permissionSets: ['organization_admin'] },
    ],
    capabilities: [
      { name: 'manage_org_users', scope: 'org' },
      { name: 'manage_metadata', scope: 'platform' },
      { name: 'manage_users', scope: 'platform' },
    ],
  });

  const SETS: Record<string, any[]> = {
    // The walled variant carries the superuser wildcard; the wall-less one does not.
    org_admin: [{ name: 'organization_admin', objects: { '*': { allowRead: true, modifyAllRecords: true } } }],
    org_admin_nb: [{ name: 'organization_admin_no_bypass', objects: { '*': { allowRead: true } } }],
    platform_admin: [
      { name: 'admin_full_access', objects: { '*': { allowRead: true, modifyAllRecords: true } } },
      { name: 'organization_admin', objects: { '*': { allowRead: true, modifyAllRecords: true } } },
    ],
    member: [{ name: 'member_default', objects: {} }],
    org_admin_and_delegate: [
      { name: 'organization_admin_no_bypass', objects: { '*': { allowRead: true } } },
      { name: 'scoped_set', objects: {}, adminScope: { businessUnit: 'a_ops', includeSubtree: true, manageAssignments: true, assignablePermissionSets: ['wild_set'] } },
    ],
  };
  const gate = new DelegatedAdminGate({ ql, resolveSets: async (c: any) => SETS[c?.principal ?? ''] ?? [] });
  const ctxOf = (principal: string, tenantId: string | null = 'org_a') =>
    ({ principal, userId: `u_${principal}`, ...(tenantId ? { tenantId } : {}) });
  return { gate, ql, tables, ctxOf };
}

/** The refusal an HTTP door answers, asserted by its ADR-0112 identity, not by a bare throw. */
async function deniedOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    expect([(e as any).code, (e as any).status]).toEqual(['PERMISSION_DENIED', 403]);
    return e;
  }
  throw new Error('expected the write to be refused, but it was admitted');
}

describe('DelegatedAdminGate — organization administrators (ADR-0090 D12 as amended 2026-10-17)', () => {
  let o: ReturnType<typeof makeOrganizationHarness>;
  beforeEach(() => { o = makeOrganizationHarness(); });

  const write = (ctx: any, object: string, operation: string, data: any) =>
    o.gate.assert({ object, operation, data, context: ctx });

  for (const principal of ['org_admin', 'org_admin_nb']) {
    describe(principal === 'org_admin' ? 'organization_admin (walled)' : 'organization_admin_no_bypass (wall-less)', () => {
      it('inserts an in-boundary position and an in-boundary set for a member; the rows land in its organization', async () => {
        const pos: any = { user_id: 'u_member', position: 'in_pos', business_unit_id: 'bu_a1' };
        await expect(write(o.ctxOf(principal), 'sys_user_position', 'insert', pos)).resolves.toBeUndefined();
        expect(pos).toMatchObject({ organization_id: 'org_a', granted_by: `u_${principal}` });
        for (const setName of ['in_set', 'org_cap_set']) {
          const grant: any = { user_id: 'u_member', permission_set: setName };
          await expect(write(o.ctxOf(principal), 'sys_user_permission_set', 'insert', grant), setName).resolves.toBeUndefined();
          expect(grant.organization_id).toBe('org_a');
        }
      });

      it('self-assignment of an in-boundary set is admitted (the boundary, not the target, decides)', async () => {
        await expect(write(o.ctxOf(principal), 'sys_user_permission_set', 'insert',
          { user_id: `u_${principal}`, permission_set: 'in_set' })).resolves.toBeUndefined();
      });

      it('deletes an in-boundary row of its organization by id', async () => {
        await expect(write(o.ctxOf(principal), 'sys_user_position', 'delete', { id: 'up_a' })).resolves.toBeUndefined();
        await expect(write(o.ctxOf(principal), 'sys_user_permission_set', 'delete', { id: 'ups_a' })).resolves.toBeUndefined();
      });

      it('refuses every out-of-boundary set, naming the set and the condition — to a member and to itself', async () => {
        const cases: Array<[string, RegExp]> = [
          ['wild_set', /'wild_set'.*condition \(a\).*'viewAllRecords'/],
          ['scoped_set', /'scoped_set'.*condition \(b\)/],
          ['plat_cap_set', /'plat_cap_set'.*condition \(c\).*'manage_metadata'/],
          ['undeclared_cap_set', /'undeclared_cap_set'.*condition \(c\).*declared nowhere/],
          ['missing_set', /'missing_set'.*not in the security catalog/],
          ['admin_full_access', /'admin_full_access'.*by name/],
          ['organization_admin', /'organization_admin'.*by name/],
          ['organization_admin_no_bypass', /'organization_admin_no_bypass'.*by name/],
          ['mcp_agent_data_read', /'mcp_agent_data_read'.*by name/],
          ['mcp_agent_data_write', /'mcp_agent_data_write'.*by name/],
          ['mcp_agent_restricted', /'mcp_agent_restricted'.*by name/],
        ];
        for (const [setName, why] of cases) {
          for (const userId of ['u_member', `u_${principal}`]) {
            const err = await deniedOf(() => write(o.ctxOf(principal), 'sys_user_permission_set', 'insert',
              { user_id: userId, permission_set: setName }));
            expect(err.message, `${setName} → ${userId}`).toMatch(why);
            expect(err.details?.permissionSet, setName).toBe(setName);
          }
        }
      });

      it('a position carrying a mixed bundle is outside whole — one set outside puts the position outside', async () => {
        const err = await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'insert',
          { user_id: 'u_member', position: 'mixed_pos' }));
        expect(err.message).toMatch(/position 'mixed_pos' carries permission set 'wild_set'.*condition \(a\)/);
        expect(err.details).toMatchObject({ position: 'mixed_pos', permissionSet: 'wild_set' });
        // …and so is removing it: the right covers in-boundary rows only.
        await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'delete', { id: 'up_a_mixed' }));
        await deniedOf(() => write(o.ctxOf(principal), 'sys_user_permission_set', 'delete', { id: 'ups_a_wild' }));
      });

      it("does not count a set that only shares the position's name: no assignment grants it (#24757)", async () => {
        // `self_named`'s own-name set carries a platform capability and would
        // fail condition (c); the position lists only `in_set`, which is inside.
        await expect(write(o.ctxOf(principal), 'sys_user_position', 'insert',
          { user_id: 'u_member', position: 'self_named' })).resolves.toBeUndefined();
      });

      it('refuses a position that carries organization_admin, and a position the catalog does not hold', async () => {
        expect((await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'insert',
          { user_id: 'u_member', position: 'org_owner_like' }))).message).toMatch(/'organization_admin'.*by name/);
        expect((await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'insert',
          { user_id: 'u_member', position: 'no_such_pos' }))).message).toMatch(/position 'no_such_pos' is not in the security catalog/);
        expect((await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'insert',
          { user_id: 'u_member', position: 'ghost_pos' }))).message).toMatch(/'missing_set'.*not in the security catalog/);
      });

      it('refuses a row of another organization, and the removal of a foreign or organization-less row', async () => {
        expect((await deniedOf(() => write(o.ctxOf(principal), 'sys_user_permission_set', 'insert',
          { user_id: 'u_member_b', permission_set: 'in_set', organization_id: 'org_b' }))).message)
          .toMatch(/belongs to organization 'org_b'/);
        expect((await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'delete', { id: 'up_b' }))).message)
          .toMatch(/belongs to organization 'org_b'/);
        expect((await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'delete', { id: 'up_orgless' }))).message)
          .toMatch(/carries no organization/);
      });

      it("refuses a business unit of another organization as the assignment's anchor", async () => {
        const err = await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'insert',
          { user_id: 'u_member', position: 'in_pos', business_unit_id: 'bu_b1' }));
        expect(err.message).toMatch(/business unit 'bu_b1' is not a unit of the organization you administer/);
      });

      it('refuses an edit in place, a filter delete, and a caller with no active organization', async () => {
        expect((await deniedOf(() => write(o.ctxOf(principal), 'sys_user_position', 'update',
          { id: 'up_a', reason: 'x' }))).message).toMatch(/never edited in place/);
        expect((await deniedOf(() => o.gate.assert({ object: 'sys_user_position', operation: 'delete',
          options: { where: { user_id: 'u_member' } }, context: o.ctxOf(principal) }))).message).toMatch(/one assignment row by id/);
        expect((await deniedOf(() => write(o.ctxOf(principal, null), 'sys_user_permission_set', 'insert',
          { user_id: 'u_member', permission_set: 'in_set' }))).message).toMatch(/no active organization/);
      });

      it('still may not write membership rows — administrator status comes from the membership grade alone', async () => {
        await deniedOf(() => write(o.ctxOf(principal), 'sys_member', 'insert',
          { user_id: 'u_member', organization_id: 'org_a', role: 'admin' }));
      });

      it('a refused insert is neither stamped nor given an organization', async () => {
        const grant: any = { user_id: 'u_member', permission_set: 'wild_set' };
        await deniedOf(() => write(o.ctxOf(principal), 'sys_user_permission_set', 'insert', grant));
        expect('organization_id' in grant || 'granted_by' in grant).toBe(false);
      });
    });
  }

  it('a platform administrator keeps the status quo, organization_admin beside it or not', async () => {
    await expect(write(o.ctxOf('platform_admin'), 'sys_user_permission_set', 'insert',
      { user_id: 'u_member', permission_set: 'admin_full_access' })).resolves.toBeUndefined();
    await expect(write(o.ctxOf('platform_admin'), 'sys_user_position', 'update', { id: 'up_a', reason: 'x' })).resolves.toBeUndefined();
  });

  it('a member is denied as before', async () => {
    expect((await deniedOf(() => write(o.ctxOf('member'), 'sys_user_permission_set', 'insert',
      { user_id: 'u_member', permission_set: 'in_set' }))).message).toMatch(/delegated adminScope/);
  });

  it('an organization administrator that is also a delegate falls back to its adminScope outside the boundary', async () => {
    // wild_set is outside the organization boundary but on the delegate's allowlist.
    await expect(write(o.ctxOf('org_admin_and_delegate'), 'sys_user_position', 'insert',
      { user_id: 'u_member', position: 'mixed_pos', business_unit_id: 'bu_a1' })).rejects.toThrow(/delegated 'insert' on sys_user_position rejected — position 'mixed_pos' distributes permission set 'in_set'/);
    await expect(write(o.ctxOf('org_admin_and_delegate'), 'sys_user_permission_set', 'insert',
      { user_id: 'u_member', permission_set: 'in_set' })).resolves.toBeUndefined();
  });

  describe('the two doors', () => {
    it('describeDelegableScope: every unit of its organization is placeable and only in-boundary positions are assignable', async () => {
      for (const principal of ['org_admin', 'org_admin_nb']) {
        const report = await o.gate.describeDelegableScope(
          (await (o.gate as any).deps.resolveSets(o.ctxOf(principal))) as any,
          o.ctxOf(principal),
        );
        expect(report, principal).toEqual({
          isTenantAdmin: false,
          scopes: [],
          placeableBusinessUnitIds: ['bu_a1'],
          assignablePositions: ['in_pos', 'self_named'],
        });
      }
    });

    it('describeDelegableScope: a platform administrator is still reported tenant-level', async () => {
      const report = await o.gate.describeDelegableScope(
        (await (o.gate as any).deps.resolveSets(o.ctxOf('platform_admin'))) as any,
        o.ctxOf('platform_admin'),
      );
      expect(report.isTenantAdmin).toBe(true);
      expect(report.assignablePositions).toContain('mixed_pos');
    });

    it('organizationAdminCoversUser: a member of its own organization only, and never for a non-administrator', async () => {
      const sets = async (p: string) => (o.gate as any).deps.resolveSets(o.ctxOf(p));
      expect(await o.gate.organizationAdminCoversUser(await sets('org_admin'), 'u_member', o.ctxOf('org_admin'))).toBe(true);
      expect(await o.gate.organizationAdminCoversUser(await sets('org_admin_nb'), 'u_member', o.ctxOf('org_admin_nb'))).toBe(true);
      expect(await o.gate.organizationAdminCoversUser(await sets('org_admin'), 'u_member_b', o.ctxOf('org_admin'))).toBe(false);
      expect(await o.gate.organizationAdminCoversUser(await sets('member'), 'u_member', o.ctxOf('member'))).toBe(false);
      expect(await o.gate.organizationAdminCoversUser(await sets('org_admin'), 'u_member', o.ctxOf('org_admin', null))).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// [ADR-0090 D12, amended 2026-10-17; #24757] The delegated walk judges the
// listed sets, never a set that only shares the position's name
// ---------------------------------------------------------------------------

/**
 * The sets a position carries are every set an assignment of it grants:
 * exactly the names its definition lists. The permission set of the position's
 * own name was judged too while the resolver folded held position names into
 * the requested set names; #24757 retired the fold, so that set is granted by
 * nothing and judged by nothing — in the allowlist check, in strict
 * containment, in the self-delegation rule against handing out administration
 * and in the delegable-scope listing.
 *
 * Catalog: `rep_pos` → [field_user] beside a plain set named `rep_pos`;
 * `lead_pos` → [field_user] beside a set named `lead_pos` that carries the wide
 * delegate's own scope; `clerk_pos` → [field_user] with no set of its name;
 * `duty_pos` (delegatable) → [field_user] beside a set named `duty_pos` that
 * carries an adminScope; `duty_plain` (delegatable) → [field_user]. The
 * controls that keep the admissions from being a gate judging nothing:
 * `audit_pos` → [audit_set], which neither delegate allowlists, and
 * `duty_admin` (delegatable) → [duty_admin_set], a LISTED set carrying an
 * adminScope.
 */
function makeOwnNameHarness() {
  const tables: Record<string, any[]> = {
    sys_business_unit: [
      { id: 'bu_hq', name: 'hq', parent_business_unit_id: null },
      { id: 'bu_east', name: 'east', parent_business_unit_id: 'bu_hq' },
      { id: 'bu_es', name: 'east_sales', parent_business_unit_id: 'bu_east' },
    ],
    sys_user_position: [
      { id: 'held_rep', user_id: 'u_east_1', position: 'rep_pos', business_unit_id: 'bu_es' },
      // A holding takes effect only in its own organization, so the delegator's
      // holdings are stamped with the one the delegation below runs in.
      { id: 'boss_duty', user_id: 'u_boss', position: 'duty_pos', organization_id: DELEGATION_ORG },
      { id: 'boss_plain', user_id: 'u_boss', position: 'duty_plain', organization_id: DELEGATION_ORG },
      { id: 'boss_admin', user_id: 'u_boss', position: 'duty_admin', organization_id: DELEGATION_ORG },
    ],
    sys_business_unit_member: [{ id: 'm1', business_unit_id: 'bu_es', user_id: 'u_east_1' }],
    sys_user: [{ id: 'u_east_1' }, { id: 'u_boss' }, { id: 'u_deleg' }],
  };
  const matches = (row: any, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) return (v as any).$in.includes(row[k]);
      return row[k] === v;
    });
  const ql: any = {
    tables,
    async find(object: string, opts: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, opts?.where));
      return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    async findOne(object: string, opts: any) {
      return (tables[object] ?? []).find((r) => matches(r, opts?.where)) ?? null;
    },
  };
  const scope = (allow: string[]) => ({ businessUnit: 'east', includeSubtree: true, manageAssignments: true, assignablePermissionSets: allow });
  const WIDE_ALLOW = ['field_user', 'rep_pos', 'lead_pos'];
  bindTestSecurityCatalog(ql, {
    permissions: [
      { name: 'field_user', objects: { crm_account: { allowRead: true } } },
      { name: 'rep_pos', objects: { crm_account: { allowRead: true, allowEdit: true } } },
      { name: 'lead_pos', objects: {}, adminScope: scope(WIDE_ALLOW) },
      { name: 'duty_pos', objects: {}, adminScope: scope(['field_user']) },
      { name: 'audit_set', objects: { crm_account: { allowRead: true } } },
      { name: 'duty_admin_set', objects: {}, adminScope: scope(['field_user']) },
    ],
    positions: [
      { name: 'rep_pos', permissionSets: ['field_user'] },
      { name: 'lead_pos', permissionSets: ['field_user'] },
      { name: 'clerk_pos', permissionSets: ['field_user'] },
      { name: 'duty_pos', permissionSets: ['field_user'], delegatable: true },
      { name: 'duty_plain', permissionSets: ['field_user'], delegatable: true },
      { name: 'audit_pos', permissionSets: ['audit_set'] },
      { name: 'duty_admin', permissionSets: ['duty_admin_set'], delegatable: true },
    ],
  });
  const SETS: Record<string, any[]> = {
    // Allowlists the set the positions LIST, not their own-name sets.
    narrow: [{ name: 'east_admin', objects: {}, adminScope: scope(['field_user']) }],
    // Also allowlists the own-name sets — which no assignment hands out.
    wide: [{ name: 'east_admin_wide', objects: {}, adminScope: scope(WIDE_ALLOW) }],
    member: [{ name: 'member_default', objects: {} }],
  };
  const gate = new DelegatedAdminGate({
    ql,
    resolveSets: async (c: any) => SETS[c?.principal ?? ''] ?? [],
    now: () => T0,
  });
  const ctxOf = (principal: string) => ({ principal, userId: `u_${principal}`, positions: [] });
  const assign = (principal: string, position: string) => gate.assert({
    object: 'sys_user_position', operation: 'insert', context: ctxOf(principal),
    data: { user_id: 'u_east_1', position, business_unit_id: 'bu_es' },
  });
  const offered = async (principal: string) =>
    (await gate.describeDelegableScope(SETS[principal] as any, ctxOf(principal))).assignablePositions.sort();
  return { gate, tables, ctxOf, assign, offered };
}

describe("DelegatedAdminGate — a set that only shares the position's name is not judged (ADR-0090 D12 as amended 2026-10-17; #24757)", () => {
  let n: ReturnType<typeof makeOwnNameHarness>;
  beforeEach(() => { n = makeOwnNameHarness(); });

  it("admits an assignment whose own-name set is outside the allowlist: the assignment does not grant it", async () => {
    const row: any = { user_id: 'u_east_1', position: 'rep_pos', business_unit_id: 'bu_es' };
    await expect(n.gate.assert({ object: 'sys_user_position', operation: 'insert', data: row, context: n.ctxOf('narrow') }))
      .resolves.toBeUndefined();
    expect(row.granted_by).toBe('u_narrow');
  });

  it("CONTROL: refuses an assignment whose LISTED set is outside the allowlist — 403 DELEGATION_SCOPE_VIOLATION (#26189), naming the set", async () => {
    const err = await refusalOf(() => n.assign('narrow', 'audit_pos'));
    expect([err.code, err.status]).toEqual(['DELEGATION_SCOPE_VIOLATION', 403]);
    expect(err.message).toMatch(/position 'audit_pos' distributes permission set 'audit_set', which is not in the scope's allowlist/);
    expect(err.details).toMatchObject({ position: 'audit_pos' });
  });

  it('a position with no own-name set in the catalog is judged on its listed sets alone, as before', async () => {
    await expect(n.assign('narrow', 'clerk_pos')).resolves.toBeUndefined();
  });

  it('removing an assignment is judged on the same sets: the narrow delegate may evict one whose own-name set it does not allowlist', async () => {
    await expect(n.gate.assert({
      object: 'sys_user_position', operation: 'delete', options: { where: { id: 'held_rep' } }, context: n.ctxOf('narrow'),
    })).resolves.toBeUndefined();
  });

  it('an own-name set carrying an adminScope is not held to strict containment: the assignment does not hand it out', async () => {
    await expect(n.assign('wide', 'lead_pos')).resolves.toBeUndefined();
  });

  it('the delegable-scope listing offers exactly the positions the write admits', async () => {
    const all = ['audit_pos', 'clerk_pos', 'duty_admin', 'duty_plain', 'duty_pos', 'lead_pos', 'rep_pos'];
    expect(await n.offered('narrow')).toEqual(all.filter((p) => p !== 'audit_pos' && p !== 'duty_admin'));
    expect(await n.offered('wide')).toEqual(all.filter((p) => p !== 'audit_pos' && p !== 'duty_admin'));
    for (const principal of ['narrow', 'wide']) {
      const offered = await n.offered(principal);
      for (const position of all) {
        const admitted = await n.assign(principal, position).then(() => true, () => false);
        expect(admitted, `${principal} · ${position}`).toBe(offered.includes(position));
      }
    }
  });

  it('a delegatable position whose own-name set carries an adminScope may be self-delegated: it distributes no administration', async () => {
    const delegation = (position: string) => n.gate.assert({
      object: 'sys_user_position', operation: 'insert', context: { userId: 'u_boss', positions: [], principal: 'member', organizationId: DELEGATION_ORG },
      data: { user_id: 'u_deleg', position, delegated_from: 'u_boss', valid_until: iso(T0 + 5 * DAY), reason: 'cover' },
    });
    await expect(delegation('duty_pos')).resolves.toBeUndefined();
    // CONTROL: a delegatable position whose LISTED set carries an adminScope
    // still cannot be self-delegated.
    const err = await deniedOf(() => delegation('duty_admin'));
    expect(err.message).toMatch(/position 'duty_admin' distributes the admin set 'duty_admin_set' — administration cannot be self-delegated/);
    expect(err.details).toMatchObject({ position: 'duty_admin', permissionSet: 'duty_admin_set' });
  });
});

// ── [#26189] A refusal that describes the caller's OWN delegated scope answers
//    its own code. The split is the ruling's (#26059 Q3, child 3): a unit
//    outside the subtree, a set not in the allowlist, or a target user outside
//    the subtree answer `403 DELEGATION_SCOPE_VIOLATION` with the gate's reason
//    as the message; every other refusal of the gate keeps `403
//    PERMISSION_DENIED`, opaque to the console (ruling #24914 B′). Each cell is
//    pinned on the thrown value AND on the REST door's classification
//    (`mapDataError`), because a message opening with the `[Security] Access
//    denied` matcher would be re-flattened there.

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it was admitted');
}

function expectScopeViolation(err: any, object: string, reason: RegExp): void {
  expect([err.code, err.status, err.statusCode], err.message).toEqual(['DELEGATION_SCOPE_VIOLATION', 403, 403]);
  expect(err.message).toMatch(reason);
  expect(err.message.startsWith('[Security] Access denied'), 'the PERMISSION_DENIED matcher prefix').toBe(false);
  expect(isPermissionDeniedError(err)).toBe(false);
  const wire = mapDataError(err, object);
  expect([wire.status, wire.body.code]).toEqual([403, 'DELEGATION_SCOPE_VIOLATION']);
  expect(wire.body.error).toBe(err.message);
}

function expectOpaqueDenial(err: any, object: string): void {
  expect([err.code, err.status], err.message).toEqual(['PERMISSION_DENIED', 403]);
  expect(isPermissionDeniedError(err)).toBe(true);
  const wire = mapDataError(err, object);
  expect([wire.status, wire.body.code]).toEqual([403, 'PERMISSION_DENIED']);
}

describe('[#26189] DelegatedAdminGate — a scope violation answers DELEGATION_SCOPE_VIOLATION; every other refusal keeps PERMISSION_DENIED', () => {
  const position = (row: any, operation = 'insert') =>
    h.gate.assert({ object: 'sys_user_position', operation, data: row, context: h.ctxOf('delegate') });
  const grant = (row: any) =>
    h.gate.assert({ object: 'sys_user_permission_set', operation: 'insert', data: row, context: h.ctxOf('delegate') });

  describe('the caller\'s own scope: DELEGATION_SCOPE_VIOLATION, the reason as the message', () => {
    it('sys_user_position: a business unit outside the subtree', async () => {
      const err = await refusalOf(() => position({ user_id: 'u_west_1', position: 'sales_rep', business_unit_id: 'bu_west' }));
      expectScopeViolation(err, 'sys_user_position', /business unit 'bu_west' is outside the delegated subtree \(scope from 'sub_admin'\)/);
      expect(err.details).toMatchObject({ operation: 'insert', object: 'sys_user_position', position: 'sales_rep' });
    });

    it('sys_user_position: an existing assignment whose business unit is outside the subtree (the pre-image)', async () => {
      h.tables.sys_user_position.push({ id: 'a_west', user_id: 'u_west_1', position: 'sales_rep', business_unit_id: 'bu_west' });
      const err = await refusalOf(() => h.gate.assert({
        object: 'sys_user_position', operation: 'delete', options: { where: { id: 'a_west' } }, context: h.ctxOf('delegate'),
      }));
      expectScopeViolation(err, 'sys_user_position', /the existing assignment's business unit 'bu_west' is outside the delegated subtree/);
    });

    it('sys_user_position: the position distributes a set not in the allowlist', async () => {
      const err = await refusalOf(() => position({ user_id: 'u_east_1', position: 'mixed_pos', business_unit_id: 'bu_es' }));
      expectScopeViolation(err, 'sys_user_position', /position 'mixed_pos' distributes permission set 'finance_admin', which is not in the scope's allowlist/);
    });

    it('sys_user_permission_set: a set not in the allowlist', async () => {
      const err = await refusalOf(() => grant({ user_id: 'u_east_1', permission_set: 'finance_admin' }));
      expectScopeViolation(err, 'sys_user_permission_set', /permission set 'finance_admin' is not in the scope's allowlist/);
      expect(err.details).toMatchObject({ permissionSet: 'finance_admin' });
    });

    it('sys_user_permission_set: a target user outside the subtree', async () => {
      const err = await refusalOf(() => grant({ user_id: 'u_west_1', permission_set: 'sales_user' }));
      expectScopeViolation(err, 'sys_user_permission_set', /target user 'u_west_1' is outside the delegated subtree/);
    });
  });

  describe('every other refusal: PERMISSION_DENIED, unchanged', () => {
    it('the audience anchor', async () => {
      expectOpaqueDenial(await refusalOf(() => position({ user_id: 'u_east_1', position: 'everyone', business_unit_id: 'bu_es' })), 'sys_user_position');
    });

    it('a principal-less write', async () => {
      expectOpaqueDenial(await refusalOf(() => h.gate.assert({
        object: 'sys_user_position', operation: 'insert', data: { user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es' }, context: {},
      })), 'sys_user_position');
    });

    it('sys_member is tenant-only', async () => {
      expectOpaqueDenial(await refusalOf(() => h.gate.assert({
        object: 'sys_member', operation: 'insert', data: { user_id: 'u_east_1', role: 'member' }, context: h.ctxOf('delegate'),
      })), 'sys_member');
    });

    it('plain CRUD with no scope', async () => {
      expectOpaqueDenial(await refusalOf(() => h.gate.assert({
        object: 'sys_user_position', operation: 'insert', data: { user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es' }, context: h.ctxOf('crud_only'),
      })), 'sys_user_position');
    });

    it('a filter write', async () => {
      expectOpaqueDenial(await refusalOf(() => h.gate.assert({
        object: 'sys_user_position', operation: 'delete', options: { where: { position: 'sales_rep' } }, context: h.ctxOf('delegate'),
      })), 'sys_user_position');
    });

    it('an unanchored assignment, new or existing', async () => {
      expectOpaqueDenial(await refusalOf(() => position({ user_id: 'u_east_1', position: 'sales_rep' })), 'sys_user_position');
      h.tables.sys_user_position.push({ id: 'a_loose', user_id: 'u_east_1', position: 'sales_rep', business_unit_id: null });
      expectOpaqueDenial(await refusalOf(() => h.gate.assert({
        object: 'sys_user_position', operation: 'delete', options: { where: { id: 'a_loose' } }, context: h.ctxOf('delegate'),
      })), 'sys_user_position');
    });

    it('a scope that does not grant manageAssignments', async () => {
      const gate = new DelegatedAdminGate({
        ql: h.ql,
        resolveSets: async () => [{ name: 'viewer_admin', objects: {}, adminScope: { ...EAST_SCOPE, manageAssignments: false } }],
      } as any);
      expectOpaqueDenial(await refusalOf(() => gate.assert({
        object: 'sys_user_position', operation: 'insert', data: { user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es' }, context: h.ctxOf('delegate'),
      })), 'sys_user_position');
    });

    it('granting an adminScope not strictly contained by the caller\'s own', async () => {
      expectOpaqueDenial(await refusalOf(() => grant({ user_id: 'u_east_1', permission_set: 'sub_admin' })), 'sys_user_permission_set');
    });

    it('a stored grant whose set the catalog does not hold, a grant naming no target user, or one whose target has no business unit', async () => {
      // An INSERT naming an unknown set is judged by the allowlist (a scope
      // violation, above); the catalog miss is the PRE-IMAGE's reason.
      h.tables.sys_user_permission_set = [{ id: 'g_retired', user_id: 'u_east_1', permission_set: 'sales_user_retired' }];
      expectOpaqueDenial(await refusalOf(() => h.gate.assert({
        object: 'sys_user_permission_set', operation: 'delete', options: { where: { id: 'g_retired' } }, context: h.ctxOf('delegate'),
      })), 'sys_user_permission_set');
      expectOpaqueDenial(await refusalOf(() => grant({ permission_set: 'sales_user' })), 'sys_user_permission_set');
      expectOpaqueDenial(await refusalOf(() => grant({ user_id: 'u_delegate', permission_set: 'sales_user' })), 'sys_user_permission_set');
    });

    it('a self-service delegation of duty (ADR-0091 D3)', async () => {
      expectOpaqueDenial(await refusalOf(() => position({
        user_id: 'u_east_1', position: 'sales_rep', business_unit_id: 'bu_es', delegated_from: 'u_delegate', reason: 'cover',
      })), 'sys_user_position');
    });
  });
});
