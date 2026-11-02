// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_personal_view` — a reader's own named list views (ruling 6570568131 on
 * #28971, letter C) — driven through the real write path: a real `ObjectQL`
 * engine over SQLite, the real `SecurityPlugin` with the shipped permission
 * sets (a member resolves `member_default`, which names the object; the object
 * declares its owner-only default row scope), and the hooks `AuthPlugin`
 * registers for it (`personal-view-hooks.ts`).
 *
 * What each block pins:
 *  - the owner saves, reads and renames their own views;
 *  - another member reads, lists and updates none of them;
 *  - an organization administrator, under either shipped variant, reads,
 *    lists and updates none of them either (the wildcard's super-user bits
 *    are closed for this object);
 *  - a body that is not spec's `ListView` is refused `400 VALIDATION_FAILED`
 *    with its paths under `config`, and nothing is stored;
 *  - a view lists the object it is saved for: `config.data.object` and
 *    `object_name` must agree, on create and on update;
 *  - the id is the engine's record id, never the `object.key` view syntax;
 *  - the owner cannot re-parent a view (`user_id`) to someone else;
 *  - the recorded platform-administrator boundary: `admin_full_access`'s bare
 *    wildcard reads, edits and deletes a member's view through the data door;
 *  - the owner's delete door (`removeOwnPersonalView`, the core of
 *    `DELETE /api/v1/personal-views/:id`): the owner's own row is removed;
 *    another member's and an organization administrator's attempt reads
 *    nothing and answers 404 with the row kept; a platform administrator, who
 *    CAN read the row, is refused loudly with 403 and the row kept; and the
 *    generic engine delete is still refused for the owner (no grant moved).
 *
 * Refusals are asserted on the ADR-0112 pair (`code` + `status`) and on the
 * row left unchanged.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';

import { authIdentityObjects } from './manifest.js';
import { PERSONAL_VIEW_OBJECT, registerPersonalViewHooks } from './personal-view-hooks.js';
import { removeOwnPersonalView } from './personal-view-routes.js';

const SYS = { context: { isSystem: true } } as any;
const ORG = 'org_default';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';
const CAROL = 'usr_carol';
const OBJ = PERSONAL_VIEW_OBJECT;

/** A member as the transports hand one to the engine: no grants, the baseline resolves from the user id. */
const as = (userId: string, permissions: string[] = []) =>
  ({ context: { userId, tenantId: ORG, positions: [], permissions } }) as any;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** Engine + shipped permission sets + the hooks `auth-plugin.ts` registers for the object. */
async function rig(): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    true,
  );
  await engine.init();
  engines.push(engine);
  let manifest: { objects?: unknown[]; permissions?: unknown[] } = {};
  const services: Record<string, unknown> = {
    manifest: { register: (m: any) => { manifest = m; } },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission'
          ? ((manifest.permissions as any[]) ?? []).find((p) => p?.name === name) ?? null
          : engine.getSchema(name) ?? null,
      list: async (type?: string) =>
        type === undefined || type === 'permission' ? [...((manifest.permissions as unknown[]) ?? [])] : [],
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
  const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await security.init(ctx);
  engine.registerApp({
    id: 'com.objectstack.qa.personal-view',
    name: 'Personal views',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      ...authIdentityObjects,
      ...((manifest.objects ?? []) as any[]).filter((o) =>
        ['sys_position', 'sys_user_position', 'sys_position_permission_set', 'sys_user_permission_set'].includes(o?.name)),
    ],
  } as any);
  await engine.syncSchemas();
  await engine.insert('sys_organization', { id: ORG, name: 'Default Organization', slug: 'default' }, SYS);
  await security.start(ctx);
  vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  registerPersonalViewHooks(engine, { packageId: 'test.personal-view' });
  for (const id of [ALICE, BOB, CAROL]) {
    await engine.insert('sys_user', { id, email: `${id}@views.example`, name: id, email_verified: true, banned: false }, SYS);
  }
  return engine;
}

/** A minimal valid `ListView` body for `object`. */
const listView = (object: string, extra: Record<string, unknown> = {}) => ({
  type: 'grid',
  data: { provider: 'object', object },
  columns: ['name'],
  ...extra,
});

