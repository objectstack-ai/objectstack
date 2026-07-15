// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D6 — explain engine: layer verdicts, attribution, machine artifact.

import { describe, it, expect } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { PermissionEvaluator } from './permission-evaluator';
import { explainAccess, buildContextForUser, type ExplainEngineDeps } from './explain-engine';

const SALES_USER = PermissionSetSchema.parse({
  name: 'sales_user',
  objects: { leave_request: { allowRead: true, allowCreate: true, readScope: 'unit' } },
});
const ADMIN = PermissionSetSchema.parse({
  name: 'admin_full_access',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } },
  systemPermissions: ['manage_users'],
});

const PRIVATE_SCHEMA = { name: 'leave_request', sharingModel: 'private' };

function makeDeps(overrides: Partial<ExplainEngineDeps> & { sets?: any[]; schema?: any; rls?: any } = {}): ExplainEngineDeps {
  const evaluator = new PermissionEvaluator();
  return {
    ql: { getSchema: () => overrides.schema ?? PRIVATE_SCHEMA },
    resolveSets: async () => overrides.sets ?? [SALES_USER],
    evaluator,
    getObjectSecurityMeta: async () => ({
      isPrivate: false,
      requiredPermissions: { all: [], read: [], create: [], update: [], delete: [] },
      fieldRequiredPermissions: {},
    }),
    requiredCaps: (meta: any, op: string) => {
      const bucket = op === 'find' ? 'read' : op === 'insert' ? 'create' : op;
      return [...(meta.all ?? []), ...((meta as any)[bucket] ?? [])];
    },
    computeRlsFilter: async () => overrides.rls !== undefined ? overrides.rls : null,
    getFieldMask: () => ({}),
    fallbackPermissionSet: 'member_default',
    ...overrides,
  };
}

const CTX = { userId: 'u1', positions: ['sales_rep', 'everyone'], permissions: [] };

