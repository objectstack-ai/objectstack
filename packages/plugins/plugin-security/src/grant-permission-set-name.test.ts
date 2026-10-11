// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] A grant names its permission set BY NAME
 * (`sys_user_permission_set.permission_set`), and nothing derives that name
 * from `permission_set_id` any more (D10's first step): a non-system write
 * naming a set the security catalog does not hold is refused, and a grant that
 * carries no name is refused as `required`.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` started on it the way a kernel composition does, because
 * what is pinned here is what the WRITE DOOR does — the security middleware,
 * the delegated-admin gate and the engine's validation all sit on that path.
 * The database holds ZERO `sys_permission_set` rows: the catalog is the
 * registry (ADR-0131 D3), and no grant path needs a row.
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
  grantSetNotInCatalogMessage,
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

const QA_ALPHA = { name: 'qa_alpha', label: 'QA Alpha', objects: {} } as unknown as PermissionSet;
const QA_BETA = { name: 'qa_beta', label: 'QA Beta', objects: {} } as unknown as PermissionSet;
const CATALOG = [MEMBER_DEFAULT, QA_ADMIN, QA_ALPHA, QA_BETA];

const SYS = { isSystem: true } as const;
const ADMIN = { userId: 'u_admin', positions: [], permissions: ['qa_admin'] };

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
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
    // `sys_member` is provisioned: an organization-scoped grant must name a
    // member of its organization (`grant-holder-membership-refusal.ts`).
    objects: [SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet, SysMember],
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
    // The security catalog's environment half: the sets a grant may name.
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? (CATALOG.find((s) => s.name === name) ?? null) : (engine.getSchema(name) ?? null),
      list: async () => CATALOG,
    },
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

  // ⛔ No `sys_permission_set` row is seeded: a grant names its set, and the
  // set is the catalog's definition of that name (ADR-0131 D3/D4).
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

/** The ADR-0112 envelope an HTTP door answers this throw with. */
function envelopeOf(e: unknown) {
  const r = resolveThrownHttpError(e);
  return { status: r.status, code: r.code, fields: (r.details?.fields ?? []) as any[] };
}

async function grantsOf(h: Harness, userId: string): Promise<any[]> {
  const rows = await h.engine.find('sys_user_permission_set', { where: { user_id: userId }, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

function expectNotInCatalogRefusal(err: unknown, value: string): void {
  const env = envelopeOf(err);
  expect([env.code, env.status]).toEqual(['VALIDATION_FAILED', 400]);
  expect(env.fields).toHaveLength(1);
  expect(env.fields[0]).toMatchObject({
    field: 'permission_set',
    code: 'reference_not_found',
    value,
    constraint: { target: 'permission', targetField: 'name' },
  });
}

// ---------------------------------------------------------------------------
// The data door: a non-system writer
// ---------------------------------------------------------------------------

describe('the data door (a non-system writer)', () => {
  it('a grant naming a catalog set is stored by name alone, with zero sys_permission_set rows', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { user_id: 'u_1', permission_set: 'qa_alpha' }, { context: ADMIN } as any);
    const [row] = await grantsOf(h, 'u_1');
    expect(row).toMatchObject({ permission_set: 'qa_alpha' });
    expect(row.permission_set_id ?? null).toBeNull();
    expect(await h.engine.find('sys_permission_set', { context: SYS } as any)).toEqual([]);
  });

  it('NEGATIVE — a name the catalog does not hold is refused 400 VALIDATION_FAILED, reference_not_found at permission_set; nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_2', permission_set: 'qa_nowhere' }, { context: ADMIN } as any,
    ));
    expectNotInCatalogRefusal(err, 'qa_nowhere');
    expect(envelopeOf(err).fields[0].message).toBe(grantSetNotInCatalogMessage('qa_nowhere'));
    expect(await grantsOf(h, 'u_2')).toHaveLength(0);
  });

  it('NEGATIVE — a grant written with the id alone is refused 400 VALIDATION_FAILED, required at permission_set: nothing derives a name from the id', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_3', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any,
    ));
    const env = envelopeOf(err);
    expect([env.code, env.status]).toEqual(['VALIDATION_FAILED', 400]);
    expect(env.fields.map((f: any) => [f.field, f.code])).toContainEqual(['permission_set', 'required']);
    expect(await grantsOf(h, 'u_3')).toHaveLength(0);
  });

  it('a batch insert with one row naming no catalog set is refused whole; nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set',
      [{ user_id: 'u_4', permission_set: 'qa_alpha' }, { user_id: 'u_4', permission_set: 'qa_nowhere' }],
      { context: ADMIN } as any,
    ));
    expectNotInCatalogRefusal(err, 'qa_nowhere');
    expect(await grantsOf(h, 'u_4')).toHaveLength(0);
  });

  it('an update re-naming the grant to another catalog set lands; one naming no catalog set is refused and the row is untouched', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'ups_5', user_id: 'u_5', permission_set: 'qa_alpha' }, { context: ADMIN } as any);
    await h.engine.update('sys_user_permission_set', { id: 'ups_5', permission_set: 'qa_beta' }, { context: ADMIN } as any);
    expect((await grantsOf(h, 'u_5'))[0]).toMatchObject({ permission_set: 'qa_beta' });
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: 'ups_5', permission_set: 'qa_nowhere' }, { context: ADMIN } as any,
    ));
    expectNotInCatalogRefusal(err, 'qa_nowhere');
    expect((await grantsOf(h, 'u_5'))[0]).toMatchObject({ permission_set: 'qa_beta' });
  });

  it('an echo of the stored name is not a new name: a grant whose set left the catalog still takes unrelated edits', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'ups_6', user_id: 'u_6', permission_set: 'qa_gone' }, { context: SYS } as any);
    await h.engine.update(
      'sys_user_permission_set', { id: 'ups_6', permission_set: 'qa_gone', reason: 'edited' }, { context: ADMIN } as any,
    );
    expect((await grantsOf(h, 'u_6'))[0]).toMatchObject({ permission_set: 'qa_gone', reason: 'edited' });
  });

  it('a catalog read that throws refuses nothing: the write proceeds and the operator is told', async () => {
    const h = await boot();
    const metadata = h.ctx.getService('metadata');
    vi.spyOn(metadata, 'get').mockRejectedValue(new Error('metadata store down'));
    await h.engine.insert('sys_user_permission_set', { user_id: 'u_7', permission_set: 'qa_nowhere' }, { context: ADMIN } as any);
    expect(await grantsOf(h, 'u_7')).toHaveLength(1);
    expect(h.ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('was NOT checked'),
      expect.objectContaining({ object: 'sys_user_permission_set' }),
    );
  });
});

// ---------------------------------------------------------------------------
// System writers
// ---------------------------------------------------------------------------

describe('a system writer', () => {
  it('stands down: a system grant naming a set not yet registered is stored as written (seed ordering)', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { user_id: 'u_s1', permission_set: 'qa_later' }, { context: SYS } as any);
    expect((await grantsOf(h, 'u_s1'))[0]).toMatchObject({ permission_set: 'qa_later' });
  });

  it('NEGATIVE — a system grant naming nothing is still refused as required (the engine judges every writer)', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_s2', permission_set_id: 'ps_beta' }, { context: SYS } as any,
    ));
    const env = envelopeOf(err);
    expect([env.code, env.status]).toEqual(['VALIDATION_FAILED', 400]);
    expect(await grantsOf(h, 'u_s2')).toHaveLength(0);
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
