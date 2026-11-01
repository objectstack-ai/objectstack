// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 20 — spawns the real producer once per single-cause fixture: a fresh real ObjectQL engine per case, 100 cases that each attempt a governed write and read the store back as unmoved, so no boot can be shared; 3.4 s in a local run; slowest CI reading 10.2 s (scheduled full-battery run 41255489006, Test Core shard log) x 1.25, rounded up

/**
 * [#25653, the #25251 principle for the whole family] App-authored automation
 * does not use its system elevation to write the four identity-assignment
 * objects — a hook that runs as system and an action body, as well as a flow.
 *
 * A `runAs: 'system'` hook's `ctx.api` and an action body's `ctx.api` /
 * `ctx.engine` write under `isSystem` with no `flowRunId`, so the refusal
 * #25251 put ahead of the security middleware's `isSystem` short-circuit did
 * not see them. Each now carries the app-automation elevation mark
 * (`@objectstack/core`), set where the elevation is derived — the hook's
 * `runAs` derivation (`ScopedContext.withRunAs`, objectql) and the action
 * body's execution-context builder (`buildActionExecutionContext`) — and the
 * one predicate (`flow-system-identity-write-refusal.ts`, plugin-security)
 * reads it.
 *
 * ## The contract, per path
 *
 *  - a `runAs: 'system'` hook, as a sandboxed body and as an in-process
 *    handler, fired by an ordinary user's write: every governed write it makes
 *    to each of the four objects is refused with `PERMISSION_DENIED` (403) and
 *    the prescription, and the store does not move;
 *  - an action body (`type: 'script'`, L2), through `ctx.api` and through
 *    `ctx.engine`: the same;
 *  - the same hook under `runAs: 'user'`: not judged by the refusal — the
 *    ordinary gates judge the user it acts for, and refuse a plain member;
 *  - platform code's `sudo()` and a platform writer's own system context: the writes land,
 *    because neither carries the mark (`sudo()` never sets it).
 *
 * The second slice closes the inherited path: a hook bound through the hook
 * binder (app-authored) that declares no `runAs` and runs under a system
 * context, its in-process `ctx.api.sudo()`, and an action it reaches through
 * `ctx.api.object(x).execute(y)` are refused the same way. A hook registered in
 * code, with no metadata binding (platform), keeps writing the four.
 *
 * The system flow's own refusal is pinned, unchanged, beside the predicate
 * (`flow-system-identity-write-refusal.test.ts`, plugin-security).
 *
 * Real `ObjectQL`, a real SQL driver, the real `SecurityPlugin` middleware and
 * the real QuickJS runner; the store is read back past the middleware.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL, bindHooksToEngine, wrapDeclarativeHook } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { hookBodyRunnerFactory, actionBodyRunnerFactory } from './sandbox/body-runner.js';
import { QuickJSScriptRunner } from './sandbox/quickjs-runner.js';
import { buildActionApi, buildActionEngineFacade, buildActionExecutionContext } from './action-execution.js';

const pk = { name: 'id', type: 'text' as const, primaryKey: true };
const text = (name: string) => ({ name, type: 'text' as const });
/** A minimal stand-in for an object this package does not ship. */
const inline = (name: string, fields: string[], extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  fields: { id: pk, ...Object.fromEntries(fields.map((f) => [f, text(f)])) },
  ...extra,
});

/** The triggering user's baseline: their own object, nothing of the four. */
const MEMBER = PermissionSetSchema.parse({
  name: 'qa_member',
  objects: { qa_note: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});

/** An ordinary user, unelevated. */
const PLAIN = { userId: 'usr_plain', tenantId: 'org_default', positions: [], permissions: ['qa_member'], isSystem: false };

/** A platform writer's own system context: no run, no mark (the single-tenancy posture wants its organization). */
const PLATFORM = { isSystem: true, tenantId: 'org_default' };

/** A row of each of the four objects. */
const ROWS: Record<string, (id: string) => Record<string, unknown>> = {
  sys_user_position: (id) => ({ id, user_id: 'usr_target', position: 'qa_rep', business_unit_id: 'bu_east' }),
  sys_user_permission_set: (id) => ({ id, user_id: 'usr_target', permission_set: 'qa_plain' }),
  sys_invitation: (id) => ({ id, email: `${id}@example.test`, role: 'member', status: 'pending', inviter_id: 'usr_plain' }),
  sys_member: (id) => ({ id, user_id: 'usr_target', organization_id: 'org_default', role: 'member' }),
};

/** The column an update changes on each object. */
const EDITS: Record<string, Record<string, unknown>> = {
  sys_user_position: { business_unit_id: 'bu_hq' },
  sys_user_permission_set: { permission_set: 'qa_other' },
  sys_invitation: { role: 'admin' },
  sys_member: { role: 'admin' },
};

const OBJECTS = Object.keys(ROWS);
const VERBS = ['insert', 'update', 'delete'] as const;

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
    id: 'com.objectstack.qa.app-automation-identity-write-refusal',
    name: 'app automation identity write refusal',
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
    ],
  } as never);
  await engine.syncSchemas();
  engines.push(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
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
  engine.setDefaultBodyRunner(hookBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'qa' }));
  return engine;
}

