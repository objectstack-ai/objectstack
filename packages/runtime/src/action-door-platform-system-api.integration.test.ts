// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform's own system api (`platformSystemApi`, objectql) over the api an
 * action door hands its handler (`buildActionApi`), a host code action
 * handler's included.
 *
 *  - It keeps the `'action'` app-automation mark: that api, and every api
 *    derived from it, carries the action door's origin flag, and on a flagged
 *    api `platformSystemApi` answers what `sudo()` answers. So the handler's
 *    writes to the identity-assignment objects through it are refused as
 *    `content/docs/permissions/system-context.mdx` says (the identity-assignment
 *    refusal), and its insert is owner-stamped as an action body's is.
 *  - What it returns stays inside runtime's walk (`deriveThroughSeam`): the
 *    stored-metadata read seam and the landed-write answer, both layers of
 *    `buildActionApi`, report it served.
 *  - CONTROL: the api the audit writer holds (a hook registered in code, fired
 *    by the action api's write) is not the action door's: there it still takes
 *    the mark off, and the platform's write lands.
 *  - CONTROL: the origin flag is not the app-authored flag, so the host
 *    handler's permanent delete (ADR-0148 D3) still runs.
 *
 * Real `ObjectQL`, a real SQL driver and the real `SecurityPlugin` middleware;
 * the store is read back past the middleware.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL, platformSystemApi } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { buildActionApi } from './action-execution.js';

const pk = { name: 'id', type: 'text' as const, primaryKey: true };
const text = (name: string) => ({ name, type: 'text' as const });
const inline = (name: string, fields: string[], extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { id: pk, ...Object.fromEntries(fields.map((f) => [f, text(f)])) },
  ...extra,
});

