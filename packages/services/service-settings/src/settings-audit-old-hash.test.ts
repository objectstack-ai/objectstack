// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26465] The settings audit trail's `old_hash` / `new_hash`, as the columns
 * declare them (ADR-0049 enforce arm).
 *
 * `sys_setting_audit` and its global-rung twin `sys_platform_setting_audit`
 * declare `old_hash` as the SHA-256 of the previous value's canonical JSON,
 * null only when it was unset, and `new_hash` as the SHA-256 of the new value,
 * null on a reset. The write path used to pass `oldHash: null` on every write
 * and record the adapter's FNV-1a 32 (`fnv32:…`) as the new hash.
 *
 * Every case drives `PUT /api/settings/:namespace` through the real route set,
 * over a real `ObjectQL` with the real platform objects and the plugin's own
 * audit writer, and reads the audit rows back out of the driver's store. The
 * expected digests are computed here with `node:crypto`, independently of the
 * implementation.
 *
 * [#26534] A secret-valued key records the SAME keyed digest on both columns
 * (`hmac-sha256:…`, `secretAuditDigest`): `old_hash` is the keyed digest of
 * the previous value, read back and decrypted inside the write, so it equals
 * the previous row's `new_hash`. No row ever carries an unkeyed digest of a
 * secret.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import {
  SysPlatformSetting,
  SysPlatformSettingAudit,
  SysSecret,
  SysSetting,
  SysSettingAudit,
} from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import type { IHttpRequest, IHttpResponse, IHttpServer, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import {
  SettingsServicePlugin,
  buildSettingAuditWriter,
  wrapEngineAsSettingsEngine,
} from './settings-service-plugin.js';
import { registerSettingsRoutes } from './settings-routes.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { withEngineRegistry } from './__tests__/settings-organization.testkit.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-audit-old-hash';

const SHA256_SHAPE = /^sha256:[0-9a-f]{64}$/;
const KEYED_SHAPE = /^hmac-sha256:[0-9a-f]{64}$/;
/** The declared digest, computed independently: SHA-256 of the canonical JSON. */
const sha256Of = (value: unknown) =>
  'sha256:' + createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');

/** A tenant-scope namespace: its audit rows land in `sys_setting_audit`. */
const TENANT_MANIFEST: SettingsManifest = {
  namespace: 'hash_tenant',
  version: 1,
  label: 'Hash probe (tenant)',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [{ type: 'text', key: 'timezone', label: 'Timezone', required: false }],
};

/** A global-scope namespace: its audit rows land in `sys_platform_setting_audit`. */
const GLOBAL_MANIFEST: SettingsManifest = {
  namespace: 'hash_global',
  version: 1,
  label: 'Hash probe (global)',
  scope: 'global',
  readPermission: 'manage_platform_settings',
  writePermission: 'manage_platform_settings',
  specifiers: [
    { type: 'text', key: 'host', label: 'Host', required: false },
    { type: 'password', key: 'api_key', label: 'API key', required: false, encrypted: true },
  ],
};

/** A user-scope namespace: one row per user, so the previous value is per-user. */
const USER_MANIFEST: SettingsManifest = {
  namespace: 'hash_user',
  version: 1,
  label: 'Hash probe (user)',
  scope: 'user',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  specifiers: [{ type: 'text', key: 'theme', label: 'Theme', required: false }],
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

/** Minimal `IHttpServer` that keeps the handlers so a route can be invoked. */
class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, handler: RouteHandler) {
    this.routes.set(`${method} ${path}`, handler);
  }
  get(p: string, h: RouteHandler) { this.add('GET', p, h); return this as any; }
  post(p: string, h: RouteHandler) { this.add('POST', p, h); return this as any; }
  put(p: string, h: RouteHandler) { this.add('PUT', p, h); return this as any; }
  delete(p: string, h: RouteHandler) { this.add('DELETE', p, h); return this as any; }
  patch(p: string, h: RouteHandler) { this.add('PATCH', p, h); return this as any; }
  use() { return this as any; }
  listen() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
  getInstance() { return null; }
}

/** The pieces the running server binds: real engine, real objects, the plugin's audit writer, real routes. */
async function boot(opts: { cryptoProvider?: LocalCryptoProvider } = {}) {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysPlatformSetting, SysSecret, SysSettingAudit, SysPlatformSettingAudit]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  // The plugin's own `sys_secret` store, with its reads recorded: which
  // handles a write dereferences is what the cost cases measure.
  const store = (new SettingsServicePlugin() as any).buildSecretStore(engine);
  const secretReads: string[] = [];
  const secretStore = {
    ...store,
    get: async (id: string) => { secretReads.push(id); return store.get(id); },
  };
  const svc = new SettingsService({
    env: {},
    engine: withEngineRegistry(wrapEngineAsSettingsEngine(engine as any), engine),
    cryptoProvider: opts.cryptoProvider ?? new LocalCryptoProvider(),
    secretStore,
    auditWriter: buildSettingAuditWriter(engine as any),
  });
  for (const m of [TENANT_MANIFEST, GLOBAL_MANIFEST, USER_MANIFEST]) svc.registerManifest(m);

  // The caller each request resolves to; a case switches it to write as another user.
  let userId = 'usr_admin';
  const http = new MockHttp();
  registerSettingsRoutes(http, svc, {
    contextFromRequest: () => ({
      enforced: true,
      permissions: ['setup.access', 'setup.write', 'manage_platform_settings'],
      userId,
      tenantId: 'org_1',
    }),
  });

  /** `PUT /api/settings/:namespace` through the mounted route. Status starts at 0 so 200 is asserted. */
  const put = async (namespace: string, body: Record<string, unknown>) => {
    const handler = http.routes.get('PUT /api/settings/:namespace')!;
    const req = {
      params: { namespace },
      query: {},
      body,
      headers: {},
      method: 'PUT',
      path: `/api/settings/${namespace}`,
    } as unknown as IHttpRequest;
    const state: { status: number; body?: any } = { status: 0 };
    const res = {
      json: (data: any) => { state.body = data; if (state.status === 0) state.status = 200; },
      send: () => {},
      status: (code: number) => { state.status = code; return res; },
      header: () => res,
    } as unknown as IHttpResponse;
    await handler(req, res);
    expect(state.status, JSON.stringify(state.body)).toBe(200);
    return state;
  };

  /** The audit rows of one key, oldest first, read out of the driver's store. */
  const auditOf = (object: 'sys_setting_audit' | 'sys_platform_setting_audit', key: string) =>
    [...rowsOf(object).values()].filter((r) => r.key === key);

  /** The `sys_secret` handle the global row of `key` names now. */
  const handleOf = (key: string) =>
    [...rowsOf('sys_platform_setting').values()].find((r) => r.key === key)?.value_enc as string | undefined;

  return {
    put,
    auditOf,
    asUser: (id: string) => { userId = id; },
    svc,
    rowsOf,
    secretReads,
    handleOf,
  };
}

