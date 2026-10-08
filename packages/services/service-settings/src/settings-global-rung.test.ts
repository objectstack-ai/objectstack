// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D7] The settings cascade's GLOBAL rung lives in the tenant-less
 * `sys_platform_setting`, and `SettingsService` reads and writes it there.
 *
 * The card's acceptance — "the settings cascade resolves deployment values from
 * the new source" — pinned over a real `ObjectQL` engine and the real platform
 * objects, through the real `IDataEngine → SettingsEngine` adapter the plugin
 * binds. Each case names the store it reads back, so a value answered from the
 * wrong table cannot pass:
 *
 *  - a global write lands in `sys_platform_setting`, keyed `(namespace, key)`,
 *    and `sys_setting` takes nothing;
 *  - the resolver's global rung is read from `sys_platform_setting`;
 *  - the rank table is unchanged: the global rung still outranks the tenant and
 *    user rungs, which still answer when it is empty;
 *  - ⛔ no dual read: a `scope = 'global'` row a pre-v18 database still holds in
 *    `sys_setting` is not a rung (ADR-0131 D14: the v18 ceremony moves it), with
 *    the same row at `scope = 'tenant'` as the control that the read can see it;
 *  - an encrypted global value keeps its handle in `sys_platform_setting.value_enc`,
 *    opens, and a rotation reaps the retired handle only after re-reading THAT
 *    row; and a handle sealed by any settings row opens from this store, because
 *    the ADR-0128 AAD binds the producer's `(namespace, key)` and neither the
 *    holder object nor an organization.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysPlatformSetting, SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { SettingsLockedError } from './settings-service.types.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-global-rung';

/** A deployment-level manifest, as the shipped `mail` / `storage` / `ai` ones are. */
const GLOBAL_MANIFEST: SettingsManifest = {
  namespace: 'relay_probe',
  version: 1,
  label: 'Relay (global)',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  specifiers: [
    { type: 'text', key: 'host', label: 'Host', required: false, default: 'localhost' },
    { type: 'password', key: 'api_key', label: 'API key', required: false, encrypted: true },
  ],
};

/** A per-user key, so every rung of the cascade can hold a row for it. */
const USER_MANIFEST: SettingsManifest = {
  namespace: 'prefs_probe',
  version: 1,
  label: 'Prefs (user)',
  scope: 'user',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [{ type: 'text', key: 'theme', label: 'Theme', required: false, default: 'system' }],
};