const refusalOf = async (write: Promise<unknown>): Promise<any> => write.then(() => undefined, (e: unknown) => e);

/** Every stored row, read as the system (what is actually on disk). */
const stored = async (engine: ObjectQL): Promise<any[]> =>
  (await engine.find(OBJ, { ...SYS, orderBy: [{ field: 'label', order: 'asc' }] })) as any[];

async function save(engine: ObjectQL, owner: string, label: string, extra: Record<string, unknown> = {}): Promise<any> {
  return engine.insert(
    OBJ,
    { user_id: owner, object_name: 'crm_lead', label, config: listView('crm_lead'), ...extra },
    as(owner),
  );
}

describe('the owner keeps their own named views', () => {
  it('saves, reads back, lists and renames their own view', async () => {
    const engine = await rig();
    const created = await save(engine, ALICE, 'This week');
    expect(created?.id).toBeTruthy();

    const mine = (await engine.find(OBJ, as(ALICE))) as any[];
    expect(mine.map((r) => r.label)).toEqual(['This week']);

    await engine.update(OBJ, { id: created.id, label: 'This week, hot' }, as(ALICE));
    const row = await engine.findOne(OBJ, { where: { id: created.id }, ...as(ALICE) });
    expect(row?.label).toBe('This week, hot');
  });

  it('the id is the engine record id, never the `object.key` view syntax', async () => {
    const engine = await rig();
    const created = await save(engine, ALICE, 'Mine');
    expect(String(created.id)).not.toContain('.');
    for (const r of await stored(engine)) expect(String(r.id)).not.toContain('.');
  });
});

describe('another member gets nothing of the owner\'s views', () => {
  it('reads none by id, lists none, and cannot update one', async () => {
    const engine = await rig();
    const alices = await save(engine, ALICE, 'Alice only');

    expect(await engine.findOne(OBJ, { where: { id: alices.id }, ...as(BOB) })).toBeNull();
    expect((await engine.find(OBJ, as(BOB))) as any[]).toEqual([]);
    expect(await engine.count(OBJ, as(BOB))).toBe(0);

    const err = await refusalOf(engine.update(OBJ, { id: alices.id, label: 'hijacked' }, as(BOB)));
    // The row is unreadable to the writer, so the by-id write answers as if it did not exist.
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
    expect((await stored(engine)).map((r) => r.label)).toEqual(['Alice only']);
  });

  it('cannot plant a view in the owner\'s name', async () => {
    const engine = await rig();
    const err = await refusalOf(engine.insert(
      OBJ,
      { user_id: ALICE, object_name: 'crm_lead', label: 'planted', config: listView('crm_lead') },
      as(BOB),
    ));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(await stored(engine)).toEqual([]);
  });
});

describe('an organization administrator gets no back door (no admin management in the first version)', () => {
  it.each(['organization_admin', 'organization_admin_no_bypass'])(
    '%s reads none of a member\'s views and cannot update one',
    async (adminSet) => {
      const engine = await rig();
      const alices = await save(engine, ALICE, 'Alice only');
      const admin = as(CAROL, [adminSet]);

      expect(await engine.findOne(OBJ, { where: { id: alices.id }, ...admin })).toBeNull();
      expect((await engine.find(OBJ, admin)) as any[]).toEqual([]);

      const err = await refusalOf(engine.update(OBJ, { id: alices.id, label: 'admin edit' }, admin));
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
      expect((await stored(engine)).map((r) => r.label)).toEqual(['Alice only']);
    },
  );

  it('RECORDED BOUNDARY: through the data door the platform administrator also edits and deletes a member\'s view', async () => {
    // `admin_full_access` spreads spec's ADMIN_FULL_ACCESS_CAPABILITIES:
    // `'*'` with allowEdit, allowDelete and modifyAllRecords, and the owner
    // floors bind members only. So the boundary today is read, edit AND delete
    // through the generic data door (exactly as on `sys_user_preference`);
    // only the own-row door refuses its delete. Pinned so the boundary the
    // card's open question asks about is stated by a test, not by prose.
    const engine = await rig();
    const alices = await save(engine, ALICE, 'Alice only');
    const platformAdmin = as(CAROL, ['admin_full_access']);
    await engine.update(OBJ, { id: alices.id, label: 'edited by the platform admin' }, platformAdmin);
    expect((await stored(engine)).map((r) => r.label)).toEqual(['edited by the platform admin']);
    await engine.delete(OBJ, { where: { id: alices.id }, ...platformAdmin } as any);
    expect(await stored(engine)).toEqual([]);
  });

  it('RECORDED BOUNDARY: the platform administrator\'s bare wildcard still reads a member\'s view', async () => {
    // `admin_full_access` keeps its bare `'*'` super-user wildcard by design
    // (the admin rescue path; its objects are spec's
    // ADMIN_FULL_ACCESS_CAPABILITIES, which this card does not touch), as it
    // does on `sys_user_preference`. Closing it is an open question on the
    // card; this pin makes the answer visible when it moves.
    const engine = await rig();
    const alices = await save(engine, ALICE, 'Alice only');
    const row = await engine.findOne(OBJ, { where: { id: alices.id }, ...as(CAROL, ['admin_full_access']) });
    expect(row?.label).toBe('Alice only');
  });

  it('CONTROL: the organization administrator keeps their own views', async () => {
    const engine = await rig();
    await save(engine, CAROL, 'Carol own');
    const own = (await engine.find(OBJ, as(CAROL, ['organization_admin']))) as any[];
    expect(own.map((r) => r.label)).toEqual(['Carol own']);
  });
});

