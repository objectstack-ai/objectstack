// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// ADR-0090 D6 — explain engine: layer verdicts, attribution, machine artifact.

import { describe, it, expect } from 'vitest';
import { resolveUserAuthzGrants } from '@objectstack/core';
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
    baselinePermissionSets: ['member_default'],
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

  // ── [#4647] the bypass, at row granularity ──────────────────────────────
  // The report: `allowed: true` + a `vama_bypass` layer saying "ownership and
  // sharing checks are skipped", sitting next to `record: { visible: false,
  // decidedBy: 'sharing' }` — one payload, two opposite answers. Under the
  // ruling the bypass is real, so the ROW story has to show it (and the write
  // gate, which now consults the same predicate, agrees).
  const VIEW_ONLY = PermissionSetSchema.parse({
    name: 'compliance_auditor',
    objects: { '*': { allowRead: true, allowEdit: true, viewAllRecords: true } },
  });
  const OWNERLESS_ROW = { id: 'r1', organization_id: 'org1', owner_id: null };
  const ADMIN_CTX = { userId: 'a1', tenantId: 'org1', positions: ['platform_admin', 'everyone'], permissions: [] };

  it('[#4647] Modify All Data admits an OWNERLESS private record — record verdict agrees with the top level', async () => {
    const d = await explainAccess(
      recDeps({
        sets: [ADMIN], layered: { layer0: null, layer1: null },
        record: OWNERLESS_ROW, shares: [], sharingFilter: { owner_id: 'a1' },
        canEdit: true, // the fixed gate: ownership fails, the bypass admits
      }),
      { object: 'leave_request', operation: 'update', context: ADMIN_CTX, recordId: 'r1' },
    );
    expect(d.allowed).toBe(true);
    expect(d.record).toMatchObject({ visible: true, decidedBy: 'vama_bypass' });
    const vama = d.layers.find((l) => l.layer === 'vama_bypass')!;
    expect(vama.verdict).toBe('widens');
    expect(vama.record!.outcome).toBe('admitted');
    // The sharing layer credits the bypass rather than claiming a share it never saw.
    expect(d.layers.find((l) => l.layer === 'sharing')!.record!.detail).toContain('Modify All Data bypass');
  });

  it('[#4647] View All Data alone does NOT bypass a WRITE — and the layer names the missing bit', async () => {
    const d = await explainAccess(
      recDeps({
        sets: [VIEW_ONLY], layered: { layer0: null, layer1: null },
        record: OWNERLESS_ROW, shares: [], sharingFilter: { owner_id: 'a1' },
        canEdit: false, // the gate refuses: no modify bit
      }),
      { object: 'leave_request', operation: 'update', context: ADMIN_CTX, recordId: 'r1' },
    );
    expect(d.record!.visible).toBe(false);
    const vama = d.layers.find((l) => l.layer === 'vama_bypass')!;
    expect(vama.verdict).toBe('not_applicable');
    expect(vama.detail).toContain('View All Data');
    expect(vama.detail).toContain('Modify All Data');
    expect(vama.contributors).toEqual([]);
  });

  it('[#4647] the same View All Data set DOES bypass a READ of that record', async () => {
    const d = await explainAccess(
      recDeps({
        sets: [VIEW_ONLY], layered: { layer0: null, layer1: null },
        record: OWNERLESS_ROW, shares: [], sharingFilter: { owner_id: 'a1' },
      }),
      { object: 'leave_request', operation: 'read', context: ADMIN_CTX, recordId: 'r1' },
    );
    const vama = d.layers.find((l) => l.layer === 'vama_bypass')!;
    expect(vama.verdict).toBe('widens');
    expect(vama.contributors.map((c) => c.name)).toEqual(['compliance_auditor']);
    expect(d.record).toMatchObject({ visible: true, decidedBy: 'vama_bypass' });
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

describe('posture derivation aligns with enforcement (label-drift elimination)', () => {
  // posture is surfaced whenever a recordId is supplied; the record-grained deps
  // are irrelevant to the posture value, so the base object-level deps suffice.
  const postureOf = async (context: any): Promise<string | undefined> => {
    const d = await explainAccess(makeDeps({ sets: [ADMIN] }), {
      object: 'leave_request',
      operation: 'read',
      context,
      recordId: 'r1',
    });
    return d.principal.posture;
  };

  it('reuses ctx.posture verbatim when enforcement already resolved it', async () => {
    // A principal resolved through resolveAuthzContext carries ctx.posture — the
    // explain panel must echo it, never re-derive a different tier.
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['everyone'], permissions: [], posture: 'PLATFORM_ADMIN' })).toBe('PLATFORM_ADMIN');
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['everyone'], permissions: [], posture: 'TENANT_ADMIN' })).toBe('TENANT_ADMIN');
    // Explicit posture wins over what the loose fallback would have guessed.
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['everyone'], permissions: ['admin_full_access'], posture: 'MEMBER' })).toBe('MEMBER');
  });

  it('a merely-SCOPED admin_full_access grant no longer over-labels as PLATFORM_ADMIN', async () => {
    // Name present in `permissions` but NOT held as an unscoped grant and NOT the
    // projected platform_admin position → MEMBER, matching enforcement (which
    // requires hasPlatformAdminGrant = unscoped admin_full_access user grant).
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['everyone'], permissions: ['admin_full_access'] })).toBe('MEMBER');
  });

  it('the unscoped-grant flag (hasPlatformAdminGrant) DOES yield PLATFORM_ADMIN', async () => {
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['everyone'], permissions: ['admin_full_access'], hasPlatformAdminGrant: true })).toBe('PLATFORM_ADMIN');
  });

  it('the projected platform_admin built-in position still yields PLATFORM_ADMIN', async () => {
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['platform_admin', 'everyone'], permissions: [] })).toBe('PLATFORM_ADMIN');
  });

  it('org_owner / org_admin better-auth role positions no longer confer TENANT_ADMIN (ADR-0095 D3)', async () => {
    // The role is a provisioning source, not posture evidence. Absent the
    // organization_admin CAPABILITY these resolve to MEMBER, as enforcement does.
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['org_admin', 'everyone'], permissions: [] })).toBe('MEMBER');
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['org_owner', 'everyone'], permissions: [] })).toBe('MEMBER');
  });

  it('the organization_admin capability grant yields TENANT_ADMIN', async () => {
    expect(await postureOf({ userId: 'a1', tenantId: 'org1', positions: ['everyone'], permissions: ['organization_admin'] })).toBe('TENANT_ADMIN');
  });

  it('guest / anonymous → EXTERNAL floor wins even over an attached posture', async () => {
    expect(await postureOf({ userId: 'a1', principalKind: 'guest', positions: [], permissions: [], posture: 'PLATFORM_ADMIN' })).toBe('EXTERNAL');
    expect(await postureOf({ userId: null, positions: [], permissions: [] })).toBe('EXTERNAL');
  });
});

