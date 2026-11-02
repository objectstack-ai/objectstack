// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `sys_user_preference`'s write rule — the owner (`user_id`) is fixed when the
 * preference is saved — driven through the real write path: a real `ObjectQL`
 * engine over SQLite, the real `SecurityPlugin` with the shipped permission
 * sets, and the hooks `AuthPlugin` registers for the object
 * (`user-preference-hooks.ts`, on the shared `owner-fixed-rule.ts`).
 *
 * What each block pins:
 *  - an organization member, whose `member_default` update floor is in force,
 *    cannot hand their own preference to another member;
 *  - an organization administrator and a platform administrator are refused
 *    the same way, though each can otherwise update a member's preference;
 *  - controls: an update that echoes the stored owner saves, the owner's own
 *    reads and writes are unchanged, and a system write is not judged.
 *
 * Refusals are asserted on the ADR-0112 pair (`code` + `status`), on the row
 * left unchanged, and on a message that names the row and the owner column and
 * echoes no other user's id.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';

import { authIdentityObjects } from './manifest.js';
import { USER_PREFERENCE_OBJECT, registerUserPreferenceHooks } from './user-preference-hooks.js';

const SYS = { context: { isSystem: true } } as any;
const ORG = 'org_default';
const ALICE = 'usr_alice';
const BOB = 'usr_bob';
const CAROL = 'usr_carol';
const OBJ = USER_PREFERENCE_OBJECT;

/** A caller as the transports hand one to the engine; the baseline set resolves from the user id. */
const as = (userId: string, permissions: string[] = [], positions: string[] = ['org_member']) =>
  ({ context: { userId, tenantId: ORG, positions, permissions } }) as any;

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

/** Engine + shipped permission sets + the hook `auth-plugin.ts` registers for the object. */
async function rig(opts: { hooks?: boolean } = {}): Promise<ObjectQL> {
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
    id: 'com.objectstack.qa.user-preference',
    name: 'User preferences',
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
  if (opts.hooks !== false) registerUserPreferenceHooks(engine, { packageId: 'test.user-preference' });
  for (const id of [ALICE, BOB, CAROL]) {
    await engine.insert('sys_user', { id, email: `${id}@prefs.example`, name: id, email_verified: true, banned: false }, SYS);
  }
  return engine;
}

const refusalOf = async (write: Promise<unknown>): Promise<any> => write.then(() => undefined, (e: unknown) => e);

/** One stored row, read as the system (what is actually on disk). */
const storedRow = async (engine: ObjectQL, id: string): Promise<any> =>
  engine.findOne(OBJ, { where: { id }, ...SYS });

async function save(engine: ObjectQL, owner: string, key: string, value: unknown = ['a']): Promise<any> {
  return engine.insert(OBJ, { user_id: owner, key, value }, as(owner));
}

describe('a preference\'s owner is fixed when it is saved', () => {
  it('a member cannot hand their own preference to another member: 403, and the row keeps its owner', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    const err = await refusalOf(engine.update(OBJ, { id: own.id, user_id: BOB }, as(ALICE)));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await storedRow(engine, own.id))?.user_id).toBe(ALICE);
    expect((await engine.find(OBJ, as(BOB))) as any[]).toEqual([]);
  });

  it('the refusal names the row and the owner column, and echoes no other user\'s id', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    const err = await refusalOf(engine.update(OBJ, { id: own.id, user_id: BOB, value: ['b'] }, as(ALICE)));
    expect(err?.status).toBe(403);
    expect(String(err?.message)).toContain(String(own.id));
    expect(String(err?.message)).toContain('user_id');
    expect(String(err?.message)).not.toContain(BOB);
    expect((await storedRow(engine, own.id))?.value).toEqual(['a']);
  });

  it.each([
    ['an organization administrator', 'organization_admin'],
    ['a platform administrator', 'admin_full_access'],
  ])('%s cannot hand a member\'s preference to someone else either', async (_who, adminSet) => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    const err = await refusalOf(engine.update(OBJ, { id: own.id, user_id: BOB }, as(CAROL, [adminSet], [])));
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await storedRow(engine, own.id))?.user_id).toBe(ALICE);
  });

  it('a multi-row update is judged per row: a predicate write moving the owner is refused, and no row moves', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    const err = await refusalOf(
      engine.update(OBJ, { user_id: BOB }, { where: { key: 'ui.recent' }, multi: true, ...as(ALICE) } as any),
    );
    expect({ code: err?.code, status: err?.status }).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect((await storedRow(engine, own.id))?.user_id).toBe(ALICE);
  });
});

describe('controls: everything else a preference write does is unchanged', () => {
  it('an update that echoes the stored owner is not a re-parent, and saves', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    await engine.update(OBJ, { id: own.id, user_id: ALICE, value: ['b'] }, as(ALICE));
    const row = await storedRow(engine, own.id);
    expect({ user_id: row?.user_id, value: row?.value }).toEqual({ user_id: ALICE, value: ['b'] });
  });

  it('the owner reads, lists and updates their own preferences', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    await engine.update(OBJ, { id: own.id, value: ['c'] }, as(ALICE));
    const mine = (await engine.find(OBJ, as(ALICE))) as any[];
    expect(mine.map((r) => [r.key, r.value])).toEqual([['ui.recent', ['c']]]);
  });

  it('an organization administrator still updates a member\'s preference value', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    await engine.update(OBJ, { id: own.id, value: ['by the admin'] }, as(CAROL, ['organization_admin'], []));
    expect((await storedRow(engine, own.id))?.value).toEqual(['by the admin']);
  });

  it('a system write is not judged: the platform\'s own writers may move a preference', async () => {
    const engine = await rig();
    const own = await save(engine, ALICE, 'ui.recent');
    await engine.update(OBJ, { id: own.id, user_id: BOB }, SYS);
    expect((await storedRow(engine, own.id))?.user_id).toBe(BOB);
  });
});
