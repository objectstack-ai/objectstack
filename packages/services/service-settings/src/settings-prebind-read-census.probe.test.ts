// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// CENSUS PROBE for #10250 — NOT a shipped pin. Measures whether a settings READ
// issued from a `kernel:ready` hook registered by a plugin that loads BEFORE
// SettingsServicePlugin resolves to the manifest default while a DIFFERENT value
// sits persisted in `sys_setting`.

import { describe, expect, it } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { SettingsManifest } from '@objectstack/spec/system';
import { SettingsService } from './settings-service.js';
import { SettingsServicePlugin } from './settings-service-plugin.js';

const OWNER_PACKAGE = 'com.objectstack.test.census-10250';

const probeManifest: SettingsManifest = {
  namespace: 'receipt_probe',
  version: 1,
  label: 'Receipt probe',
  scope: 'global',
  specifiers: [
    { type: 'text', key: 'last_run', label: 'Last run', required: false, default: 'MANIFEST-DEFAULT' },
  ],
};

function makeMemoryDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let nextId = 0;
  const copy = (r: Record<string, unknown>) => ({ ...r });
  const rowsOf = (object: string) => {
    let s = store.get(object);
    if (!s) { s = new Map(); store.set(object, s); }
    return s;
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return (row[k] ?? null) === (v ?? null);
    });
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(o: string, ast: any) {
      return [...rowsOf(o).values()].filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(o: string, ast: any) {
      for (const r of rowsOf(o).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `row_${nextId}`;
      const row = { ...data, id };
      rowsOf(o).set(id, row);
      return copy(row);
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = rowsOf(o); const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id }; s.set(id, next); return copy(next);
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && rowsOf(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return rowsOf(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast); const s = rowsOf(o);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = await this.find(o, ast);
      for (const r of rows) rowsOf(o).delete(r.id as string);
      return rows.length;
    },
    async syncSchema() {}, async dropTable() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rowsOf };
}

class EnginePlugin implements Plugin {
  name = 'com.objectstack.engine.objectql';
  version = '0.0.0';
  type = 'standard' as const;
  providesServices = ['objectql'];
  constructor(private readonly engine: ObjectQL) {}
  init = async (ctx: PluginContext) => { ctx.registerService('objectql', this.engine); };
}

interface Reading { engineBound?: boolean; value?: string }

/**
 * Shaped EXACTLY like the shipped readers (plugin-email / service-sms /
 * service-storage): a `kernel:ready` hook registered from `start()`, reading a
 * settings namespace. No dependency is declared on the settings plugin —
 * matching the shipped classes, none of which declares one.
 */
class ReaderPlugin implements Plugin {
  version = '0.0.0';
  type = 'standard' as const;
  readonly observed: Reading = {};
  constructor(public name: string) {}
  async init(_ctx: PluginContext): Promise<void> { /* registers nothing */ }
  async start(ctx: PluginContext): Promise<void> {
    ctx.hook('kernel:ready', async () => {
      let svc: SettingsService | undefined;
      try { svc = ctx.getService<SettingsService>('settings'); } catch { return; }
      if (!svc) return;
      this.observed.engineBound = Boolean((svc as unknown as { engine?: unknown }).engine);
      const r = await svc.get<string>('receipt_probe', 'last_run');
      this.observed.value = String(r.value);
    });
  }
}

async function boot(readerFirst: boolean) {
  const { driver, rowsOf } = makeMemoryDriver();
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [SysSetting, SysSecret]) engine.registry.registerObject(o as any, OWNER_PACKAGE);

  // A REAL persisted row — what an operator saved through Setup → Settings on a
  // previous run. Any read that reaches the engine must return THIS.
  rowsOf('sys_setting').set('seeded', {
    id: 'seeded', namespace: 'receipt_probe', key: 'last_run', scope: 'global',
    user_id: null, value: 'PERSISTED-ROW', value_enc: null, encrypted: false,
    locked: false, locked_reason: null, updated_at: new Date().toISOString(), updated_by: null,
  });

  const reader = new ReaderPlugin('com.objectstack.test.reader');
  const settings = new SettingsServicePlugin({
    registerRoutes: false, manifests: [probeManifest], actionHandlers: {},
  });
  const kernel = new LiteKernel({ logger: { level: 'error' } as never });
  kernel.use(new EnginePlugin(engine));
  // The ONLY difference between the two runs: which of these two lines is first.
  if (readerFirst) { kernel.use(reader); kernel.use(settings); }
  else { kernel.use(settings); kernel.use(reader); }
  await kernel.bootstrap();
  return { reader, kernel };
}

describe('#10250 census — a settings read from a plugin loaded before SettingsServicePlugin', () => {
  it('READER FIRST: reads the manifest default while the persisted row says otherwise', async () => {
    const { reader } = await boot(true);
    process.stderr.write('[CENSUS reader-first ] ' + JSON.stringify(reader.observed) + '\n');
    expect(reader.observed.engineBound).toBe(false);
    expect(reader.observed.value).toBe('MANIFEST-DEFAULT');
  });

  it('POSITIVE CONTROL — SETTINGS FIRST: the same reader reads the persisted row', async () => {
    const { reader } = await boot(false);
    process.stderr.write('[CENSUS settings-first] ' + JSON.stringify(reader.observed) + '\n');
    expect(reader.observed.engineBound).toBe(true);
    expect(reader.observed.value).toBe('PERSISTED-ROW');
  });
});
