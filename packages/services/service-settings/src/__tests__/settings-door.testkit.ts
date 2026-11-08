// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding: a settings door over the real `ObjectQL` engine, the real
 * platform setting objects and the real `PUT /api/settings/:namespace` route,
 * with a Map driver underneath. Shared by the door suites that judge a value
 * shape end to end (#31241 `json`, #30208 `map`).
 */

import { vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SysPlatformSetting, SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { IHttpServer, IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from '../settings-service.js';
import { SettingsServicePlugin, wrapEngineAsSettingsEngine } from '../settings-service-plugin.js';
import { withEngineRegistry } from './settings-organization.testkit.js';
import { LocalCryptoProvider } from '../local-crypto-provider.js';
import { registerSettingsRoutes } from '../settings-routes.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-door';

/** A driver over plain Maps — the verbs the settings path reaches through `ObjectQL`. */
export function makeMemoryDriver() {
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

export class MockHttp implements IHttpServer {
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

/**
 * The pieces the running server binds: the real `ObjectQL` engine over a Map
 * driver, the platform setting objects, a `SettingsService` with `manifest`
 * registered, and the settings routes. `before` runs on the service before the
 * manifest registers (an option source, as a plugin registers one).
 */
export async function bootSettingsDoor(
  manifest: SettingsManifest,
  options: { before?: (svc: SettingsService) => void } = {},
) {
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
  options.before?.(svc);
  svc.registerManifest(manifest);
  const http = new MockHttp();
  registerSettingsRoutes(http, svc, {
    contextFromRequest: () => ({ enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' }),
  });
  const put = http.routes.get('PUT /api/settings/:namespace')!;
  const namespace = manifest.namespace;
  /** One `PUT /api/settings/:namespace` with `body`, as the console sends it (a flat patch). */
  const save = async (body: Record<string, unknown>) => {
    const req: IHttpRequest = { params: { namespace }, query: {}, body, headers: {}, method: 'PUT', path: '/' };
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
    [...rowsOf('sys_platform_setting').values()].find((r) => r.namespace === namespace && r.key === key);
  const seed = (row: Record<string, unknown>) =>
    rowsOf('sys_platform_setting').set(String(row.id), { encrypted: false, locked: false, value_enc: null, ...row });
  return { svc, save, stored, seed };
}