/** Seed one row of `object` past the middleware: setup is not the subject. */
async function seed(engine: ObjectQL, object: string): Promise<Record<string, unknown>> {
  await engine.insert(object, ROWS[object]('seeded'), { context: { ...PLATFORM } } as never);
  return (await stored(engine, object, 'seeded'))!;
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

/**
 * The refusal, as the caller of the triggering write or of the action meets
 * it. A hook's refusal reaches the caller through the hook's own error relay,
 * so the code is read from the error itself or, when the relay wraps, from its
 * `cause` chain.
 */
function rootRefusal(err: any): any {
  let e = err;
  for (let i = 0; e && i < 5; i++) {
    if (e.code === 'PERMISSION_DENIED') return e;
    e = e.cause;
  }
  return err;
}

function expectRefused(err: any, object: string, operation: string, source: 'hook' | 'action'): void {
  expect(err, `${operation} on ${object} from the ${source} was not refused`).not.toBe(null);
  const root = rootRefusal(err);
  expect(root.code).toBe('PERMISSION_DENIED');
  expect(root.statusCode ?? root.status).toBe(403);
  expect(String(err.message)).toMatch(
    source === 'hook' ? /a hook that runs as system/ : /an action body \(an action body runs as system\)/,
  );
  if (object === 'sys_user_position' || object === 'sys_user_permission_set') {
    expect(String(err.message)).toMatch(source === 'hook' ? /Set the hook's runAs to 'user'/ : /a flow whose runAs is 'user'/);
  } else {
    expect(String(err.message)).toMatch(/organization endpoints/);
  }
}

/** The source of a body that performs `verb` on the seeded (or a new) row of `object`. */
function bodySource(object: string, verb: (typeof VERBS)[number]): string {
  const repo = `ctx.api.object(${JSON.stringify(object)})`;
  if (verb === 'insert') return `await ${repo}.insert(${JSON.stringify(ROWS[object]('born'))});`;
  if (verb === 'update') return `await ${repo}.update(${JSON.stringify(EDITS[object])}, { where: { id: 'seeded' } });`;
  return `await ${repo}.delete({ where: { id: 'seeded' } });`;
}

/** Bind a hook on `qa_note` after-insert, fire it by the plain user's own write, return the refusal. */
async function fireHook(
  engine: ObjectQL,
  runAs: 'system' | 'user',
  object: string,
  verb: (typeof VERBS)[number],
  surface: 'body' | 'handler',
): Promise<any> {
  const hook: Record<string, unknown> = { name: 'qa_identity_hook', object: 'qa_note', events: ['afterInsert'], runAs };
  if (surface === 'body') {
    hook.body = { language: 'js', source: bodySource(object, verb), capabilities: ['api.read', 'api.write'] };
  } else {
    hook.handler = async (hctx: any) => {
      const repo = hctx.api.object(object);
      if (verb === 'insert') await repo.insert(ROWS[object]('born'));
      else if (verb === 'update') await repo.update(EDITS[object], { where: { id: 'seeded' } });
      else await repo.delete({ where: { id: 'seeded' } });
    };
  }
  bindHooksToEngine(engine, [hook as any], { packageId: 'qa' });
  return refusal(() => engine.insert('qa_note', { id: 'note_1', title: 'Note' }, { context: { ...PLAIN } } as never));
}

/** Invoke an action body as an action door does: `ctx.api`, `ctx.engine` and `executionContext` from the caller's envelope. */
async function runAction(engine: ObjectQL, source: string): Promise<any> {
  const handler = actionBodyRunnerFactory(new QuickJSScriptRunner(), { ql: engine, appId: 'qa' })({
    name: 'qa_identity_action',
    object: 'qa_note',
    type: 'script',
    body: { language: 'js', source, capabilities: ['api.read', 'api.write'] },
  });
  engine.registerAction('qa_note', 'qa_identity_action', handler!);
  const ec = { ...PLAIN };
  return refusal(() =>
    engine.executeAction('qa_note', 'qa_identity_action', {
      api: buildActionApi({} as never, engine, ec),
      engine: buildActionEngineFacade({} as never, engine, ec),
      executionContext: buildActionExecutionContext(ec),
      params: { objectName: 'qa_note' },
    }),
  );
}

describe("a runAs:'system' hook fired by an ordinary user's write: governed writes to the four objects are refused", () => {
  for (const surface of ['body', 'handler'] as const) {
    for (const object of OBJECTS) {
      for (const verb of VERBS) {
        it(`${surface}: ${verb} on ${object} is refused and the store does not move`, async () => {
          const engine = await boot();
          const before = await seed(engine, object);

          expectRefused(await fireHook(engine, 'system', object, verb, surface), object, verb, 'hook');

          expect(await stored(engine, object, 'seeded')).toEqual(before);
          expect(await stored(engine, object, 'born')).toBe(null);
          // The hook aborted the triggering write too (`onError: 'abort'`).
          expect(await stored(engine, 'qa_note', 'note_1')).toBe(null);
        }, 30000);
      }
    }
  }

  it('the same hook still writes every other object', async () => {
    const engine = await boot();
    bindHooksToEngine(engine, [{
      name: 'qa_other_hook', object: 'qa_note', events: ['afterInsert'], runAs: 'system',
      body: {
        language: 'js',
        source: `await ctx.api.object('qa_note').update({ title: 'stamped' }, { where: { id: 'note_1' } });`,
        capabilities: ['api.read', 'api.write'],
      },
    } as any], { packageId: 'qa' });
    await engine.insert('qa_note', { id: 'note_1', title: 'Note' }, { context: { ...PLAIN } } as never);
    expect(await stored(engine, 'qa_note', 'note_1')).toMatchObject({ title: 'stamped' });
  }, 30000);
});

describe('an action body: governed writes to the four objects are refused', () => {
  for (const object of OBJECTS) {
    for (const verb of VERBS) {
      it(`ctx.api: ${verb} on ${object} is refused and the store does not move`, async () => {
        const engine = await boot();
        const before = await seed(engine, object);

        expectRefused(await runAction(engine, `${bodySource(object, verb)} return 1;`), object, verb, 'action');

        expect(await stored(engine, object, 'seeded')).toEqual(before);
        expect(await stored(engine, object, 'born')).toBe(null);
      }, 30000);
    }

    it(`ctx.engine: insert, update and delete on ${object} are refused and the store does not move`, async () => {
      const engine = await boot();
      const before = await seed(engine, object);
      const facade = buildActionEngineFacade({} as never, engine, { ...PLAIN });

      expectRefused(await refusal(() => facade.insert(object, ROWS[object]('born'))), object, 'insert', 'action');
      expectRefused(await refusal(() => facade.update(object, 'seeded', EDITS[object])), object, 'update', 'action');
      expectRefused(await refusal(() => facade.delete(object, 'seeded')), object, 'delete', 'action');

      expect(await stored(engine, object, 'seeded')).toEqual(before);
      expect(await stored(engine, object, 'born')).toBe(null);
    }, 30000);
  }

  it('the same body still reads the four objects and writes every other object', async () => {
    const engine = await boot();
    for (const object of OBJECTS) await seed(engine, object);
    const err = await runAction(
      engine,
      `const seen = [];
       for (const o of ${JSON.stringify(OBJECTS)}) seen.push((await ctx.api.object(o).find({ where: { id: 'seeded' } })).length);
       await ctx.api.object('qa_note').insert({ id: 'note_2', title: String(seen.join(',')) });
       return 1;`,
    );
    expect(err).toBe(null);
    expect(await stored(engine, 'qa_note', 'note_2')).toMatchObject({ title: '1,1,1,1' });
  }, 30000);
});

describe("CONTROL: the same hook under runAs:'user' takes the ordinary gates", () => {
  for (const object of OBJECTS) {
    it(`${object}: the plain member's insert is refused by the ordinary gates, not by the elevation refusal`, async () => {
      const engine = await boot();
      const err = await fireHook(engine, 'user', object, 'insert', 'body');
      expect(err, `the plain member's ${object} insert landed`).not.toBe(null);
      expect(rootRefusal(err).code).toBe('PERMISSION_DENIED');
      expect(String(err.message)).not.toMatch(/runs as system/);
      expect(await stored(engine, object, 'born')).toBe(null);
    }, 30000);
  }
});

describe('CONTROL: platform system writes carry no mark and still land', () => {
  for (const object of OBJECTS) {
    it(`${object}: a sudo() derived from a user context, and a bare system context, insert, update and delete`, async () => {
      const engine = await boot();
      const sudo = engine.createContext({ ...PLAIN }).sudo().object(object);
      await sudo.insert(ROWS[object]('by_sudo'));
      expect(await stored(engine, object, 'by_sudo')).toMatchObject({ id: 'by_sudo' });
      await sudo.update(EDITS[object], { where: { id: 'by_sudo' } });
      expect(await stored(engine, object, 'by_sudo')).toMatchObject(EDITS[object]);
      await sudo.delete({ where: { id: 'by_sudo' } });
      expect(await stored(engine, object, 'by_sudo')).toBe(null);

      await engine.insert(object, ROWS[object]('by_system'), { context: { ...PLATFORM } } as never);
      expect(await stored(engine, object, 'by_system')).toMatchObject({ id: 'by_system' });
    }, 30000);
  }
});

/** A host handler writing `verb` on `object` through the api it is handed. */
function handlerWrite(object: string, verb: (typeof VERBS)[number]) {
  return async (api: any): Promise<void> => {
    const repo = api.object(object);
    if (verb === 'insert') await repo.insert(ROWS[object]('born'));
    else if (verb === 'update') await repo.update(EDITS[object], { where: { id: 'seeded' } });
    else await repo.delete({ where: { id: 'seeded' } });
  };
}

/** The id of the `qa_note` row a hook fired for, on either face of its input. */
const noteId = (hctx: any): unknown => hctx.result?.id ?? hctx.input?.data?.id ?? hctx.input?.id;

/** Bind an app-authored hook with no `runAs`, fire it by `trigger`'s write, return the refusal. */
async function fireInheritingHook(engine: ObjectQL, hook: Record<string, unknown>, trigger: Record<string, unknown>): Promise<any> {
  bindHooksToEngine(engine, [{ name: 'qa_inherit_hook', object: 'qa_note', events: ['afterInsert'], ...hook } as any], { packageId: 'qa' });
  return refusal(() => engine.insert('qa_note', { id: 'note_1', title: 'Note' }, { context: { ...trigger } } as never));
}

describe('an app-authored hook with no runAs, under a platform system write: governed writes to the four objects are refused', () => {
  for (const surface of ['body', 'handler'] as const) {
    for (const object of OBJECTS) {
      for (const verb of VERBS) {
        it(`${surface}: ${verb} on ${object} is refused and the store does not move`, async () => {
          const engine = await boot();
          const before = await seed(engine, object);
          const write = handlerWrite(object, verb);
          const hook = surface === 'body'
            ? { body: { language: 'js', source: bodySource(object, verb), capabilities: ['api.read', 'api.write'] } }
            : { handler: async (hctx: any) => write(hctx.api) };

          expectRefused(await fireInheritingHook(engine, hook, PLATFORM), object, verb, 'hook');

          expect(await stored(engine, object, 'seeded')).toEqual(before);
          expect(await stored(engine, object, 'born')).toBe(null);
          expect(await stored(engine, 'qa_note', 'note_1')).toBe(null);
        }, 30000);
      }
    }
  }

  it('the same hook still writes every other object', async () => {
    const engine = await boot();
    const err = await fireInheritingHook(engine, {
      body: {
        language: 'js',
        source: `await ctx.api.object('qa_note').update({ title: 'stamped' }, { where: { id: 'note_1' } });`,
        capabilities: ['api.read', 'api.write'],
      },
    }, PLATFORM);
    expect(err).toBe(null);
    expect(await stored(engine, 'qa_note', 'note_1')).toMatchObject({ title: 'stamped' });
  }, 30000);
});

describe("an app-authored hook's in-process ctx.api.sudo(): governed writes to the four objects are refused", () => {
  for (const object of OBJECTS) {
    for (const verb of VERBS) {
      it(`${verb} on ${object} is refused and the store does not move`, async () => {
        const engine = await boot();
        const before = await seed(engine, object);
        const write = handlerWrite(object, verb);

        expectRefused(
          await fireInheritingHook(engine, { handler: async (hctx: any) => write(hctx.api.sudo()) }, PLAIN),
          object, verb, 'hook',
        );

        expect(await stored(engine, object, 'seeded')).toEqual(before);
        expect(await stored(engine, object, 'born')).toBe(null);
      }, 30000);
    }
  }

  it("inside ctx.api.transaction, and under runAs: 'user', the same", async () => {
    const engine = await boot();
    const write = handlerWrite('sys_member', 'insert');
    expectRefused(
      await fireInheritingHook(engine, {
        handler: async (hctx: any) => hctx.api.transaction(async (trx: any) => write(trx.sudo())),
      }, PLAIN),
      'sys_member', 'insert', 'hook',
    );
    expectRefused(
      await fireInheritingHook(engine, { runAs: 'user', handler: async (hctx: any) => write(hctx.api.sudo()) }, PLAIN),
      'sys_member', 'insert', 'hook',
    );
    expect(await stored(engine, 'sys_member', 'born')).toBe(null);
  }, 30000);
});

describe("an action reached through ctx.api.object(x).execute(y): governed writes to the four objects are refused", () => {
  for (const object of OBJECTS) {
    it(`insert on ${object} is refused`, async () => {
      const engine = await boot();
      const write = handlerWrite(object, 'insert');
      engine.registerAction('qa_note', 'qa_reached_action', async (actx: any) => write(actx.api));

      expectRefused(
        await fireInheritingHook(engine, { handler: async (hctx: any) => hctx.api.object('qa_note').execute('qa_reached_action') }, PLAIN),
        object, 'insert', 'action',
      );

      expect(await stored(engine, object, 'born')).toBe(null);
    }, 30000);
  }
});

describe("CONTROL: an app-authored hook with no runAs, under an ordinary user's write, takes the ordinary gates", () => {
  for (const object of OBJECTS) {
    it(`${object}: the plain member's insert is refused by the ordinary gates, not by the elevation refusal`, async () => {
      const engine = await boot();
      const write = handlerWrite(object, 'insert');
      const err = await fireInheritingHook(engine, { handler: async (hctx: any) => write(hctx.api) }, PLAIN);
      expect(err, `the plain member's ${object} insert landed`).not.toBe(null);
      expect(rootRefusal(err).code).toBe('PERMISSION_DENIED');
      expect(String(err.message)).not.toMatch(/governed identity writes/);
      expect(await stored(engine, object, 'born')).toBe(null);
    }, 30000);
  }
});

describe('CONTROL: a hook registered in code, with no metadata binding, still writes the four objects', () => {
  for (const object of OBJECTS) {
    it(`${object}: inherited system context, its sudo(), and the declarative wrapper with no binding all land`, async () => {
      const engine = await boot();
      const insert = (id: string) => async (api: any) => api.object(object).insert(ROWS[object](id));
      const byInherit = insert('by_inherit');
      const bySudo = insert('by_sudo');
      const byWrapped = insert('by_wrapped');
      engine.registerHook('afterInsert', async (hctx: any) => {
        if (noteId(hctx) === 'note_sys') await byInherit(hctx.api);
        if (noteId(hctx) === 'note_user') await bySudo(hctx.api.sudo());
      }, { object: 'qa_note', packageId: 'sys:qa' });
      const meta = { name: 'qa_platform_wrapped', object: 'qa_note', events: ['afterInsert'] } as any;
      engine.registerHook('afterInsert', wrapDeclarativeHook(meta, async (hctx: any) => {
        if (noteId(hctx) === 'note_sys') await byWrapped(hctx.api);
      }), { object: 'qa_note', packageId: 'sys:qa' });

      await engine.insert('qa_note', { id: 'note_sys', title: 'Note' }, { context: { ...PLATFORM } } as never);
      await engine.insert('qa_note', { id: 'note_user', title: 'Note' }, { context: { ...PLAIN } } as never);

      for (const id of ['by_inherit', 'by_sudo', 'by_wrapped']) {
        expect(await stored(engine, object, id), `${id} on ${object} did not land`).toMatchObject({ id });
      }
    }, 30000);
  }
});
