// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { FieldMasker } from './field-masker.js';
import { RLSCompiler, RLS_DENY_FILTER, isSupportedRlsExpression } from './rls-compiler.js';
import type { PermissionSet } from '@objectstack/spec/security';
import { RLS } from '@objectstack/spec/security';

// ---------------------------------------------------------------------------
// SecurityPlugin – basic metadata
// ---------------------------------------------------------------------------
describe('SecurityPlugin', () => {
  it('should have correct metadata', () => {
    const plugin = new SecurityPlugin();
    expect(plugin.name).toBe('com.objectstack.security');
    expect(plugin.type).toBe('standard');
    expect(plugin.version).toBe('1.0.0');
    expect(plugin.dependencies).toContain('com.objectstack.engine.objectql');
  });

  it('should register services during init', async () => {
    const plugin = new SecurityPlugin();
    const manifestService = { register: vi.fn() };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'manifest') return manifestService;
        return undefined;
      }),
    };
    await plugin.init(ctx);
    expect(ctx.registerService).toHaveBeenCalledWith('security.permissions', expect.any(PermissionEvaluator));
    expect(ctx.registerService).toHaveBeenCalledWith('security.rls', expect.any(RLSCompiler));
    expect(ctx.registerService).toHaveBeenCalledWith('security.fieldMasker', expect.any(FieldMasker));
    expect(manifestService.register).toHaveBeenCalled();
  });

  it('should warn and return when objectql service is missing', async () => {
    const plugin = new SecurityPlugin();
    const manifestService = { register: vi.fn() };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'manifest') return manifestService;
        throw new Error('not found');
      }),
    };
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('should warn when objectql does not support middleware', async () => {
    const plugin = new SecurityPlugin();
    const manifestService = { register: vi.fn() };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'manifest') return manifestService;
        return {}; // objectql without registerMiddleware
      }),
    };
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(ctx.logger.warn).toHaveBeenCalled();
  });

  it('should register middleware when objectql supports it', async () => {
    const plugin = new SecurityPlugin();
    const registerMiddleware = vi.fn();
    const manifestService = { register: vi.fn() };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'manifest') return manifestService;
        return { registerMiddleware };
      }),
    };
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(registerMiddleware).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should destroy without error', async () => {
    const plugin = new SecurityPlugin();
    await expect(plugin.destroy()).resolves.toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // org-scoping probe — when @objectstack/plugin-org-scoping is installed
  // (i.e. the `org-scoping` service is registered), SecurityPlugin keeps
  // wildcard `current_user.organization_id` RLS policies. Otherwise it
  // strips them so single-tenant deployments aren't filtered to nothing.
  // -------------------------------------------------------------------------
  const makeMiddlewareCtx = (overrides: { permissionSets: PermissionSet[]; objectFields?: string[]; schemaExtra?: Record<string, any>; orgScoping?: boolean; findOneImpl?: (query: any) => any }) => {
    const fields: Record<string, any> = {};
    for (const f of overrides.objectFields ?? ['id', 'organization_id', 'owner_id', 'name']) {
      fields[f] = { name: f };
    }
    const baseSchema: any = { name: 'task', fields, ...(overrides.schemaExtra ?? {}) };
    let middleware: any;
    // The pre-image write-authorization check re-reads the target row via
    // `ql.findOne(object, { where: { $and: [{ id }, writeFilter] }, … })`.
    // `findOneImpl` lets a test decide whether that row is "visible" (owned /
    // in-tenant) or filtered out (someone else's row → null → deny).
    const findOne = vi.fn(async (_object: string, query: any) =>
      overrides.findOneImpl ? overrides.findOneImpl(query) : null,
    );
    const ql = {
      registerMiddleware: (mw: any) => {
        // Capture only the FIRST middleware (the security CRUD one);
        // ignore the secondary bootstrap-replay middleware registered
        // later in `start()`.
        if (!middleware) middleware = mw;
      },
      getSchema: () => baseSchema,
      findOne,
    };
    const metadata = {
      get: async () => baseSchema,
      list: async () => overrides.permissionSets,
    };
    const services: Record<string, any> = {
      manifest: { register: vi.fn() },
      objectql: ql,
      metadata,
    };
    if (overrides.orgScoping) {
      // Sentinel object — SecurityPlugin only checks truthiness.
      services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
    }
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service not registered: ${name}`);
        return services[name];
      },
    };
    return {
      ctx,
      findOne,
      run: async (opCtx: any) => {
        await middleware(opCtx, async () => {});
        return opCtx;
      },
    };
  };

  const tenantPolicySet: PermissionSet = {
    name: 'member_default',
    label: 'Member',
    isProfile: true,
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    rowLevelSecurity: [
      { name: 'tenant_isolation', object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' },
    ],
  } as any;

  // Note: `organization_id` auto-injection lives in `@objectstack/plugin-org-scoping`
  // and is covered by that package's tests. SecurityPlugin only owns
  // `owner_id` auto-stamping.
  it('owner_id is always auto-injected on insert (regardless of org-scoping)', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet] });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task', operation: 'insert', data: { name: 'A' },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
    };
    await harness.run(opCtx);
    // SecurityPlugin no longer touches organization_id — that's plugin-org-scoping's job.
    expect(opCtx.data.organization_id).toBeUndefined();
    expect(opCtx.data.owner_id).toBe('u1');
  });

  it('without org-scoping plugin — strips tenant_isolation RLS so find applies no tenant where', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet] });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task', operation: 'find', ast: { where: undefined },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
    };
    await harness.run(opCtx);
    expect(opCtx.ast.where).toBeUndefined();
  });

  it('with org-scoping plugin — applies tenant_isolation RLS to find', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet], orgScoping: true });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task', operation: 'find', ast: { where: undefined },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
    };
    await harness.run(opCtx);
    expect(opCtx.ast.where).toEqual({ organization_id: 'org-1' });
  });

  // Regression: when a schema explicitly opts out of tenancy
  // (`tenancy.enabled === false` — e.g. `sys_package` Marketplace catalog),
  // the wildcard `tenant_isolation` policy targeting `organization_id`
  // must be treated as "not applicable" and SKIPPED, NOT fail-closed
  // with RLS_DENY_FILTER. Otherwise the registry skips injecting the
  // tenant column (correct) but the security plugin still produces zero
  // rows on every read (wrong) — which silently broke the cloud
  // Marketplace UI.
  it('tenancy.enabled=false — wildcard organization_id RLS is skipped, not denied', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [tenantPolicySet],
      // Catalog table without organization_id; opts out of tenancy.
      objectFields: ['id', 'manifest_id', 'visibility', 'owner_org_id'],
      schemaExtra: { tenancy: { enabled: false, strategy: 'shared' } },
      orgScoping: true,
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task', operation: 'find', ast: { where: undefined },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
    };
    await harness.run(opCtx);
    // No deny sentinel, no organization_id where clause: the read
    // passes through and the catalog row is visible to every tenant.
    expect(opCtx.ast.where).toBeUndefined();
  });

  // ── Row-level WRITE authorization (pre-image check, #1985) ──────────────
  // A by-id update/delete never builds an RLS `where`, so the owner/tenant
  // predicate must be enforced by re-reading the target row before mutating.
  describe('pre-image write authorization', () => {
    const ownerPolicySet: PermissionSet = {
      name: 'member_default',
      label: 'Member',
      isProfile: true,
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
      rowLevelSecurity: [
        { name: 'owner_only_writes', object: '*', operation: 'update', using: 'created_by = current_user.id' },
        { name: 'owner_only_deletes', object: '*', operation: 'delete', using: 'created_by = current_user.id' },
      ],
    } as any;
    const memberCtx = { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] };
    const ownerFields = ['id', 'created_by', 'name'];

    it('DENIES an update when the target row is not visible under the write filter (not the owner)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [ownerPolicySet],
        objectFields: ownerFields,
        findOneImpl: () => null, // row exists but filtered out by created_by → not visible
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'update',
        data: { id: 'r1', name: 'hijack' }, options: { where: { id: 'r1' } },
        context: memberCtx,
      };
      await expect(harness.run(opCtx)).rejects.toMatchObject({ name: 'PermissionDeniedError' });
      expect(harness.findOne).toHaveBeenCalledTimes(1);
      // the re-read ANDs the row id with the owner write filter
      const [, query] = harness.findOne.mock.calls[0];
      expect(query.where.$and[0]).toEqual({ id: 'r1' });
    });

    it('ALLOWS an update when the target row IS visible under the write filter (the owner)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [ownerPolicySet],
        objectFields: ownerFields,
        findOneImpl: () => ({ id: 'r1', created_by: 'u1', name: 'mine' }),
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'delete',
        options: { where: { id: 'r1' } },
        context: memberCtx,
      };
      await expect(harness.run(opCtx)).resolves.toBeDefined();
      expect(harness.findOne).toHaveBeenCalledTimes(1);
    });

    it('DENIES a purge of a not-owned row via the pre-image check (#1883 — destructive ops inherit row-level gating)', async () => {
      // The destructive lifecycle class (transfer/restore/purge) is pre-wired
      // into OPERATION_TO_PERMISSION, so it clears the object-level RBAC gate.
      // The record-level pre-image RLS check must therefore ALSO cover it —
      // otherwise a grant-holder could destroy out-of-scope rows by id. purge
      // maps onto the `delete` RLS class.
      const purgerSet: PermissionSet = {
        name: 'purger', label: 'Purger', isProfile: true,
        objects: { '*': { allowRead: true, allowPurge: true } },
        rowLevelSecurity: [
          { name: 'owner_only_deletes', object: '*', operation: 'delete', using: 'created_by = current_user.id' },
        ],
      } as any;
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'purger' });
      const harness = makeMiddlewareCtx({
        permissionSets: [purgerSet],
        objectFields: ownerFields,
        findOneImpl: () => null, // row exists but not owned → filtered out → deny
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'purge',
        options: { where: { id: 'r1' } },
        context: memberCtx,
      };
      await expect(harness.run(opCtx)).rejects.toMatchObject({ name: 'PermissionDeniedError' });
      expect(harness.findOne).toHaveBeenCalledTimes(1);
    });

    it('SKIPS the check when no RLS policy applies (e.g. modifyAllRecords / admin) — no extra read', async () => {
      const adminSet: PermissionSet = {
        name: 'admin_full_access', label: 'Admin', isProfile: true,
        objects: { '*': { allowRead: true, allowEdit: true, allowDelete: true, modifyAllRecords: true, viewAllRecords: true } },
        // no rowLevelSecurity
      } as any;
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'admin_full_access' });
      const harness = makeMiddlewareCtx({ permissionSets: [adminSet], objectFields: ownerFields });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'update',
        data: { id: 'r1', name: 'x' }, options: { where: { id: 'r1' } },
        context: { userId: 'admin', roles: ['admin_full_access'], permissions: [] },
      };
      await expect(harness.run(opCtx)).resolves.toBeDefined();
      expect(harness.findOne).not.toHaveBeenCalled();
    });

    it('SKIPS the check for a multi-row predicate id ({$in}) — only single-id by-pk writes are guarded', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [ownerPolicySet], objectFields: ownerFields, findOneImpl: () => null,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'update', multi: true,
        data: { name: 'bulk' }, options: { multi: true, where: { id: { $in: ['r1', 'r2'] } } },
        context: memberCtx,
      };
      await harness.run(opCtx);
      expect(harness.findOne).not.toHaveBeenCalled();
    });
  });

  it('tenancy.enabled=false via systemFields.tenant=false — also skipped', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [tenantPolicySet],
      objectFields: ['id', 'name'],
      schemaExtra: { systemFields: { tenant: false } },
      orgScoping: true,
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task', operation: 'find', ast: { where: undefined },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
    };
    await harness.run(opCtx);
    expect(opCtx.ast.where).toBeUndefined();
  });

  it('tenancy enabled (default) — wildcard organization_id RLS still denies when field is missing', async () => {
    // Sanity check: dropping the deny sentinel must remain in effect
    // for objects that did NOT opt out — otherwise a wildcard policy
    // applied to a half-migrated table would silently expose every row.
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [tenantPolicySet],
      objectFields: ['id', 'name'], // no organization_id, no opt-out
      orgScoping: true,
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task', operation: 'find', ast: { where: undefined },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
    };
    await harness.run(opCtx);
    expect(opCtx.ast.where).toEqual(RLS_DENY_FILTER);
  });

  // Post-resolution fallback: roles is non-empty (e.g. better-auth
  // sys_member.role = 'owner') but no sys_role binding maps that name to
  // a permission set, so resolvePermissionSets returns []. Without the
  // post-resolution fallback both CRUD and RLS would be skipped → users
  // with org membership but no granted permission set could read every
  // tenant's data. The fallback re-resolves with `member_default` so
  // tenant_isolation still applies.
  it('post-resolution fallback — non-empty roles resolving to no permission sets still get tenant_isolation RLS', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    // The metadata only carries `member_default` (loaded via
    // `permissionSets: [tenantPolicySet]`). The role name 'owner' is
    // not bound anywhere, so `resolvePermissionSets(['owner'])` → [].
    const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet], orgScoping: true });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task', operation: 'find', ast: { where: undefined },
      context: { userId: 'u1', tenantId: 'org-1', roles: ['owner'], permissions: [] },
    };
    await harness.run(opCtx);
    expect(opCtx.ast.where).toEqual({ organization_id: 'org-1' });
  });

  // -------------------------------------------------------------------------
  // ADR-0066 D2/D3 — private posture + requiredPermissions (full middleware)
  // -------------------------------------------------------------------------
  describe('ADR-0066 private posture + requiredPermissions (middleware)', () => {
    const memberSet: PermissionSet = {
      name: 'member_default', label: 'Member', isProfile: true,
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    } as any;
    // Platform super-admin: super-user wildcard + the capability + a tenant_isolation
    // RLS policy (to prove the posture-gated bypass actually short-circuits it).
    const adminSet: PermissionSet = {
      name: 'admin_full_access', label: 'Admin', isProfile: true,
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } },
      systemPermissions: ['manage_platform_settings'],
      rowLevelSecurity: [
        { name: 'tenant_isolation', object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' },
      ],
    } as any;

    it('DENIES a non-admin (plain wildcard) on a private object — wildcard does not cover it', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [memberSet],
        objectFields: ['id', 'organization_id', 'signed_token'],
        schemaExtra: { access: { default: 'private' } },
        orgScoping: true,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'find', ast: { where: undefined },
        context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
      };
      await expect(harness.run(opCtx)).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });

    it('DENIES a caller missing the required capability (D3 AND-gate)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [memberSet],
        objectFields: ['id', 'organization_id', 'signed_token'],
        schemaExtra: { requiredPermissions: ['manage_platform_settings'] },
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'find', ast: { where: undefined },
        context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
      };
      await expect(harness.run(opCtx)).rejects.toMatchObject({
        name: 'PermissionDeniedError',
        message: expect.stringContaining('requires capability'),
      });
    });

    it('ALLOWS the platform admin and BYPASSES wildcard RLS on a private object (read)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'admin_full_access' });
      const harness = makeMiddlewareCtx({
        permissionSets: [adminSet],
        objectFields: ['id', 'organization_id', 'signed_token'],
        schemaExtra: { access: { default: 'private' }, requiredPermissions: ['manage_platform_settings'] },
        orgScoping: true,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'find', ast: { where: undefined },
        context: { userId: 'admin', tenantId: 'org-1', roles: ['admin_full_access'], permissions: [] },
      };
      await expect(harness.run(opCtx)).resolves.toBeDefined();
      // Without the bypass this would be { organization_id: 'org-1' } and the
      // platform admin would miss null-/cross-org rows (the sys_license bug).
      expect(opCtx.ast.where).toBeUndefined();
    });

    it('BYPASSES the write pre-image check for a modifyAll admin on a private object', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'admin_full_access' });
      const harness = makeMiddlewareCtx({
        permissionSets: [adminSet],
        objectFields: ['id', 'organization_id', 'signed_token'],
        schemaExtra: { access: { default: 'private' }, requiredPermissions: ['manage_platform_settings'] },
        orgScoping: true,
        findOneImpl: () => null, // would DENY if the pre-image check ran
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'update',
        data: { id: 'r1', signed_token: 'x' }, options: { where: { id: 'r1' } },
        context: { userId: 'admin', tenantId: 'org-1', roles: ['admin_full_access'], permissions: [] },
      };
      await expect(harness.run(opCtx)).resolves.toBeDefined();
      expect(harness.findOne).not.toHaveBeenCalled();
    });

    // ADR-0024 / cloud#551 — `managedBy: 'better-auth'` identity tables get the
    // SAME posture-gated superuser bypass as private/non-tenant objects (their
    // rows are written without a tenant stamp, so the wildcard tenant_isolation
    // would otherwise hide every row from a platform admin).
    it('ALLOWS the platform admin and BYPASSES wildcard RLS on a better-auth-managed object', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'admin_full_access' });
      const harness = makeMiddlewareCtx({
        permissionSets: [adminSet],
        objectFields: ['id', 'organization_id', 'provider_id'],
        schemaExtra: { managedBy: 'better-auth' }, // NOT private, NOT tenancy-disabled
        orgScoping: true,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'find', ast: { where: undefined },
        context: { userId: 'admin', tenantId: 'org-1', roles: ['admin_full_access'], permissions: [] },
      };
      await expect(harness.run(opCtx)).resolves.toBeDefined();
      expect(opCtx.ast.where).toBeUndefined(); // bypassed — admin sees all identity rows
    });

    it('does NOT bypass for a non-admin on a better-auth-managed object (no leak)', async () => {
      const memberWithRls: PermissionSet = {
        name: 'member_default', label: 'Member', isProfile: true,
        objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
        rowLevelSecurity: [
          { name: 'tenant_isolation', object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' },
        ],
      } as any;
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [memberWithRls],
        objectFields: ['id', 'organization_id', 'provider_id'],
        schemaExtra: { managedBy: 'better-auth' },
        orgScoping: true,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const opCtx: any = {
        object: 'task', operation: 'find', ast: { where: undefined },
        context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] },
      };
      await harness.run(opCtx);
      // The member is still tenant-scoped — the managedBy bypass is admin-only.
      expect(opCtx.ast.where).toEqual({ organization_id: 'org-1' });
    });
  });

  // -------------------------------------------------------------------------
  // getReadFilter service (ADR-0021 D-C) — the reusable READ scope the
  // analytics raw-SQL path bridges to. Must produce the SAME FilterCondition
  // the engine middleware injects on `find`, and fail CLOSED on any error.
  // -------------------------------------------------------------------------
  describe('getReadFilter service', () => {
    it('registers a "security" service exposing getReadFilter', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet] });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const call = (harness.ctx.registerService as any).mock.calls.find(
        (c: any[]) => c[0] === 'security',
      );
      expect(call).toBeTruthy();
      expect(typeof call[1].getReadFilter).toBe('function');
    });

    it('returns the SAME tenant filter the find-path injects (org-scoping on)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet], orgScoping: true });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const ctx = { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] };
      const filter = await plugin.getReadFilter('task', ctx);
      expect(filter).toEqual({ organization_id: 'org-1' });
    });

    it('returns undefined (no scope) when tenant_isolation is stripped (org-scoping off)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet] });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const filter = await plugin.getReadFilter('task', { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] });
      expect(filter).toBeUndefined();
    });

    it('fail-closed: wildcard org policy on an object missing the column → deny sentinel', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [tenantPolicySet],
        objectFields: ['id', 'name'], // no organization_id, tenancy not opted out
        orgScoping: true,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const filter = await plugin.getReadFilter('task', { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] });
      expect(filter).toEqual(RLS_DENY_FILTER);
    });

    it('tenancy opt-out → undefined (not denied), matching the find-path', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [tenantPolicySet],
        objectFields: ['id', 'name'],
        schemaExtra: { tenancy: { enabled: false, strategy: 'shared' } },
        orgScoping: true,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const filter = await plugin.getReadFilter('task', { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] });
      expect(filter).toBeUndefined();
    });

    it('system context bypasses scoping (returns undefined)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet], orgScoping: true });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const filter = await plugin.getReadFilter('task', { isSystem: true, userId: 'u1', tenantId: 'org-1' });
      expect(filter).toBeUndefined();
    });

    it('anonymous (no userId/roles/permissions) → undefined (authn gated elsewhere)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet], orgScoping: true });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      const filter = await plugin.getReadFilter('task', { roles: [], permissions: [] });
      expect(filter).toBeUndefined();
    });

    it('fail-closed: a permission-resolution throw yields the deny sentinel (never allow-all)', async () => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet], orgScoping: true });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      // Force resolution to blow up.
      (plugin as any).permissionEvaluator.resolvePermissionSets = async () => {
        throw new Error('metadata service unavailable');
      };
      const filter = await plugin.getReadFilter('task', { userId: 'u1', tenantId: 'org-1', roles: [], permissions: [] });
      expect(filter).toEqual(RLS_DENY_FILTER);
    });
  });

  // -------------------------------------------------------------------------
  // FLS write enforcement (Backend FLS strip — gap #1)
  // -------------------------------------------------------------------------
  // Permission set that allows full CRUD on `task` but denies edit on
  // two specific fields: `salary` (read-only) and `ssn` (hidden).
  const flsPolicySet: PermissionSet = {
    name: 'member_default',
    label: 'Member',
    isProfile: true,
    objects: {
      '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    },
    fields: {
      'task.salary': { readable: true, editable: false },
      'task.ssn': { readable: false, editable: false },
    },
  } as any;

  it('FLS write — insert with a forbidden field throws PermissionDeniedError', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', salary: 9999 },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] },
    };
    await expect(harness.run(opCtx)).rejects.toThrow(/Field write denied/);
    await expect(harness.run(opCtx)).rejects.toMatchObject({
      details: { forbiddenFields: ['salary'] },
    });
  });

  it('FLS write — update with a forbidden field throws PermissionDeniedError', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'update',
      data: { ssn: 'leaked-123' },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] },
    };
    await expect(harness.run(opCtx)).rejects.toMatchObject({
      details: { forbiddenFields: ['ssn'] },
    });
  });

  it('fails CLOSED when permission resolution throws — denies, never bypasses (P0-2)', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet] });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    // Simulate the permission/metadata subsystem failing mid-resolution.
    (plugin as any).permissionEvaluator = {
      resolvePermissionSets: async () => { throw new Error('metadata service unavailable'); },
    };
    const opCtx: any = {
      object: 'task',
      operation: 'find',
      data: {},
      context: { userId: 'u1', tenantId: 'org-1', roles: ['member'], permissions: [] },
    };
    // Resolution failed → the request must be DENIED, not waved through.
    await expect(harness.run(opCtx)).rejects.toThrow(/permission subsystem unavailable/);
    expect(harness.ctx.logger.error).toHaveBeenCalled();
  });

  it('a system operation still bypasses security regardless (P0-2)', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({ permissionSets: [tenantPolicySet] });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    (plugin as any).permissionEvaluator = {
      resolvePermissionSets: async () => { throw new Error('should not be called'); },
    };
    const opCtx: any = { object: 'task', operation: 'find', context: { isSystem: true } };
    await expect(harness.run(opCtx)).resolves.toBeDefined(); // bypass short-circuits before resolution
  });

  it('FLS write — multiple forbidden fields are all listed in the error', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', salary: 1, ssn: 'x' },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] },
    };
    await expect(harness.run(opCtx)).rejects.toMatchObject({
      details: { forbiddenFields: ['salary', 'ssn'] },
    });
  });

  it('FLS write — insert that touches only editable fields passes', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A' },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] },
    };
    await expect(harness.run(opCtx)).resolves.toBeTruthy();
    // owner_id was auto-injected (still in scope for tests)
    expect(opCtx.data.owner_id).toBe('u1');
  });

  it('FLS write — bulk insert array catches forbidden field on any row', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: [
        { name: 'a' },
        { name: 'b', salary: 9 },  // offender on row 2
      ],
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] },
    };
    await expect(harness.run(opCtx)).rejects.toMatchObject({
      details: { forbiddenFields: ['salary'] },
    });
  });

  it('FLS write — system context (isSystem) bypasses the check entirely', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', salary: 9999, ssn: 'sys' },
      context: { isSystem: true },
    };
    await expect(harness.run(opCtx)).resolves.toBeTruthy();
  });

  it('FLS write — fields without any rule pass through (allow-list semantics)', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn', 'description'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    // `description` has no field rule → must be writable.
    const opCtx: any = {
      object: 'task',
      operation: 'insert',
      data: { name: 'A', description: 'foo' },
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] },
    };
    await expect(harness.run(opCtx)).resolves.toBeTruthy();
  });

  it('FLS write — does not interfere with read (find) — masker still strips read', async () => {
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
    const harness = makeMiddlewareCtx({
      permissionSets: [flsPolicySet],
      objectFields: ['id', 'owner_id', 'name', 'salary', 'ssn'],
    });
    await plugin.init(harness.ctx);
    await plugin.start(harness.ctx);
    const opCtx: any = {
      object: 'task',
      operation: 'find',
      ast: { where: undefined },
      result: undefined,
      context: { userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] },
    };
    // emulate the engine populating result inside next()
    const orig = harness.run;
    await orig.call(harness, opCtx);
    // No throw — find is not a write operation.
  });


  // ---------------------------------------------------------------------------
  // ADR-0058 D4 — RLS `check` clause (write post-image validation)
  //
  // `using` gates which EXISTING rows a write may target (pre-image, step 2.7);
  // `check` validates the NEW / CHANGED row (post-image) on insert/update — the
  // PostgreSQL WITH CHECK analog — compiled by the canonical compiler and matched
  // in-memory. Fail closed (D5). Scoped to policies that explicitly declare check.
  // ---------------------------------------------------------------------------
  describe('RLS check enforcement (ADR-0058 D4)', () => {
    const checkPolicySet: PermissionSet = {
      name: 'member_default',
      label: 'Member',
      isProfile: true,
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
      rowLevelSecurity: [
        { name: 'emea_insert_check', object: '*', operation: 'insert', check: "region == 'EMEA'" },
        { name: 'emea_update_check', object: '*', operation: 'update', check: "region == 'EMEA'" },
      ],
    } as any;

    const started = async (findOneImpl?: (q: any) => any) => {
      const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
      const harness = makeMiddlewareCtx({
        permissionSets: [checkPolicySet],
        objectFields: ['id', 'region', 'owner_id', 'name'],
        findOneImpl,
      });
      await plugin.init(harness.ctx);
      await plugin.start(harness.ctx);
      return harness;
    };
    const ctx = () => ({ userId: 'u1', tenantId: 'org-1', roles: [], permissions: ['member_default'] });

    it('INSERT whose post-image satisfies the check succeeds', async () => {
      const h = await started();
      const opCtx: any = { object: 'task', operation: 'insert', data: { name: 'A', region: 'EMEA' }, context: ctx() };
      await expect(h.run(opCtx)).resolves.toBeDefined();
    });

    it('INSERT whose post-image VIOLATES the check is denied (fail closed)', async () => {
      const h = await started();
      const opCtx: any = { object: 'task', operation: 'insert', data: { name: 'A', region: 'APAC' }, context: ctx() };
      await expect(h.run(opCtx)).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });

    it('INSERT missing the checked field is denied (fail closed)', async () => {
      const h = await started();
      const opCtx: any = { object: 'task', operation: 'insert', data: { name: 'A' }, context: ctx() };
      await expect(h.run(opCtx)).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });

    it('UPDATE whose post-image (pre-image ∪ change) satisfies the check succeeds', async () => {
      // Pre-image is APAC; the update moves it to EMEA → post-image is valid.
      const h = await started(() => ({ id: 'r1', region: 'APAC', name: 'X' }));
      const opCtx: any = { object: 'task', operation: 'update', data: { id: 'r1', region: 'EMEA' }, context: ctx() };
      await expect(h.run(opCtx)).resolves.toBeDefined();
    });

    it('UPDATE that changes a valid row to violate the check is denied', async () => {
      // Pre-image is EMEA (valid); the update moves it to APAC → post-image invalid.
      const h = await started(() => ({ id: 'r1', region: 'EMEA', name: 'X' }));
      const opCtx: any = { object: 'task', operation: 'update', data: { id: 'r1', region: 'APAC' }, context: ctx() };
      await expect(h.run(opCtx)).rejects.toMatchObject({ name: 'PermissionDeniedError' });
    });

    it('UPDATE leaving the checked field unchanged uses the pre-image value (valid stays valid)', async () => {
      const h = await started(() => ({ id: 'r1', region: 'EMEA', name: 'X' }));
      const opCtx: any = { object: 'task', operation: 'update', data: { id: 'r1', name: 'renamed' }, context: ctx() };
      await expect(h.run(opCtx)).resolves.toBeDefined();
    });

    it('DELETE is unaffected by check (no new row to validate)', async () => {
      const h = await started(() => ({ id: 'r1', region: 'APAC' }));
      const opCtx: any = { object: 'task', operation: 'delete', data: { id: 'r1' }, context: ctx() };
      await expect(h.run(opCtx)).resolves.toBeDefined();
    });
  });
});
// ---------------------------------------------------------------------------
describe('PermissionEvaluator', () => {
  const makePermSet = (
    name: string,
    objects: PermissionSet['objects'] = {},
    fields: PermissionSet['fields'] = {}
  ): PermissionSet => ({ name, objects, fields });

  it('should allow read when allowRead is true', () => {
    const evaluator = new PermissionEvaluator();
    const ps = makePermSet('admin', { contact: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } });
    expect(evaluator.checkObjectPermission('find', 'contact', [ps])).toBe(true);
    expect(evaluator.checkObjectPermission('findOne', 'contact', [ps])).toBe(true);
    expect(evaluator.checkObjectPermission('count', 'contact', [ps])).toBe(true);
  });

  it('should deny when no permission set matches', () => {
    const evaluator = new PermissionEvaluator();
    const ps = makePermSet('readonly', { contact: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false } });
    expect(evaluator.checkObjectPermission('insert', 'contact', [ps])).toBe(false);
  });

  it('should allow unknown (non-destructive) operations by default', () => {
    const evaluator = new PermissionEvaluator();
    expect(evaluator.checkObjectPermission('unknownOp', 'contact', [])).toBe(true);
  });

  it('denies transfer/restore/purge without the matching RBAC bit (#1883)', () => {
    const evaluator = new PermissionEvaluator();
    // Full CRUD does NOT imply the destructive lifecycle class: each op is
    // gated by its own bit (allowTransfer/allowRestore/allowPurge) and must
    // be denied when the bit is absent — never default-allow (ADR-0049).
    const ps = makePermSet('member', {
      contact: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    });
    expect(evaluator.checkObjectPermission('transfer', 'contact', [ps])).toBe(false);
    expect(evaluator.checkObjectPermission('restore', 'contact', [ps])).toBe(false);
    expect(evaluator.checkObjectPermission('purge', 'contact', [ps])).toBe(false);
    // …and an empty permission-set list denies too (fail-closed baseline).
    expect(evaluator.checkObjectPermission('purge', 'contact', [])).toBe(false);
  });

  it('allows transfer/restore/purge via their specific RBAC bits (#1883)', () => {
    const evaluator = new PermissionEvaluator();
    const transferOnly = makePermSet('t', { contact: { allowTransfer: true } });
    const restoreOnly = makePermSet('r', { contact: { allowRestore: true } });
    const purgeOnly = makePermSet('p', { contact: { allowPurge: true } });
    expect(evaluator.checkObjectPermission('transfer', 'contact', [transferOnly])).toBe(true);
    expect(evaluator.checkObjectPermission('restore', 'contact', [restoreOnly])).toBe(true);
    expect(evaluator.checkObjectPermission('purge', 'contact', [purgeOnly])).toBe(true);
    // A bit on one op never leaks to another.
    expect(evaluator.checkObjectPermission('purge', 'contact', [transferOnly])).toBe(false);
    expect(evaluator.checkObjectPermission('transfer', 'contact', [purgeOnly])).toBe(false);
  });

  it('modifyAllRecords super-user bypass covers transfer/restore/purge (#1883)', () => {
    const evaluator = new PermissionEvaluator();
    const admin = makePermSet('admin', { contact: { modifyAllRecords: true } });
    expect(evaluator.checkObjectPermission('transfer', 'contact', [admin])).toBe(true);
    expect(evaluator.checkObjectPermission('restore', 'contact', [admin])).toBe(true);
    expect(evaluator.checkObjectPermission('purge', 'contact', [admin])).toBe(true);
  });

  it('should allow via viewAllRecords', () => {
    const evaluator = new PermissionEvaluator();
    const ps = makePermSet('viewer', { task: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false, viewAllRecords: true } });
    expect(evaluator.checkObjectPermission('find', 'task', [ps])).toBe(true);
  });

  it('should allow edit/delete via modifyAllRecords', () => {
    const evaluator = new PermissionEvaluator();
    const ps = makePermSet('manager', { task: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false, modifyAllRecords: true } });
    expect(evaluator.checkObjectPermission('update', 'task', [ps])).toBe(true);
    expect(evaluator.checkObjectPermission('delete', 'task', [ps])).toBe(true);
  });

  it('should merge field permissions (most permissive)', () => {
    const evaluator = new PermissionEvaluator();
    const ps1 = makePermSet('ps1', {}, { 'contact.email': { readable: true, editable: false } });
    const ps2 = makePermSet('ps2', {}, { 'contact.email': { readable: false, editable: true } });
    const result = evaluator.getFieldPermissions('contact', [ps1, ps2]);
    expect(result['email']).toEqual({ readable: true, editable: true });
  });

  it('should filter field permissions to the correct object', () => {
    const evaluator = new PermissionEvaluator();
    const ps = makePermSet('ps', {}, {
      'contact.email': { readable: true, editable: false },
      'task.title': { readable: true, editable: true },
    });
    const result = evaluator.getFieldPermissions('contact', [ps]);
    expect(result['email']).toBeDefined();
    expect(result['title']).toBeUndefined();
  });

  it('should resolve permission sets from metadata service by role name', async () => {
    const evaluator = new PermissionEvaluator();
    const ps1 = { name: 'admin' };
    const ps2 = { name: 'viewer' };
    const metadata = { list: vi.fn().mockReturnValue([ps1, ps2]) };
    const result = await evaluator.resolvePermissionSets(['admin'], metadata);
    expect(result).toEqual([ps1]);
  });

  it('should return empty array when metadata has no permission sets', async () => {
    const evaluator = new PermissionEvaluator();
    const metadata = { list: vi.fn().mockReturnValue([]) };
    await expect(
      evaluator.resolvePermissionSets(['admin'], metadata),
    ).resolves.toEqual([]);
  });

  it('resolves permission sets via async metadata.list (real MetadataManager shape)', async () => {
    const evaluator = new PermissionEvaluator();
    const psAdmin = { name: 'admin_full_access' };
    const metadata = {
      list: vi.fn().mockResolvedValue([psAdmin, { name: 'viewer_readonly' }]),
    };
    const result = await evaluator.resolvePermissionSets(
      ['admin_full_access'],
      metadata,
    );
    expect(metadata.list).toHaveBeenCalledWith('permission');
    expect(result).toEqual([psAdmin]);
  });

  it('matches by both role and explicit permission-set identifiers', async () => {
    const evaluator = new PermissionEvaluator();
    const sets = [
      { name: 'admin_full_access' },
      { name: 'viewer_readonly' },
      { name: 'export_reports' },
    ];
    const metadata = { list: vi.fn().mockReturnValue(sets) };
    const result = await evaluator.resolvePermissionSets(
      ['admin_full_access', 'export_reports'],
      metadata,
    );
    expect(result.map((p) => p.name).sort()).toEqual([
      'admin_full_access',
      'export_reports',
    ]);
  });
});

// ---------------------------------------------------------------------------
// PermissionEvaluator — ADR-0066 D2 (private posture) + D3 (capabilities)
// ---------------------------------------------------------------------------
describe('PermissionEvaluator — ADR-0066 posture + capabilities', () => {
  const ps = (name: string, objects: PermissionSet['objects'] = {}, systemPermissions?: string[]): PermissionSet =>
    ({ name, objects, ...(systemPermissions ? { systemPermissions } : {}) });
  const plainWildcard = ps('member', { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } });
  const superWildcard = ps('admin', { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } });
  const explicitGrant = ps('license_reader', { sys_license: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } });

  it('private object is NOT covered by a plain (non-superuser) wildcard', () => {
    const ev = new PermissionEvaluator();
    expect(ev.checkObjectPermission('find', 'sys_license', [plainWildcard], { isPrivate: true })).toBe(false);
    // ...but a public object still is (today's allow-by-default).
    expect(ev.checkObjectPermission('find', 'crm_account', [plainWildcard])).toBe(true);
    expect(ev.checkObjectPermission('find', 'crm_account', [plainWildcard], { isPrivate: false })).toBe(true);
  });

  it('private object IS covered by a super-user wildcard (View/Modify All Data)', () => {
    const ev = new PermissionEvaluator();
    expect(ev.checkObjectPermission('find', 'sys_license', [superWildcard], { isPrivate: true })).toBe(true);
    expect(ev.checkObjectPermission('insert', 'sys_license', [superWildcard], { isPrivate: true })).toBe(true);
    expect(ev.checkObjectPermission('update', 'sys_license', [superWildcard], { isPrivate: true })).toBe(true);
  });

  it('private object IS covered by an explicit per-object grant (no superuser bit needed)', () => {
    const ev = new PermissionEvaluator();
    expect(ev.checkObjectPermission('find', 'sys_license', [explicitGrant], { isPrivate: true })).toBe(true);
    expect(ev.checkObjectPermission('update', 'sys_license', [explicitGrant], { isPrivate: true })).toBe(false);
  });

  it('getSystemPermissions unions capabilities across sets', () => {
    const ev = new PermissionEvaluator();
    const a = ps('a', {}, ['manage_users', 'export_data']);
    const b = ps('b', {}, ['export_data', 'manage_platform_settings']);
    expect([...ev.getSystemPermissions([a, b])].sort()).toEqual(['export_data', 'manage_platform_settings', 'manage_users']);
    expect([...ev.getSystemPermissions([plainWildcard])]).toEqual([]);
  });

  it('hasSuperuserReadBypass honours the private posture', () => {
    const ev = new PermissionEvaluator();
    // plain wildcard: bypasses on a public object, NOT on a private one.
    expect(ev.hasSuperuserReadBypass('crm_account', [plainWildcard], { isPrivate: false })).toBe(false); // no viewAll bit
    expect(ev.hasSuperuserReadBypass('sys_license', [superWildcard], { isPrivate: true })).toBe(true);
    expect(ev.hasSuperuserReadBypass('sys_license', [plainWildcard], { isPrivate: true })).toBe(false);
    // explicit grant without viewAll → no read bypass.
    expect(ev.hasSuperuserReadBypass('sys_license', [explicitGrant], { isPrivate: true })).toBe(false);
  });

  it('hasSuperuserWriteBypass requires modifyAllRecords', () => {
    const ev = new PermissionEvaluator();
    const viewOnly = ps('vo', { '*': { allowRead: true, viewAllRecords: true } });
    expect(ev.hasSuperuserWriteBypass('sys_license', [superWildcard], { isPrivate: true })).toBe(true);
    expect(ev.hasSuperuserWriteBypass('sys_license', [viewOnly], { isPrivate: true })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FieldMasker
// ---------------------------------------------------------------------------
describe('FieldMasker', () => {
  it('should return results unchanged when no field permissions', () => {
    const masker = new FieldMasker();
    const records = [{ id: '1', name: 'Alice', email: 'alice@example.com' }];
    expect(masker.maskResults(records, {}, 'contact')).toEqual(records);
  });

  it('should remove non-readable fields from records', () => {
    const masker = new FieldMasker();
    const records = [{ id: '1', name: 'Alice', email: 'alice@example.com' }];
    const perms = { email: { readable: false, editable: false } };
    const result = masker.maskResults(records, perms, 'contact') as any[];
    expect(result[0].email).toBeUndefined();
    expect(result[0].name).toBe('Alice');
  });

  it('should handle single record (non-array)', () => {
    const masker = new FieldMasker();
    const record = { id: '1', ssn: '123-45-6789', name: 'Bob' };
    const perms = { ssn: { readable: false, editable: false } };
    const result = masker.maskResults(record, perms, 'person') as any;
    expect(result.ssn).toBeUndefined();
    expect(result.name).toBe('Bob');
  });

  it('should preserve readable fields', () => {
    const masker = new FieldMasker();
    const record = { id: '1', name: 'Carol', secret: 'x' };
    const perms = {
      name: { readable: true, editable: true },
      secret: { readable: false, editable: false },
    };
    const result = masker.maskResults(record, perms, 'user') as any;
    expect(result.name).toBe('Carol');
    expect(result.secret).toBeUndefined();
  });

  it('should return non-editable fields', () => {
    const masker = new FieldMasker();
    const perms = {
      email: { readable: true, editable: false },
      name: { readable: true, editable: true },
    };
    const nonEditable = masker.getNonEditableFields(perms);
    expect(nonEditable).toContain('email');
    expect(nonEditable).not.toContain('name');
  });

  it('should strip non-editable fields from write data', () => {
    const masker = new FieldMasker();
    const data = { name: 'Dave', email: 'dave@example.com', createdAt: '2024' };
    const perms = {
      email: { readable: true, editable: false },
      createdAt: { readable: true, editable: false },
      name: { readable: true, editable: true },
    };
    const result = masker.stripNonEditableFields(data, perms);
    expect(result.name).toBe('Dave');
    expect(result.email).toBeUndefined();
    expect(result.createdAt).toBeUndefined();
  });

  describe('detectForbiddenWrites', () => {
    it('returns [] when no field permissions defined', () => {
      const masker = new FieldMasker();
      expect(
        masker.detectForbiddenWrites({ salary: 9999 }, {}),
      ).toEqual([]);
    });

    it('returns [] when all fields are editable', () => {
      const masker = new FieldMasker();
      const perms = {
        salary: { readable: true, editable: true },
      };
      expect(
        masker.detectForbiddenWrites({ salary: 9999 }, perms),
      ).toEqual([]);
    });

    it('returns [] when payload only contains fields without permission rules', () => {
      const masker = new FieldMasker();
      const perms = {
        salary: { readable: true, editable: false },
      };
      // 'name' has no field rule → passes through.
      expect(
        masker.detectForbiddenWrites({ name: 'Dave' }, perms),
      ).toEqual([]);
    });

    it('returns the non-editable fields present in payload (single record)', () => {
      const masker = new FieldMasker();
      const perms = {
        salary: { readable: true, editable: false },
        ssn: { readable: false, editable: false },
      };
      expect(
        masker.detectForbiddenWrites(
          { name: 'Dave', salary: 9999, ssn: '...' },
          perms,
        ),
      ).toEqual(['salary', 'ssn']);
    });

    it('handles array (bulk insert) — returns union of offenders, deduped, sorted', () => {
      const masker = new FieldMasker();
      const perms = {
        salary: { readable: true, editable: false },
        ssn: { readable: false, editable: false },
      };
      const rows = [
        { name: 'a', salary: 1 },
        { name: 'b', ssn: 'x' },
        { name: 'c', salary: 2, ssn: 'y' },
      ];
      expect(masker.detectForbiddenWrites(rows, perms)).toEqual([
        'salary',
        'ssn',
      ]);
    });

    it('ignores null/non-object rows in a bulk array', () => {
      const masker = new FieldMasker();
      const perms = { salary: { readable: true, editable: false } };
      // null inside array should be skipped, not crash
      const rows = [null as any, { salary: 1 }, 'string' as any];
      expect(masker.detectForbiddenWrites(rows, perms)).toEqual(['salary']);
    });

    it('readable-but-not-editable counts as forbidden write (a user who can see a field still cannot change it)', () => {
      const masker = new FieldMasker();
      const perms = {
        approved_by: { readable: true, editable: false },
      };
      expect(
        masker.detectForbiddenWrites({ approved_by: 'u2' }, perms),
      ).toEqual(['approved_by']);
    });
  });
});

// ---------------------------------------------------------------------------
// RLSCompiler
// ---------------------------------------------------------------------------
describe('RLSCompiler', () => {
  it('should return null for empty policies', () => {
    const compiler = new RLSCompiler();
    expect(compiler.compileFilter([])).toBeNull();
  });

  it('should compile equality expression with current_user property', () => {
    const compiler = new RLSCompiler();
    const policy: any = { object: 'task', operation: 'select', using: 'owner_id = current_user.id' };
    const ctx: any = { userId: 'user-42', tenantId: 'tenant-1', roles: [] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({ owner_id: 'user-42' });
  });

  it('resolves current_user.email to the literal (unique owner anchor)', () => {
    // Email is the seedable, unique owner anchor — a data column like
    // `owner` can be authored against it and compiles to a concrete literal,
    // which is what lets controlled_by_parent resolve master ids under a
    // system find (the value is baked in, not a placeholder).
    const compiler = new RLSCompiler();
    const policy: any = { object: 'showcase_invoice', operation: 'select', using: 'owner = current_user.email' };
    const ctx: any = { userId: 'u1', email: 'ada@example.com', roles: [] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({ owner: 'ada@example.com' });
  });

  it('does NOT resolve current_user.name (collision-prone) → fail-closed', () => {
    // Display names are intentionally NOT exposed to RLS: they collide, and a
    // collision on an ownership predicate is an access leak. An unresolved
    // variable drops the (only) policy → deny sentinel.
    const compiler = new RLSCompiler();
    const policy: any = { object: 'showcase_invoice', operation: 'select', using: 'owner = current_user.name' };
    const ctx: any = { userId: 'u1', email: 'ada@example.com', roles: [] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('should compile literal equality expression', () => {
    const compiler = new RLSCompiler();
    const policy: any = { object: 'doc', operation: 'select', using: "status = 'published'" };
    const filter = compiler.compileFilter([policy]);
    expect(filter).toEqual({ status: 'published' });
  });

  it('should compile IN expression with array property', () => {
    const compiler = new RLSCompiler();
    const policy: any = { object: 'project', operation: 'select', using: 'id IN (current_user.roles)' };
    const ctx: any = { userId: 'u1', tenantId: 't1', roles: ['role-a', 'role-b'] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({ id: { $in: ['role-a', 'role-b'] } });
  });

  it('should compile IN expression against pre-resolved org_user_ids', () => {
    // Covers the sys_user_org_members policy that lets members see
    // fellow collaborators in the active organization. The runtime
    // resolver populates ctx.org_user_ids from sys_member; the
    // compiler reads it as an arbitrary current_user.* property.
    const compiler = new RLSCompiler();
    const policy: any = {
      object: 'sys_user',
      operation: 'select',
      using: 'id IN (current_user.org_user_ids)',
    };
    const ctx: any = {
      userId: 'u1',
      tenantId: 'org-1',
      roles: [],
      org_user_ids: ['u1', 'u2', 'u3'],
    };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({ id: { $in: ['u1', 'u2', 'u3'] } });
  });

  it('should fail-closed for IN when org_user_ids is empty', () => {
    // No active org → no fellow members. The IN policy drops out;
    // since it was the only policy supplied, the compiler returns
    // the deny sentinel (zero rows). Real callers usually pair this
    // with a sys_user_self policy so the user still sees their own row.
    const compiler = new RLSCompiler();
    const policy: any = {
      object: 'sys_user',
      operation: 'select',
      using: 'id IN (current_user.org_user_ids)',
    };
    const ctx: any = { userId: 'u1', tenantId: null, roles: [], org_user_ids: [] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('should OR-combine multiple policies', () => {
    const compiler = new RLSCompiler();
    const p1: any = { object: 'task', operation: 'select', using: 'owner_id = current_user.id' };
    const p2: any = { object: 'task', operation: 'select', using: "status = 'public'" };
    const ctx: any = { userId: 'u99', tenantId: 't1', roles: [] };
    const filter = compiler.compileFilter([p1, p2], ctx);
    expect(filter).toEqual({ $or: [{ owner_id: 'u99' }, { status: 'public' }] });
  });

  it('should fail-closed (deny filter) when expression is unsupported', () => {
    // Previously returned null, which is fail-OPEN (no RLS applied →
    // every row visible). Now returns the deny sentinel so a misconfigured
    // policy doesn't silently disable tenant isolation.
    const compiler = new RLSCompiler();
    const policy: any = { object: 'x', operation: 'select', using: 'complex expression WITH unsupported syntax' };
    const filter = compiler.compileFilter([policy]);
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('should fail-closed when the only policy depends on a missing user-context value', () => {
    // Repro: a logged-in user without an active organization. The
    // tenant_isolation rule would compile to `organization_id = null`,
    // which previously either (a) returned every row from tables that
    // lack `organization_id` (e.g. sys_user) or (b) returned every row
    // because compileFilter dropped it as null. We now fail-closed so
    // the user sees zero rows on tenant-aware tables until they pick an
    // active organization. Per-object rules that *do* compile (e.g.
    // `sys_user_self`) still grant access — see the next test.
    const compiler = new RLSCompiler();
    const policy: any = { object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' };
    const ctx: any = { userId: 'u1', tenantId: null, roles: [] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('should still apply policy when only one of multiple has a usable value', () => {
    // tenant policy can't compile (null tenantId) but sys_user_self can.
    // Result: just the self-row filter — the broken tenant policy drops out.
    const compiler = new RLSCompiler();
    const tenantPolicy: any = { object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' };
    const selfPolicy: any = { object: 'sys_user', operation: 'select', using: 'id = current_user.id' };
    const ctx: any = { userId: 'u1', tenantId: null, roles: [] };
    const filter = compiler.compileFilter([tenantPolicy, selfPolicy], ctx);
    expect(filter).toEqual({ id: 'u1' });
  });

  it('should compile tenant policy normally when an active organization is set', () => {
    // Sanity check — the deny path is only triggered by *missing* values.
    const compiler = new RLSCompiler();
    const policy: any = { object: '*', operation: 'all', using: 'organization_id = current_user.organization_id' };
    const ctx: any = { userId: 'u1', tenantId: 'org-1', roles: [] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({ organization_id: 'org-1' });
  });

  it('should get applicable policies for object and operation', () => {
    const compiler = new RLSCompiler();
    const policies: any[] = [
      { object: 'task', operation: 'select', using: 'owner_id = current_user.id' },
      { object: 'task', operation: 'insert', using: "status = 'open'" },
      { object: 'contact', operation: 'all', using: 'organization_id = current_user.organization_id' },
      { object: '*', operation: 'all', using: "active = 'true'" },
    ];

    const taskSelect = compiler.getApplicablePolicies('task', 'find', policies);
    expect(taskSelect).toHaveLength(2); // task select + * all
    const taskInsert = compiler.getApplicablePolicies('task', 'insert', policies);
    expect(taskInsert).toHaveLength(2); // task insert + * all
    const contactFind = compiler.getApplicablePolicies('contact', 'find', policies);
    expect(contactFind).toHaveLength(2); // contact all + * all
  });

  // §7.3.1 dynamic membership — arbitrary pre-resolved sets in rlsMembership
  it('should resolve IN against a §7.3.1 pre-resolved rlsMembership set', () => {
    // Manager hierarchy: the runtime resolved the manager's reports into
    // ctx.rlsMembership.team_member_ids. The compiler merges that bag into
    // the user context so `IN (current_user.team_member_ids)` resolves
    // without any subquery support.
    const compiler = new RLSCompiler();
    const policy: any = {
      object: 'task',
      operation: 'select',
      using: 'assigned_to_id IN (current_user.team_member_ids)',
    };
    const ctx: any = {
      userId: 'mgr-1',
      tenantId: 'org-1',
      roles: ['manager'],
      rlsMembership: { team_member_ids: ['u2', 'u3', 'u4'] },
    };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({ assigned_to_id: { $in: ['u2', 'u3', 'u4'] } });
  });

  it('should fail-closed when a §7.3.1 membership set is empty', () => {
    // A manager with no reports → empty team_member_ids → the IN policy
    // drops out → sole policy → deny sentinel (zero rows). Never fail-open.
    const compiler = new RLSCompiler();
    const policy: any = {
      object: 'task',
      operation: 'select',
      using: 'assigned_to_id IN (current_user.team_member_ids)',
    };
    const ctx: any = { userId: 'mgr-1', tenantId: 'org-1', roles: [], rlsMembership: { team_member_ids: [] } };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual(RLS_DENY_FILTER);
  });

  it('should not let a rlsMembership key clobber a named context field', () => {
    // roles is a first-class field; a hostile/misconfigured membership bag
    // must not override it. The named `roles` (['real-role']) wins; the
    // policy compiles against it, not the injected ['spoofed'].
    const compiler = new RLSCompiler();
    const policy: any = { object: 'x', operation: 'select', using: 'role_id IN (current_user.roles)' };
    const ctx: any = {
      userId: 'u1',
      tenantId: 'org-1',
      roles: ['real-role'],
      rlsMembership: { roles: ['spoofed'] },
    };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({ role_id: { $in: ['real-role'] } });
  });

  // Always-true literal — makes RLS.allowAllPolicy grant access instead of
  // silently failing closed.
  it('should compile "1 = 1" to an unrestricted (empty) filter', () => {
    const compiler = new RLSCompiler();
    const policy: any = { object: 'account', operation: 'all', using: '1 = 1', roles: ['ceo'] };
    const ctx: any = { userId: 'u1', tenantId: 'org-1', roles: ['ceo'] };
    const filter = compiler.compileFilter([policy], ctx);
    expect(filter).toEqual({}); // matches every row
  });

  it('should grant allow-all via RLS.allowAllPolicy instead of denying', () => {
    // Regression guard: '1 = 1' used to be unsupported → deny sentinel,
    // making the helper do the opposite of its name. Now it grants.
    const compiler = new RLSCompiler();
    const policy = RLS.allowAllPolicy('account', ['ceo', 'cfo']) as any;
    const filter = compiler.compileFilter([policy]);
    expect(filter).toEqual({});
    expect(filter).not.toEqual(RLS_DENY_FILTER);
  });
});

// ---------------------------------------------------------------------------
// ADR-0056 D4 — RLS predicates that won't compile must not vanish in silence
// ---------------------------------------------------------------------------
describe('RLSCompiler D4 — uncompilable predicates are surfaced', () => {
  it('isSupportedRlsExpression accepts the compilable shapes', () => {
    // Legacy SQL-ish subset (bridged `=`/`IN`).
    expect(isSupportedRlsExpression('owner_id = current_user.id')).toBe(true);
    expect(isSupportedRlsExpression('owner = current_user.email')).toBe(true);
    expect(isSupportedRlsExpression("status = 'published'")).toBe(true);
    expect(isSupportedRlsExpression('id IN (current_user.org_user_ids)')).toBe(true);
    expect(isSupportedRlsExpression('1 = 1')).toBe(true);
    // ADR-0058: the canonical compiler lowers a broader pushdown subset, so the
    // shape gate now (correctly) reports these as enforceable — `==`/`!=`,
    // comparisons, and CEL compound predicates all compile to a FilterCondition.
    expect(isSupportedRlsExpression('owner == current_user.id')).toBe(true);   // `==`
    expect(isSupportedRlsExpression('amount > 100')).toBe(true);               // comparison
    expect(isSupportedRlsExpression('region != null')).toBe(true);             // null check
    expect(isSupportedRlsExpression('a == 1 && b == 2')).toBe(true);           // CEL compound
  });

  it('isSupportedRlsExpression rejects genuinely non-pushdownable shapes', () => {
    // These cannot lower to a FilterCondition for ANY input, so the gate must
    // reject them (ADR-0055 / ADR-0056 D4) — they fail closed at runtime.
    expect(isSupportedRlsExpression('a = current_user.id AND b = 1')).toBe(false); // SQL AND ≠ CEL && (unparseable)
    expect(isSupportedRlsExpression('amount + 1 > 2')).toBe(false);                // arithmetic
    expect(isSupportedRlsExpression('id IN (SELECT id FROM users)')).toBe(false);  // subquery
    expect(isSupportedRlsExpression('record.a.b == 1')).toBe(false);              // cross-object traversal
    expect(isSupportedRlsExpression('')).toBe(false);
  });

  it('WARNS (does not silently drop) an unsupported-shape policy', () => {
    const warned: string[] = [];
    const compiler = new RLSCompiler();
    compiler.setLogger({ warn: (message: string) => warned.push(message) });
    // ADR-0058: a genuinely non-pushdownable shape (arithmetic) — no input can
    // lower it, so it must WARN (vs a valid shape whose var is merely absent).
    const policy: any = { name: 'bad', object: 'thing', operation: 'select', using: 'amount + 1 > 2' };
    const filter = compiler.compileFilter([policy], { userId: 'u1' } as any);
    expect(filter).toEqual(RLS_DENY_FILTER); // only policy dropped → fail-closed
    expect(warned.length).toBe(1);
    expect(warned[0]).toContain('uncompilable predicate');
  });

  it('does NOT warn a SUPPORTED shape whose context var is merely absent', () => {
    const warned: string[] = [];
    const compiler = new RLSCompiler();
    compiler.setLogger({ warn: (message: string) => warned.push(message) });
    // valid shape; `department` simply isn't in the context → intentional fail-closed skip.
    // CEL form (SQL `=` would now additionally emit a deprecation warn).
    const policy: any = { name: 'dept', object: 'thing', operation: 'select', using: 'dept == current_user.department' };
    compiler.compileFilter([policy], { userId: 'u1' } as any);
    expect(warned.length).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// ADR-0058 D1 — SQL→CEL deprecation bridge: legacy SQL-style RLS predicates
// still COMPILE (back-compat for stored predicates) but emit a deprecation warn;
// canonical CEL passes through silently (idempotent bridge).
// ---------------------------------------------------------------------------
describe('RLSCompiler — SQL→CEL deprecation bridge (ADR-0058 D1)', () => {
  it('a legacy SQL-style predicate still compiles AND warns deprecation', () => {
    const warned: string[] = [];
    const compiler = new RLSCompiler();
    compiler.setLogger({ warn: (m: string) => warned.push(m) });
    const policy: any = { object: 'task', operation: 'select', using: 'owner_id = current_user.id' };
    const filter = compiler.compileFilter([policy], { userId: 'u1' } as any);
    expect(filter).toEqual({ owner_id: 'u1' }); // bridge keeps it working
    expect(warned.some((m) => m.includes('DEPRECATED SQL-style'))).toBe(true);
  });

  it('a legacy SQL `IN (...)` predicate still compiles AND warns', () => {
    const warned: string[] = [];
    const compiler = new RLSCompiler();
    compiler.setLogger({ warn: (m: string) => warned.push(m) });
    const policy: any = { object: 'p', operation: 'select', using: 'id IN (current_user.org_user_ids)' };
    const filter = compiler.compileFilter([policy], { userId: 'u1', org_user_ids: ['u1', 'u2'] } as any);
    expect(filter).toEqual({ id: { $in: ['u1', 'u2'] } });
    expect(warned.some((m) => m.includes('DEPRECATED SQL-style'))).toBe(true);
  });

  it('canonical CEL passes through with NO deprecation warn (idempotent bridge)', () => {
    const warned: string[] = [];
    const compiler = new RLSCompiler();
    compiler.setLogger({ warn: (m: string) => warned.push(m) });
    const policy: any = { object: 'task', operation: 'select', using: 'owner_id == current_user.id' };
    const filter = compiler.compileFilter([policy], { userId: 'u1' } as any);
    expect(filter).toEqual({ owner_id: 'u1' }); // identical result to the SQL form
    expect(warned.length).toBe(0);
  });
});

describe('SecurityPlugin – metadata-change cache invalidation', () => {
  it('clears metadata-derived caches when metadata changes at runtime', async () => {
    const plugin = new SecurityPlugin();
    let watchCb: (() => void) | undefined;
    const metadata = {
      watch: (_type: string, cb: () => void) => {
        watchCb = cb;
        return { unsubscribe: vi.fn() };
      },
    };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      hook: vi.fn(),
      getService: vi.fn().mockImplementation((name: string) => {
        if (name === 'manifest') return { register: vi.fn() };
        if (name === 'metadata') return metadata;
        if (name === 'objectql') return { registerMiddleware: vi.fn() };
        return undefined;
      }),
    };
    await plugin.init(ctx);
    await plugin.start(ctx);

    expect(typeof watchCb).toBe('function');

    (plugin as any).fieldNamesCache.set('crm_account', new Set(['name']));
    (plugin as any).tenancyDisabledCache.set('crm_account', true);
    (plugin as any).cbpRelCache.set('crm_account', null);

    watchCb!();

    expect((plugin as any).fieldNamesCache.size).toBe(0);
    expect((plugin as any).tenancyDisabledCache.size).toBe(0);
    expect((plugin as any).cbpRelCache.size).toBe(0);
  });
});


// ---------------------------------------------------------------------------
// ADR-0066 D3 — field-level requiredPermissions (read-mask + write-deny)
// ---------------------------------------------------------------------------
describe('SecurityPlugin — ADR-0066 D3 field-level requiredPermissions', () => {
  const fieldsSchema = {
    fields: {
      id: { name: 'id' },
      name: { name: 'name' },
      salary: { name: 'salary', requiredPermissions: ['view_salary'] },
    },
  };
  const setNoCap: PermissionSet = {
    name: 'fld_member', isProfile: true,
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  } as any;
  const setWithCap: PermissionSet = {
    name: 'fld_cap', isProfile: true,
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    systemPermissions: ['view_salary'],
  } as any;

  const harnessFor = (sets: PermissionSet[], fallback: string) => {
    let middleware: any;
    const schema = { name: 'task', ...fieldsSchema };
    const ql: any = {
      registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
      getSchema: () => schema,
      findOne: async () => null,
      find: async () => [],
    };
    const metadata = { get: async () => schema, list: async () => sets };
    const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: (n: string) => { if (!(n in services)) throw new Error(`service not registered: ${n}`); return services[n]; },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: fallback });
    return { plugin, ctx, run: async (opCtx: any) => { await middleware(opCtx, async () => {}); return opCtx; } };
  };

  it('masks a capability-gated field on read when the caller lacks the capability', async () => {
    const h = harnessFor([setNoCap], 'fld_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'task', operation: 'find', ast: { where: undefined }, result: [{ id: 'r1', name: 'A', salary: 100 }], context: { userId: 'u1', roles: [], permissions: [] } };
    await h.run(opCtx);
    expect(opCtx.result[0].name).toBe('A');
    expect(opCtx.result[0].salary).toBeUndefined();
  });

  it('does NOT mask when the caller holds the capability', async () => {
    const h = harnessFor([setWithCap], 'fld_cap');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'task', operation: 'find', ast: { where: undefined }, result: [{ id: 'r1', name: 'A', salary: 100 }], context: { userId: 'u1', roles: [], permissions: ['fld_cap'] } };
    await h.run(opCtx);
    expect(opCtx.result[0].salary).toBe(100);
  });

  it('denies a write to a capability-gated field when the caller lacks the capability', async () => {
    const h = harnessFor([setNoCap], 'fld_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'task', operation: 'insert', data: { name: 'A', salary: 200 }, context: { userId: 'u1', roles: [], permissions: [] } };
    await expect(h.run(opCtx)).rejects.toMatchObject({ name: 'PermissionDeniedError' });
  });

  it('allows the write when the caller holds the capability', async () => {
    const h = harnessFor([setWithCap], 'fld_cap');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'task', operation: 'insert', data: { name: 'A', salary: 200 }, context: { userId: 'u1', roles: [], permissions: ['fld_cap'] } };
    await expect(h.run(opCtx)).resolves.toBeDefined();
  });
});