describe('#26465 — old_hash / new_hash on the tenant rung (sys_setting_audit)', () => {
  it('first set: old_hash is null; new_hash is the declared SHA-256 of the value', async () => {
    const { put, auditOf } = await boot();

    await put('hash_tenant', { timezone: 'UTC' });

    const rows = auditOf('sys_setting_audit', 'timezone');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'set', old_hash: null, new_hash: sha256Of('UTC'), encrypted: false });
    expect(rows[0].new_hash).toMatch(SHA256_SHAPE);
  });

  it('overwrite: old_hash is the digest of the previous value', async () => {
    const { put, auditOf } = await boot();

    await put('hash_tenant', { timezone: 'UTC' });
    await put('hash_tenant', { timezone: 'Asia/Tokyo' });

    const rows = auditOf('sys_setting_audit', 'timezone');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: 'set', old_hash: sha256Of('UTC'), new_hash: sha256Of('Asia/Tokyo') });
    // The chain reads: each row's old_hash is the row before's new_hash.
    expect(rows[1].old_hash).toBe(rows[0].new_hash);
  });

  it('same-value write: old_hash equals new_hash, so a duplicate write is detectable', async () => {
    const { put, auditOf } = await boot();

    await put('hash_tenant', { timezone: 'Asia/Tokyo' });
    await put('hash_tenant', { timezone: 'Asia/Tokyo' });

    const rows = auditOf('sys_setting_audit', 'timezone');
    expect(rows).toHaveLength(2);
    expect(rows[1].old_hash).toBe(sha256Of('Asia/Tokyo'));
    expect(rows[1].old_hash).toBe(rows[1].new_hash);
  });

  it('set → reset → set: the reset carries the previous digest and no new one; the next set starts from unset', async () => {
    const { put, auditOf } = await boot();

    await put('hash_tenant', { timezone: 'UTC' });
    // A null value is the family's removal: there is no DELETE verb on the
    // settings routes, so this IS the delete.
    await put('hash_tenant', { timezone: null });
    await put('hash_tenant', { timezone: 'Europe/Paris' });

    const rows = auditOf('sys_setting_audit', 'timezone');
    expect(rows.map((r) => r.action)).toEqual(['set', 'reset', 'set']);
    expect(rows[1]).toMatchObject({ old_hash: sha256Of('UTC'), new_hash: null });
    expect(rows[2]).toMatchObject({ old_hash: null, new_hash: sha256Of('Europe/Paris') });
  });
});

