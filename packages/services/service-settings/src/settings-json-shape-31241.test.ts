// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31241] A `json` setting persists a JSON object or array (ADR-0007:
 * `json` | code editor | object), at both doors.
 *
 * The console's `json` field sent the textarea's TEXT, and the save door
 * stored it: `PUT /api/settings/lifecycle` with `{ quotas: "{ … }" }` answered
 * 200 and `sys_platform_setting.value` held a string, so the lifecycle sweep
 * read every quota as absent. Pinned here over the real `ObjectQL` engine, the
 * real platform setting objects and the real route, with the shipped
 * `lifecycleSettingsManifest` (the only `json` specifiers in the platform):
 *
 *  - the save door refuses a string — and any other non-object — for a `json`
 *    key with one `invalid_type` `FieldError`, and stores nothing;
 *  - an object, an array and a clear (`null`) are accepted;
 *  - a string already stored under one `json` key does not block a save that
 *    does not touch it (the door judges only what it is handed);
 *  - the env door (`OS_LIFECYCLE_*`) rejects text that does not parse to an
 *    object or array, with one `error` line, and the key resolves from the next
 *    layer; JSON text of an object is in force.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL, lifecycleSettingsManifest } from '@objectstack/objectql';
import { SysPlatformSetting, SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin, wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { withEngineRegistry } from './__tests__/settings-organization.testkit.js';
import { LocalCryptoProvider } from './local-crypto-provider.js';
import { registerSettingsRoutes } from './settings-routes.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-json-shape';

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

class MockHttp implements IHttpServer {
  routes = new Map<string, RouteHandler>();
  private add(method: string, path: string, h: RouteHandler) { this.routes.set(`${method} ${path}`, h); }
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

/** The pieces the running server binds, with the shipped lifecycle manifest and the settings routes. */
async function boot() {
  const engine = new ObjectQL();
  const { driver, rowsOf } = makeMemoryDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysPlatformSetting, SysSecret]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  const svc = new SettingsService({
    env: {},
    engine: withEngineRegistry(wrapEngineAsSettingsEngine(engine as any), engine),
    cryptoProvider: new LocalCryptoProvider(),
    secretStore: (new SettingsServicePlugin() as any).buildSecretStore(engine),
  });
  svc.registerManifest(lifecycleSettingsManifest);
  const http = new MockHttp();
  registerSettingsRoutes(http, svc, {
    contextFromRequest: () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' }),
  });
  const put = http.routes.get('PUT /api/settings/:namespace')!;
  /** One `PUT /api/settings/lifecycle` with `body`, as the console sends it (a flat patch). */
  const save = async (body: Record<string, unknown>) => {
    const req: IHttpRequest = { params: { namespace: 'lifecycle' }, query: {}, body, headers: {}, method: 'PUT', path: '/' };
    const state: { status: number; body?: any } = { status: 200 };
    const res: IHttpResponse = {
      json: vi.fn((d) => { state.body = d; }) as any,
      send: vi.fn() as any,
      status: vi.fn((c: number) => { state.status = c; return res; }) as any,
      header: vi.fn(() => res) as any,
    };
    await put(req, res);
    return state;
  };
  const stored = (key: string) =>
    [...rowsOf('sys_platform_setting').values()].find((r) => r.namespace === 'lifecycle' && r.key === key);
  const seed = (row: Record<string, unknown>) =>
    rowsOf('sys_platform_setting').set(String(row.id), { encrypted: false, locked: false, value_enc: null, ...row });
  return { svc, save, stored, seed };
}

describe('[#31241] the save door: a `json` key takes a JSON object or array', () => {
  it('refuses the JSON text the old console sent: 400, one invalid_type FieldError per key, nothing stored', async () => {
    const { save, stored } = await boot();

    const st = await save({
      quotas: '{\n  "sys_audit_log": 1000\n}',
      quota_defaults: '{\n  "telemetry": 500\n}',
    });

    expect(st.status).toBe(400);
    expect(st.body.error.code).toBe('SETTINGS_VALIDATION');
    const fields = st.body.error.details.fields as Array<Record<string, unknown>>;
    expect(fields.map((f) => [f.field, f.code])).toEqual([
      ['quotas', 'invalid_type'],
      ['quota_defaults', 'invalid_type'],
    ]);
    expect(fields[0].constraint).toEqual({ type: 'json' });
    expect(fields[0].message).toBe(
      'Row quotas must be a JSON object or array, not a string of 27 characters. Send the parsed value, not its JSON text.',
    );
    // The message names what to send, never the value.
    expect(JSON.stringify(fields)).not.toContain('sys_audit_log');
    expect(stored('quotas')).toBeUndefined();
    expect(stored('quota_defaults')).toBeUndefined();
  });

  it('refuses every other non-object: a number, a boolean, a blank string', async () => {
    const { save, stored } = await boot();

    const st = await save({ quotas: 5, quota_defaults: true, retention_overrides: '' });

    expect(st.status).toBe(400);
    const fields = st.body.error.details.fields as Array<Record<string, unknown>>;
    expect(fields.map((f) => [f.field, f.code])).toEqual([
      ['retention_overrides', 'invalid_type'],
      ['quotas', 'invalid_type'],
      ['quota_defaults', 'invalid_type'],
    ]);
    expect(stored('quotas')).toBeUndefined();
  });

  it('CONTROL: stores an object and an array as themselves', async () => {
    const { svc, save, stored } = await boot();

    const st = await save({ quotas: { sys_audit_log: 1000 }, quota_defaults: [] });

    expect(st.status).toBe(200);
    expect(stored('quotas')?.value).toEqual({ sys_audit_log: 1000 });
    expect(stored('quota_defaults')?.value).toEqual([]);
    const got = await svc.get('lifecycle', 'quotas');
    expect(got.value).toEqual({ sys_audit_log: 1000 });
    expect(got.source).toBe('global');
  });

  it('accepts a clear (null): the key falls back to its default', async () => {
    const { svc, save } = await boot();
    await save({ quotas: { sys_audit_log: 1000 } });

    const st = await save({ quotas: null });

    expect(st.status).toBe(200);
    expect((await svc.get('lifecycle', 'quotas')).value).toEqual({});
  });

  it('a string already stored under one json key does not block a save that does not touch it', async () => {
    const { svc, save, seed } = await boot();
    seed({ id: 'legacy', namespace: 'lifecycle', key: 'quota_defaults', value: '{"telemetry": 500}' });

    const st = await save({ growth_alert_rows: 10 });

    expect(st.status).toBe(200);
    expect((await svc.get('lifecycle', 'growth_alert_rows')).value).toBe(10);
  });
});

describe('[#31241] the env door judges a `json` key the same way', () => {
  const envService = (value: string) => {
    const errors: string[] = [];
    const svc = new SettingsService({
      env: { OS_LIFECYCLE_QUOTAS: value },
      logger: { error: (m: string) => void errors.push(m), warn: () => {} } as any,
    });
    svc.registerManifest(lifecycleSettingsManifest);
    return { svc, errors };
  };

  it('CONTROL: JSON text of an object is in force, as the object', async () => {
    const { svc, errors } = envService('{"sys_audit_log": 1000}');

    const got = await svc.get('lifecycle', 'quotas');

    expect(got.value).toEqual({ sys_audit_log: 1000 });
    expect(got.source).toBe('env');
    expect(errors).toEqual([]);
  });

  it('text that does not parse is not in force: the key resolves from the next layer, with one error line', async () => {
    const { svc, errors } = envService('{"sys_audit_log": 1000');

    const got = await svc.get('lifecycle', 'quotas');
    await svc.get('lifecycle', 'quotas');

    expect(got.value).toEqual({});
    expect(got.source).not.toBe('env');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OS_LIFECYCLE_QUOTAS');
    expect(errors[0]).toContain("is not a JSON object or array, which its type 'json' declares");
    expect(errors[0]).toContain('a string of 22 characters');
    expect(errors[0]).not.toContain('sys_audit_log');
  });

  it('text that parses to a scalar is not in force either', async () => {
    const { svc, errors } = envService('5');

    const got = await svc.get('lifecycle', 'quotas');

    expect(got.value).toEqual({});
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('a number');
  });
});