describe('explainAccess (ADR-0090 D6)', () => {
  it('allows a granted read and attributes the granting set', async () => {
    const d = await explainAccess(makeDeps(), { object: 'leave_request', operation: 'read', context: CTX });
    expect(d.allowed).toBe(true);
    expect(d.principal).toMatchObject({ userId: 'u1', positions: ['sales_rep', 'everyone'], permissionSets: ['sales_user'] });
    const crud = d.layers.find((l) => l.layer === 'object_crud')!;
    expect(crud.verdict).toBe('grants');
    expect(crud.contributors).toEqual([{ kind: 'permission_set', name: 'sales_user', via: 'resolved' }]);
    // read decisions carry the composed machine artifact
    expect('readFilter' in d).toBe(true);
  });

  it('reports the full pipeline in order', async () => {
    const d = await explainAccess(makeDeps(), { object: 'leave_request', operation: 'read', context: CTX });
    expect(d.layers.map((l) => l.layer)).toEqual([
      'principal', 'required_permissions', 'object_crud', 'fls',
      'owd_baseline', 'depth', 'sharing', 'vama_bypass', 'rls',
    ]);
  });

  it('denies an ungranted operation and explains which layer denied', async () => {
    const d = await explainAccess(makeDeps(), { object: 'leave_request', operation: 'delete', context: CTX });
    expect(d.allowed).toBe(false);
    expect(d.layers.find((l) => l.layer === 'object_crud')!.verdict).toBe('denies');
  });

  it('surfaces the required_permissions AND-gate as the denying layer', async () => {
    const deps = makeDeps({
      getObjectSecurityMeta: async () => ({
        isPrivate: false,
        requiredPermissions: { all: ['manage_metadata'], read: [], create: [], update: [], delete: [] },
        fieldRequiredPermissions: {},
      }),
    });
    const d = await explainAccess(deps, { object: 'leave_request', operation: 'read', context: CTX });
    expect(d.allowed).toBe(false);
    const gate = d.layers.find((l) => l.layer === 'required_permissions')!;
    expect(gate.verdict).toBe('denies');
    expect(gate.detail).toContain('manage_metadata');
  });

  it('explains the leave_request incident shape: unset OWD reads as fail-closed private', async () => {
    const d = await explainAccess(
      makeDeps({ schema: { name: 'leave_request' } }), // no sharingModel declared
      { object: 'leave_request', operation: 'read', context: CTX },
    );
    const owd = d.layers.find((l) => l.layer === 'owd_baseline')!;
    expect(owd.verdict).toBe('narrows');
    expect(owd.detail).toContain('ADR-0090 D1');
  });

  it('reports VAMA bypass and org depth for an admin', async () => {
    const d = await explainAccess(makeDeps({ sets: [ADMIN] }), { object: 'leave_request', operation: 'read', context: { userId: 'admin', positions: ['platform_admin', 'everyone'], permissions: [] } });
    expect(d.allowed).toBe(true);
    expect(d.layers.find((l) => l.layer === 'vama_bypass')!.verdict).toBe('widens');
    expect(d.layers.find((l) => l.layer === 'depth')!.detail).toContain("'org'");
  });

  it('an RLS deny-all composition flips the decision to denied', async () => {
    const d = await explainAccess(
      makeDeps({ rls: { id: '__deny_all__' } }),
      { object: 'leave_request', operation: 'read', context: CTX },
    );
    expect(d.allowed).toBe(false);
    expect(d.layers.find((l) => l.layer === 'rls')!.verdict).toBe('denies');
  });

  it('carries D10 dual attribution when the context acts on behalf of a user', async () => {
    const d = await explainAccess(makeDeps(), {
      object: 'leave_request', operation: 'read',
      context: { ...CTX, principalKind: 'agent', onBehalfOf: { userId: 'u9' } },
    });
    expect(d.principal.principalKind).toBe('agent');
    expect(d.principal.onBehalfOf).toEqual({ userId: 'u9' });
    expect(d.layers[0].detail).toContain('on behalf of u9');
  });

  it('surfaces expired grants in the principal layer with the dedicated state (ADR-0091 D2)', async () => {
    const d = await explainAccess(makeDeps(), {
      object: 'leave_request', operation: 'read',
      context: {
        ...CTX,
        expiredGrants: [{ kind: 'position', name: 'payroll_approver', until: '2026-07-01T00:00:00Z' }],
      },
    });
    const principal = d.layers.find((l) => l.layer === 'principal')!;
    expect(principal.detail).toContain('EXPIRED');
    expect(principal.detail).toContain('payroll_approver until 2026-07-01T00:00:00Z');
    expect(principal.contributors).toContainEqual({
      kind: 'position',
      name: 'payroll_approver',
      via: 'held until 2026-07-01T00:00:00Z — expired',
      state: 'expired',
    });
    // Expired grants contribute nothing to the resolved principal itself.
    expect(d.principal.positions).not.toContain('payroll_approver');
  });

  it('attributes a delegated position "via delegation from X until Y" in the principal layer (ADR-0091 D3)', async () => {
    const d = await explainAccess(makeDeps(), {
      object: 'leave_request', operation: 'read',
      context: {
        ...CTX,
        positions: ['sales_rep', 'approver', 'everyone'],
        delegatedPositions: [{ name: 'approver', from: 'u_boss', until: '2026-07-20T00:00:00Z' }],
      },
    });
    const principal = d.layers.find((l) => l.layer === 'principal')!;
    expect(principal.detail).toContain('held via delegation');
    expect(principal.detail).toContain('approver from u_boss until 2026-07-20T00:00:00Z');
    expect(principal.contributors).toContainEqual({
      kind: 'position',
      name: 'approver',
      via: 'delegation from u_boss until 2026-07-20T00:00:00Z',
    });
  });

  it('lists masked fields in the fls layer', async () => {
    const d = await explainAccess(
      makeDeps({ getFieldMask: () => ({ salary: { readable: false }, name: { readable: true } }) }),
      { object: 'leave_request', operation: 'read', context: CTX },
    );
    const fls = d.layers.find((l) => l.layer === 'fls')!;
    expect(fls.verdict).toBe('narrows');
    expect(fls.detail).toContain('salary');
  });
});