describe('#26465 — the previous value is read under the scope the write targets', () => {
  it('a user-scope write reads its OWN previous row, not another user\'s', async () => {
    const { put, auditOf, asUser } = await boot();

    asUser('usr_a');
    await put('hash_user', { theme: 'dark' });
    asUser('usr_b');
    await put('hash_user', { theme: 'light' });
    asUser('usr_a');
    await put('hash_user', { theme: 'light' });

    const rows = auditOf('sys_setting_audit', 'theme');
    expect(rows.map((r) => [r.actor_id, r.old_hash, r.new_hash])).toEqual([
      ['usr_a', null, sha256Of('dark')],
      // usr_b had no value of its own: usr_a's row is not its previous value.
      ['usr_b', null, sha256Of('light')],
      ['usr_a', sha256Of('dark'), sha256Of('light')],
    ]);
  });
});

describe('#26465 — the global rung (sys_platform_setting_audit) records the same hashes', () => {
  it('first set, overwrite and same-value write', async () => {
    const { put, auditOf } = await boot();

    await put('hash_global', { host: 'smtp.example.com' });
    await put('hash_global', { host: 'smtp2.example.com' });
    await put('hash_global', { host: 'smtp2.example.com' });

    const rows = auditOf('sys_platform_setting_audit', 'host');
    expect(rows.map((r) => [r.old_hash, r.new_hash])).toEqual([
      [null, sha256Of('smtp.example.com')],
      [sha256Of('smtp.example.com'), sha256Of('smtp2.example.com')],
      [sha256Of('smtp2.example.com'), sha256Of('smtp2.example.com')],
    ]);
  });
});

/** The unkeyed digests a leak of `value` would carry, for the "never in any row" check. */
const unkeyedOf = (value: string) => [
  sha256Of(value).slice('sha256:'.length),
  createHash('sha256').update(value, 'utf8').digest('hex'),
];
const expectNoUnkeyedDigest = (rows: Record<string, unknown>[], values: string[]) => {
  for (const row of rows) {
    for (const v of values) {
      expect(JSON.stringify(row)).not.toContain(v);
      for (const d of unkeyedOf(v)) expect(JSON.stringify(row)).not.toContain(d);
    }
  }
};