// ─── buildContextForUser (#6352) ────────────────────────────────────────────
//
// `buildContextForUser` no longer aggregates anything. It calls
// `@objectstack/core`'s `resolveUserAuthzGrants` — the SAME function every
// inbound request resolves through — and adds only presentation: the ADR-0091
// expired / delegated row annotations, and `hasPlatformAdminGrant` read back off
// the resolver's own posture verdict.
//
// ⚠ The fixtures below use a `where`-HONOURING fake, and that is load-bearing,
// not tidiness. The deleted mirror filtered rows in memory, so it produced the
// right answer even against a fake that ignored `where` and returned every row
// for a table. The resolver delegates filtering to the engine, exactly as the
// real ObjectQL engine does, so a fake that ignores `where` now reports grants
// nobody holds — a fixture defect the old shape was blind to.

type Rows = Record<string, any[]>;

/** Minimal `where`-honouring ObjectQL stand-in: scalar equality and `$in`. */
function makeGrantQl(tables: Rows) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      return (tables[object] ?? []).filter((row) =>
        Object.entries(where).every(([key, cond]) => {
          const cell = row[key];
          if (cond && typeof cond === 'object' && '$in' in (cond as any)) {
            return ((cond as any).$in as unknown[]).includes(cell);
          }
          return cell === cond;
        }),
      );
    },
  };
}

