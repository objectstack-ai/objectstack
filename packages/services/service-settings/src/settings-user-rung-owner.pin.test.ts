// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The user rung belongs to one user.
 *
 * A key declared `scope: 'user'` is stored per user: its rows carry the
 * `user_id` of the person whose preference they are. Two halves keep that
 * true at the service boundary, and each is pinned here on both stores the
 * service can run over (an engine-bound `sys_setting`, and the no-engine
 * in-memory fallback):
 *
 *  - **Read.** The user rung answers only a caller whose user id is present
 *    and equals the row's `user_id`. A resolve with no user id falls through
 *    to the tenant rung, then global, then the manifest default, exactly as if
 *    no user row existed. That holds on every public read path that reaches
 *    the cascade (`get`, `getMany`, `getNamespace`, `createClient`,
 *    `runAction`, `resetNamespace`).
 *  - **Write.** `set` / `setMany` refuse a user-scoped key with no user id,
 *    with a typed refusal (`SETTINGS_VALIDATION`, the key named in `fields`)
 *    before any write, so the store never holds a user row with no owner.
 *
 * Controls: a caller with a user id reads and writes only their own row, and
 * tenant / global keys answer and write the same with or without a user id.
 */

import { describe, it, expect, vi } from 'vitest';
import { SettingsService } from './settings-service.js';
import { SettingsValidationError, type SettingsContext } from './settings-service.types.js';

type Row = Record<string, unknown>;

const NS = 'prefs_owner';
const USER_A = 'usr_owner_a';
const USER_B = 'usr_owner_b';

const MANIFEST = {
  namespace: NS,
  version: 1,
  label: 'Preferences',
  specifiers: [
    { type: 'text', key: 'theme', label: 'Theme', scope: 'user', default: 'system' },
    { type: 'text', key: 'density', label: 'Density', scope: 'tenant', default: 'comfortable' },
    { type: 'text', key: 'banner', label: 'Banner', scope: 'global', default: 'none' },
  ],
} as any;

// The service's stored row shape, per rung. A user row with a `null` owner is
// the shape an ownerless write stored before the write half refused it; a
// database may still hold one.
const userRow = (userId: string | null, value: string): Row => ({
  namespace: NS, key: 'theme', scope: 'user', user_id: userId, value,
  value_enc: null, encrypted: false, locked: false, locked_reason: null,
});
const PEOPLE = [userRow(null, 'ownerless'), userRow(USER_A, 'dark'), userRow(USER_B, 'light')];
const tenantRow = (key: string, value: string): Row => ({
  namespace: NS, key, scope: 'tenant', user_id: null, value,
  value_enc: null, encrypted: false, locked: false, locked_reason: null,
});
const globalRow = (key: string, value: string): Row => ({
  namespace: NS, key, scope: 'global', user_id: null, value,
  value_enc: null, encrypted: false, locked: false, locked_reason: null,
});

// `$or` is the one combinator the settings reads write; any other is refused,
// so a predicate this double cannot express never reads as "no such row".
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === '$or') return (v as Row[]).some((b) => matches(row, b));
    if (k.startsWith('$')) throw new Error(`fake engine: unimplemented combinator ${k}`);
    return (row[k] ?? null) === (v ?? null);
  });
}

/**
 * A `SettingsEngine`-shaped double over two stores: the global rung's
 * `sys_platform_setting` (no `scope`, no `user_id`) and `sys_setting` for the
 * tenant and user rungs. Every user id resolves in `sys_user`, so the
 * service's own user-reference refusal never decides a case here.
 */
function engineStack(seed: Row[], opts: { overAnswer?: boolean } = {}) {
  const stores: Record<string, Row[]> = {
    sys_platform_setting: seed
      .filter((r) => r.scope === 'global')
      .map(({ scope: _scope, user_id: _userId, ...stored }) => ({ ...stored })),
    sys_setting: seed.filter((r) => r.scope !== 'global').map((r) => ({ ...r })),
  };
  const find = vi.fn(async (object: string, query: any) => {
    if (object === 'sys_user') return [{ id: query?.where?.id }];
    // `overAnswer`: a store that hands back every row of the namespace to any
    // load, whatever else the predicate asked for.
    const where = opts.overAnswer ? { namespace: query?.where?.namespace } : query?.where ?? {};
    const hits = (stores[object] ?? []).filter((r) => matches(r, where));
    return typeof query?.limit === 'number' ? hits.slice(0, query.limit) : hits;
  });
  const insert = vi.fn(async (object: string, data: Row) => {
    (stores[object] ??= []).push({ ...data });
    return { ...data };
  });
  const engine = { find, insert, update: vi.fn(), delete: vi.fn(), count: vi.fn() };
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(MANIFEST);
  svc.bindEngine(engine as any);
  return {
    svc,
    wrote: () => insert.mock.calls.length + engine.update.mock.calls.length,
    snapshot: () => JSON.stringify(stores),
  };
}

