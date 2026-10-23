// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The external population's baseline (ruling of record 6355206139, letter B,
// stage 1, E4): a holder of the `external` organization role resolves the
// shipped `external_default` set and NOTHING the deployment's defaults bind —
// not `member_default`, not an app's `isDefault` set — so it reads its own
// identity rows and reaches data only through its explicit grants.
//
// The measured leak this closes: `sys_user_org_members`
// (`id in current_user.org_user_ids`) on the member baseline OR-combines with
// any application policy, so supplier A's portal user read every employee and
// supplier B's users through `GET /data/sys_user`.

import { describe, it, expect, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_IDENTITY_ORG_EXTERNAL } from '@objectstack/spec';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { PermissionEvaluator } from './permission-evaluator.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import { SecurityPlugin } from './security-plugin.js';
import { securityBuiltinPositions } from './builtin-positions.js';
import { MANAGED_DENY_TARGET_SETS } from './managed-object-write-denies.js';
import { defaultPermissionSets, EXTERNAL_DEFAULT_PERMISSION_SET } from './objects/default-permission-sets.js';

const evaluator = new PermissionEvaluator();
const rls = new RLSCompiler();
const EXTERNAL_DEFAULT = defaultPermissionSets.find((p) => p.name === EXTERNAL_DEFAULT_PERMISSION_SET)!;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

const EXTERNAL = {
  userId: 'u_supplier_a',
  tenantId: 'org_1',
  positions: [BUILTIN_IDENTITY_ORG_EXTERNAL],
  org_user_ids: ['u_supplier_a', 'u_employee', 'u_supplier_b'],
} as any;

/** The policies one set contributes for one object × operation, domains applied. */
const policiesFor = (set: PermissionSet, object: string, operation: string) =>
  rls.getApplicablePolicies(object, operation, (set.rowLevelSecurity ?? []) as any, EXTERNAL.positions);

