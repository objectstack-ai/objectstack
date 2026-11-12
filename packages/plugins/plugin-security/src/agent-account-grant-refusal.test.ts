// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0151 D3] An AI service account is never assigned a permission set above
 * the agent ceiling: a non-system `sys_user_permission_set` or
 * `sys_user_position` write that would give an account a set carrying View
 * All, Modify All, the destructive class, a system permission or an admin
 * scope is refused by the set's name — `400 VALIDATION_FAILED`,
 * `invalid_value` at `permission_set` or `position` — and nothing is stored.
 * A set within the ceiling stays assignable to an account, a person may still
 * be assigned the breaching set (CONTROL: nothing that exists narrows), and a
 * system write stands down.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` registered on it, so the hooks under test are the ones the
 * plugin's own `start()` binds, on the engine's own insert and update paths.
 * Each refusal is identified by its ADR-0112 envelope, never a bare
 * `toThrow()`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';
import { SysUser } from '@objectstack/platform-objects/identity';
import { bindSecurityCatalogReader, createSecurityCatalogReader } from '@objectstack/core';

import { SecurityPlugin } from './security-plugin.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import {
  AGENT_ACCOUNT_GRANT_HOOK_PACKAGE,
  agentAccountSetGrantMessage,
  registerAgentAccountGrantRefusal,
} from './agent-account-grant-refusal.js';

const MEMBER_DEFAULT = { name: 'member_default', label: 'Member', objects: {} } as unknown as PermissionSet;
const QA_ADMIN = {
  name: 'qa_admin',
  label: 'QA Admin',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } },
} as unknown as PermissionSet;

const ORG = 'org_a';
const SYS = { isSystem: true } as const;
const PLATFORM_ADMIN = { userId: 'u_platform', positions: [], permissions: ['qa_admin'], posture: 'PLATFORM_ADMIN', tenantId: ORG };

/** Within the ceiling: ordinary CRUD on one object. */
const SAFE_SET = 'qa_lead_editor';
/** Above it: View All and transfer on one object, and a system permission. */
const BREACHING_SET = 'qa_lead_super';
/** A position binding only the safe set, and one binding the breaching set beside it. */
const SAFE_POSITION = 'qa_lead_clerk';
const BREACHING_POSITION = 'qa_lead_chief';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.agent-account-grant-refusal',
    name: 'Agent account grant refusal',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysUserPermissionSet, SysUserPosition],
  } as any);
  await engine.syncSchemas();
  if (!engine.registry.getObject(SysUser.name)) engine.registry.registerObject(SysUser as never, 'qa.agent-account');
  await engine.syncObjectSchema('sys_user');
  // The account and two people, written as the system (no sign-in plugin is
  // composed here, so no registration door judges the account row).
  await engine.insert('sys_user', { id: 'u_bot', name: 'Bot', email: 'bot@agents.invalid', principal_kind: 'agent', accountable_user_id: 'u_person' }, { context: SYS });
  for (const id of ['u_person', 'u_platform']) {
    await engine.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: SYS });
  }
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      // The catalog reads a set by name (ADR-0150 D3): served from the same list.
      get: async (type: string, name: string) =>
        (type === 'position' ? null : type === 'permission' ? [MEMBER_DEFAULT, QA_ADMIN].find((s: any) => s.name === name) : engine.getSchema(name)) ?? null,
      list: async (type: string) => (type === 'position' ? [] : [MEMBER_DEFAULT, QA_ADMIN]),
    },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    hook: vi.fn(),
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);

  // The security catalog (the registry): the two sets and the two positions.
  engine.registry.registerItem('permission', { name: SAFE_SET, label: SAFE_SET, objects: { crm_lead: { allowRead: true, allowEdit: true } } } as any, 'name' as any, 'qa.agent-account');
  engine.registry.registerItem('permission', {
    name: BREACHING_SET,
    label: BREACHING_SET,
    objects: { crm_lead: { allowRead: true, viewAllRecords: true, allowTransfer: true } },
    systemPermissions: ['manage_users'],
  } as any, 'name' as any, 'qa.agent-account');
  engine.registry.registerItem('position', { name: SAFE_POSITION, label: SAFE_POSITION, permissionSets: [SAFE_SET] } as any, 'name' as any, 'qa.agent-account');
  engine.registry.registerItem('position', { name: BREACHING_POSITION, label: BREACHING_POSITION, permissionSets: [SAFE_SET, BREACHING_SET] } as any, 'name' as any, 'qa.agent-account');
  return { engine, plugin, ctx };
}

type Harness = Awaited<ReturnType<typeof boot>>;

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

function envelopeOf(e: unknown) {
  const r = resolveThrownHttpError(e);
  return { status: r.status, code: r.code, message: r.message, fields: (r.details?.fields ?? []) as any[] };
}

function expectAccountRefusal(err: unknown, field: 'permission_set' | 'position', value: string) {
  const env = envelopeOf(err);
  expect(env.status).toBe(400);
  expect(env.code).toBe('VALIDATION_FAILED');
  expect(env.fields).toHaveLength(1);
  expect(env.fields[0]).toMatchObject({ field, code: 'invalid_value', value, constraint: { principalKind: 'agent' } });
  return env;
}

const rows = async (h: Harness, object: string, where: Record<string, unknown>) =>
  ((await h.engine.find(object, { where, context: SYS })) as any[]) ?? [];

const grant = (h: Harness, userId: string, setName: string) =>
  h.engine.insert('sys_user_permission_set', { user_id: userId, permission_set: setName }, { context: PLATFORM_ADMIN } as any);

const assign = (h: Harness, userId: string, position: string) =>
  h.engine.insert('sys_user_position', { user_id: userId, position }, { context: PLATFORM_ADMIN } as any);

describe('[ADR-0151 D3] a set above the agent ceiling is refused for an AI service account, by name', () => {
  it('a direct grant of the breaching set to the account is refused, naming the set and what in it breaches, and nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => grant(h, 'u_bot', BREACHING_SET));
    const env = expectAccountRefusal(err, 'permission_set', BREACHING_SET);
    expect(env.fields[0].message).toBe(agentAccountSetGrantMessage(BREACHING_SET, 'u_bot', [
      'objects.crm_lead.viewAllRecords', 'objects.crm_lead.allowTransfer', 'systemPermissions',
    ]));
    expect(env.fields[0].message).toContain(`'${BREACHING_SET}'`);
    expect(await rows(h, 'sys_user_permission_set', { user_id: 'u_bot' })).toHaveLength(0);
  });

  it('a position binding the breaching set is refused for the account at `position`, naming the set, and nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => assign(h, 'u_bot', BREACHING_POSITION));
    const env = expectAccountRefusal(err, 'position', BREACHING_POSITION);
    expect(env.fields[0].message).toContain(`'${BREACHING_SET}'`);
    expect(env.fields[0].message).not.toContain(`'${SAFE_SET}'`);
    expect(await rows(h, 'sys_user_position', { user_id: 'u_bot' })).toHaveLength(0);
  });

  it('an update that would leave the account holding the breaching set is refused, and the stored grant is unchanged', async () => {
    const h = await boot();
    const created: any = await grant(h, 'u_bot', SAFE_SET);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: created.id, permission_set: BREACHING_SET }, { context: PLATFORM_ADMIN } as any,
    ));
    expectAccountRefusal(err, 'permission_set', BREACHING_SET);
    const [stored] = await rows(h, 'sys_user_permission_set', { user_id: 'u_bot' });
    expect(stored?.permission_set).toBe(SAFE_SET);
  });

  it('moving a person\'s breaching grant onto the account is refused too', async () => {
    const h = await boot();
    const created: any = await grant(h, 'u_person', BREACHING_SET);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: created.id, user_id: 'u_bot' }, { context: PLATFORM_ADMIN } as any,
    ));
    expectAccountRefusal(err, 'permission_set', BREACHING_SET);
    expect(await rows(h, 'sys_user_permission_set', { user_id: 'u_bot' })).toHaveLength(0);
  });

  it('positive: a set and a position within the ceiling are assigned to the account and stored', async () => {
    const h = await boot();
    await grant(h, 'u_bot', SAFE_SET);
    await assign(h, 'u_bot', SAFE_POSITION);
    expect((await rows(h, 'sys_user_permission_set', { user_id: 'u_bot' })).map((r) => r.permission_set)).toEqual([SAFE_SET]);
    expect((await rows(h, 'sys_user_position', { user_id: 'u_bot' })).map((r) => r.position)).toEqual([SAFE_POSITION]);
  });

  it('CONTROL: a person is assigned the breaching set and the breaching position, as before', async () => {
    const h = await boot();
    await grant(h, 'u_person', BREACHING_SET);
    await assign(h, 'u_person', BREACHING_POSITION);
    expect((await rows(h, 'sys_user_permission_set', { user_id: 'u_person' })).map((r) => r.permission_set)).toEqual([BREACHING_SET]);
    expect((await rows(h, 'sys_user_position', { user_id: 'u_person' })).map((r) => r.position)).toEqual([BREACHING_POSITION]);
  });

  it('a system write stands down, as on the sibling refusals', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { user_id: 'u_bot', permission_set: BREACHING_SET, organization_id: ORG }, { context: { ...SYS, tenantId: ORG } });
    expect(await rows(h, 'sys_user_permission_set', { user_id: 'u_bot' })).toHaveLength(1);
  });

  /** The bound `beforeInsert` handler over a double engine whose user row is an account. */
  function boundInsertHandler(opts: { hasUserObject: boolean }) {
    const handlers: Record<string, (ctx: any) => Promise<void>> = {};
    const find = vi.fn(async () => [{ id: 'u_bot', principal_kind: 'agent' }]);
    const engine = {
      registerHook: (event: string, handler: any) => { handlers[event] = handler; },
      find,
      getSchema: (name: string) => (name === 'sys_user' && !opts.hasUserObject ? undefined : { name }),
    };
    bindSecurityCatalogReader(engine, {
      resolve: async (kind: string, name: string) => (kind === 'permission' && name === BREACHING_SET
        ? { definition: { name, objects: { crm_lead: { allowRead: true, viewAllRecords: true } } } }
        : undefined),
    } as any);
    expect(registerAgentAccountGrantRefusal(engine)).toBe(true);
    return { handler: handlers.beforeInsert!, find };
  }

  const insertCtx = (callerReads: boolean) => ({
    object: 'sys_user_permission_set',
    session: { userId: 'u_caller' },
    input: { data: { user_id: 'u_bot', permission_set: BREACHING_SET } },
    api: { object: () => ({ find: async () => (callerReads ? [{ id: 'u_bot' }] : []) }) },
  });

  it('a holder the caller\'s own door does not read is never read as the system, and is not judged here', async () => {
    const { handler, find } = boundInsertHandler({ hasUserObject: true });
    await expect(handler(insertCtx(false))).resolves.toBeUndefined();
    expect(find).not.toHaveBeenCalled();
    // CONTROL: the same row, with a holder the caller reads, is read and refused.
    expectAccountRefusal(await refusalOf(() => handler(insertCtx(true))), 'permission_set', BREACHING_SET);
    expect(find).toHaveBeenCalledTimes(1);
  });

  it('a composition with no sys_user object has no account to judge, and reads none', async () => {
    const { handler, find } = boundInsertHandler({ hasUserObject: false });
    await expect(handler(insertCtx(true))).resolves.toBeUndefined();
    expect(find).not.toHaveBeenCalled();
  });

  it('binds once, and says so when the engine has no hook registry', () => {
    const registerHook = vi.fn();
    const unregisterHooksByPackage = vi.fn();
    expect(registerAgentAccountGrantRefusal({ registerHook, unregisterHooksByPackage })).toBe(true);
    expect(unregisterHooksByPackage).toHaveBeenCalledWith(AGENT_ACCOUNT_GRANT_HOOK_PACKAGE);
    expect(registerHook.mock.calls.map((c) => c[0])).toEqual(['beforeInsert', 'beforeUpdate']);
    const warn = vi.fn();
    expect(registerAgentAccountGrantRefusal({}, { warn })).toBe(false);
    expect(warn.mock.calls[0]?.[0]).toContain('is NOT refused');
  });
});

/**
 * [#32164, red-line review E3] The set an account would hold is read the way
 * the authorization resolver reads the row: a grant at the package it stores
 * (ADR-0150 D8 R1), a position's sets from the package that declared the
 * position (ADR-0150 D3/D7). A read the rule refuses (two holders, none
 * placed) fails closed. BASE: the bare name was read, two holders refused it,
 * and a refused read answered no breach, so either holder's set was admitted.
 */
describe('[E3] two packages hold one name: the account is judged on the set it would hold', () => {
  const CRM = 'com.acme.crm';
  const HR = 'com.acme.hr';
  /** CRM's set of this name is within the ceiling, HR's is above it. */
  const TWO = 'qa_shared_lead';
  const def = (name: string, packageId: string, breaching: boolean) => ({
    name,
    label: name,
    objects: { crm_lead: breaching ? { allowRead: true, viewAllRecords: true } : { allowRead: true, allowEdit: true } },
    _packageId: packageId,
  });
  /** Each package's position binding `TWO` by name, read from its own package. */
  const CRM_POSITION = 'crm_lead_clerk';
  const HR_POSITION = 'hr_lead_chief';

  function standIn(opts: { hrBreaches: boolean }) {
    const sets: Record<string, Record<string, unknown>> = {
      [CRM]: def(TWO, CRM, false),
      [HR]: def(TWO, HR, opts.hrBreaches),
    };
    const positions: Record<string, Record<string, unknown>> = {
      [CRM_POSITION]: { name: CRM_POSITION, label: CRM_POSITION, permissionSets: [TWO], _packageId: CRM },
      [HR_POSITION]: { name: HR_POSITION, label: HR_POSITION, permissionSets: [TWO], _packageId: HR },
    };
    const manifests = [CRM, HR].map((id) => ({ manifest: { id, namespace: id.split('.').pop() } }));
    return {
      getItem: (type: string, name: string) =>
        type === 'permission' ? (name === TWO ? sets[CRM] : undefined) : type === 'position' ? positions[name] : undefined,
      listItems: (type: string) => (type === 'permission' ? [sets[CRM], sets[HR]] : type === 'position' ? Object.values(positions) : []),
      isPackageDisabled: () => false,
      packageScopedHoldersOf: (type: string, name: string) => (type === 'permission' && name === TWO ? [CRM, HR] : []),
      getPackageScopedItem: (type: string, name: string, packageId: string) =>
        type === 'permission' && name === TWO ? sets[packageId] : undefined,
      getEnvironmentScopedItem: () => undefined,
      getArtifactItem: (type: string, name: string, packageId: string) =>
        type === 'position' && positions[name]?._packageId === packageId ? positions[name] : undefined,
      getPackage: (id: string) => manifests.find((m) => m.manifest.id === id),
      getAllPackages: () => manifests,
      bareNameHoldersAreSealed: true,
    };
  }

  function handlers(opts: { hrBreaches: boolean }) {
    const bound: Record<string, (ctx: any) => Promise<void>> = {};
    const engine = {
      registerHook: (event: string, handler: any) => { bound[event] = handler; },
      find: vi.fn(async () => [{ id: 'u_bot', principal_kind: 'agent' }]),
      getSchema: (name: string) => ({ name }),
    };
    bindSecurityCatalogReader(engine, createSecurityCatalogReader({
      registry: standIn(opts) as never,
      metadata: { get: async () => undefined, list: async () => [] },
    }));
    expect(registerAgentAccountGrantRefusal(engine)).toBe(true);
    return bound;
  }

  const ctxOf = (object: string, data: Record<string, unknown>, previous?: Record<string, unknown>) => ({
    object,
    session: { userId: 'u_caller' },
    input: { data, ...(previous ? { id: previous.id } : {}) },
    ...(previous ? { previous } : {}),
    api: { object: () => ({ find: async () => [{ id: 'u_bot' }] }) },
  });

  it('a grant naming the package whose set breaches is refused; naming the one within the ceiling is admitted', async () => {
    const h = handlers({ hrBreaches: true });
    const refused = await refusalOf(() =>
      h.beforeInsert!(ctxOf('sys_user_permission_set', { user_id: 'u_bot', permission_set: TWO, permission_set_package: HR })));
    const env = expectAccountRefusal(refused, 'permission_set', TWO);
    expect(env.fields[0].message).toContain('objects.crm_lead.viewAllRecords');
    await expect(h.beforeInsert!(ctxOf('sys_user_permission_set', { user_id: 'u_bot', permission_set: TWO, permission_set_package: CRM })))
      .resolves.toBeUndefined();
  });

  it('an update keeps the stored package: moving an HR grant onto the account is refused, a CRM grant is admitted', async () => {
    const h = handlers({ hrBreaches: true });
    const hrRow = { id: 'g1', user_id: 'u_person', permission_set: TWO, permission_set_package: HR };
    expectAccountRefusal(
      await refusalOf(() => h.beforeUpdate!(ctxOf('sys_user_permission_set', { user_id: 'u_bot' }, hrRow))),
      'permission_set', TWO,
    );
    const crmRow = { ...hrRow, id: 'g2', permission_set_package: CRM };
    await expect(h.beforeUpdate!(ctxOf('sys_user_permission_set', { user_id: 'u_bot' }, crmRow))).resolves.toBeUndefined();
  });

  it('a grant whose read the rule refuses (no package placed) fails closed: refused when either holder\'s set breaches; CONTROL: admitted when neither does', async () => {
    const refused = await refusalOf(() =>
      handlers({ hrBreaches: true }).beforeInsert!(ctxOf('sys_user_permission_set', { user_id: 'u_bot', permission_set: TWO })));
    expectAccountRefusal(refused, 'permission_set', TWO);
    await expect(handlers({ hrBreaches: false }).beforeInsert!(ctxOf('sys_user_permission_set', { user_id: 'u_bot', permission_set: TWO })))
      .resolves.toBeUndefined();
  });

  it('a position binding the name is judged on its own package\'s set: HR\'s position refused, CRM\'s admitted', async () => {
    const h = handlers({ hrBreaches: true });
    const env = expectAccountRefusal(
      await refusalOf(() => h.beforeInsert!(ctxOf('sys_user_position', { user_id: 'u_bot', position: HR_POSITION }))),
      'position', HR_POSITION,
    );
    expect(env.fields[0].message).toContain(`'${TWO}'`);
    await expect(h.beforeInsert!(ctxOf('sys_user_position', { user_id: 'u_bot', position: CRM_POSITION }))).resolves.toBeUndefined();
  });
});
