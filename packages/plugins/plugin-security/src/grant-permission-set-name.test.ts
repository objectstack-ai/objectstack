// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D4] A grant names its permission set BY NAME
 * (`sys_user_permission_set.permission_set`), its one reference: the legacy
 * `permission_set_id` is retired (D10, C7b), so a write naming it is refused
 * as an undeclared field; a non-system write naming a set the security
 * catalog does not hold is refused, and a grant that carries no name is
 * refused as `required`. One grant per user, set and organization: the
 * declared unique index (`unique: 'organization'`, NULL-safe on the
 * organization) refuses a second, platform-wide grants included, on every
 * write path, so a revoke leaves no grant of that set in force.
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
import { mapDataError, resolveThrownHttpError } from '@objectstack/types';
import type { PermissionSet } from '@objectstack/spec/security';

import { SecurityPlugin } from './security-plugin.js';
import { SysUser, SysMember } from '@objectstack/platform-objects/identity';
import { SysPosition } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
import { SysPositionPermissionSet } from './__tests__/legacy-catalog-objects.testkit.js';
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
    expect(row).not.toHaveProperty('permission_set_id');
    expect(await h.engine.find('sys_permission_set', { context: SYS })).toEqual([]);
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

  it('NEGATIVE — a grant written with the retired id is refused 400 INVALID_FIELD: the column is no longer declared (C7b)', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_3', permission_set_id: 'ps_alpha', permission_set: 'qa_alpha' }, { context: ADMIN } as any,
    ));
    const env = envelopeOf(err);
    expect([env.code, env.status]).toEqual(['INVALID_FIELD', 400]);
    expect(await grantsOf(h, 'u_3')).toHaveLength(0);
  });

  it('NEGATIVE — a grant naming no set is refused 400 VALIDATION_FAILED, required at permission_set', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { user_id: 'u_3b' }, { context: ADMIN } as any,
    ));
    const env = envelopeOf(err);
    expect([env.code, env.status]).toEqual(['VALIDATION_FAILED', 400]);
    expect(env.fields.map((f: any) => [f.field, f.code])).toContainEqual(['permission_set', 'required']);
    expect(await grantsOf(h, 'u_3b')).toHaveLength(0);
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
      'sys_user_permission_set', { user_id: 'u_s2' }, { context: SYS } as any,
    ));
    const env = envelopeOf(err);
    expect([env.code, env.status]).toEqual(['VALIDATION_FAILED', 400]);
    expect(await grantsOf(h, 'u_s2')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// One grant per user, set and organization (seat answers on #15211: Q5 A, Q-S3a)
// ---------------------------------------------------------------------------

describe('one grant per user, set and organization — the declared unique \'organization\' index', () => {
  const ORG = 'org_dup';
  const grantsOfSet = async (h: Harness, userId: string, set: string) =>
    (await grantsOf(h, userId)).filter((g) => g.permission_set === set);
  /** The engine's envelope, and what the data doors answer it with on the wire. */
  const duplicateShape = (err: unknown) => {
    const wire = mapDataError(err, 'sys_user_permission_set');
    return [envelopeOf(err).code, envelopeOf(err).status, wire.body.code, wire.status];
  };
  const DUPLICATE = ['DUPLICATE_RECORD', 409, 'UNIQUE_VIOLATION', 409];
  const knexOf = (h: Harness): any => (h.engine as any).getDriver('sys_user_permission_set').knex;

  it('NEGATIVE — a second organization-scoped grant is refused 409 (UNIQUE_VIOLATION on the wire); the revoke of the one leaves none in force', async () => {
    const h = await boot();
    await h.engine.insert('sys_member', { id: 'mem_d1', user_id: 'u_d1', organization_id: ORG, role: 'member' }, { context: SYS } as any);
    await h.engine.insert('sys_user_permission_set', { id: 'ups_d1', user_id: 'u_d1', permission_set: 'qa_alpha', organization_id: ORG }, { context: ADMIN } as any);
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set', { id: 'ups_d1b', user_id: 'u_d1', permission_set: 'qa_alpha', organization_id: ORG }, { context: SYS } as any,
    ));
    expect(duplicateShape(err)).toEqual(DUPLICATE);
    expect((await grantsOfSet(h, 'u_d1', 'qa_alpha')).map((g) => g.id)).toEqual(['ups_d1']);

    await h.engine.delete('sys_user_permission_set', { where: { id: 'ups_d1' }, context: ADMIN } as any);
    expect(await grantsOfSet(h, 'u_d1', 'qa_alpha')).toEqual([]);
  });

  it('NEGATIVE — a second platform-wide grant (organization NULL) is refused 409 by the index itself, for every writer; the revoke leaves none in force', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'ups_p1', user_id: 'u_p1', permission_set: 'qa_alpha', organization_id: null }, { context: ADMIN } as any);
    for (const context of [ADMIN, SYS]) {
      const err = await refusalOf(() => h.engine.insert(
        'sys_user_permission_set', { user_id: 'u_p1', permission_set: 'qa_alpha' }, { context } as any,
      ));
      expect(duplicateShape(err)).toEqual(DUPLICATE);
    }
    expect((await grantsOfSet(h, 'u_p1', 'qa_alpha')).map((g) => g.id)).toEqual(['ups_p1']);

    await h.engine.delete('sys_user_permission_set', { where: { id: 'ups_p1' }, context: ADMIN } as any);
    expect(await grantsOfSet(h, 'u_p1', 'qa_alpha')).toEqual([]);
  });

  it('NEGATIVE — the index refuses a platform-wide duplicate on paths no hook sees: a two-row batch insert stores nothing, and raw SQL beneath the engine is refused', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      'sys_user_permission_set',
      [{ user_id: 'u_b1', permission_set: 'qa_alpha' }, { user_id: 'u_b1', permission_set: 'qa_alpha' }],
      { context: SYS } as any,
    ));
    expect(duplicateShape(err)).toEqual(DUPLICATE);
    expect(await grantsOf(h, 'u_b1')).toEqual([]);

    await knexOf(h)('sys_user_permission_set').insert({ id: 'raw_1', user_id: 'u_r1', permission_set: 'qa_alpha', organization_id: null });
    await expect(
      knexOf(h)('sys_user_permission_set').insert({ id: 'raw_2', user_id: 'u_r1', permission_set: 'qa_alpha', organization_id: null }),
    ).rejects.toThrow(/UNIQUE constraint failed/);
    expect((await grantsOf(h, 'u_r1')).map((g) => g.id)).toEqual(['raw_1']);
  });

  it('NEGATIVE — an update that makes a platform-wide duplicate (re-naming the set) is refused 409 and the row is untouched', async () => {
    const h = await boot();
    await h.engine.insert('sys_user_permission_set', { id: 'ups_u1', user_id: 'u_u1', permission_set: 'qa_alpha' }, { context: ADMIN } as any);
    await h.engine.insert('sys_user_permission_set', { id: 'ups_u2', user_id: 'u_u1', permission_set: 'qa_beta' }, { context: ADMIN } as any);
    const err = await refusalOf(() => h.engine.update(
      'sys_user_permission_set', { id: 'ups_u2', permission_set: 'qa_alpha' }, { context: ADMIN } as any,
    ));
    expect(duplicateShape(err)).toEqual(DUPLICATE);
    expect((await grantsOf(h, 'u_u1')).find((g) => g.id === 'ups_u2')).toMatchObject({ permission_set: 'qa_beta' });
  });

  it('CONTROL — one set to one user in two organizations and platform-wide, two users of one set (a batch and raw SQL alike), and an edit of a held grant all land', async () => {
    const h = await boot();
    for (const org of ['org_c1', 'org_c2']) {
      await h.engine.insert('sys_member', { id: `mem_${org}`, user_id: 'u_c1', organization_id: org, role: 'member' }, { context: SYS } as any);
      await h.engine.insert('sys_user_permission_set', { user_id: 'u_c1', permission_set: 'qa_alpha', organization_id: org }, { context: ADMIN } as any);
    }
    await h.engine.insert('sys_user_permission_set', { id: 'ups_c1', user_id: 'u_c1', permission_set: 'qa_alpha' }, { context: ADMIN } as any);
    await h.engine.insert(
      'sys_user_permission_set',
      [{ user_id: 'u_c2', permission_set: 'qa_alpha' }, { user_id: 'u_c3', permission_set: 'qa_alpha' }],
      { context: SYS } as any,
    );
    await knexOf(h)('sys_user_permission_set').insert({ id: 'raw_c4', user_id: 'u_c4', permission_set: 'qa_alpha', organization_id: null });
    await h.engine.update('sys_user_permission_set', { id: 'ups_c1', permission_set: 'qa_alpha', reason: 'edited' }, { context: ADMIN } as any);
    expect(await grantsOfSet(h, 'u_c1', 'qa_alpha')).toHaveLength(3);
    for (const user of ['u_c2', 'u_c3', 'u_c4']) expect(await grantsOfSet(h, user, 'qa_alpha')).toHaveLength(1);
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