/** A portal grant on ONE application object — the explicit grant the ruling admits. */
const PORTAL_GRANT = PermissionSetSchema.parse({
  name: 'supplier_portal',
  objects: { srm_purchase_order: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
});

describe('the external baseline set: own rows, never the member directory', () => {
  it('ships, with no wildcard and no delete bit anywhere (anchor-safe)', () => {
    expect(EXTERNAL_DEFAULT).toBeDefined();
    expect(Object.keys(EXTERNAL_DEFAULT.objects ?? {})).not.toContain('*');
    for (const [object, perms] of Object.entries(EXTERNAL_DEFAULT.objects ?? {})) {
      expect((perms as any).allowDelete, object).not.toBe(true);
      expect((perms as any).viewAllRecords, object).not.toBe(true);
      expect((perms as any).modifyAllRecords, object).not.toBe(true);
    }
  });

  it('declares no policy over the fellow-member list — the directory scope is the one it leaves out', () => {
    for (const policy of EXTERNAL_DEFAULT.rowLevelSecurity ?? []) {
      expect(policy.using, policy.name).not.toContain('org_user_ids');
    }
    expect((EXTERNAL_DEFAULT.rowLevelSecurity ?? []).map((p) => p.name)).not.toContain('sys_user_org_members');
    // CONTROL: the member baseline does carry it, so the absence above is the difference.
    expect((MEMBER_DEFAULT.rowLevelSecurity ?? []).map((p) => p.name)).toContain('sys_user_org_members');
  });

  it('sys_user: an external reads its own row only, not a fellow member\'s', () => {
    const policies = policiesFor(EXTERNAL_DEFAULT, 'sys_user', 'select');
    expect(policies.length).toBeGreaterThan(0);
    expect(rls.compileFilter(policies as any, EXTERNAL)).toEqual({ id: 'u_supplier_a' });
  });

  it('sys_member: an external reads its own membership only', () => {
    expect(evaluator.checkObjectPermission('find', 'sys_member', [EXTERNAL_DEFAULT])).toBe(true);
    const policies = policiesFor(EXTERNAL_DEFAULT, 'sys_member', 'select');
    expect(rls.compileFilter(policies as any, EXTERNAL)).toEqual({ user_id: 'u_supplier_a' });
    expect(rls.compileFilter(policies as any, {} as any)).toEqual(RLS_DENY_FILTER);
  });

  it('the organization structure tables are not granted at all', () => {
    for (const object of ['sys_team', 'sys_business_unit', 'sys_business_unit_member', 'sys_sso_provider']) {
      expect(evaluator.checkObjectPermission('find', object, [EXTERNAL_DEFAULT]), object).toBe(false);
    }
  });

  it('with one explicit grant it reads that object and no other application object', () => {
    const sets = [PORTAL_GRANT, EXTERNAL_DEFAULT];
    expect(evaluator.checkObjectPermission('find', 'srm_purchase_order', sets)).toBe(true);
    expect(evaluator.checkObjectPermission('insert', 'srm_purchase_order', sets)).toBe(false);
    expect(evaluator.checkObjectPermission('find', 'srm_supplier', sets)).toBe(false);
  });

  it('takes no registry-driven read injection: a newly declared identity table stays closed to it', () => {
    expect(MANAGED_DENY_TARGET_SETS).not.toContain(EXTERNAL_DEFAULT_PERMISSION_SET);
  });

  it('the org_external identity position names it, and only it', () => {
    const position: any = securityBuiltinPositions.find((p) => p.name === BUILTIN_IDENTITY_ORG_EXTERNAL);
    expect(position).toBeDefined();
    expect(position.permissionSets).toEqual([EXTERNAL_DEFAULT_PERMISSION_SET]);
  });
});

// ── the resolution, through the service locator a consumer uses ─────────────

/** An app's `isDefault` baseline — composed into the member baseline, never an external's. */
const APP_DEFAULT: PermissionSet = PermissionSetSchema.parse({
  name: 'srm_app_default',
  objects: { srm_supplier: { allowRead: true } },
});

async function locateSecurityService() {
  const ql: any = {
    registerMiddleware: () => {},
    getSchema: () => null,
    findOne: async (object: string, query?: EngineFindOneQueryInput) => {
      assertEngineFindOnePredicate(object, query);
      return null;
    },
    find: async () => [],
    registry: {
      getItem: (type: string, name: string) =>
        type === 'permission' ? [APP_DEFAULT, PORTAL_GRANT].find((d) => d.name === name) : undefined,
      listItems: (type: string) => (type === 'permission' ? [APP_DEFAULT, PORTAL_GRANT] : []),
      isPackageDisabled: () => false,
    },
  };
  const metadata: any = { get: async () => null, list: async () => [] };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: APP_DEFAULT.name } as any);
  await plugin.init(ctx);
  await plugin.start(ctx);
  return ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
}

describe('the external baseline at resolution: the deployment defaults never reach it', () => {
  it('an external resolves its own set and its explicit grant — not member_default, not the app default', async () => {
    const svc = await locateSecurityService();
    const names = await svc.resolvePermissionSetNames({
      userId: 'u_supplier_a',
      positions: [BUILTIN_IDENTITY_ORG_EXTERNAL],
      permissions: [PORTAL_GRANT.name],
    });
    expect([...names].sort()).toEqual([EXTERNAL_DEFAULT_PERMISSION_SET, PORTAL_GRANT.name].sort());
  });

  it('an external with no grant of its own falls back to its own set, never the member baseline', async () => {
    const svc = await locateSecurityService();
    const names = await svc.resolvePermissionSetNames({ userId: 'u_supplier_a', positions: [BUILTIN_IDENTITY_ORG_EXTERNAL] });
    expect(names).toEqual([EXTERNAL_DEFAULT_PERMISSION_SET]);
  });

  it('CONTROL: an ordinary member is unchanged — the composed baseline, additively', async () => {
    const svc = await locateSecurityService();
    const names = await svc.resolvePermissionSetNames({ userId: 'u_employee', positions: ['org_member', 'everyone'] });
    expect([...names].sort()).toEqual(['member_default', APP_DEFAULT.name].sort());
    expect(names).not.toContain(EXTERNAL_DEFAULT_PERMISSION_SET);
  });
});
