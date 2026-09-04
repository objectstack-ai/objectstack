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
 *  - a multi-row write publishes no PER-RECORD event — it has no per-record
 *    identity, and `recordId` is required, so the pre-fix fabrication
 *    (`recordId: ''`, `after: <count>`) is not replaced by another one;
 *  - a publish failure never fails the write.
 *
 * #4639 then gave the multi-row case its own honest contract rather than
 * leaving it silent — see the second describe block: `data.records.updated` /
 * `data.records.deleted`, carrying `matched` and NO `recordId`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BulkDataEventSchema, DataEventSchema } from '@objectstack/spec/api';
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

function makeStubDriver() {
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
    const { driver } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(task);
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

  it('a publish failure never fails the write itself', async () => {
    (realtime.publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('transport down'));

    const record = await engine.insert('task', { title: 'still written' });
    expect(record.id).toBeTruthy();
    expect(await engine.findOne('task', { where: { id: record.id } })).toMatchObject({ title: 'still written' });
  });

  it('publishes nothing at all when no realtime service is configured', async () => {
    const bare = new ObjectQL();
    const { driver } = makeStubDriver();
    bare.registerDriver(driver, true);
    await bare.init();
    bare.registry.registerObject(task);

    await expect(bare.insert('task', { title: 'no realtime' })).resolves.toBeTruthy();
    expect(published).toHaveLength(0);
  });
});

/**
 * #4639 — a predicate write gets its OWN contract instead of impersonating a
 * per-record one.
 *
 * `IDataDriver.updateMany`/`deleteMany` resolve an affected COUNT, so a
 * `multi: true` write can satisfy neither `DataEvent.recordId` (required) nor
 * any of `before`/`after`/`changes`. #4626 correctly refused to fabricate one
 * and published nothing — honest, but it meant webhooks, knowledge sync and
 * `subscribeData` all went silent when a predicate write emptied half a table.
 *
 * These pin the third option: `data.records.updated` / `data.records.deleted`,
 * an aggregate event that states the count and claims nothing else.
 */
