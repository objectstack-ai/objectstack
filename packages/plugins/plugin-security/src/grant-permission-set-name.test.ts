// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] `sys_user_permission_set.permission_set` names the grant's set
 * beside `permission_set_id`, and the two never disagree.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` started on it the way a kernel composition does, because
 * what is pinned here is what the WRITE DOOR does with a supplied name — the
 * engine's own `readonly` strips, the security middleware, the delegated-admin
 * gate and the reference check all sit on that path, and a double would answer
 * for none of them.
 *
 * What the door did with a supplied name before the hooks existed (measured on
 * this branch with the column declared and the hooks unregistered, over this
 * harness): an INSERT stored a supplied name verbatim, whatever set it named,
 * from a system and a non-system caller alike — the engine's create-side
 * `readonly` strip exempts the reserved `sys_` namespace; a non-system UPDATE
 * dropped it silently (the update-side strip) and a system UPDATE stored it;
 * an id written alone left the name NULL. So the column alone would have let a
 * client land a grant whose two halves disagree, and every refusal below is
 * the hooks' — each one is ablated in the PR record.
 *
 * Refusals are identified by their ADR-0112 envelope — `code` and `status`,
 * read through `resolveThrownHttpError`, the resolver both HTTP doors answer
 * with — never by a bare `toThrow()`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition } from './objects/sys-position.object.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './objects/sys-permission-set.object.js';
import { SysPositionPermissionSet } from './objects/sys-position-permission-set.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import {
  GRANT_SET_NAME_HOOK_PACKAGE,
  grantSetNameMismatchMessage,
  registerGrantPermissionSetNameHooks,
} from './grant-permission-set-name.js';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const MEMBER_DEFAULT = { name: 'member_default', label: 'Member', objects: {} } as unknown as PermissionSet;

/** A tenant-level administrator (ADR-0066 superuser wildcard): the gate admits it, CRUD admits it. */
const QA_ADMIN = {
  name: 'qa_admin',
  label: 'QA Admin',
  objects: {
    '*': {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
} as unknown as PermissionSet;

const SYS = { isSystem: true } as const;
const ADMIN = { userId: 'u_admin', positions: [], permissions: ['qa_admin'] };

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(opts: { walled?: boolean } = {}) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.grant-permission-set-name',
    name: 'Grant permission-set name',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet],
  } as any);
  await engine.syncSchemas();
  // The authz resolver reads these; the auth plugin registers them in a deployment.
  for (const o of [SysUser, SysMember]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as never, 'qa.authz-read-set');
  }
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_DEFAULT, QA_ADMIN],
    },
    ...(opts.walled
      ? { 'org-scoping': { name: 'com.objectstack.org-scoping' }, tenancy: { posture: 'isolated' } }
      : {}),
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    // Lifecycle hooks are collected and never fired: the fixture seeds every row it reads.
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

  const seed = opts.walled ? { isSystem: true, tenantId: 'org_a' } : SYS;
  const set = (id: string, name: string) => ({
    id, name, label: name, object_permissions: '{}', field_permissions: '{}', system_permissions: '[]', active: true,
  });
  await engine.insert('sys_permission_set', [set('ps_alpha', 'qa_alpha'), set('ps_beta', 'qa_beta')], { context: seed } as any);
  return { engine, plugin };
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

/** The ADR-0112 envelope an HTTP door answers this throw with. */
function envelopeOf(e: unknown) {
  const r = resolveThrownHttpError(e);
  return { status: r.status, code: r.code, fields: (r.details?.fields ?? []) as any[] };
}

async function grantsOf(h: Harness, userId: string): Promise<any[]> {
  const rows = await h.engine.find('sys_user_permission_set', { where: { user_id: userId }, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

function expectNameRefusal(err: unknown, value: unknown): void {
  const env = envelopeOf(err);
  expect([env.code, env.status]).toEqual(['VALIDATION_FAILED', 400]);
  expect(env.fields).toHaveLength(1);
  expect(env.fields[0]).toMatchObject({
    field: 'permission_set',
    code: 'invalid_value',
    value,
    constraint: { target: 'sys_permission_set', targetField: 'name', derivedFrom: 'permission_set_id' },
  });
}

// ---------------------------------------------------------------------------
// The data door: a non-system writer
// ---------------------------------------------------------------------------

describe('the data door (a non-system writer)', () => {
  it('a grant written with the id alone gets the name of the set the id points at', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { user_id: 'u_1', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    const [row] = await grantsOf(h, 'u_1');
    expect(row).toMatchObject({ permission_set_id: 'ps_alpha', permission_set: 'qa_alpha' });
  });

  it('a supplied name that agrees with the id is accepted and stored', async () => {
    const h = await boot();
    await h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_2', permission_set_id: 'ps_alpha', permission_set: 'qa_alpha' }, { context: ADMIN } as any,
    );
    expect((await grantsOf(h, 'u_2'))[0]).toMatchObject({ permission_set_id: 'ps_alpha', permission_set: 'qa_alpha' });
  });

  it('NEGATIVE — a supplied name of ANOTHER set is refused 400 VALIDATION_FAILED, invalid_value at permission_set; nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_3', permission_set_id: 'ps_alpha', permission_set: 'qa_beta' }, { context: ADMIN } as any,
    ));
    expectNameRefusal(err, 'qa_beta');
    expect(envelopeOf(err).fields[0].message).toBe(grantSetNameMismatchMessage('qa_beta'));
    // The refusal names no set the caller did not send.
    expect(envelopeOf(err).fields[0].message).not.toContain('qa_alpha');
    expect(await grantsOf(h, 'u_3')).toHaveLength(0);
  });

  it('NEGATIVE — a supplied name beside an id that names no set is refused the same way; nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_4', permission_set_id: 'ps_nowhere', permission_set: 'qa_alpha' }, { context: ADMIN } as any,
    ));
    expectNameRefusal(err, 'qa_alpha');
    expect(await grantsOf(h, 'u_4')).toHaveLength(0);
  });

  it('a batch insert with one disagreeing row is refused whole; nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert('sys_user_permission_set', [
      { user_id: 'u_b1', permission_set_id: 'ps_alpha' },
      { user_id: 'u_b2', permission_set_id: 'ps_beta', permission_set: 'qa_alpha' },
    ], { context: ADMIN } as any));
    expectNameRefusal(err, 'qa_alpha');
    expect(await grantsOf(h, 'u_b1')).toHaveLength(0);
    expect(await grantsOf(h, 'u_b2')).toHaveLength(0);
  });

  it('an update by id that re-points the grant moves the name with it', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'g_up', user_id: 'u_5', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    await h.engine.update('sys_user_permission_set', { id: 'g_up', permission_set_id: 'ps_beta' }, { context: ADMIN } as any);
    expect((await grantsOf(h, 'u_5'))[0]).toMatchObject({ permission_set_id: 'ps_beta', permission_set: 'qa_beta' });
  });

  it('an update by id that re-points the grant AND echoes the new name lands both (the echo survives the readonly strip)', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'g_echo', user_id: 'u_6', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    await h.engine.update(
      'sys_user_permission_set', { id: 'g_echo', permission_set_id: 'ps_beta', permission_set: 'qa_beta' }, { context: ADMIN } as any,
    );
    expect((await grantsOf(h, 'u_6'))[0]).toMatchObject({ permission_set_id: 'ps_beta', permission_set: 'qa_beta' });
  });

  it('NEGATIVE — an update by id that re-points the grant but echoes the OLD name is refused; the row is untouched', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'g_stale', user_id: 'u_7', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: 'g_stale', permission_set_id: 'ps_beta', permission_set: 'qa_alpha' }, { context: ADMIN } as any,
    ));
    expectNameRefusal(err, 'qa_alpha');
    expect((await grantsOf(h, 'u_7'))[0]).toMatchObject({ permission_set_id: 'ps_alpha', permission_set: 'qa_alpha' });
  });

  it('NEGATIVE — an update by id writing only a disagreeing name is refused; the row is untouched', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'g_name', user_id: 'u_8', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: 'g_name', permission_set: 'qa_beta' }, { context: ADMIN } as any,
    ));
    expectNameRefusal(err, 'qa_beta');
    expect((await grantsOf(h, 'u_8'))[0]).toMatchObject({ permission_set_id: 'ps_alpha', permission_set: 'qa_alpha' });
  });

  it('a whole-record round trip (the agreeing name echoed, another column edited) is accepted and changes nothing else', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'g_rt', user_id: 'u_9', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    await h.engine.update(
      'sys_user_permission_set', { id: 'g_rt', permission_set: 'qa_alpha', reason: 'edited' }, { context: ADMIN } as any,
    );
    expect((await grantsOf(h, 'u_9'))[0]).toMatchObject({ permission_set_id: 'ps_alpha', permission_set: 'qa_alpha', reason: 'edited' });
  });

  it('a cleared name is not a clear: the derived name is written back', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'g_clr', user_id: 'u_10', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    await h.engine.update('sys_user_permission_set', { id: 'g_clr', permission_set: null }, { context: ADMIN } as any);
    expect((await grantsOf(h, 'u_10'))[0]).toMatchObject({ permission_set_id: 'ps_alpha', permission_set: 'qa_alpha' });
  });

  it('a predicate (multi) update that re-points every matched grant names every one of them', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', [
      { id: 'g_m1', user_id: 'u_m1', permission_set_id: 'ps_alpha' },
      { id: 'g_m2', user_id: 'u_m2', permission_set_id: 'ps_alpha' },
    ], { context: ADMIN } as any);
    await h.engine.update(
      'sys_user_permission_set', { permission_set_id: 'ps_beta' },
      { where: { permission_set_id: 'ps_alpha' }, multi: true, context: ADMIN } as any,
    );
    const rows = [...(await grantsOf(h, 'u_m1')), ...(await grantsOf(h, 'u_m2'))];
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r).toMatchObject({ permission_set_id: 'ps_beta', permission_set: 'qa_beta' });
  });

  it('an update that writes neither column leaves the name alone (no backfill rides an unrelated edit)', async () => {
    const h = await boot();
    // A grant written before the column existed carries no name: written here
    // with the hooks unbound, then the hooks bound again.
    await h.plugin.destroy();
    await h.engine.insert('sys_user_permission_set', { id: 'g_old', user_id: 'u_11', permission_set_id: 'ps_alpha' }, { context: SYS } as any);
    expect((await grantsOf(h, 'u_11'))[0]?.permission_set ?? null).toBeNull();
    expect(registerGrantPermissionSetNameHooks(h.engine as any)).toBe(true);
    await h.engine.update('sys_user_permission_set', { id: 'g_old', reason: 'edited' }, { context: ADMIN } as any);
    const [row] = await grantsOf(h, 'u_11');
    expect(row).toMatchObject({ reason: 'edited' });
    expect(row?.permission_set ?? null).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// System writers
// ---------------------------------------------------------------------------

describe('a system writer', () => {
  it('a system grant written with the id alone is stamped too (a seed, a writer outside this repository)', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { user_id: 'u_s1', permission_set_id: 'ps_beta' }, { context: SYS } as any);
    expect((await grantsOf(h, 'u_s1'))[0]).toMatchObject({ permission_set_id: 'ps_beta', permission_set: 'qa_beta' });
  });

  it('NEGATIVE — a system grant naming another set is refused: a platform writer that names the wrong set fails at its first write', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_s2', permission_set_id: 'ps_beta', permission_set: 'qa_alpha' }, { context: SYS } as any,
    ));
    expectNameRefusal(err, 'qa_alpha');
    expect(await grantsOf(h, 'u_s2')).toHaveLength(0);
  });

  it('a system grant whose set row does not exist yet is left as written (seed ordering), name and all', async () => {
    const h = await boot();
    await h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_s3', permission_set_id: 'ps_later', permission_set: 'qa_later' }, { context: SYS } as any,
    );
    expect((await grantsOf(h, 'u_s3'))[0]).toMatchObject({ permission_set_id: 'ps_later', permission_set: 'qa_later' });
  });
});

// ---------------------------------------------------------------------------
// A walled, two-organization posture
// ---------------------------------------------------------------------------

describe("walled posture, two organizations — the name is read from the WRITER's catalog", () => {
  const ORG_A_ADMIN = { ...ADMIN, tenantId: 'org_a' };

  it("an own-organization grant is stamped; a supplied name beside another organization's set id is refused exactly like one beside an id that names nothing", async () => {
    const h = await boot({ walled: true });
    await h.engine.insert('sys_permission_set',
      { id: 'ps_b_only', name: 'qa_b_only', label: 'B only', object_permissions: '{}', field_permissions: '{}', system_permissions: '[]', active: true },
      { context: { isSystem: true, tenantId: 'org_b' } } as any);

    await h.engine.insert('sys_user_permission_set', { user_id: 'u_wa', permission_set_id: 'ps_alpha' }, { context: ORG_A_ADMIN } as any);
    expect((await grantsOf(h, 'u_wa'))[0]).toMatchObject({ permission_set: 'qa_alpha', organization_id: 'org_a' });

    const foreign = envelopeOf(await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_wb', permission_set_id: 'ps_b_only', permission_set: 'qa_b_only' }, { context: ORG_A_ADMIN } as any,
    )));
    const nowhere = envelopeOf(await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_wb', permission_set_id: 'ps_nowhere', permission_set: 'qa_b_only' }, { context: ORG_A_ADMIN } as any,
    )));
    const shape = (e: typeof foreign) => [e.code, e.status, e.fields.map((f) => [f.field, f.code, f.value, f.message, Object.keys(f).sort(), f.constraint])];
    expect(shape(foreign)).toEqual(shape(nowhere));
    expect([foreign.code, foreign.status]).toEqual(['VALIDATION_FAILED', 400]);
    expect(await grantsOf(h, 'u_wb')).toHaveLength(0);
  });
});

describe('registration', () => {
  it('both hooks bind under one package when the plugin starts, and unbind when it is destroyed', async () => {
    const h = await boot();
    await h.plugin.destroy();
    expect((h.engine as any).unregisterHooksByPackage(GRANT_SET_NAME_HOOK_PACKAGE)).toBe(0);
    expect(registerGrantPermissionSetNameHooks(h.engine as any)).toBe(true);
    expect((h.engine as any).unregisterHooksByPackage(GRANT_SET_NAME_HOOK_PACKAGE)).toBe(2);
  });
});
