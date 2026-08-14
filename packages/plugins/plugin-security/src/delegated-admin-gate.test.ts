// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D12 — delegated administration: scoped admin, no self-escalation.

import { describe, it, expect, beforeEach } from 'vitest';
import { DelegatedAdminGate } from './delegated-admin-gate';

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
  manageBindings: true,
  authorEnvironmentSets: true,
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
  it('tenant-level admin (superuser wildcard) passes untouched', async () => {
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

describe('DelegatedAdminGate — bindings (sys_position_permission_set)', () => {
  it('delegate binds an allowlisted set to a position held only inside the subtree', async () => {
    await expect(h.gate.assert({
      object: 'sys_position_permission_set', operation: 'insert',
      data: { position_id: 'pos_sales', permission_set_id: 'ps_sales' },
      context: h.ctxOf('delegate'),
    })).resolves.toBeUndefined();
  });

  it('denies binding a non-allowlisted set', async () => {
    await expect(h.gate.assert({
      object: 'sys_position_permission_set', operation: 'insert',
      data: { position_id: 'pos_sales', permission_set_id: 'ps_fin' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/not in the scope's allowlist/);
  });

  it('denies re-composing a position held outside the subtree (blast radius)', async () => {
    h.tables.sys_user_position.push({ id: 'a_w', user_id: 'u_west_1', position: 'sales_rep', business_unit_id: 'bu_west' });
    await expect(h.gate.assert({
      object: 'sys_position_permission_set', operation: 'insert',
      data: { position_id: 'pos_sales', permission_set_id: 'ps_sales' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/outside the delegated subtree/);
  });

  it('audience-anchor bindings are tenant-level only for delegates', async () => {
    await expect(h.gate.assert({
      object: 'sys_position_permission_set', operation: 'insert',
      data: { position_id: 'pos_everyone', permission_set_id: 'ps_sales' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/tenant-level only/);
  });
});

describe('DelegatedAdminGate — direct grants (sys_user_permission_set)', () => {
  it('delegate grants an allowlisted set to a user inside the subtree; granted_by stamped', async () => {
    const row: any = { user_id: 'u_east_1', permission_set_id: 'ps_sales' };
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert', data: row, context: h.ctxOf('delegate'),
    })).resolves.toBeUndefined();
    expect(row.granted_by).toBe('u_delegate');
  });

  it('denies grants to users outside the subtree', async () => {
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert',
      data: { user_id: 'u_west_1', permission_set_id: 'ps_sales' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/outside the delegated subtree/);
  });

  it('denies non-allowlisted sets — including to the delegate themselves', async () => {
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert',
      data: { user_id: 'u_delegate', permission_set_id: 'ps_fin' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/not in the scope's allowlist/);
  });

  it('granting a set that carries an adminScope requires STRICT containment (equal scope refused)', async () => {
    // sub_admin carries the delegate's own EXACT scope — lateral propagation banned.
    await expect(h.gate.assert({
      object: 'sys_user_permission_set', operation: 'insert',
      data: { user_id: 'u_east_1', permission_set_id: 'ps_sub' },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/not strictly contained/);
  });
});

describe('DelegatedAdminGate — env-set authoring (sys_permission_set)', () => {
  it('delegate with authorEnvironmentSets may insert an inert env set', async () => {
    await expect(h.gate.assert({
      object: 'sys_permission_set', operation: 'insert',
      data: { name: 'east_helper', object_permissions: '{}' },
      context: h.ctxOf('delegate'),
    })).resolves.toBeUndefined();
  });

  it('authoring a set that mints a NARROWER adminScope is allowed (strict containment)', async () => {
    await expect(h.gate.assert({
      object: 'sys_permission_set', operation: 'insert',
      data: {
        name: 'east_sales_admin',
        admin_scope: JSON.stringify({
          businessUnit: 'east_sales',
          manageAssignments: true,
          assignablePermissionSets: ['sales_user'],
        }),
      },
      context: h.ctxOf('delegate'),
    })).resolves.toBeUndefined();
  });

  it('authoring a scope equal to or broader than your own is denied', async () => {
    await expect(h.gate.assert({
      object: 'sys_permission_set', operation: 'insert',
      data: { name: 'clone_of_mine', admin_scope: JSON.stringify(EAST_SCOPE) },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/strictly contains it/);

    await expect(h.gate.assert({
      object: 'sys_permission_set', operation: 'insert',
      data: {
        name: 'hq_takeover',
        admin_scope: JSON.stringify({ ...EAST_SCOPE, businessUnit: 'hq' }),
      },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/strictly contains it/);
  });

  it('delegates cannot set the tenant-wide isDefault suggestion', async () => {
    await expect(h.gate.assert({
      object: 'sys_permission_set', operation: 'insert',
      data: { name: 'east_default', isDefault: true },
      context: h.ctxOf('delegate'),
    })).rejects.toThrow(/tenant-level/);
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
 */
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
      { id: 'h1', user_id: 'u_boss', position: 'approver' },
      { id: 'h2', user_id: 'u_boss', position: 'plain_pos' },
      { id: 'h3', user_id: 'u_boss', position: 'admin_pos' },
      { id: 'h4', user_id: 'u_relay', position: 'approver', delegated_from: 'u_boss', valid_until: iso(nowMs + 20 * DAY) },
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
  const gate = new DelegatedAdminGate({
    ql,
    resolveSets: async () => [{ name: 'member_default', objects: {} }],
    now: () => nowMs,
  });
  const delegate = (userId: string, row: any) =>
    gate.assert({ object: 'sys_user_position', operation: 'insert', data: row, context: { userId, positions: [] } });
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
  const gate = new DelegatedAdminGate({
    ql,
    resolveSets: async () => [{ name: 'member_default', objects: {} }],
    now: () => nowMs,
  });
  const delegate = (userId: string, row: any) =>
    gate.assert({ object: 'sys_user_position', operation: 'insert', data: row, context: { userId, positions: [] } });
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
    d.tables.sys_user_position.push({ id: 'hb', user_id: 'u_deleg', position: 'approver', business_unit_id: 'bu_west' });
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
    d.tables.sys_user_position.push({ id: 'hd', user_id: 'u_relay', position: 'approver', business_unit_id: 'bu_east', delegated_from: 'u_boss', valid_until: iso(T0 + 20 * DAY) });
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