describe('explainAccess — record-grained (C2 / ADR-0095)', () => {
  const REC_CTX = { userId: 'u1', tenantId: 'org1', positions: ['sales_rep', 'everyone'], permissions: [] };

  function recDeps(opts: {
    layered?: { layer0: any; layer1: any };
    record?: Record<string, unknown> | null;
    sharingFilter?: unknown;
    shares?: any[];
    canEdit?: boolean;
    sets?: any[];
    schema?: any;
  } = {}): ExplainEngineDeps {
    const base = makeDeps({ sets: opts.sets, schema: opts.schema });
    return {
      ...base,
      computeLayeredRlsFilter: async () => opts.layered ?? { layer0: null, layer1: null },
      fetchRecord: async () => (opts.record !== undefined ? opts.record : { id: 'r1', organization_id: 'org1', owner_id: 'u1' }),
      sharingReadFilter: async () => (opts.sharingFilter !== undefined ? opts.sharingFilter : null),
      listRecordShares: async () => opts.shares ?? [],
      canEditRecord: async () => opts.canEdit ?? false,
    };
  }

  it('leaves the object-level report byte-identical when no recordId is supplied (backward compat)', async () => {
    const d = await explainAccess(recDeps(), { object: 'leave_request', operation: 'read', context: REC_CTX });
    expect(d.record).toBeUndefined();
    expect(d.principal).not.toHaveProperty('posture');
    expect(d.layers.map((l) => l.layer)).toEqual([
      'principal', 'required_permissions', 'object_crud', 'fls',
      'owd_baseline', 'depth', 'sharing', 'vama_bypass', 'rls',
    ]);
    expect(d.layers.every((l) => l.kernelTier === undefined)).toBe(true);
    expect(d.layers.every((l) => l.record === undefined)).toBe(true);
  });

  it('prepends the tenant_isolation Layer 0, tags every layer with kernelTier, and resolves posture', async () => {
    const d = await explainAccess(
      recDeps({ layered: { layer0: { organization_id: 'org1' }, layer1: null }, record: { id: 'r1', organization_id: 'org1', owner_id: 'u1' } }),
      { object: 'leave_request', operation: 'read', context: REC_CTX, recordId: 'r1' },
    );
    expect(d.layers[0].layer).toBe('tenant_isolation');
    expect(d.layers[0].kernelTier).toBe('layer_0_tenant');
    expect(d.layers.find((l) => l.layer === 'rls')!.kernelTier).toBe('layer_1_business');
    expect(d.principal.posture).toBe('MEMBER');
    expect(d.record).toMatchObject({ recordId: 'r1', visible: true });
  });

  it('derives PLATFORM_ADMIN posture from the platform_admin position', async () => {
    const d = await explainAccess(
      recDeps({ sets: [ADMIN], layered: { layer0: null, layer1: null } }),
      { object: 'leave_request', operation: 'read', context: { userId: 'a1', tenantId: 'org1', positions: ['platform_admin', 'everyone'], permissions: [] }, recordId: 'r1' },
    );
    expect(d.principal.posture).toBe('PLATFORM_ADMIN');
  });

  it('Layer 0 (the tenant wall) excludes a cross-org record — decidedBy tenant_isolation', async () => {
    const d = await explainAccess(
      recDeps({ layered: { layer0: { organization_id: 'org1' }, layer1: null }, record: { id: 'r1', organization_id: 'org2', owner_id: 'u1' } }),
      { object: 'leave_request', operation: 'read', context: REC_CTX, recordId: 'r1' },
    );
    const tenant = d.layers.find((l) => l.layer === 'tenant_isolation')!;
    expect(tenant.record!.outcome).toBe('excluded');
    expect(tenant.record!.rules[0]).toMatchObject({ kind: 'tenant_filter', effect: 'excludes' });
    expect(d.record).toMatchObject({ visible: false, decidedBy: 'tenant_isolation' });
  });

  it('Layer 1 (business RLS) excludes a non-matching record — decidedBy rls', async () => {
    const d = await explainAccess(
      recDeps({ layered: { layer0: null, layer1: { status: 'open' } }, record: { id: 'r1', organization_id: 'org1', owner_id: 'u1', status: 'closed' } }),
      { object: 'leave_request', operation: 'read', context: REC_CTX, recordId: 'r1' },
    );
    const rls = d.layers.find((l) => l.layer === 'rls')!;
    expect(rls.record!.outcome).toBe('excluded');
    expect(rls.record!.matchesRecord).toBe(false);
    expect(d.record).toMatchObject({ visible: false, decidedBy: 'rls' });
  });

  it('a record_share admits a non-owner on a private object — sharing admits, decidedBy sharing', async () => {
    const d = await explainAccess(
      recDeps({
        layered: { layer0: null, layer1: null },
        record: { id: 'r1', organization_id: 'org1', owner_id: 'u_other' },
        shares: [{ id: 'shr_1', recipient_type: 'user', recipient_id: 'u1', access_level: 'read', source: 'manual' }],
        sharingFilter: { $or: [{ owner_id: 'u1' }, { id: { $in: ['r1'] } }] },
      }),
      { object: 'leave_request', operation: 'read', context: REC_CTX, recordId: 'r1' },
    );
    const sharing = d.layers.find((l) => l.layer === 'sharing')!;
    expect(sharing.record!.outcome).toBe('admitted');
    expect(sharing.record!.rules[0]).toMatchObject({ kind: 'record_share', effect: 'admits', grants: 'read' });
    expect(d.record).toMatchObject({ visible: true, decidedBy: 'sharing' });
  });

  it('private object, non-owner, no admitting share — not visible, decidedBy sharing', async () => {
    const d = await explainAccess(
      recDeps({ layered: { layer0: null, layer1: null }, record: { id: 'r1', organization_id: 'org1', owner_id: 'u_other' }, shares: [], sharingFilter: { owner_id: 'u1' } }),
      { object: 'leave_request', operation: 'read', context: REC_CTX, recordId: 'r1' },
    );
    expect(d.layers.find((l) => l.layer === 'sharing')!.record!.outcome).toBe('excluded');
    expect(d.record).toMatchObject({ visible: false, decidedBy: 'sharing' });
  });

  it('a missing record yields not_evaluated row layers and an invisible verdict', async () => {
    const d = await explainAccess(
      recDeps({ record: null }),
      { object: 'leave_request', operation: 'read', context: REC_CTX, recordId: 'missing' },
    );
    expect(d.record).toMatchObject({ visible: false });
    expect(d.record!.decidedBy).toBeUndefined();
    expect(d.layers.find((l) => l.layer === 'rls')!.record!.outcome).toBe('not_evaluated');
    expect(d.layers.find((l) => l.layer === 'tenant_isolation')!.record!.outcome).toBe('not_evaluated');
  });

  it('write ops use the sharing service canEdit as the by-construction verdict', async () => {
    const editor = PermissionSetSchema.parse({ name: 'editor', objects: { leave_request: { allowRead: true, allowEdit: true } } });
    const d = await explainAccess(
      recDeps({ sets: [editor], layered: { layer0: null, layer1: null }, record: { id: 'r1', organization_id: 'org1', owner_id: 'u_other' }, canEdit: true, shares: [] }),
      { object: 'leave_request', operation: 'update', context: REC_CTX, recordId: 'r1' },
    );
    expect(d.layers.find((l) => l.layer === 'sharing')!.record!.outcome).toBe('admitted');
    expect(d.record).toMatchObject({ recordId: 'r1', visible: true });
  });

  it('degrades gracefully with no record-grained deps — object-level layers plus a best-effort verdict', async () => {
    // Only the base object-level deps: recordId is given but fetchRecord /
    // computeLayeredRlsFilter etc. are absent (e.g. no plugin-sharing).
    const d = await explainAccess(makeDeps(), { object: 'leave_request', operation: 'read', context: REC_CTX, recordId: 'r1' });
    expect(d.layers[0].layer).toBe('tenant_isolation');
    expect(d.record).toMatchObject({ recordId: 'r1' });
    // record could not be fetched → not_evaluated tenant + invisible.
    expect(d.layers.find((l) => l.layer === 'tenant_isolation')!.record!.outcome).toBe('not_evaluated');
  });
});

