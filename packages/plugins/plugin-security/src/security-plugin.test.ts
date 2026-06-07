// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { FieldMasker } from './field-masker.js';
import { RLSCompiler, RLS_DENY_FILTER } from './rls-compiler.js';
import type { PermissionSet } from '@objectstack/spec/security';

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
  const makeMiddlewareCtx = (overrides: { permissionSets: PermissionSet[]; objectFields?: string[]; schemaExtra?: Record<string, any>; orgScoping?: boolean }) => {
    const fields: Record<string, any> = {};
    for (const f of overrides.objectFields ?? ['id', 'organization_id', 'owner_id', 'name']) {
      fields[f] = { name: f };
    }
    const baseSchema: any = { name: 'task', fields, ...(overrides.schemaExtra ?? {}) };
    let middleware: any;
    const ql = {
      registerMiddleware: (mw: any) => {
        // Capture only the FIRST middleware (the security CRUD one);
        // ignore the secondary bootstrap-replay middleware registered
        // later in `start()`.
        if (!middleware) middleware = mw;
      },
      getSchema: () => baseSchema,
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

  it('should allow unknown operations by default', () => {
    const evaluator = new PermissionEvaluator();
    expect(evaluator.checkObjectPermission('unknownOp', 'contact', [])).toBe(true);
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
});