describe('#4639 — predicate writes publish aggregate BulkDataEvents', () => {
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
    const { driver } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(task);
    engine.setRealtimeService(realtime);
    warn = vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('a multi-row update publishes ONE schema-valid data.records.updated', async () => {
    await engine.insert('task', [{ title: 'a', status: 'open' }, { title: 'b', status: 'open' }]);
    published.length = 0;

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'open' } } as any);

    expect(published).toHaveLength(1);
    const envelope = published[0];
    expect(envelope.type).toBe('data.records.updated');
    expect(envelope.object).toBe('task');

    const event = BulkDataEventSchema.parse(envelope.payload);
    expect(event.id).toMatch(UUID_RE);
    expect(event.type).toBe('data.records.updated');
    expect(event.object).toBe('task');
    expect(event.matched).toBe(2);
    expect(event.timestamp).toBe(envelope.timestamp);
  });

  it('a multi-row delete publishes ONE schema-valid data.records.deleted', async () => {
    await engine.insert('task', [{ title: 'a', status: 'stale' }, { title: 'b', status: 'stale' }, { title: 'c', status: 'live' }]);
    published.length = 0;

    await engine.delete('task', { multi: true, where: { status: 'stale' } } as any);

    expect(published).toHaveLength(1);
    const event = BulkDataEventSchema.parse(published[0].payload);
    expect(event.type).toBe('data.records.deleted');
    expect(event.matched).toBe(2);
  });

  it('a bulk event is NOT a DataEvent — it cannot be mistaken for a per-record one', async () => {
    await engine.insert('task', [{ title: 'a', status: 'open' }]);
    published.length = 0;

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'open' } } as any);

    // The whole point of a separate type: a consumer validating against the
    // per-record contract REJECTS this rather than reading `recordId` as an
    // empty string (the pre-#4626 fabrication) or as `undefined` (what a
    // widened `DataEvent` would have given it).
    const payload = published[0].payload as Record<string, unknown>;
    expect(DataEventSchema.safeParse(payload).success).toBe(false);
    expect(payload.recordId).toBeUndefined();
    expect(payload.after).toBeUndefined();
    expect(payload.changes).toBeUndefined();
  });

  it('does NOT carry the query predicate (it embeds composed security scoping)', async () => {
    await engine.insert('task', [{ title: 'a', status: 'open' }]);
    published.length = 0;

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'open' } } as any);

    // The only predicate available at publish time is the middleware-COMPOSED
    // AST, whose `where` carries the security layer's injected row scoping
    // (RLS, sharing). Shipping that to an external webhook URL would disclose
    // tenant scoping internals, so the event states the count and stops.
    const payload = published[0].payload as Record<string, unknown>;
    expect(payload.where).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('status');
  });

  it('carries userId when the execution context names an actor', async () => {
    await engine.insert('task', [{ title: 'a', status: 'open' }]);
    published.length = 0;

    await engine.update(
      'task',
      { status: 'done' },
      { multi: true, where: { status: 'open' }, context: { userId: 'usr_789' } } as any,
    );

    expect(BulkDataEventSchema.parse(published[0].payload).userId).toBe('usr_789');
  });

  it('publishes NOTHING when the predicate matched no rows', async () => {
    await engine.insert('task', [{ title: 'a', status: 'open' }]);
    published.length = 0;

    await engine.update('task', { status: 'done' }, { multi: true, where: { status: 'nonexistent' } } as any);

    // No rows matched → no data changed → not a data event. This is what keeps
    // an idle hourly LifecycleService sweep from becoming one webhook delivery
    // per object per hour saying "0 records".
    expect(published).toHaveLength(0);
  });

  it('publishes NOTHING when the driver breaks its count contract — and says so', async () => {
    const offContract = new ObjectQL();
    const { driver } = makeStubDriver();
    // `updateMany` is contracted to resolve the affected count. A driver that
    // resolves something else leaves `matched` unknowable, and `matched` is the
    // entire substance of a bulk event — so none is published.
    driver.updateMany = async () => ({ acknowledged: true } as any);
    offContract.registerDriver(driver, true);
    await offContract.init();
    offContract.registry.registerObject(task);
    offContract.setRealtimeService(realtime);
    const offWarn = vi.spyOn((offContract as any).logger, 'warn').mockImplementation(() => undefined);
    await offContract.insert('task', [{ title: 'a', status: 'open' }]);
    published.length = 0;

    await offContract.update('task', { status: 'done' }, { multi: true, where: { status: 'open' } } as any);

    expect(published).toHaveLength(0);
    const logged = offWarn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('data.records.updated');
    expect(logged).toContain('#4639');
  });

  it('a by-id delete still takes the PER-RECORD path even with multi: true', async () => {
    const [record] = await engine.insert('task', [{ title: 'reaped' }]);
    published.length = 0;

    // The shape LifecycleService's guarded reap uses: a scalar `where.id` is a
    // single-record target regardless of `multi`, so it must keep producing a
    // per-record event. Only an operator predicate routes to deleteMany.
    await engine.delete('task', { where: { id: record.id }, multi: true } as any);

    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('data.record.deleted');
    expect(DataEventSchema.parse(published[0].payload).recordId).toBe(record.id);
  });

  it('a publish failure never fails the predicate write itself', async () => {
    await engine.insert('task', [{ title: 'a', status: 'open' }]);
    published.length = 0;
    (realtime.publish as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('transport down'));

    await expect(
      engine.update('task', { status: 'done' }, { multi: true, where: { status: 'open' } } as any),
    ).resolves.not.toThrow();
    expect(await engine.findOne('task', { where: { status: 'done' } })).toBeTruthy();
    expect(warn).toHaveBeenCalled();
  });
});

/**
 * #14970 — the producer half of `DataEvent.organizationId`.
 *
 * `packages/spec/src/api/events.zod.ts` declared the member (PR #14635) and
 * states the obligation on the producer: *"a producer that omits the key on an
 * organization-stamped row publishes a cross-tenant event, which is fixed at
 * the publish site — never by a consumer-side lookup."* The engine published
 * it on no event at all, which left the landed spec term and the ready
 * consumer piece (#13566's fan-out filter) both inert.
 *
 * ⚠️ **A green suite proves nothing here unless the pins discriminate.** The
 * failure mode is "the key is absent on EVERY event", and a pin that only
 * asserts *absent when there is no organization* passes happily against it.
 * Two properties make these pins real:
 *
 *  1. **Caller organization ≠ record organization.** `execCtx.tenantId` is the
 *     CALLER's active org; the contract asks for the RECORD's. They coincide on
 *     an ordinary tenant write and diverge on a system/unscoped one, so every
 *     positive pin below writes a row into an organization the caller is not
 *     standing in — an administrator's write into another organization, the
 *     exact case the spec names. Substituting `execCtx.tenantId` fails them.
 *  2. **The two spellings differ.** The row's COLUMN is snake_case
 *     (`organization_id`); the published KEY is camelCase (`organizationId`).
 *     Reading the wrong one publishes the key absent on every event while
 *     every absence pin still passes — so the positive pins assert BOTH
 *     spellings on the same event.
 *
 * And absence is asserted as OMISSION, not as `=== undefined`: the schema is
 * `z.string().min(1).optional()`, so `''` is refused outright (which would
 * throw inside the publish site and drop the event entirely) while a key set
 * to an explicit `undefined` survives `parse` as a PRESENT key.
 */
