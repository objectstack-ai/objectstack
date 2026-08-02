// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4626 — the ObjectQL engine publishes TRUE `DataEvent`s (contract-first).
 *
 * `@objectstack/spec/api`'s `DataEvent` is the declared contract for realtime
 * record changes: top-level `id` (uuid), `type`, `object`, `recordId`
 * (REQUIRED), `changes?`, `before?`, `after?`, `userId?`, `timestamp`. Before
 * this fix the engine published a bare `RealtimeEventPayload` envelope with
 * `{ recordId, after, changes }` nested under `payload` and never generated
 * `id`/`userId` — so every `subscribeData` subscriber that wrote
 * `event.recordId` / `event.changes` (exactly what the types promised) read
 * `undefined` at runtime.
 *
 * These tests pin the producer half of the contract:
 *  - the transport envelope's `payload` IS a schema-valid `DataEvent`;
 *  - a batch insert publishes one event PER RECORD, with unique ids;
 *  - `userId` is carried when the execution context names an actor;
 *  - a multi-row write (`updateMany`/`deleteMany` → affected count) publishes
 *    NOTHING, loudly — it has no per-record identity, and `recordId` is
 *    required, so the pre-fix fabrication (`recordId: ''`, `after: <count>`)
 *    is not replaced by another one;
 *  - a publish failure never fails the write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DataEventSchema } from '@objectstack/spec/api';