const NOW = Date.parse('2026-07-10T12:00:00Z');

describe('buildContextForUser', () => {
  const ql = makeGrantQl({
    sys_user_position: [{ user_id: 'u2', position: 'hr_specialist' }],
    sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'ps1' }],
    sys_permission_set: [{ id: 'ps1', name: 'payroll_reader' }],
  });

  it('derives hasPlatformAdminGrant from an UNSCOPED admin_full_access user grant (matches resolveAuthzContext)', async () => {
    const qlUnscoped = makeGrantQl({
      // organization_id absent → unscoped
      sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'psAdmin' }],
      sys_permission_set: [{ id: 'psAdmin', name: 'admin_full_access' }],
    });
    const ctx = await buildContextForUser(qlUnscoped, 'u2');
    expect(ctx.hasPlatformAdminGrant).toBe(true);
    expect(ctx.permissions).toContain('admin_full_access');
    // The resolver PROJECTS the built-in position from the same grant (ADR-0068
    // D2) and resolves the rung once — both now reach the panel unchanged.
    expect(ctx.positions).toContain('platform_admin');
    expect(ctx.posture).toBe('PLATFORM_ADMIN');
  });

  it('a SCOPED (org-specific) admin_full_access user grant does NOT set hasPlatformAdminGrant', async () => {
    const qlScoped = makeGrantQl({
      sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'psAdmin', organization_id: 'org1' }],
      sys_permission_set: [{ id: 'psAdmin', name: 'admin_full_access' }],
    });
    const ctx = await buildContextForUser(qlScoped, 'u2');
    expect(ctx.hasPlatformAdminGrant).toBe(false);
    // The name is still resolved into permissions (it grants object CRUD), but it
    // no longer confers platform_admin posture — the drift this closes.
    expect(ctx.permissions).toContain('admin_full_access');
    expect(ctx.positions).not.toContain('platform_admin');
    expect(ctx.posture).toBe('MEMBER');
  });

  it('reconstructs positions + direct grants + the everyone anchor', async () => {
    const ctx = await buildContextForUser(ql, 'u2');
    expect(ctx).toEqual({
      userId: 'u2',
      positions: ['hr_specialist', 'everyone'],
      permissions: ['payroll_reader'],
      // [#6352] The resolver's full envelope now reaches the panel. These four
      // were MISSING from the hand-written mirror, which is why an explanation
      // could disagree with enforcement — see the parity suite below.
      systemPermissions: [],
      org_user_ids: ['u2'],
      posture: 'MEMBER',
      // [ADR-0105 D2] The DELEGATOR's own org access set, resolved here rather
      // than inherited — a delegated read is bounded by the delegator's own
      // memberships. This fixture serves no `sys_member` rows, so it is empty,
      // which fails the `group` wall closed.
      accessible_org_ids: [],
      expiredGrants: [],
      delegatedPositions: [],
      hasPlatformAdminGrant: false,
    });
  });

  it('surfaces delegation provenance for a position held via a delegated_from row (ADR-0091 D3)', async () => {
    const qlDelegated = makeGrantQl({
      sys_user_position: [
        { user_id: 'u2', position: 'hr_specialist' },
        { user_id: 'u2', position: 'approver', delegated_from: 'u_boss', valid_until: '2026-07-20T00:00:00Z' },
      ],
    });
    const ctx = await buildContextForUser(qlDelegated, 'u2', NOW);
    expect(ctx.positions).toEqual(['hr_specialist', 'approver', 'everyone']);
    expect(ctx.delegatedPositions).toEqual([
      { name: 'approver', from: 'u_boss', until: '2026-07-20T00:00:00Z' },
    ]);
  });

  it('filters grants outside their validity window and reports them as expired (ADR-0091 D2)', async () => {
    const qlWindowed = makeGrantQl({
      sys_user_position: [
        { user_id: 'u2', position: 'hr_specialist' },
        { user_id: 'u2', position: 'payroll_approver', valid_until: '2026-07-01T00:00:00Z' },
        // Pending (future valid_from) is filtered but NOT reported as expired.
        { user_id: 'u2', position: 'auditor', valid_from: '2026-08-01T00:00:00Z' },
      ],
      sys_user_permission_set: [
        { user_id: 'u2', permission_set_id: 'ps1' },
        { user_id: 'u2', permission_set_id: 'ps2', valid_until: '2026-06-01T00:00:00Z' },
      ],
      sys_permission_set: [
        { id: 'ps1', name: 'payroll_reader' },
        { id: 'ps2', name: 'quarter_close_admin' },
      ],
    });
    const ctx = await buildContextForUser(qlWindowed, 'u2', NOW);
    expect(ctx.positions).toEqual(['hr_specialist', 'everyone']);
    expect(ctx.permissions).toEqual(['payroll_reader']);
    expect(ctx.expiredGrants).toEqual([
      { kind: 'position', name: 'payroll_approver', until: '2026-07-01T00:00:00Z' },
      { kind: 'permission_set', name: 'quarter_close_admin', until: '2026-06-01T00:00:00Z' },
    ]);
  });
});

