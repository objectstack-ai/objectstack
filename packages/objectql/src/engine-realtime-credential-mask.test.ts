// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `data.record.*` event is an external exit of the write it describes: its
 * subscribers store or forward the record bodies (`after`, `changes`) to
 * readers below the write boundary. So both bodies carry what a write
 * RESPONSE carries — credential-class fields masked, `internal: true` fields
 * omitted, by the one helper every write response uses — while the engine's
 * own write result, read by privileged in-process callers, stays whole.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { SECRET_MASK } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const CREDENTIAL = 'synthetic-credential-7c1e';
const INTERNAL = 'synthetic-internal-0b42';

const widget = {
  name: 'widget',
  label: 'Widget',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    passphrase: { name: 'passphrase', type: 'password' as const },
    lookup_digest: { name: 'lookup_digest', type: 'text' as const, internal: true },
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

describe('record-change event bodies apply the write-response non-exposure rules', () => {
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
    engine.registry.registerObject(widget);
    engine.setRealtimeService(realtime);
    vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn((engine as any).logger, 'debug').mockImplementation(() => undefined);
  });

  it('a create event masks the credential field and omits the internal field from `after`', async () => {
    await engine.insert('widget', { id: 'w1', title: 'One', passphrase: CREDENTIAL, lookup_digest: INTERNAL });
    expect(published).toHaveLength(1);
    const payload = published[0].payload as Record<string, any>;
    expect(payload.type).toBe('data.record.created');
    expect(payload.after.title).toBe('One');
    expect(payload.after.passphrase).toBe(SECRET_MASK);
    expect('lookup_digest' in payload.after).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(payload)).not.toContain(INTERNAL);
  });

  it('an update event projects both `after` and `changes`', async () => {
    await engine.insert('widget', { id: 'w2', title: 'Two', passphrase: 'first', lookup_digest: 'first' });
    published.length = 0;
    await engine.update('widget', { id: 'w2', title: 'Two b', passphrase: CREDENTIAL, lookup_digest: INTERNAL });
    expect(published).toHaveLength(1);
    const payload = published[0].payload as Record<string, any>;
    expect(payload.type).toBe('data.record.updated');
    expect(payload.changes.title).toBe('Two b');
    expect(payload.changes.passphrase).toBe(SECRET_MASK);
    expect('lookup_digest' in payload.changes).toBe(false);
    expect(payload.after.passphrase).toBe(SECRET_MASK);
    expect('lookup_digest' in payload.after).toBe(false);
    expect(JSON.stringify(payload)).not.toContain(CREDENTIAL);
    expect(JSON.stringify(payload)).not.toContain(INTERNAL);
  });

  it('an unset credential field rides the event as null, not as the mask', async () => {
    await engine.insert('widget', { id: 'w3', title: 'Three', passphrase: null });
    const payload = published[0].payload as Record<string, any>;
    expect(payload.after.passphrase).toBeNull();
  });

  it("the engine's own write result is unchanged for the privileged in-process caller", async () => {
    const created = await engine.insert('widget', {
      id: 'w4', title: 'Four', passphrase: CREDENTIAL, lookup_digest: INTERNAL,
    }) as Record<string, unknown>;
    expect(created.passphrase).toBe(CREDENTIAL);
    expect(created.lookup_digest).toBe(INTERNAL);

    const updated = await engine.update('widget', { id: 'w4', lookup_digest: `${INTERNAL}-b` }) as Record<string, unknown>;
    expect(updated.passphrase).toBe(CREDENTIAL);
    expect(updated.lookup_digest).toBe(`${INTERNAL}-b`);
    // ...while the events those writes published carried neither value.
    expect(JSON.stringify(published.map((e) => e.payload))).not.toContain(CREDENTIAL);
    expect(JSON.stringify(published.map((e) => e.payload))).not.toContain(INTERNAL);
  });
});