describe('buildContextForUser', () => {
  const ql = {
    async find(object: string, opts: any) {
      if (object === 'sys_user_position') return [{ user_id: 'u2', position: 'hr_specialist' }];
      if (object === 'sys_user_permission_set') return [{ user_id: 'u2', permission_set_id: 'ps1' }];
      if (object === 'sys_permission_set') return [{ id: 'ps1', name: 'payroll_reader' }];
      return [];
    },
  };

  it('reconstructs positions + direct grants + the everyone anchor', async () => {
    const ctx = await buildContextForUser(ql, 'u2');
    expect(ctx).toEqual({
      userId: 'u2',
      positions: ['hr_specialist', 'everyone'],
      permissions: ['payroll_reader'],
      expiredGrants: [],
      delegatedPositions: [],
    });
  });

  it('surfaces delegation provenance for a position held via a delegated_from row (ADR-0091 D3)', async () => {
    const NOW = Date.parse('2026-07-10T12:00:00Z');
    const qlDelegated = {
      async find(object: string, _opts: any) {
        if (object === 'sys_user_position') {
          return [
            { user_id: 'u2', position: 'hr_specialist' },
            { user_id: 'u2', position: 'approver', delegated_from: 'u_boss', valid_until: '2026-07-20T00:00:00Z' },
          ];
        }
        return [];
      },
    };
    const ctx = await buildContextForUser(qlDelegated, 'u2', NOW);
    expect(ctx.positions).toEqual(['hr_specialist', 'approver', 'everyone']);
    expect(ctx.delegatedPositions).toEqual([
      { name: 'approver', from: 'u_boss', until: '2026-07-20T00:00:00Z' },
    ]);
  });

  it('filters grants outside their validity window and reports them as expired (ADR-0091 D2)', async () => {
    const NOW = Date.parse('2026-07-10T12:00:00Z');
    const qlWindowed = {
      async find(object: string, _opts: any) {
        if (object === 'sys_user_position') {
          return [
            { user_id: 'u2', position: 'hr_specialist' },
            { user_id: 'u2', position: 'payroll_approver', valid_until: '2026-07-01T00:00:00Z' },
            // Pending (future valid_from) is filtered but NOT reported as expired.
            { user_id: 'u2', position: 'auditor', valid_from: '2026-08-01T00:00:00Z' },
          ];
        }
        if (object === 'sys_user_permission_set') {
          return [
            { user_id: 'u2', permission_set_id: 'ps1' },
            { user_id: 'u2', permission_set_id: 'ps2', valid_until: '2026-06-01T00:00:00Z' },
          ];
        }
        if (object === 'sys_permission_set') {
          return [
            { id: 'ps1', name: 'payroll_reader' },
            { id: 'ps2', name: 'quarter_close_admin' },
          ];
        }
        return [];
      },
    };
    const ctx = await buildContextForUser(qlWindowed, 'u2', NOW);
    expect(ctx.positions).toEqual(['hr_specialist', 'everyone']);
    expect(ctx.permissions).toEqual(['payroll_reader']);
    expect(ctx.expiredGrants).toEqual([
      { kind: 'position', name: 'payroll_approver', until: '2026-07-01T00:00:00Z' },
      { kind: 'permission_set', name: 'quarter_close_admin', until: '2026-06-01T00:00:00Z' },
    ]);
  });
});