// ─── [#6352] The explain panel and enforcement resolve ONE aggregation ───────
//
// Every case below runs `buildContextForUser` and `resolveUserAuthzGrants` over
// the SAME rows and asserts they agree — the assertion nothing in the repo made
// while the mirror existed. Convergence makes agreement structural rather than
// coincidental, so the suite's real job is the second half of each case: the
// `expected` block pins what the shared aggregation must actually PRODUCE, so
// the pin can never pass by both sides resolving to nothing.
//
// Each `expected` block was RED before convergence. Measured against the mirror
// on the first fixture's rows: it returned positions `['hr_specialist',
// 'everyone']` (no `sys_member` role projection) and permissions
// `['payroll_reader']` (no position-bound set, no `ai_seat`), against the
// resolver's `['org_admin', 'hr_specialist', 'everyone']` and
// `['payroll_reader', 'hr_tools', 'ai_seat']`. A user whose grants arrive
// through a POSITION was explained as holding none of them — the panel denying
// what enforcement allows, which is the exact failure an explain panel exists
// to prevent.
describe('buildContextForUser ↔ resolveUserAuthzGrants parity (#6352)', () => {
  const PARITY_CASES: Array<{
    name: string;
    tables: Rows;
    expected: {
      positions: string[];
      permissions: string[];
      systemPermissions: string[];
      accessible_org_ids: string[];
      posture: string;
      hasPlatformAdminGrant: boolean;
    };
  }> = [
    {
      // The measured pre-change divergence, in one fixture: an org role
      // (ADR-0095 D3 `sys_member` projection), a platform-RBAC position
      // (ADR-0057 D4), a permission set the POSITION carries
      // (`sys_position_permission_set`), and the ADR-0024 `ai_seat` synthesis.
      name: 'org role + position-bound permission set + ai_seat',
      tables: {
        sys_user: [{ id: 'u2', email: 'u2@example.com', ai_access: true }],
        sys_member: [{ user_id: 'u2', organization_id: 'org1', role: 'admin' }],
        sys_user_position: [{ user_id: 'u2', position: 'hr_specialist' }],
        sys_position: [{ id: 'pos_hr', name: 'hr_specialist' }],
        sys_position_permission_set: [{ position_id: 'pos_hr', permission_set_id: 'ps_hr_tools' }],
        sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'ps1' }],
        sys_permission_set: [
          { id: 'ps1', name: 'payroll_reader' },
          { id: 'ps_hr_tools', name: 'hr_tools', system_permissions: ['manage_users'] },
        ],
      },
      expected: {
        positions: ['org_admin', 'hr_specialist', 'everyone'],
        permissions: ['payroll_reader', 'hr_tools', 'ai_seat'],
        systemPermissions: ['manage_users'],
        accessible_org_ids: ['org1'],
        posture: 'MEMBER',
        hasPlatformAdminGrant: false,
      },
    },
    {
      // [ADR-0090 D5] The audience anchor is not decoration: a set bound to the
      // implicit `everyone` position must RESOLVE. The mirror pushed `everyone`
      // onto the list and then read no position-bound sets at all, so anything
      // granted this way was invisible to the panel.
      name: 'everyone-anchor-bound permission set resolves',
      tables: {
        sys_position: [{ id: 'pos_everyone', name: 'everyone' }],
        sys_position_permission_set: [{ position_id: 'pos_everyone', permission_set_id: 'ps_base' }],
        sys_permission_set: [{ id: 'ps_base', name: 'company_directory' }],
      },
      expected: {
        positions: ['everyone'],
        permissions: ['company_directory'],
        systemPermissions: [],
        accessible_org_ids: [],
        posture: 'MEMBER',
        hasPlatformAdminGrant: false,
      },
    },
    {
      // [ADR-0068 D2] The platform_admin derivation, both polarities.
      name: 'unscoped admin_full_access derives platform_admin',
      tables: {
        sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'psAdmin' }],
        sys_permission_set: [{ id: 'psAdmin', name: 'admin_full_access' }],
      },
      expected: {
        positions: ['platform_admin', 'everyone'],
        permissions: ['admin_full_access'],
        systemPermissions: [],
        accessible_org_ids: [],
        posture: 'PLATFORM_ADMIN',
        hasPlatformAdminGrant: true,
      },
    },
    {
      name: 'org-scoped admin_full_access does NOT derive platform_admin',
      tables: {
        sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'psAdmin', organization_id: 'org1' }],
        sys_permission_set: [{ id: 'psAdmin', name: 'admin_full_access' }],
      },
      expected: {
        positions: ['everyone'],
        permissions: ['admin_full_access'],
        systemPermissions: [],
        accessible_org_ids: [],
        posture: 'MEMBER',
        hasPlatformAdminGrant: false,
      },
    },
    {
      // [ADR-0095 D3] The org-admin rung comes from the CAPABILITY grant
      // `auto-org-admin-grant` writes, never from the better-auth role.
      name: 'organization_admin capability grant derives TENANT_ADMIN',
      tables: {
        sys_member: [{ user_id: 'u2', organization_id: 'org1', role: 'admin' }],
        sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'psOrg', organization_id: 'org1' }],
        sys_permission_set: [{ id: 'psOrg', name: 'organization_admin' }],
      },
      expected: {
        positions: ['org_admin', 'everyone'],
        permissions: ['organization_admin'],
        systemPermissions: [],
        accessible_org_ids: ['org1'],
        posture: 'TENANT_ADMIN',
        hasPlatformAdminGrant: false,
      },
    },
    {
      // [ADR-0091 D2] Validity windows drop rows on BOTH sides, including the
      // platform_admin derivation: an EXPIRED unscoped admin_full_access grant
      // must not confer the rung. Only the explain-side annotation survives.
      name: 'ADR-0091 windows: expired admin grant confers nothing',
      tables: {
        sys_user_position: [
          { user_id: 'u2', position: 'hr_specialist' },
          { user_id: 'u2', position: 'payroll_approver', valid_until: '2026-07-01T00:00:00Z' },
          { user_id: 'u2', position: 'auditor', valid_from: '2026-08-01T00:00:00Z' },
        ],
        sys_user_permission_set: [
          { user_id: 'u2', permission_set_id: 'ps1' },
          { user_id: 'u2', permission_set_id: 'psAdmin', valid_until: '2026-06-01T00:00:00Z' },
        ],
        sys_permission_set: [
          { id: 'ps1', name: 'payroll_reader' },
          { id: 'psAdmin', name: 'admin_full_access' },
        ],
      },
      expected: {
        positions: ['hr_specialist', 'everyone'],
        permissions: ['payroll_reader'],
        systemPermissions: [],
        accessible_org_ids: [],
        posture: 'MEMBER',
        hasPlatformAdminGrant: false,
      },
    },
  ];

  for (const { name, tables, expected } of PARITY_CASES) {
    it(`agrees with the enforcement resolver — ${name}`, async () => {
      const grants = await resolveUserAuthzGrants(makeGrantQl(tables), 'u2', { nowMs: NOW });
      const ctx = await buildContextForUser(makeGrantQl(tables), 'u2', NOW);

      // (a) The two agree, field for field, on the whole aggregation surface.
      expect(ctx.positions).toEqual(grants.positions);
      expect(ctx.permissions).toEqual(grants.permissions);
      expect(ctx.systemPermissions).toEqual(grants.systemPermissions);
      expect(ctx.accessible_org_ids).toEqual(grants.accessible_org_ids);
      expect(ctx.org_user_ids).toEqual(grants.org_user_ids);
      expect(ctx.posture).toEqual(grants.posture);
      expect(ctx.hasPlatformAdminGrant).toBe(grants.posture === 'PLATFORM_ADMIN');

      // (b) Non-vacuity: agreeing on nothing is not agreement. Pin what the one
      // aggregation must actually produce for these rows.
      expect(ctx.positions).toEqual(expected.positions);
      expect(ctx.permissions).toEqual(expected.permissions);
      expect(ctx.systemPermissions).toEqual(expected.systemPermissions);
      expect(ctx.accessible_org_ids).toEqual(expected.accessible_org_ids);
      expect(ctx.posture).toBe(expected.posture);
      expect(ctx.hasPlatformAdminGrant).toBe(expected.hasPlatformAdminGrant);
    });
  }

  it('the explain-only surface is ADDITIVE — it annotates rows, it never changes the verdict', async () => {
    const tables: Rows = {
      sys_user_position: [
        { user_id: 'u2', position: 'hr_specialist' },
        { user_id: 'u2', position: 'approver', delegated_from: 'u_boss', valid_until: '2026-07-20T00:00:00Z' },
        { user_id: 'u2', position: 'payroll_approver', valid_until: '2026-07-01T00:00:00Z' },
      ],
      sys_user_permission_set: [{ user_id: 'u2', permission_set_id: 'ps2', valid_until: '2026-06-01T00:00:00Z' }],
      sys_permission_set: [{ id: 'ps2', name: 'quarter_close_admin' }],
    };
    const grants = await resolveUserAuthzGrants(makeGrantQl(tables), 'u2', { nowMs: NOW });
    const ctx = await buildContextForUser(makeGrantQl(tables), 'u2', NOW);

    // The annotations are non-empty…
    expect(ctx.delegatedPositions).toEqual([
      { name: 'approver', from: 'u_boss', until: '2026-07-20T00:00:00Z' },
    ]);
    expect(ctx.expiredGrants).toEqual([
      { kind: 'position', name: 'payroll_approver', until: '2026-07-01T00:00:00Z' },
      { kind: 'permission_set', name: 'quarter_close_admin', until: '2026-06-01T00:00:00Z' },
    ]);
    // …and the aggregation is still byte-identical to enforcement's. An expired
    // grant is REPORTED, never RESOLVED.
    expect(ctx.positions).toEqual(grants.positions);
    expect(ctx.permissions).toEqual(grants.permissions);
    expect(ctx.positions).not.toContain('payroll_approver');
    expect(ctx.permissions).not.toContain('quarter_close_admin');
  });
});