describe('the owner cannot hand a view to someone else', () => {
  it('an update re-parenting user_id to another user is refused, and the row keeps its owner', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'Alice only');
    const err = await refusalOf(engine.update(OBJ, { id: own.id, user_id: BOB }, as(ALICE)));
    expect(err?.status).toBe(403);
    const [row] = await stored(engine);
    expect(row.user_id).toBe(ALICE);
  });

  it('the write rule holds it on its own: a platform administrator, whom no row scope binds, cannot re-parent a view either', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'Alice only');
    const err = await refusalOf(engine.update(OBJ, { id: own.id, user_id: BOB }, as(CAROL, ['admin_full_access'])));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    const [row] = await stored(engine);
    expect(row.user_id).toBe(ALICE);
  });

  it('control: an update that echoes the stored owner is not a re-parent, and is accepted', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'Alice only');
    await engine.update(OBJ, { id: own.id, user_id: ALICE, label: 'Alice, renamed' }, as(ALICE));
    const [row] = await stored(engine);
    expect({ user_id: row.user_id, label: row.label }).toEqual({ user_id: ALICE, label: 'Alice, renamed' });
  });
});

describe('the body is spec\'s ListView, judged on every save', () => {
  it('a create whose config is not a ListView is refused 400 VALIDATION_FAILED, paths under config, nothing stored', async () => {
    const engine = await rig();
    const err = await refusalOf(save(engine, ALICE, 'Broken', { config: { type: 'not_a_view_type', columns: 'name' } }));
    expect({ code: err?.code, name: err?.name }).toEqual({ code: 'VALIDATION_FAILED', name: 'ValidationError' });
    const paths = (err.fields as Array<{ field: string }>).map((f) => f.field);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(p.startsWith('config')).toBe(true);
    expect(await stored(engine)).toEqual([]);
  });

  it('an update whose config is not a ListView is refused, and the stored body is kept', async () => {
    const engine = await rig();
    const created = await save(engine, ALICE, 'Good');
    const err = await refusalOf(engine.update(OBJ, { id: created.id, config: { columns: 42 } }, as(ALICE)));
    expect(err?.code).toBe('VALIDATION_FAILED');
    const [row] = await stored(engine);
    const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
    expect(config).toMatchObject({ type: 'grid', columns: ['name'] });
  });

  it('a config that is not JSON at all is refused on the config field', async () => {
    const engine = await rig();
    const err = await refusalOf(save(engine, ALICE, 'Text', { config: '{ not json' }));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect((err.fields as Array<{ field: string }>).map((f) => f.field)).toEqual(['config']);
  });

  it('CONTROL: an update that does not send config is not re-judged', async () => {
    const engine = await rig();
    const created = await save(engine, ALICE, 'Rename me');
    await engine.update(OBJ, { id: created.id, label: 'Renamed' }, as(ALICE));
    expect((await stored(engine)).map((r) => r.label)).toEqual(['Renamed']);
  });
});

