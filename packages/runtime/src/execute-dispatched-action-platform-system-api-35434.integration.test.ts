// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The platform's own system api (`platformSystemApi`, objectql) over the api
 * `ObjectRepository.execute` hands the action it dispatches
 * (`ctx.api.object(o).execute(name)`).
 *
 *  - It keeps the `'action'` app-automation mark `execute` sets: that api, and
 *    every api derived from it, carries the dispatched action's origin flag,
 *    and on a flagged api `platformSystemApi` answers what `sudo()` answers.
 *    So the dispatched handler's writes to the identity-assignment objects
 *    through it are refused as `content/docs/permissions/system-context.mdx`
 *    says (the identity-assignment refusal), whichever api dispatched it: the
 *    action door's (an action handler chaining another) or a bare engine api.
 *  - CONTROL: the api the audit writer holds (a hook registered in code, fired
 *    by the dispatched handler's write) is not the dispatched action's: there
 *    it still takes the mark off, and the platform's write lands.
 *  - CONTROL: the origin flag is not the app-authored flag, so the dispatched
 *    handler's permanent delete (ADR-0148 D3) still runs.
 *
 * Real `ObjectQL`, a real SQL driver and the real `SecurityPlugin` middleware;
 * the store is read back past the middleware.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
// Paid at collection: the action path reaches a dynamic import of this package inside a clocked case.
import '@objectstack/metadata';
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
    id: 'com.objectstack.qa.execute-dispatched-action-platform-system-api',
    name: 'execute dispatched action platform system api',
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

/** The two apis a dispatch can start from: the action door's, and a bare engine api. */
const CALLERS: ReadonlyArray<readonly [string, (engine: ObjectQL) => any]> = [
  ["the action door's api (an action handler chaining another action)", (engine) => buildActionApi({} as never, engine, { ...CALLER })],
  ['a bare engine api', (engine) => engine.createContext({ ...CALLER })],
];

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

function expectIdentityRefused(err: any, object: string, route: string): void {
  expect(err, `insert on ${object} through ${route} was not refused`).not.toBe(null);
  expect(err.code).toBe('PERMISSION_DENIED');
  expect(err.statusCode ?? err.status).toBe(403);
  expect(String(err.message)).toMatch(/an action body \(an action body runs as system\)/);
}

describe("platformSystemApi on the api ObjectRepository.execute hands the dispatched action keeps the 'action' mark", () => {
  for (const [caller, apiOf] of CALLERS) {
    for (const object of OBJECTS) {
      it(`dispatched from ${caller}: an insert into ${object} through it, through its sudo() and inside its transaction is refused, and nothing lands`, async () => {
        const engine = await boot();
        const seen: Record<string, unknown> = {};
        engine.registerAction('qa_note', 'grant', async (actx: any) => {
          seen.direct = await refusal(() => platformSystemApi(actx.api)!.object(object).insert(ROWS[object]('direct')));
          seen.sudo = await refusal(() => platformSystemApi(actx.api.sudo())!.object(object).insert(ROWS[object]('sudo')));
          seen.trx = await refusal(() =>
            actx.api.transaction(async (trx: any) => platformSystemApi(trx)!.object(object).insert(ROWS[object]('trx'))),
          );
          // CONTROL: the handler's own sudo(), refused before this card too.
          seen.ownSudo = await refusal(() => actx.api.sudo().object(object).insert(ROWS[object]('own_sudo')));
        });

        await apiOf(engine).object('qa_note').execute('grant');

        for (const route of ['direct', 'sudo', 'trx', 'ownSudo']) expectIdentityRefused(seen[route], object, route);
        for (const id of ['direct', 'sudo', 'trx', 'own_sudo']) expect(await stored(engine, object, id)).toBe(null);
      }, 30000);
    }
  }

  it("its insert into an ordinary object is owner-stamped with the caller, as the action body's insert is", async () => {
    const engine = await boot();
    engine.registerAction('qa_note', 'note', async (actx: any) =>
      platformSystemApi(actx.api)!.object('qa_note').insert({ id: 'note_1', title: 'by dispatched handler' }),
    );
    await CALLERS[0][1](engine).object('qa_note').execute('note');
    expect(await stored(engine, 'qa_note', 'note_1')).toMatchObject({ owner_id: CALLER.userId });
  }, 30000);
});

describe("CONTROL: the api the audit writer holds is not the dispatched action's", () => {
  it("a hook registered in code, fired by the dispatched handler's write, takes the mark off and its platform write lands; its sudo() does not", async () => {
    const engine = await boot();
    const seen: Record<string, unknown> = {};
    engine.registerHook('afterInsert', async (hctx: any) => {
      if ((hctx.result?.id ?? hctx.input?.data?.id) !== 'note_1') return;
      await platformSystemApi(hctx.api)!.object('sys_member').insert(ROWS.sys_member('by_platform'));
      await platformSystemApi(hctx.api)!.object('sys_audit_log').insert({ id: 'audit_1', action: 'create', object_name: 'qa_note' });
      seen.sudo = await refusal(() => hctx.api.sudo().object('sys_member').insert(ROWS.sys_member('by_sudo')));
    }, { object: 'qa_note', packageId: 'sys:qa' });
    engine.registerAction('qa_note', 'note', async (actx: any) =>
      actx.api.object('qa_note').insert({ id: 'note_1', title: 'by dispatched handler' }),
    );

    await CALLERS[0][1](engine).object('qa_note').execute('note');

    expect(await stored(engine, 'qa_note', 'note_1')).toMatchObject({ id: 'note_1' });
    expect(await stored(engine, 'sys_member', 'by_platform')).toMatchObject({ id: 'by_platform' });
    expect(await stored(engine, 'sys_audit_log', 'audit_1')).toMatchObject({ id: 'audit_1' });
    expectIdentityRefused(seen.sudo, 'sys_member', "the hook api's sudo()");
    expect(await stored(engine, 'sys_member', 'by_sudo')).toBe(null);
  }, 30000);
});

describe("CONTROL: the dispatched action's origin flag is not the app-authored flag", () => {
  it("the dispatched handler's permanent delete still runs, through its api and through platformSystemApi on it", async () => {
    const engine = await boot();
    const api = CALLERS[0][1](engine);
    await api.object('qa_note').insert({ id: 'note_1', title: 'one' });
    await api.object('qa_note').insert({ id: 'note_2', title: 'two' });
    engine.registerAction('qa_note', 'purge', async (actx: any) => {
      await actx.api.object('qa_note').delete({ where: { id: 'note_1' }, permanent: true });
      await platformSystemApi(actx.api)!.object('qa_note').delete({ where: { id: 'note_2' }, permanent: true });
    });

    await api.object('qa_note').execute('purge');

    expect(await stored(engine, 'qa_note', 'note_1')).toBe(null);
    expect(await stored(engine, 'qa_note', 'note_2')).toBe(null);
  }, 30000);
});