import type { IRealtimeService, RealtimeEventPayload } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const task = {
  name: 'task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    title: { name: 'title', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
  },
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
    findStream() { throw new Error('ns'); },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
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
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    // The driver contract returns an AFFECTED COUNT for the bulk verbs — the
    // reason a multi-row write can name no record (see the pins below).
    async updateMany(o: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).set(r.id as string, { ...r, ...data });
      return rows.length;
    },
    async deleteMany(o: string, ast: any) {
      const rows = await this.find(o, ast);
      for (const r of rows) storeFor(o).delete(r.id as string);
      return rows.length;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

describe('#4626 — engine writes publish true DataEvents', () => {
  let engine: ObjectQL;
  let published: RealtimeEventPayload[];
  let realtime: IRealtimeService;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    published = [];
    realtime = {
      publish: vi.fn(async (event: RealtimeEventPayload) => { published.push(event); }),
      subscribe: vi.fn(async () => 'sub-1'),
      unsubscribe: vi.fn(async () => undefined),
    };
    engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(task as any);
    engine.setRealtimeService(realtime);
    warn = vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('insert publishes an envelope whose payload IS a schema-valid DataEvent', async () => {
    const record = await engine.insert('task', { title: 'Write the pin' });

    expect(published).toHaveLength(1);
    const envelope = published[0];

    // The transport envelope keeps its shape — nothing else on the wire moves.
    expect(envelope.type).toBe('data.record.created');
    expect(envelope.object).toBe('task');
    expect(typeof envelope.timestamp).toBe('string');

    // The payload is the full DataEvent — parsed with the SPEC schema, not a
    // hand-rolled shape, so this pin fails the moment either side drifts.
    const event = DataEventSchema.parse(envelope.payload);
    expect(event.id).toMatch(UUID_RE);
    expect(event.type).toBe('data.record.created');
    expect(event.object).toBe('task');
    expect(event.recordId).toBe(record.id);
    expect(event.after).toMatchObject({ id: record.id, title: 'Write the pin' });
    expect(event.changes).toBeUndefined();
    expect(event.timestamp).toBe(envelope.timestamp);
  });

  it('a batch insert publishes ONE event per record, each with its own uuid', async () => {
    await engine.insert('task', [{ title: 'a' }, { title: 'b' }, { title: 'c' }]);

    expect(published).toHaveLength(3);
    const events = published.map((e) => DataEventSchema.parse(e.payload));
    expect(events.map((e) => (e.after as any).title)).toEqual(['a', 'b', 'c']);
    expect(events.every((e) => e.type === 'data.record.created')).toBe(true);
    expect(events.every((e) => UUID_RE.test(e.id))).toBe(true);
    expect(new Set(events.map((e) => e.id)).size).toBe(3);
    expect(new Set(events.map((e) => e.recordId)).size).toBe(3);
  });

  it('update publishes changes AND recordId at the TOP LEVEL (the #4626 defect)', async () => {
    const record = await engine.insert('task', { title: 'v1', status: 'open' });
    published.length = 0;

    await engine.update('task', { id: record.id, status: 'done' });

    expect(published).toHaveLength(1);
    const event = DataEventSchema.parse(published[0].payload);
    expect(event.type).toBe('data.record.updated');
    // Pre-fix these were `undefined` on what the subscriber received.
    expect(event.recordId).toBe(record.id);
    expect(event.changes).toMatchObject({ status: 'done' });
    expect(event.after).toMatchObject({ id: record.id, status: 'done', title: 'v1' });
    expect(event.id).toMatch(UUID_RE);
  });

  it('delete publishes a schema-valid event with recordId and no after', async () => {
    const record = await engine.insert('task', { title: 'gone' });
    published.length = 0;

    await engine.delete('task', { where: { id: record.id } } as any);

    expect(published).toHaveLength(1);
    const event = DataEventSchema.parse(published[0].payload);
    expect(event.type).toBe('data.record.deleted');
    expect(event.recordId).toBe(record.id);
    expect(event.after).toBeUndefined();
    expect(event.changes).toBeUndefined();
  });

  it('carries userId when the execution context names an actor', async () => {
    const record = await engine.insert('task', { title: 'mine' }, { context: { userId: 'usr_123' } } as any);
    const created = DataEventSchema.parse(published[0].payload);
    expect(created.userId).toBe('usr_123');

    published.length = 0;
    await engine.update('task', { id: record.id, title: 'edited' }, { context: { userId: 'usr_456' } } as any);
    expect(DataEventSchema.parse(published[0].payload).userId).toBe('usr_456');
  });

  it('omits userId for system-initiated writes (no actor known)', async () => {
    await engine.insert('task', { title: 'boot' });
    expect(DataEventSchema.parse(published[0].payload).userId).toBeUndefined();
  });

  it('publishes NOTHING for a multi-row update — and says so', async () => {
    await engine.insert('task', [{ title: 'a', status: 'open' }, { title: 'b', status: 'open' }]);
    published.length = 0;
    warn.mockClear();

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'open' } } as any);

    // `updateMany` returns an affected COUNT: there is no record to name, and
    // `DataEvent.recordId` is required. Pre-fix this published one event with
    // `recordId: ''` and `after: 2` — an event every compliant consumer must
    // reject. Absence is loud, not silent.
    expect(published).toHaveLength(0);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('data.record.updated');
    expect(logged).toContain('#4626');
  });

  it('publishes NOTHING for a multi-row delete — and says so', async () => {
    await engine.insert('task', [{ title: 'a', status: 'stale' }, { title: 'b', status: 'stale' }]);
    published.length = 0;
    warn.mockClear();

    await engine.delete('task', { multi: true, where: { status: 'stale' } } as any);

    expect(published).toHaveLength(0);
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('data.record.deleted');
  });

  it('a publish failure never fails the write itself', async () => {
    (realtime.publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('transport down'));

    const record = await engine.insert('task', { title: 'still written' });
    expect(record.id).toBeTruthy();
    expect(await engine.findOne('task', { where: { id: record.id } })).toMatchObject({ title: 'still written' });
  });

  it('publishes nothing at all when no realtime service is configured', async () => {
    const bare = new ObjectQL();
    const { driver } = makeMemoryDriver();
    bare.registerDriver(driver, true);
    await bare.init();
    bare.registry.registerObject(task as any);

    await expect(bare.insert('task', { title: 'no realtime' })).resolves.toBeTruthy();
    expect(published).toHaveLength(0);
  });
});
