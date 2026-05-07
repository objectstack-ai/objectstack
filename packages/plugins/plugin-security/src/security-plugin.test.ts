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
      logger: { info: vi.fn(), warn: vi.fn() },
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
      logger: { info: vi.fn(), warn: vi.fn() },
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
      logger: { info: vi.fn(), warn: vi.fn() },
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
      logger: { info: vi.fn(), warn: vi.fn() },
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
});

// ---------------------------------------------------------------------------
// PermissionEvaluator
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