const MEMBER = PermissionSetSchema.parse({
  name: 'qa_member',
  objects: { qa_note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});

/** The invoking user's envelope, as an action door receives it. */
const CALLER = { userId: 'usr_plain', tenantId: 'org_default', positions: [], permissions: ['qa_member'], isSystem: false };

/** A row of each of the four identity-assignment objects. */
const ROWS: Record<string, (id: string) => Record<string, unknown>> = {
  sys_user_position: (id) => ({ id, user_id: 'usr_target', position: 'qa_rep', business_unit_id: 'bu_east' }),
  sys_user_permission_set: (id) => ({ id, user_id: 'usr_target', permission_set: 'qa_plain' }),
  sys_invitation: (id) => ({ id, email: `${id}@example.test`, role: 'member', status: 'pending', inviter_id: 'usr_plain' }),
  sys_member: (id) => ({ id, user_id: 'usr_target', organization_id: 'org_default', role: 'member' }),
};
const OBJECTS = Object.keys(ROWS);

/** The idempotence markers of `buildActionApi`'s two layers: each reads `true` on an api its walk serves. */
const SERVED_BY_READ_SEAM = Symbol.for('objectstack.runtime.storedMetadataReaderSeam');
const SERVED_BY_LANDED_WRITE_ANSWER = Symbol.for('objectstack.runtime.landedWritesAnswered');

const engines: ObjectQL[] = [];
afterEach(async () => {
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot(): Promise<ObjectQL> {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const engine = new ObjectQL({ logger } as never);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.action-door-platform-system-api',
    name: 'action door platform system api',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      inline('sys_user', ['name'], { managedBy: 'better-auth' }),
      inline('sys_organization', ['name'], { managedBy: 'better-auth' }),
      inline('sys_member', ['user_id', 'organization_id', 'role'], { managedBy: 'better-auth' }),
      inline('sys_invitation', ['email', 'role', 'status', 'inviter_id', 'organization_id'], { managedBy: 'better-auth' }),
      inline('sys_user_position', ['user_id', 'position', 'business_unit_id', 'granted_by']),
      inline('sys_user_permission_set', ['user_id', 'permission_set', 'granted_by']),
      inline('qa_note', ['title', 'organization_id', 'owner_id']),
      inline('sys_audit_log', ['action', 'object_name'], { managedBy: 'append-only', systemFields: { tenant: false } }),
    ],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        (type === 'permission' ? [MEMBER].find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
      list: async () => [MEMBER],
    },
  };
  const ctx = {
    logger,
    registerService: vi.fn(),
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'qa_member' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  return engine;
}

/** The api an action door hands its handler, from the caller's envelope. */
function actionApi(engine: ObjectQL): any {
  return buildActionApi({} as never, engine, { ...CALLER });
}

/** The stored row, read past the middleware; `null` when there is none. */
async function stored(engine: ObjectQL, object: string, id: string): Promise<Record<string, unknown> | null> {
  return ((await engine.findOne(object, { where: { id }, context: { isSystem: true } } as never)) as any) ?? null;
}

/** The refusal a write met, or `null` when it landed. */
async function refusal(write: () => Promise<unknown>): Promise<any> {
  try {
    await write();
    return null;
  } catch (e) {
    return e;
  }
}

function expectIdentityRefused(err: any, object: string): void {
  expect(err, `insert on ${object} through platformSystemApi was not refused`).not.toBe(null);
  expect(err.code).toBe('PERMISSION_DENIED');
  expect(err.statusCode ?? err.status).toBe(403);
  expect(String(err.message)).toMatch(/an action body \(an action body runs as system\)/);
}

describe("platformSystemApi on the action door's api keeps the 'action' mark", () => {
  for (const object of OBJECTS) {
    it(`an insert into ${object} through it, through its sudo() and inside its transaction is refused, and nothing lands`, async () => {
      const engine = await boot();
      const api = actionApi(engine);

      expectIdentityRefused(await refusal(() => platformSystemApi(api)!.object(object).insert(ROWS[object]('direct'))), object);
      expectIdentityRefused(await refusal(() => platformSystemApi(api.sudo())!.object(object).insert(ROWS[object]('sudo'))), object);
      expectIdentityRefused(
        await refusal(() => api.transaction(async (trx: any) => platformSystemApi(trx)!.object(object).insert(ROWS[object]('trx')))),
        object,
      );

      for (const id of ['direct', 'sudo', 'trx']) expect(await stored(engine, object, id)).toBe(null);
    }, 30000);
  }

  it("its insert into an ordinary object is owner-stamped with the caller, as the action body's insert is", async () => {
    const engine = await boot();
    await platformSystemApi(actionApi(engine))!.object('qa_note').insert({ id: 'note_1', title: 'by handler' });
    expect(await stored(engine, 'qa_note', 'note_1')).toMatchObject({ owner_id: CALLER.userId });
  }, 30000);
});

describe("what platformSystemApi derives from the action door's api stays inside runtime's walk", () => {
  it('both layers of buildActionApi serve it, as they serve sudo()', async () => {
    const engine = await boot();
    const api = actionApi(engine);
    const actionDoor = Symbol.for('objectstack.objectql.actionDoorApi');
    for (const derived of [platformSystemApi(api), platformSystemApi(api.sudo()), api[actionDoor](), api.sudo()]) {
      expect(derived[SERVED_BY_READ_SEAM]).toBe(true);
      expect(derived[SERVED_BY_LANDED_WRITE_ANSWER]).toBe(true);
    }
    // CONTROL: the markers are the walk's, not a property every api answers.
    const bare = engine.createContext({ isSystem: true });
    expect((bare as any)[SERVED_BY_READ_SEAM]).toBeUndefined();
    expect((platformSystemApi(bare) as any)[SERVED_BY_LANDED_WRITE_ANSWER]).toBeUndefined();
  }, 30000);
});

describe("CONTROL: the api the audit writer holds is not the action door's", () => {
  it("a hook registered in code, fired by the action api's write, takes the mark off and its platform write lands; its sudo() does not", async () => {
    const engine = await boot();
    const seen: Record<string, unknown> = {};
    engine.registerHook('afterInsert', async (hctx: any) => {
      if ((hctx.result?.id ?? hctx.input?.data?.id) !== 'note_1') return;
      await platformSystemApi(hctx.api)!.object('sys_member').insert(ROWS.sys_member('by_platform'));
      await platformSystemApi(hctx.api)!.object('sys_audit_log').insert({ id: 'audit_1', action: 'create', object_name: 'qa_note' });
      seen.sudo = await refusal(() => hctx.api.sudo().object('sys_member').insert(ROWS.sys_member('by_sudo')));
    }, { object: 'qa_note', packageId: 'sys:qa' });

    await actionApi(engine).object('qa_note').insert({ id: 'note_1', title: 'by handler' });

    expect(await stored(engine, 'sys_member', 'by_platform')).toMatchObject({ id: 'by_platform' });
    expect(await stored(engine, 'sys_audit_log', 'audit_1')).toMatchObject({ id: 'audit_1' });
    expectIdentityRefused(seen.sudo, 'sys_member');
    expect(await stored(engine, 'sys_member', 'by_sudo')).toBe(null);
  }, 30000);
});

describe("CONTROL: the action door's origin flag is not the app-authored flag", () => {
  it("the host handler's permanent delete still runs, through its api and through platformSystemApi on it", async () => {
    const engine = await boot();
    const api = actionApi(engine);
    await api.object('qa_note').insert({ id: 'note_1', title: 'one' });
    await api.object('qa_note').insert({ id: 'note_2', title: 'two' });

    await api.object('qa_note').delete({ where: { id: 'note_1' }, permanent: true });
    await platformSystemApi(api)!.object('qa_note').delete({ where: { id: 'note_2' }, permanent: true });

    expect(await stored(engine, 'qa_note', 'note_1')).toBe(null);
    expect(await stored(engine, 'qa_note', 'note_2')).toBe(null);
  }, 30000);
});