/** A driver over plain Maps — the verbs the settings path reaches through `ObjectQL`. */
function makeMemoryDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  // `$or` is the one combinator the settings reads emit; anything else refuses,
  // so a predicate this double cannot express never reads as "no such row".
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k === '$or') return (v as any[]).some((b) => matches(row, b));
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      // The caller's bound by PRESENCE, after the filter and before the copy.
      const hits = [...rowsOf(object).values()].filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? hits.slice(0, ast.limit) : hits;
      return page.map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of rowsOf(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return copy(next);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return rowsOf(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = rowsOf(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) rowsOf(object).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

/** The pieces the running server binds: real engine, real objects, real adapter and secret store. */
async function boot() {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysPlatformSetting, SysSecret]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  const cryptoProvider = new LocalCryptoProvider();
  const svc = new SettingsService({
    env: {},
    engine: wrapEngineAsSettingsEngine(engine as any),
    cryptoProvider,
    secretStore: (new SettingsServicePlugin() as any).buildSecretStore(engine),
  });
  svc.registerManifest(GLOBAL_MANIFEST);
  svc.registerManifest(USER_MANIFEST);
  const rows = (object: string) => [...rowsOf(object).values()];
  /** Seed a row straight into a store, as a database already holds it. */
  const seed = (object: string, row: Record<string, unknown>) =>
    rowsOf(object).set(String(row.id), { encrypted: false, locked: false, value_enc: null, ...row });
  return { svc, engine, cryptoProvider, rows, seed };
}

describe('[ADR-0131 D7] the global rung is stored in sys_platform_setting', () => {
  it('a global write lands in sys_platform_setting, keyed (namespace, key) — and sys_setting takes nothing', async () => {
    const { svc, rows } = await boot();

    await svc.set('relay_probe', 'host', 'smtp.example.com', { userId: 'usr_admin', tenantId: 'org_1' });
    await svc.set('relay_probe', 'host', 'smtp2.example.com', { userId: 'usr_admin', tenantId: 'org_1' });

    // One row for the deployment, updated in place on the second write.
    const platform = rows('sys_platform_setting');
    expect(platform).toHaveLength(1);
    expect(platform[0]).toMatchObject({ namespace: 'relay_probe', key: 'host', value: 'smtp2.example.com' });
    // The store has no rung column, no user column and no organization: the
    // writer's tenant context did not attribute the deployment value to it.
    expect(platform[0]).not.toHaveProperty('scope');
    expect(platform[0]).not.toHaveProperty('user_id');
    expect(platform[0].organization_id ?? null).toBeNull();
    // The tenant/user store took nothing.
    expect(rows('sys_setting')).toEqual([]);
  });

  it('the cascade resolves the global rung FROM sys_platform_setting', async () => {
    const { svc, seed } = await boot();
    seed('sys_platform_setting', { id: 'ps_1', namespace: 'relay_probe', key: 'host', value: 'relay.internal' });

    const got = await svc.get('relay_probe', 'host');
    expect(got.value).toBe('relay.internal');
    expect(got.source).toBe('global');
    expect(got.cascadeChain?.[0]).toMatchObject({ scope: 'global', value: 'relay.internal', effective: true });
  });

  it('a lock on the global rung still refuses a lower-rung write (the lock check reads the new store)', async () => {
    const { svc, seed, rows } = await boot();
    seed('sys_platform_setting', {
      id: 'ps_1', namespace: 'prefs_probe', key: 'theme', value: 'dark',
      locked: true, locked_reason: 'Platform policy: one theme.',
    });

    const err = await svc.set('prefs_probe', 'theme', 'light', { userId: 'u1' }).then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(SettingsLockedError);
    expect((err as SettingsLockedError).code).toBe('SETTINGS_LOCKED');
    expect(rows('sys_setting')).toEqual([]);
  });
});

describe('[ADR-0131 D7] the rank table is unchanged — only the global rung moved', () => {
  it('the global rung outranks the tenant and user rungs, which answer once it is empty', async () => {
    const { svc, seed } = await boot();
    seed('sys_setting', { id: 'st_t', namespace: 'prefs_probe', key: 'theme', scope: 'tenant', user_id: null, value: 'tenant-theme' });
    seed('sys_setting', { id: 'st_u', namespace: 'prefs_probe', key: 'theme', scope: 'user', user_id: 'u1', value: 'user-theme' });

    // No global row: the tenant and user rungs answer, in the order they did.
    let got = await svc.get('prefs_probe', 'theme', { userId: 'u1' });
    expect(got.cascadeChain?.map((e) => e.scope)).toEqual(['tenant', 'user', 'default']);
    expect(got.source).toBe('tenant');

    // A global row, from its own store, takes rank 1 — above both.
    seed('sys_platform_setting', { id: 'ps_1', namespace: 'prefs_probe', key: 'theme', value: 'global-theme' });
    got = await svc.get('prefs_probe', 'theme', { userId: 'u1' });
    expect(got.cascadeChain?.map((e) => e.scope)).toEqual(['global', 'tenant', 'user', 'default']);
    expect(got.value).toBe('global-theme');
    expect(got.source).toBe('global');
  });
});

describe('[ADR-0131 D14] no dual read: sys_setting is not a second source for the global rung', () => {
  it('a scope=global row still in sys_setting is NOT read — the control row at scope=tenant is', async () => {
    const { svc, seed } = await boot();
    // The shape a pre-v18 database holds until the v18 ceremony moves it. The
    // key is user-declared, so every rung — global, tenant, user — is consulted.
    seed('sys_setting', { id: 'legacy', namespace: 'prefs_probe', key: 'theme', scope: 'global', user_id: null, value: 'legacy-theme' });

    const got = await svc.get('prefs_probe', 'theme', { userId: 'u1' });
    expect(got.value).toBe('system');
    expect(got.source).toBe('default');
    expect(got.cascadeChain?.map((e) => e.scope)).toEqual(['default']);

    // Control: the identical row one rung down IS visible to the same read,
    // so the silence above is the exclusion and not a read that sees nothing.
    seed('sys_setting', { id: 'legacy', namespace: 'prefs_probe', key: 'theme', scope: 'tenant', user_id: null, value: 'legacy-theme' });
    const control = await svc.get('prefs_probe', 'theme', { userId: 'u1' });
    expect(control.value).toBe('legacy-theme');
    expect(control.source).toBe('tenant');
  });

  it('a global-scope key never consults sys_setting at all — the legacy row is not its value either', async () => {
    const { svc, seed } = await boot();
    seed('sys_setting', { id: 'legacy', namespace: 'relay_probe', key: 'host', scope: 'global', user_id: null, value: 'legacy.example.com' });

    const got = await svc.get('relay_probe', 'host');
    expect(got.value).toBe('localhost');
    expect(got.source).toBe('default');
  });
});

describe('[ADR-0131 D7 / ADR-0128] an encrypted global value', () => {
  it('keeps its handle in sys_platform_setting.value_enc, opens, and a rotation reaps the retired handle', async () => {
    const { svc, rows } = await boot();

    await svc.set('relay_probe', 'api_key', 'first-secret');
    const [first] = rows('sys_platform_setting');
    expect(String(first.value_enc)).toMatch(/^sec_/);
    expect(first.value ?? null).toBeNull();
    expect(rows('sys_secret').map((r) => r.id)).toEqual([first.value_enc]);
    expect((await svc.get('relay_probe', 'api_key')).value).toBe('first-secret');

    await svc.set('relay_probe', 'api_key', 'second-secret');
    const [second] = rows('sys_platform_setting');
    expect(second.value_enc).not.toBe(first.value_enc);
    expect((await svc.get('relay_probe', 'api_key')).value).toBe('second-secret');
    // The reaper re-read the platform row, saw it repointed, and removed the
    // retired ciphertext — exactly one secret row survives, the one in force.
    expect(rows('sys_secret').map((r) => r.id)).toEqual([second.value_enc]);
    expect(rows('sys_setting')).toEqual([]);
  });

  it('a handle sealed by a settings row opens from sys_platform_setting unchanged (AAD = producer scope + namespace + key)', async () => {
    const { svc, cryptoProvider, seed } = await boot();
    // Sealed the way every settings write seals it, with an organization in the
    // context — the context a tenant admin's write, or a pre-v18 global write,
    // carried. Nothing about the holder object or the organization is bound in.
    const handle = await cryptoProvider.encrypt('moved-secret', {
      scope: 'settings', namespace: 'relay_probe', key: 'api_key', tenantId: 'org_1',
    });
    seed('sys_secret', {
      id: handle.id, namespace: 'relay_probe', key: 'api_key',
      kms_key_id: handle.kmsKeyId, alg: handle.alg, version: handle.version, ciphertext: handle.ciphertext,
    });
    // The row the v18 ceremony writes: the same handle, in the new store.
    seed('sys_platform_setting', { id: 'ps_1', namespace: 'relay_probe', key: 'api_key', encrypted: true, value_enc: handle.id });

    const got = await svc.get('relay_probe', 'api_key');
    expect(got.value).toBe('moved-secret');
    expect(got.source).toBe('global');
  });
});