describe('a view lists the object it is saved for', () => {
  it('a create whose config.data.object is another object is refused on config.data.object, nothing stored', async () => {
    const engine = await rig();
    const err = await refusalOf(save(engine, ALICE, 'Wrong object', { config: listView('crm_account') }));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect((err.fields as Array<{ field: string; code?: string }>).map((f) => [f.field, f.code])).toEqual([
      ['config.data.object', 'object_mismatch'],
    ]);
    expect(await stored(engine)).toEqual([]);
  });

  it('an update that moves only object_name away from the stored body is refused, and the row is kept', async () => {
    const engine = await rig();
    const created = await save(engine, ALICE, 'Leads');
    const err = await refusalOf(engine.update(OBJ, { id: created.id, object_name: 'crm_account' }, as(ALICE)));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect((await stored(engine))[0].object_name).toBe('crm_lead');
  });

  it('an update that sends only a body for another object is refused, and the stored body is kept', async () => {
    const engine = await rig();
    const created = await save(engine, ALICE, 'Leads');
    const err = await refusalOf(engine.update(OBJ, { id: created.id, config: listView('crm_account') }, as(ALICE)));
    expect(err?.code).toBe('VALIDATION_FAILED');
    const [row] = await stored(engine);
    const config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config;
    expect(config.data.object).toBe('crm_lead');
  });

  it('CONTROL: moving both object_name and the body together is accepted', async () => {
    const engine = await rig();
    const created = await save(engine, ALICE, 'Moving');
    await engine.update(OBJ, { id: created.id, object_name: 'crm_account', config: listView('crm_account') }, as(ALICE));
    expect((await stored(engine))[0].object_name).toBe('crm_account');
  });
});

describe('the owner\'s delete door removes the owner\'s own view, and nobody else\'s', () => {
  /** The context the door resolves for a caller, as the transports hand one to the engine. */
  const caller = (userId: string, permissions: string[] = []) => as(userId, permissions).context;

  it('own row: removed, and the owner\'s other views stay', async () => {
    const engine = await rig();
    const gone = await save(engine, ALICE, 'A gone');
    await save(engine, ALICE, 'B kept');
    await removeOwnPersonalView(engine as any, gone.id, caller(ALICE));
    expect((await stored(engine)).map((r) => r.label)).toEqual(['B kept']);
  });

  it('another member\'s row: 404 RECORD_NOT_FOUND (unreadable, the unknown-id answer), and the row stays', async () => {
    const engine = await rig();
    const alices = await save(engine, ALICE, 'Alice only');
    const err = await refusalOf(removeOwnPersonalView(engine as any, alices.id, caller(BOB)));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
    expect((await stored(engine)).map((r) => r.label)).toEqual(['Alice only']);
  });

  it.each(['organization_admin', 'organization_admin_no_bypass'])(
    '%s deleting a member\'s row: 404 RECORD_NOT_FOUND, and the row stays',
    async (adminSet) => {
      const engine = await rig();
      const alices = await save(engine, ALICE, 'Alice only');
      const err = await refusalOf(removeOwnPersonalView(engine as any, alices.id, caller(CAROL, [adminSet])));
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
      expect((await stored(engine)).map((r) => r.label)).toEqual(['Alice only']);
    },
  );

  it('a platform administrator, who reads the row, is refused loudly: 403 PERMISSION_DENIED, and the row stays', async () => {
    const engine = await rig();
    const alices = await save(engine, ALICE, 'Alice only');
    const err = await refusalOf(removeOwnPersonalView(engine as any, alices.id, caller(CAROL, ['admin_full_access'])));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await stored(engine)).map((r) => r.label)).toEqual(['Alice only']);
  });

  it('an unknown id: 404 RECORD_NOT_FOUND', async () => {
    const engine = await rig();
    const err = await refusalOf(removeOwnPersonalView(engine as any, 'no_such_view', caller(ALICE)));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'RECORD_NOT_FOUND', status: 404 });
  });

  it('the grant model does not move: the generic engine delete of the owner\'s own row is still refused', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'Alice only');
    const err = await refusalOf(engine.delete(OBJ, { where: { id: own.id }, ...as(ALICE) } as any));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await stored(engine)).map((r) => r.label)).toEqual(['Alice only']);
  });
});
