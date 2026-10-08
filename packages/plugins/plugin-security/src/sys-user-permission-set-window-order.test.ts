// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0091 D1/D2] A permission-set assignment's validity window is half-open,
 * `[valid_from, valid_until)`, so a window whose end is not after its start is
 * empty: the grant can never confer anything. `sys_user_permission_set` refuses
 * to store one.
 *
 * What the write door did before the object declared the refusal (measured on
 * this harness): every write below landed — an inverted or empty window was
 * stored, from a system and a non-system writer alike, and the resolver then
 * dropped the grant at every evaluation, so an administrator who mistyped a
 * date was told nothing.
 *
 * The refusal judges the window the write leaves behind: an insert by its own
 * two bounds, an update by the stored row overlaid with the patch. An update
 * that moves neither bound is not judged, so a row stored before the refusal
 * existed does not block an unrelated edit — repairing it is the only write
 * that has to state a valid window.
 *
 * Measured on a REAL `ObjectQL` engine over a real SQL driver with the REAL
 * `SecurityPlugin` started on it, the harness `grant-permission-set-name.test.ts`
 * uses: what is pinned is what the write door does, and a double would answer
 * for none of it. Refusals are identified by their ADR-0112 envelope — `code`
 * and `status`, read through `resolveThrownHttpError`, the resolver both HTTP
 * doors answer with — never by a bare `toThrow()`.
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

const MEMBER_DEFAULT = { name: 'member_default', label: 'Member', objects: {} } as unknown as PermissionSet;
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
const GRANTS = 'sys_user_permission_set';

const T0 = '2026-11-01T00:00:00.000Z';
const T1 = '2026-12-01T00:00:00.000Z';
const T2 = '2027-01-01T00:00:00.000Z';

const engines: ObjectQL[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (engines.length) {
    try { await engines.pop()?.destroy(); } catch { /* noop */ }
  }
});

async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.grant-window-order',
    name: 'Grant window order',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [SysPosition, SysUserPosition, SysPermissionSet, SysPositionPermissionSet, SysUserPermissionSet, SysMember],
  } as any);
  await engine.syncSchemas();
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

  await engine.insert('sys_permission_set', {
    id: 'ps_alpha', name: 'qa_alpha', label: 'qa_alpha',
    object_permissions: '{}', field_permissions: '{}', system_permissions: '[]', active: true,
  }, { context: SYS } as any);
  return { engine, driver };
}

type Harness = Awaited<ReturnType<typeof boot>>;

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
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

function expectWindowRefusal(err: unknown): void {
  const env = envelopeOf(err);
  expect([env.status, env.code]).toEqual([400, 'VALIDATION_FAILED']);
  expect(env.fields.map((f) => [f.field, f.code])).toEqual([['valid_until', 'rule_violation']]);
}

async function grantsOf(h: Harness, userId: string): Promise<any[]> {
  const rows = await h.engine.find(GRANTS, { where: { user_id: userId }, context: SYS });
  return Array.isArray(rows) ? rows : [];
}

const instant = (v: unknown) => (v == null ? v : new Date(v as string).toISOString());
const windowOf = (row: any) => ({ valid_from: instant(row?.valid_from), valid_until: instant(row?.valid_until) });

describe('an insert is judged by the window it stores', () => {
  for (const [who, context] of [['a system writer', SYS], ['an administrator', ADMIN]] as const) {
    it(`NEGATIVE — ${who}: valid_until before valid_from is refused 400 VALIDATION_FAILED; nothing is stored`, async () => {
      const h = await boot();
      const err = await refusalOf(() => h.engine.insert(
        GRANTS, { user_id: 'u_inv', permission_set_id: 'ps_alpha', valid_from: T1, valid_until: T0 }, { context } as any,
      ));
      expectWindowRefusal(err);
      expect(await grantsOf(h, 'u_inv')).toHaveLength(0);
    });
  }

  it('NEGATIVE — equal bounds are refused: [t, t) is empty', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(
      GRANTS, { user_id: 'u_eq', permission_set_id: 'ps_alpha', valid_from: T1, valid_until: T1 }, { context: ADMIN } as any,
    ));
    expectWindowRefusal(err);
    expect(await grantsOf(h, 'u_eq')).toHaveLength(0);
  });

  it('NEGATIVE — a batch with one inverted row is refused whole; nothing is stored', async () => {
    const h = await boot();
    const err = await refusalOf(() => h.engine.insert(GRANTS, [
      { user_id: 'u_b1', permission_set_id: 'ps_alpha', valid_from: T0, valid_until: T1 },
      { user_id: 'u_b2', permission_set_id: 'ps_alpha', valid_from: T2, valid_until: T1 },
    ], { context: ADMIN } as any));
    expectWindowRefusal(err);
    expect(await grantsOf(h, 'u_b1')).toHaveLength(0);
    expect(await grantsOf(h, 'u_b2')).toHaveLength(0);
  });

  it('a valid window lands', async () => {
    const h = await boot();
    await h.engine.insert(GRANTS, { user_id: 'u_ok', permission_set_id: 'ps_alpha', valid_from: T0, valid_until: T1 }, { context: ADMIN } as any);
    expect(windowOf((await grantsOf(h, 'u_ok'))[0])).toEqual({ valid_from: T0, valid_until: T1 });
  });

  it('one bound alone lands, either one; no window at all lands', async () => {
    const h = await boot();
    await h.engine.insert(GRANTS, { user_id: 'u_from', permission_set_id: 'ps_alpha', valid_from: T1 }, { context: ADMIN } as any);
    await h.engine.insert(GRANTS, { user_id: 'u_until', permission_set_id: 'ps_alpha', valid_until: T0 }, { context: ADMIN } as any);
    await h.engine.insert(GRANTS, { user_id: 'u_none', permission_set_id: 'ps_alpha' }, { context: ADMIN } as any);
    expect(windowOf((await grantsOf(h, 'u_from'))[0])).toEqual({ valid_from: T1, valid_until: null });
    expect(windowOf((await grantsOf(h, 'u_until'))[0])).toEqual({ valid_from: null, valid_until: T0 });
    expect(windowOf((await grantsOf(h, 'u_none'))[0])).toEqual({ valid_from: null, valid_until: null });
  });
});

