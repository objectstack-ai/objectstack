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
 * A secret-valued key is the CONTROL: its keyed fingerprint path
 * (`hmac-sha256:…`, `secretAuditDigest`) is untouched, so its rows keep a null
 * `old_hash` and a keyed `new_hash`.
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
async function boot() {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysPlatformSetting, SysSecret, SysSettingAudit, SysPlatformSettingAudit]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  const svc = new SettingsService({
    env: {},
    engine: withEngineRegistry(wrapEngineAsSettingsEngine(engine as any), engine),
    cryptoProvider: new LocalCryptoProvider(),
    secretStore: (new SettingsServicePlugin() as any).buildSecretStore(engine),
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

  return { put, auditOf, asUser: (id: string) => { userId = id; } };
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

  it('CONTROL — a secret value keeps its keyed path: keyed new_hash, null old_hash, no unkeyed digest anywhere', async () => {
    const { put, auditOf } = await boot();

    await put('hash_global', { api_key: 'pw-alpha' });
    await put('hash_global', { api_key: 'pw-beta' });

    const rows = auditOf('sys_platform_setting_audit', 'api_key');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.encrypted).toBe(true);
      expect(row.old_hash).toBeNull();
      expect(row.new_hash).toMatch(KEYED_SHAPE);
    }
    expect(rows[1].new_hash).not.toBe(rows[0].new_hash);
    const unkeyed = [sha256Of('pw-alpha'), sha256Of('pw-beta'), 'sha256:' + createHash('sha256').update('pw-alpha').digest('hex')];
    for (const row of rows) for (const d of unkeyed) expect(JSON.stringify(row)).not.toContain(d.slice('sha256:'.length));
  });
});
