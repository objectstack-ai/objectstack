// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21120] A `data.record.*` realtime event is a stored-metadata-body READ EXIT:
 * a subscriber receives the written row in `after` (and the input patch in
 * `changes`). For `sys_metadata` / `sys_metadata_history` that row's `metadata`
 * column is a serialized metadata body — a datasource body's credential material
 * included — so the event must project it through the shared redactor, exactly
 * as `/meta` and the generic data door do. These pins hold that.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

const CRED = 'event-cred-a91f';
const datasourceBody = (cred = CRED) =>
  JSON.stringify({ name: 'ds', driver: 'turso', config: { url: 'libsql://db.turso.io', encryptionKey: cred } });

const sysMetadata = {
  name: 'sys_metadata',
  label: 'System Metadata',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    type: { name: 'type', type: 'text' as const },
    name: { name: 'name', type: 'text' as const },
    metadata: { name: 'metadata', type: 'textarea' as const },
  },
};

const task = {
  name: 'task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    metadata: { name: 'metadata', type: 'textarea' as const },
  },
};

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string) { return Array.from(storeFor(o).values()); },
    findStream() { throw new Error('ns'); },
    async findOne(o: string, ast: any) {
      const where = ast?.where ?? {};
      for (const r of storeFor(o).values()) {
        if (Object.entries(where).every(([k, v]) => k.startsWith('$') || (r[k] ?? null) === ((v as any)?.$eq ?? v ?? null))) return r;
      }
      return null;
    },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id);
      if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string) { return (await this.find(o)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async updateMany() { return 0; }, async deleteMany() { return 0; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async upsert(o: string, data: Record<string, unknown>) { return this.create(o, data); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver };
}

describe('[#21120] realtime data.record.* events redact a stored metadata body', () => {
  let engine: ObjectQL;
  let published: RealtimeEventPayload[];

  beforeEach(async () => {
    published = [];
    const realtime: IRealtimeService = {
      publish: vi.fn(async (event: RealtimeEventPayload) => { published.push(event); }),
      subscribe: vi.fn(async () => 'sub-1'),
      unsubscribe: vi.fn(async () => undefined),
    };
    engine = new ObjectQL();
    const { driver } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadata);
    engine.registry.registerObject(task);
    engine.setRealtimeService(realtime);
    vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn((engine as any).logger, 'debug').mockImplementation(() => undefined);
  });

  it('a sys_metadata insert event withholds the stored credential from `after`', async () => {
    await engine.insert('sys_metadata', { id: 'm1', type: 'datasource', name: 'ds', metadata: datasourceBody() });
    expect(published).toHaveLength(1);
    const payload = published[0].payload as Record<string, any>;
    expect(JSON.stringify(payload)).not.toContain(CRED);
    // The event still describes the row — type survives, the body is still present but projected.
    expect(payload.after.type).toBe('datasource');
    expect(payload.after.metadata).toBeDefined();
    expect(JSON.parse(payload.after.metadata).config.encryptionKey).toBeUndefined();
    expect(JSON.parse(payload.after.metadata).config.url).toBe('libsql://db.turso.io');
  });

  it('a credential-free sys_metadata body rides the event unchanged', async () => {
    const clean = JSON.stringify({ name: 'v', driver: 'postgres', config: { host: 'h', database: 'd' } });
    await engine.insert('sys_metadata', { id: 'm2', type: 'datasource', name: 'v', metadata: clean });
    const payload = published[0].payload as Record<string, any>;
    expect(payload.after.metadata).toBe(clean);
  });

  it('an ordinary object with a metadata column is untouched (outside the family)', async () => {
    await engine.insert('task', { id: 't1', title: 'x', metadata: datasourceBody() });
    const payload = published[0].payload as Record<string, any>;
    // task is not a stored-metadata-body object — its column is served as stored.
    expect(payload.after.metadata).toBe(datasourceBody());
  });

  it('an update event redacts the body in `after` and `changes`', async () => {
    await engine.insert('sys_metadata', { id: 'm3', type: 'datasource', name: 'ds', metadata: '{}' });
    published.length = 0;
    await engine.update('sys_metadata', { id: 'm3', metadata: datasourceBody() });
    expect(published).toHaveLength(1);
    const payload = published[0].payload as Record<string, any>;
    expect(JSON.stringify(payload)).not.toContain(CRED);
  });
});