describe('an update is judged by the stored row overlaid with the patch', () => {
  async function stored(h: Harness, id: string, window: Record<string, string>) {
    await h.engine.insert(GRANTS, { id, user_id: `u_${id}`, permission_set_id: 'ps_alpha', ...window }, { context: ADMIN } as any);
  }

  it('NEGATIVE — moving valid_until to before the stored valid_from is refused; the stored row is unchanged', async () => {
    const h = await boot();
    await stored(h, 'g_until', { valid_from: T1, valid_until: T2 });
    const err = await refusalOf(() => h.engine.update(GRANTS, { id: 'g_until', valid_until: T0 }, { context: ADMIN } as any));
    expectWindowRefusal(err);
    expect(windowOf((await grantsOf(h, 'u_g_until'))[0])).toEqual({ valid_from: T1, valid_until: T2 });
  });

  it('NEGATIVE — moving valid_from to the stored valid_until is refused (a system writer too); the stored row is unchanged', async () => {
    const h = await boot();
    await stored(h, 'g_from', { valid_from: T0, valid_until: T1 });
    const err = await refusalOf(() => h.engine.update(GRANTS, { id: 'g_from', valid_from: T1 }, { context: SYS } as any));
    expectWindowRefusal(err);
    expect(windowOf((await grantsOf(h, 'u_g_from'))[0])).toEqual({ valid_from: T0, valid_until: T1 });
  });

  it('NEGATIVE — a multi-row update that inverts the windows it matches is refused; no row moves', async () => {
    const h = await boot();
    await stored(h, 'g_m1', { valid_from: T1, valid_until: T2 });
    await stored(h, 'g_m2', { valid_from: T1 });
    const err = await refusalOf(() => h.engine.update(
      GRANTS, { valid_until: T0 }, { where: { permission_set_id: 'ps_alpha' }, multi: true, context: SYS } as any,
    ));
    expectWindowRefusal(err);
    expect(windowOf((await grantsOf(h, 'u_g_m1'))[0])).toEqual({ valid_from: T1, valid_until: T2 });
    expect(windowOf((await grantsOf(h, 'u_g_m2'))[0])).toEqual({ valid_from: T1, valid_until: null });
  });

  it('moving a bound within a valid window lands', async () => {
    const h = await boot();
    await stored(h, 'g_move', { valid_from: T0, valid_until: T1 });
    await h.engine.update(GRANTS, { id: 'g_move', valid_until: T2 }, { context: ADMIN } as any);
    expect(windowOf((await grantsOf(h, 'u_g_move'))[0])).toEqual({ valid_from: T0, valid_until: T2 });
  });

  it('a row stored with an inverted window does not block an update that moves neither bound; repairing it lands', async () => {
    const h = await boot();
    // A row the refusal never judged — stored beneath the engine, the way a
    // row written before the refusal existed sits in a deployed table.
    await h.driver.create(GRANTS, {
      id: 'g_legacy', user_id: 'u_legacy', permission_set_id: 'ps_alpha', valid_from: T1, valid_until: T0,
    });
    expect(windowOf((await grantsOf(h, 'u_legacy'))[0]), 'the legacy row is stored inverted').toEqual({ valid_from: T1, valid_until: T0 });

    await h.engine.update(GRANTS, { id: 'g_legacy', reason: 'unrelated edit' }, { context: ADMIN } as any);
    expect((await grantsOf(h, 'u_legacy'))[0]).toMatchObject({ reason: 'unrelated edit' });

    // Moving one bound still leaves it inverted: refused.
    expectWindowRefusal(await refusalOf(() => h.engine.update(GRANTS, { id: 'g_legacy', valid_until: T0.replace('11-01', '11-15') }, { context: ADMIN } as any)));
    // Moving it past the other bound repairs it.
    await h.engine.update(GRANTS, { id: 'g_legacy', valid_until: T2 }, { context: ADMIN } as any);
    expect(windowOf((await grantsOf(h, 'u_legacy'))[0])).toEqual({ valid_from: T1, valid_until: T2 });
  });
});