/** The no-engine in-memory fallback, seeded store-level. */
function memoryStack(seed: Row[]) {
  const svc = new SettingsService({ env: {} });
  svc.registerManifest(MANIFEST);
  const memory = (svc as any).memory as Row[];
  memory.push(...seed.map((r) => ({ ...r })));
  return {
    svc,
    wrote: () => (memory.length === seed.length ? 0 : 1),
    snapshot: () => JSON.stringify(memory),
  };
}

const STACKS = [
  ['engine-bound', engineStack],
  ['in-memory', memoryStack],
] as const;

/** Each public read path that reaches the cascade, answering `theme` for `ctx`. */
const READ_PATHS: Array<[string, (svc: SettingsService, ctx: SettingsContext) => Promise<unknown>]> = [
  ['get', async (svc, ctx) => (await svc.get(NS, 'theme', ctx)).value],
  ['getMany', async (svc, ctx) => (await svc.getMany(NS, ['theme', 'density'], ctx)).theme.value],
  ['getNamespace', async (svc, ctx) => (await svc.getNamespace(NS, ctx)).values.theme.value],
  ['createClient', async (svc, ctx) => {
    const client = await svc.createClient(NS, { ctx });
    try { return client.current.theme; } finally { client.dispose(); }
  }],
  ['runAction', async (svc, ctx) => {
    let seen: unknown;
    svc.registerAction(NS, 'probe', async ({ values }) => {
      seen = values.theme;
      return { ok: true, severity: 'info', message: 'ok' };
    });
    await svc.runAction(NS, 'probe', {}, ctx);
    return seen;
  }],
];

/** Contexts that carry no user id. */
const NO_USER: Array<[string, SettingsContext]> = [
  ['an empty context', {}],
  ['a tenant-only context', { tenantId: 'org_1' }],
  ['an empty-string user id', { userId: '' }],
];

describe('the user rung answers only its owner', () => {
  describe.each(STACKS)('%s', (_label, stack) => {
    describe.each(READ_PATHS)('%s', (_path, read) => {
      it.each(NO_USER)('a resolve with no user id never answers a user-scoped row (%s)', async (_c, ctx) => {
        const { svc } = stack(PEOPLE);
        expect(await read(svc, ctx)).toBe('system');
      });

      it('control: a caller with a user id reads only their own row', async () => {
        const { svc } = stack(PEOPLE);
        expect(await read(svc, { userId: USER_A })).toBe('dark');
        expect(await read(svc, { userId: USER_B })).toBe('light');
        expect(await read(svc, { userId: 'usr_owner_c' })).toBe('system');
      });
    });

    it('with no user id, a user-scoped key falls through to the tenant rung, then global, then the default', async () => {
      const users = PEOPLE;

      const withTenant = await stack([...users, tenantRow('theme', 'tenant-theme')]).svc.get(NS, 'theme');
      expect(withTenant).toMatchObject({ value: 'tenant-theme', source: 'tenant' });
      expect(withTenant.cascadeChain?.map((e) => e.scope)).toEqual(['tenant', 'default']);

      const withGlobal = await stack([...users, globalRow('theme', 'global-theme')]).svc.get(NS, 'theme');
      expect(withGlobal).toMatchObject({ value: 'global-theme', source: 'global' });
      expect(withGlobal.cascadeChain?.map((e) => e.scope)).toEqual(['global', 'default']);

      const bare = await stack(users).svc.get(NS, 'theme');
      expect(bare).toMatchObject({ value: 'system', source: 'default' });
      expect(bare.cascadeChain?.map((e) => e.scope)).toEqual(['default']);
    });

    it('control: the owner still sees their row above the tenant rung, as before', async () => {
      const { svc } = stack([userRow(USER_A, 'dark'), tenantRow('theme', 'tenant-theme')]);
      const got = await svc.get(NS, 'theme', { userId: USER_A });
      expect(got.cascadeChain?.map((e) => e.scope)).toEqual(['tenant', 'user', 'default']);
      expect(got.cascadeChain?.find((e) => e.scope === 'user')?.value).toBe('dark');
    });

    it('a reset with no user id counts no user row and writes nothing', async () => {
      const { svc, wrote, snapshot } = stack(PEOPLE);
      const before = snapshot();
      expect(await svc.resetNamespace(NS)).toBe(0);
      expect(wrote()).toBe(0);
      expect(snapshot()).toBe(before);
    });

    it('control: tenant and global keys resolve the same with or without a user id', async () => {
      const { svc } = stack([tenantRow('density', 'compact'), globalRow('banner', 'maintenance')]);
      for (const ctx of [{}, { tenantId: 'org_1' }, { userId: USER_A }] as SettingsContext[]) {
        expect(await svc.get(NS, 'density', ctx)).toMatchObject({ value: 'compact', source: 'tenant' });
        expect(await svc.get(NS, 'banner', ctx)).toMatchObject({ value: 'maintenance', source: 'global' });
      }
    });
  });
});