describe('#14970 — a published DataEvent names the RECORD\'s organization', () => {
  /** Tenant-scoped: the kernel-injected `organization_id` is declared. */
  const invoice = {
    name: 'invoice',
    label: 'Invoice',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      amount: { name: 'amount', type: 'text' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  };

  // A SYSTEM context: `isSystem` is what lets a caller file a row under an
  // organization that is not its own active one (the tenant write wall, #2946,
  // rejects a foreign `organization_id` for everyone else). `tenantId` is the
  // caller's org and is deliberately NOT the row's on every positive pin.
  const CALLER_ORG = 'org_platform';
  const RECORD_ORG = 'org_acme';
  const sysCtx = { isSystem: true, tenantId: CALLER_ORG, userId: 'usr_admin' };

  let engine: ObjectQL;
  let published: RealtimeEventPayload[];
  let realtime: IRealtimeService;

  const payloadOf = (i = 0) => published[i].payload as Record<string, unknown>;
  const hasOrgKey = (i = 0) =>
    Object.prototype.hasOwnProperty.call(payloadOf(i), 'organizationId');

  beforeEach(async () => {
    published = [];
    realtime = {
      publish: vi.fn(async (event: RealtimeEventPayload) => { published.push(event); }),
      subscribe: vi.fn(async () => 'sub-1'),
      unsubscribe: vi.fn(async () => undefined),
    };
    engine = new ObjectQL();
    const { driver } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(invoice);
    engine.registry.registerObject(task);
    engine.setRealtimeService(realtime);
    vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it('created: names the ROW\'s organization, not the caller\'s active one', async () => {
    const record = await engine.insert(
      'invoice',
      { amount: '100', organization_id: RECORD_ORG },
      { context: sysCtx } as any,
    );

    expect(published).toHaveLength(1);
    const event = DataEventSchema.parse(published[0].payload);
    expect(event.type).toBe('data.record.created');
    expect(event.recordId).toBe(record.id);

    // The discriminating assertion: the RECORD's org, and provably not the
    // caller's — `execCtx.tenantId` was a different, non-empty organization
    // throughout this write.
    expect(event.organizationId).toBe(RECORD_ORG);
    expect(event.organizationId).not.toBe(CALLER_ORG);

    // The spelling control (see the block header): the row body carries the
    // snake_case COLUMN, the event carries the camelCase KEY, and both are
    // populated on this one event. Reading `row.organizationId` instead would
    // leave the second one absent while the first still passed.
    expect((event.after as Record<string, unknown>).organization_id).toBe(RECORD_ORG);
  });

  it('updated: names the POST-state\'s organization, not the caller\'s', async () => {
    const record = await engine.insert(
      'invoice',
      { amount: '100', organization_id: RECORD_ORG },
      { context: sysCtx } as any,
    );
    published.length = 0;

    await engine.update('invoice', { id: record.id, amount: '250' }, { context: sysCtx } as any);

    expect(published).toHaveLength(1);
    const event = DataEventSchema.parse(published[0].payload);
    expect(event.type).toBe('data.record.updated');
    expect(event.organizationId).toBe(RECORD_ORG);
    expect(event.organizationId).not.toBe(CALLER_ORG);
    expect((event.after as Record<string, unknown>).organization_id).toBe(RECORD_ORG);
  });

  it('updated: a row MOVED between organizations is labelled with where it is NOW', async () => {
    const record = await engine.insert(
      'invoice',
      { amount: '100', organization_id: RECORD_ORG },
      { context: sysCtx } as any,
    );
    published.length = 0;

    await engine.update(
      'invoice',
      { id: record.id, organization_id: 'org_moved' },
      { context: sysCtx } as any,
    );

    const event = DataEventSchema.parse(published[0].payload);
    // The post-state, not the pre-image — a consumer filtering on the event's
    // organization must see the row where it now lives.
    expect(event.organizationId).toBe('org_moved');
    expect(event.organizationId).not.toBe(RECORD_ORG);
  });

  it('deleted: names the organization off the PRE-IMAGE — the path with no `after`', async () => {
    const record = await engine.insert(
      'invoice',
      { amount: '100', organization_id: RECORD_ORG },
      { context: sysCtx } as any,
    );
    published.length = 0;

    await engine.delete('invoice', { where: { id: record.id }, context: sysCtx } as any);

    expect(published).toHaveLength(1);
    const event = DataEventSchema.parse(published[0].payload);
    expect(event.type).toBe('data.record.deleted');
    expect(event.recordId).toBe(record.id);
    // The delete path is the one most likely to regress silently: there is no
    // post-state to read, so this value can only have come from the pre-image
    // the by-id branch already holds.
    expect(event.after).toBeUndefined();
    expect(event.organizationId).toBe(RECORD_ORG);
    expect(event.organizationId).not.toBe(CALLER_ORG);
  });

  it('an object that is not tenant-scoped OMITS the key on all three actions', async () => {
    // `task` declares no `organization_id`, so `resolveTenantFieldName` finds
    // no column and nothing is published — rather than the caller's org being
    // used as a stand-in, which is what makes this pin more than a tautology:
    // the caller carries `tenantId: CALLER_ORG` on every one of these writes.
    const record = await engine.insert('task', { title: 'no wall' }, { context: sysCtx } as any);
    await engine.update('task', { id: record.id, title: 'edited' }, { context: sysCtx } as any);
    await engine.delete('task', { where: { id: record.id }, context: sysCtx } as any);

    expect(published.map((e) => e.type)).toEqual([
      'data.record.created', 'data.record.updated', 'data.record.deleted',
    ]);
    for (let i = 0; i < 3; i += 1) {
      // OMITTED, asserted as omission: an explicitly-`undefined` key would
      // survive `parse` and reach a consumer as a present key.
      expect(hasOrgKey(i)).toBe(false);
      expect(DataEventSchema.parse(published[i].payload).organizationId).toBeUndefined();
    }
  });

  it('a tenant-scoped object whose ROW carries no organization OMITS the key', async () => {
    // Distinct from the case above: the column EXISTS, it is simply empty —
    // "not behind any organization wall" for this row. The caller still has an
    // active organization, and it still must not be substituted.
    const record = await engine.insert(
      'invoice',
      { amount: '7', organization_id: null },
      { context: sysCtx } as any,
    );

    expect(published).toHaveLength(1);
    expect(hasOrgKey()).toBe(false);
    expect(DataEventSchema.parse(published[0].payload).organizationId).toBeUndefined();
    expect(DataEventSchema.parse(published[0].payload).recordId).toBe(record.id);
  });

  it('an empty-string organization column OMITS the key AND still publishes the event', async () => {
    // `''` is refused by `z.string().min(1)`, so handing it to the publish
    // site's `parse` would throw and the event would be dropped altogether —
    // a silence far worse than an absent key. The gate is in the resolver, not
    // in the error handler.
    await engine.insert(
      'invoice',
      { amount: '9', organization_id: '' },
      { context: sysCtx } as any,
    );

    expect(published).toHaveLength(1);
    expect(hasOrgKey()).toBe(false);
    expect(() => DataEventSchema.parse(published[0].payload)).not.toThrow();
  });

  it('a batch insert stamps each row with its OWN organization', async () => {
    await engine.insert(
      'invoice',
      [
        { amount: '1', organization_id: RECORD_ORG },
        { amount: '2', organization_id: 'org_globex' },
        { amount: '3' },
      ],
      { context: sysCtx } as any,
    );

    expect(published).toHaveLength(3);
    const events = published.map((e) => DataEventSchema.parse(e.payload));
    expect(events.map((e) => e.organizationId)).toEqual([RECORD_ORG, 'org_globex', undefined]);
    // The org-less row omits rather than inheriting a sibling's or the
    // caller's — one event per record means one organization per record.
    expect(hasOrgKey(2)).toBe(false);
  });
});