// ─── [#3544] the export axis is explainable ────────────────────────────────
//
// Without this the axis is undiagnosable: a caller hits 403
// EXPORT_NOT_PERMITTED, an admin runs explain(read), gets `allowed: true`, and
// has nowhere left to look. The answer must be a first-class operation.
describe('explainAccess — export axis (#3544)', () => {
  const READER = PermissionSetSchema.parse({
    name: 'reader',
    objects: { leave_request: { allowRead: true } },
  });
  const EXPORTER = PermissionSetSchema.parse({
    name: 'exporter',
    objects: { leave_request: { allowRead: true, allowExport: true } },
  });

  it('denies export for a reader without the grant, while read is allowed', async () => {
    const readDecision = await explainAccess(makeDeps({ sets: [READER] }), {
      object: 'leave_request', operation: 'read', context: CTX,
    });
    expect(readDecision.allowed).toBe(true);

    const exportDecision = await explainAccess(makeDeps({ sets: [READER] }), {
      object: 'leave_request', operation: 'export', context: CTX,
    });
    expect(exportDecision.allowed).toBe(false);
    const crud = exportDecision.layers.find((l) => l.layer === 'object_crud');
    expect(crud?.verdict).toBe('denies');
    expect(crud?.detail).toMatch(/export/);
  });

  it('allows export when a set carries the grant, and attributes WHICH set', async () => {
    const d = await explainAccess(makeDeps({ sets: [READER, EXPORTER] }), {
      object: 'leave_request', operation: 'export', context: CTX,
    });
    expect(d.allowed).toBe(true);
    const crud = d.layers.find((l) => l.layer === 'object_crud');
    // The attribution is the point: it names the granting set, so an admin can
    // see which grant to remove (or which one is missing).
    expect(crud?.contributors.map((c) => c.name)).toContain('exporter');
    expect(crud?.contributors.map((c) => c.name)).not.toContain('reader');
  });

  it('surfaces the readFilter — an export streams the same filtered rows a read does', async () => {
    const d = await explainAccess(makeDeps({ sets: [EXPORTER], rls: { owner_id: 'u1' } }), {
      object: 'leave_request', operation: 'export', context: CTX,
    });
    expect(d.readFilter).toEqual({ owner_id: 'u1' });
  });

  it('computes RLS as a find, not as an "export" the compiler has no policy for', async () => {
    // The bug this pins: asking the RLS compiler about an `export` operation
    // matches no select policy, so the report would claim "No RLS policy
    // applies" for a principal whose rows ARE filtered.
    const seen: string[] = [];
    const d = await explainAccess(
      makeDeps({
        sets: [EXPORTER],
        computeRlsFilter: async (_s: any, _o: string, op: string) => { seen.push(op); return { owner_id: 'u1' }; },
      }),
      { object: 'leave_request', operation: 'export', context: CTX },
    );
    expect(seen).toContain('find');
    expect(seen).not.toContain('export');
    expect(d.layers.find((l) => l.layer === 'rls')?.verdict).toBe('narrows');
  });

  it('resolves requiredPermissions against the READ bucket', async () => {
    const seen: string[] = [];
    await explainAccess(
      makeDeps({
        sets: [EXPORTER],
        requiredCaps: (_m: any, op: string) => { seen.push(op); return []; },
      }),
      { object: 'leave_request', operation: 'export', context: CTX },
    );
    expect(seen).toEqual(['find']);
  });

  it('a super-user wildcard does not confer export', async () => {
    const d = await explainAccess(makeDeps({ sets: [ADMIN] }), {
      object: 'leave_request', operation: 'export', context: CTX,
    });
    expect(d.allowed).toBe(false);
  });
});