describe('the user rung compares the owner itself, whatever rows the store answers', () => {
  it.each(READ_PATHS)('%s', async (_path, read) => {
    const { svc } = engineStack(PEOPLE, { overAnswer: true });
    expect(await read(svc, { userId: USER_B })).toBe('light');
    expect(await read(svc, { userId: USER_A })).toBe('dark');
    expect(await read(svc, { userId: 'usr_owner_c' })).toBe('system');
    expect(await read(svc, {})).toBe('system');
  });
});

describe('a user-scoped write names its owner', () => {
  describe.each(STACKS)('%s', (_label, stack) => {
    it.each(NO_USER)('a write of a user-scoped key with no user id is refused and stores nothing (%s)', async (_c, ctx) => {
      const { svc, wrote, snapshot } = stack([]);
      const events: unknown[] = [];
      svc.subscribe(NS, (e) => events.push(e));
      const before = snapshot();

      for (const value of ['dark', null]) {
        const err: unknown = await svc.set(NS, 'theme', value, ctx).then(() => null, (e: unknown) => e);
        // The envelope, not the bare throw: a service-layer error class carries
        // `code` and the per-key `fields`, and no HTTP `status`.
        expect(err).toBeInstanceOf(SettingsValidationError);
        expect((err as SettingsValidationError).code).toBe('SETTINGS_VALIDATION');
        expect((err as SettingsValidationError).fields).toEqual([
          expect.objectContaining({ field: 'theme', code: 'invalid_value', constraint: { scope: 'user' } }),
        ]);
      }

      expect(wrote()).toBe(0);
      expect(snapshot()).toBe(before);
      expect(events).toEqual([]);
    });

    it('the refusal covers the whole batch: a tenant key beside it is not written either', async () => {
      const { svc, wrote, snapshot } = stack([]);
      const before = snapshot();
      const err: unknown = await svc
        .setMany(NS, { density: 'compact', theme: 'dark' }, { tenantId: 'org_1' })
        .then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(SettingsValidationError);
      expect((err as SettingsValidationError).code).toBe('SETTINGS_VALIDATION');
      expect((err as SettingsValidationError).fields.map((f) => f.field)).toEqual(['theme']);
      expect(wrote()).toBe(0);
      expect(snapshot()).toBe(before);
    });

    it("control: a write with a user id stores that user's row, and another user does not read it", async () => {
      const { svc, wrote } = stack([]);
      const got = await svc.set(NS, 'theme', 'dark', { userId: USER_A });
      expect(got).toMatchObject({ value: 'dark', source: 'user' });
      expect(wrote()).toBe(1);
      expect((await svc.get(NS, 'theme', { userId: USER_A })).value).toBe('dark');
      expect((await svc.get(NS, 'theme', { userId: USER_B })).value).toBe('system');
    });

    it('control: tenant and global keys write the same with no user id', async () => {
      const { svc } = stack([]);
      expect(await svc.set(NS, 'density', 'compact')).toMatchObject({ value: 'compact', source: 'tenant' });
      expect(await svc.set(NS, 'banner', 'maintenance')).toMatchObject({ value: 'maintenance', source: 'global' });
    });
  });
});
