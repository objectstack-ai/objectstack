// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35167] An `insert` that opens its after-abort unit opens it around the
 * engine body, inside the middleware chain — the rule `update` follows since
 * #35142 — over the REAL stack: `ObjectQL`, `SqlDriver` on better-sqlite3
 * `:memory:` (a single-connection pool) and `SecurityPlugin`'s authorization
 * gate.
 *
 * The concurrency cells park one writer's middleware chain — after the gate's
 * reads, before `next()` — and ask whether a second writer's insert lands
 * meanwhile. When the unit opened at the door, the parked writer already held
 * the store's only connection in its `BEGIN`, so the second writer's whole
 * insert, its gate reads included, waited for that commit: writers on a hooked
 * object were serialised behind the gate. Now nothing holds the connection
 * while a middleware runs, on a hooked object as on a plain one.
 *
 * The last describe is the control: the unit still exists, and an aborting
 * `afterInsert` still rolls the row back with it (#22782, unchanged).
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SysMember, SysOrganization, SysUser } from '@objectstack/platform-objects/identity';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysUserPosition } from './objects/sys-user-position.object.js';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';
import { wireEngineSecuritySource } from './engine-security-source.testkit.js';

const SYS = { context: { isSystem: true } } as never;
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;
const OBJ = 'uim_ticket';
const ORG = 'org_uim';
const A = 'usr_uim_a';
const B = 'usr_uim_b';
/** How long the second writer gets while the first one is parked. */
const WINDOW_MS = 2_000;
const SET = PermissionSetSchema.parse({
  name: 'uim_member',
  objects: { [OBJ]: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});
const SETS = [MEMBER_DEFAULT, SET];
const memberOf = (userId: string) => ({
  userId, tenantId: ORG, positions: ['org_member'], permissions: [SET.name, 'member_default'], posture: 'MEMBER',
});
/** What the `afterInsert` hook throws, asserted by identity. */
const HOOK_REFUSAL = new Error('refused by the afterInsert hook');
const QUIET = { debug() {}, info() {}, warn() {}, error() {} };

type HookShape = 'none' | 'beforeInsert' | 'afterInsert';

async function boot(hook: HookShape) {
  const engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as never,
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.unit-inside-middleware', name: 'unit inside middleware', version: '1.0.0', type: 'plugin', scope: 'system',
    objects: [SysUser, SysOrganization, SysMember, SysUserPosition, SysUserPermissionSet, {
      name: OBJ, label: 'Ticket', sharingModel: 'private', tenancy: { enabled: false },
      fields: { id: { name: 'id', type: 'text', primaryKey: true }, name: { name: 'name', type: 'text' } },
    }],
  } as never);
  await engine.syncSchemas();
  if (hook !== 'none') {
    // A metadata-bound hook: its presence is what opens the after-abort unit —
    // any `beforeInsert` (side-writing term), or a blocking `afterInsert` whose
    // `onError` is `abort` (aborting term). The `afterInsert` refuses a row
    // named `boom`, for the control below.
    const bound = hook === 'afterInsert'
      ? {
          name: 'uim_after', object: OBJ, events: ['afterInsert'], onError: 'abort',
          handler: (ctx: any) => { if (ctx.result?.name === 'boom') throw HOOK_REFUSAL; },
        }
      : { name: 'uim_touch', object: OBJ, events: ['beforeInsert'], handler: () => {} };
    bindHooksToEngine(engine as never, [bound as never], { packageId: 'app:uim', logger: QUIET as never });
  }
  await engine.insert('sys_user', [A, B].map((id) => ({ id, name: id, email: `${id}@uim.test` })), SYS);
  await engine.insert('sys_organization', [{ id: ORG, name: 'UIM', slug: 'uim' }], SYS);
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (type: string, name: string) =>
        type === 'permission' ? SETS.find((s) => s.name === name) ?? null : engine.getSchema(name) ?? null,
      list: async () => SETS,
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: () => undefined,
    hook: () => undefined,
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  wireEngineSecuritySource(engine, () => plugin);
  // Registered after the security plugin's, so it runs after the gate's reads:
  // a write by `A` waits here, before `next()`, until the test releases it.
  let release!: () => void;
  const parked = new Promise<void>((resolve) => { release = resolve; });
  let arrived!: () => void;
  const arrival = new Promise<void>((resolve) => { arrived = resolve; });
  engine.registerMiddleware((async (op: any, next: () => Promise<void>) => {
    if (op.operation === 'insert' && op.context?.userId === A) { arrived(); await parked; }
    await next();
  }) as never, { object: OBJ });
  return { engine, release, arrival };
}

const insertAs = (engine: ObjectQL, user: string, id: string, name = id) =>
  engine.insert(OBJ, { id, name }, { context: memberOf(user) } as never);
const settledWithin = (p: Promise<unknown>, ms: number) =>
  Promise.race([
    p.then(() => 'fulfilled', (e: unknown) => `rejected: ${(e as any)?.code ?? (e as Error)?.message}`),
    new Promise<string>((resolve) => setTimeout(() => resolve('still waiting'), ms)),
  ]);

const HOOK_LABEL: Record<HookShape, string> = {
  none: 'no metadata insert hook (no unit)',
  beforeInsert: 'a metadata beforeInsert hook (the unit opens)',
  afterInsert: 'only a blocking metadata afterInsert hook (the unit opens)',
};

for (const hook of ['none', 'beforeInsert', 'afterInsert'] as const) {
  describe(`[#35167] insert — ${HOOK_LABEL[hook]}`, () => {
    it('a second writer\'s insert lands while the first one is parked in the middleware chain', async () => {
      const { engine, release, arrival } = await boot(hook);
      const first = insertAs(engine, A, 'tk_a');
      // `first` settling before it parks fails the cell below, not the timeout.
      await Promise.race([arrival, first.then(() => undefined, () => undefined)]);
      const second = await settledWithin(insertAs(engine, B, 'tk_b'), WINDOW_MS);
      release();
      expect(second, 'the second insert, while the first is parked before next()').toBe('fulfilled');
      await expect(first).resolves.toMatchObject({ id: 'tk_a' });
      const ids = ((await engine.find(OBJ, {} as never, SYS)) as any[]).map((r) => r.id).sort();
      expect(ids).toEqual(['tk_a', 'tk_b']);
    });
  });
}

describe('[#35167] control — the unit around the engine body still rolls an aborted insert back', () => {
  it('an afterInsert hook that throws leaves no row on SQLite', async () => {
    const { engine, release } = await boot('afterInsert');
    release();
    const err = await insertAs(engine, B, 'tk_boom', 'boom').then(() => undefined, (e: unknown) => e);
    expect(err, 'the afterInsert hook\'s own throw reaches the caller').toBe(HOOK_REFUSAL);
    expect(await engine.findOne(OBJ, { where: { id: 'tk_boom' } } as never, SYS)).toBeNull();
    await expect(insertAs(engine, B, 'tk_ok')).resolves.toMatchObject({ id: 'tk_ok' });
  });
});