describe('#26534 — a secret value records the keyed digest of its previous value as old_hash', () => {
  it('first write: old_hash null, keyed new_hash', async () => {
    const { put, auditOf } = await boot();

    await put('hash_global', { api_key: 'pw-alpha' });

    const rows = auditOf('sys_platform_setting_audit', 'api_key');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'set', encrypted: true, old_hash: null });
    expect(rows[0].new_hash).toMatch(KEYED_SHAPE);
    expectNoUnkeyedDigest(rows, ['pw-alpha']);
  });

  it('overwrite: old_hash is the previous row\'s keyed new_hash, and no unkeyed digest is anywhere in a row', async () => {
    const { put, auditOf } = await boot();

    await put('hash_global', { api_key: 'pw-alpha' });
    await put('hash_global', { api_key: 'pw-beta' });

    const rows = auditOf('sys_platform_setting_audit', 'api_key');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.encrypted).toBe(true);
      expect(row.new_hash).toMatch(KEYED_SHAPE);
    }
    expect(rows[1].old_hash).toMatch(KEYED_SHAPE);
    expect(rows[1].old_hash).toBe(rows[0].new_hash);
    expect(rows[1].new_hash).not.toBe(rows[1].old_hash);
    expectNoUnkeyedDigest(rows, ['pw-alpha', 'pw-beta']);
  });

  it('same-value rewrite: old_hash equals new_hash, so a rotation that changed nothing is visible', async () => {
    const { put, auditOf } = await boot();

    await put('hash_global', { api_key: 'pw-alpha' });
    await put('hash_global', { api_key: 'pw-alpha' });

    const rows = auditOf('sys_platform_setting_audit', 'api_key');
    expect(rows).toHaveLength(2);
    expect(rows[1].old_hash).toMatch(KEYED_SHAPE);
    expect(rows[1].old_hash).toBe(rows[1].new_hash);
    expect(rows[1].old_hash).toBe(rows[0].new_hash);
    expectNoUnkeyedDigest(rows, ['pw-alpha']);
  });

  it('set → reset → set: the reset carries the previous keyed digest and no new one; the next set starts from unset', async () => {
    const { put, auditOf } = await boot();

    await put('hash_global', { api_key: 'pw-alpha' });
    await put('hash_global', { api_key: null });
    await put('hash_global', { api_key: 'pw-beta' });

    const rows = auditOf('sys_platform_setting_audit', 'api_key');
    expect(rows.map((r) => r.action)).toEqual(['set', 'reset', 'set']);
    expect(rows[1]).toMatchObject({ old_hash: rows[0].new_hash, new_hash: null });
    expect(rows[1].old_hash).toMatch(KEYED_SHAPE);
    expect(rows[2].old_hash).toBeNull();
    expect(rows[2].new_hash).toMatch(KEYED_SHAPE);
    expectNoUnkeyedDigest(rows, ['pw-alpha', 'pw-beta']);
  });

  it('cost: only a secret overwrite pays one more read of the previous handle, and that secret is still reaped after it', async () => {
    /** The reads of the previous handle one overwrite makes, on a fresh boot. */
    const overwriteReads = async (provider?: LocalCryptoProvider) => {
      const { put, auditOf, rowsOf, secretReads, handleOf } = await boot({ cryptoProvider: provider });
      // A non-secret write never touches sys_secret.
      await put('hash_global', { host: 'smtp.example.com' });
      expect(secretReads).toEqual([]);
      // A first write has no previous handle to read: every read is of the
      // handle it just wrote (the response's re-resolve).
      await put('hash_global', { api_key: 'pw-alpha' });
      const first = handleOf('api_key')!;
      expect(first).toMatch(/^sec_/);
      expect(secretReads.every((id) => id === first)).toBe(true);
      secretReads.length = 0;
      await put('hash_global', { api_key: 'pw-beta' });
      // The rotated-away secret is reaped AFTER the old_hash read (#8030).
      expect(rowsOf('sys_secret').has(first)).toBe(false);
      expect(rowsOf('sys_secret').has(handleOf('api_key')!)).toBe(true);
      return {
        reads: secretReads.filter((id) => id === first).length,
        oldHash: auditOf('sys_platform_setting_audit', 'api_key')[1].old_hash,
      };
    };
    // The baseline: with no keyed digest the write skips the old_hash read,
    // and what is left is the read the write path already made before this
    // rule (`validatePatch` resolves the key's current value).
    const unkeyed = new LocalCryptoProvider();
    (unkeyed as any).keyedDigest = undefined;
    const baseline = await overwriteReads(unkeyed);
    const keyed = await overwriteReads();

    expect(baseline.oldHash).toBeNull();
    expect(keyed.oldHash).toMatch(KEYED_SHAPE);
    expect(keyed.reads - baseline.reads).toBe(1);
  });

  it('no keyed digest available: old_hash null like new_hash, and the write lands', async () => {
    const provider = new LocalCryptoProvider();
    (provider as any).keyedDigest = undefined;
    const { put, auditOf, svc } = await boot({ cryptoProvider: provider });

    await put('hash_global', { api_key: 'pw-alpha' });
    await put('hash_global', { api_key: 'pw-beta' });

    const rows = auditOf('sys_platform_setting_audit', 'api_key');
    expect(rows.map((r) => [r.old_hash, r.new_hash])).toEqual([[null, null], [null, null]]);
    expect((await svc.get('hash_global', 'api_key')).value).toBe('pw-beta');
    expectNoUnkeyedDigest(rows, ['pw-alpha', 'pw-beta']);
  });

  it('a previous handle that no longer resolves records old_hash null and the write still lands', async () => {
    const { put, auditOf, rowsOf, handleOf, svc } = await boot();

    await put('hash_global', { api_key: 'pw-alpha' });
    rowsOf('sys_secret').delete(handleOf('api_key')!);
    await put('hash_global', { api_key: 'pw-beta' });

    const rows = auditOf('sys_platform_setting_audit', 'api_key');
    expect(rows).toHaveLength(2);
    expect(rows[1].old_hash).toBeNull();
    expect(rows[1].new_hash).toMatch(KEYED_SHAPE);
    expect((await svc.get('hash_global', 'api_key')).value).toBe('pw-beta');
  });

  it('a key whose manifest changes between non-secret and secret never records an unkeyed digest of a secret', async () => {
    // Not reachable through PUT: `encrypted` is the manifest's, and only a
    // re-registration (a deploy that edits the manifest) changes it.
    const { put, auditOf, svc } = await boot();
    const asSecret = (secret: boolean): SettingsManifest => ({
      ...GLOBAL_MANIFEST,
      specifiers: [
        secret
          ? { type: 'password', key: 'host', label: 'Host', required: false, encrypted: true }
          : { type: 'text', key: 'host', label: 'Host', required: false },
      ],
    });

    await put('hash_global', { host: 'plain-value' });
    svc.registerManifest(asSecret(true));
    await put('hash_global', { host: 'secret-value' });
    svc.registerManifest(asSecret(false));
    await put('hash_global', { host: 'plain-again' });

    const rows = auditOf('sys_platform_setting_audit', 'host');
    expect(rows.map((r) => r.encrypted)).toEqual([false, true, false]);
    // non-secret → secret: the previous row held no secret, so no keyed digest of it.
    expect(rows[1].old_hash).toBeNull();
    expect(rows[1].new_hash).toMatch(KEYED_SHAPE);
    // secret → non-secret: the previous value was a secret, so no unkeyed digest of it.
    expect(rows[2].old_hash).toBeNull();
    expect(rows[2].new_hash).toBe(sha256Of('plain-again'));
    expectNoUnkeyedDigest(rows, ['secret-value']);
  });
});
