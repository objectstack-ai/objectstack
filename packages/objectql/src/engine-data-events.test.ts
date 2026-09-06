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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  /**
   * [#15688] Genuinely NOT tenant-scoped — and the declared opt-out is the ONLY
   * way for a fixture to be that. `registerObject` INJECTS the kernel
   * `organization_id` column (`TENANT_SCOPE_FIELD_DEF`, gated on the injection
   * plan's `tenant` flag) into every object that does not opt out, so an object
   * is never unscoped by simply omitting the field from its `fields` map. The
   * first edition of the pin below was written on `task` in the belief that it
   * was, and passed for a different reason than it stated.
   */
  const unscoped = {
    name: 'audit_note',
    label: 'Audit note',
    tenancy: { enabled: false },
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      body: { name: 'body', type: 'text' as const },
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
  /**
   * [#15688] The columns the REGISTRY holds after the injection pass — never
   * the ones the fixture above authored. This is the difference the pins below
   * assert rather than assume.
   */
  const registeredColumns = (name: string) =>
    Object.keys((engine.registry.getObject(name) as { fields?: Record<string, unknown> } | undefined)?.fields ?? {});

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
    engine.registry.registerObject(unscoped);
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

  it('an object that is not tenant-scoped has the column WITHHELD, and OMITS the key on all three actions', async () => {
    // [#15688] The premise is MEASURED before it is used, because prose that
    // merely claims it is how this pin went wrong once: `audit_note` declares
    // `tenancy: { enabled: false }`, so the injection pass withholds the kernel
    // column and `resolveTenantFieldName` resolves nothing at all. `task` is
    // the CONTROL for that assertion — registered without the opt-out, it has
    // `organization_id` INJECTED, so it cannot serve as an unscoped fixture.
    // These two lines turn "not tenant-scoped" from an assumption into a
    // reading, and a future edit that moves the injection reddens them here
    // rather than leaving a stale sentence behind.
    expect(registeredColumns('audit_note')).not.toContain('organization_id');
    expect(registeredColumns('task')).toContain('organization_id');

    // What makes the omission more than a tautology: the caller carries
    // `tenantId: CALLER_ORG` on every one of these writes, so an implementation
    // reaching for the caller's org as a stand-in fails here.
    const record = await engine.insert('audit_note', { body: 'no wall' }, { context: sysCtx } as any);
    await engine.update('audit_note', { id: record.id, body: 'edited' }, { context: sysCtx } as any);
    await engine.delete('audit_note', { where: { id: record.id }, context: sysCtx } as any);

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

  it('an INJECTION-scoped object whose rows carry no organization OMITS the key on all three actions', async () => {
    // [#15688] The population the pin above used to be written on, kept and
    // described as what it actually is. `task`'s fixture names no
    // `organization_id`, but `registerObject` injects one, so
    // `resolveTenantFieldName` answers `organization_id` here: the key is
    // omitted because the ROW carries no organization, NEVER because the
    // object has no column. Same caller-org discrimination as above.
    expect(registeredColumns('task')).toContain('organization_id');

    const record = await engine.insert('task', { title: 'no wall' }, { context: sysCtx } as any);
    await engine.update('task', { id: record.id, title: 'edited' }, { context: sysCtx } as any);
    await engine.delete('task', { where: { id: record.id }, context: sysCtx } as any);

    expect(published.map((e) => e.type)).toEqual([
      'data.record.created', 'data.record.updated', 'data.record.deleted',
    ]);
    for (let i = 0; i < 3; i += 1) {
      expect(hasOrgKey(i)).toBe(false);
      expect(DataEventSchema.parse(published[i].payload).organizationId).toBeUndefined();
    }
  });

  it('a tenant-scoped object whose ROW carries no organization OMITS the key', async () => {
    // [#15688] Distinct from the case above in PROVENANCE and in the row: there
    // the kernel column is INJECTED and the row never mentions it; here the
    // object AUTHORS `organization_id` and the row sets it explicitly to
    // `null`. Both are "not behind any organization wall" for this row, and in
    // both the caller still has an active organization that must not be
    // substituted.
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

/**
 * #15225 / #15813 — the producer half of `BulkDataEvent.organizationId`: the
 * bulk sibling of the #14970 block above, and the remaining half of the
 * cross-tenant webhook leak (#13566) whose single-record half #14970 closed.
 *
 * `BulkDataEventSchema.organizationId` (PR #15218) is ONE organization for the
 * whole batch, asserted by the producer from the tenant wall the predicate
 * write was composed under, or absent. ⚠️ `absent` means the OPPOSITE of what
 * it means one block up: on a `DataEvent` it is a statement about the ROW
 * ("belongs to no organization"); here it is a statement about PRODUCER
 * KNOWLEDGE ("no single organization was asserted for this batch").
 *
 * ## What the producer reads, and what it deliberately does NOT (#15813)
 *
 * The wall is computed by plugin-security and nowhere else. The producer
 * reads the verdict the enforcement layer RECORDED on the operation context
 * (`OperationContext.tenantLayer0Verdict`, `TenantLayer0VerdictSchema` in
 * `@objectstack/spec/security`) — `organization` (or a one-member
 * `organizations`) stamps the key; everything else, including NO recorded
 * verdict, omits it. It reads NOTHING else: not the enforced posture, not the
 * execution context's `tenantId` / `accessible_org_ids` / `posture`, not the
 * object schema. The first edition of this block pinned a producer that
 * re-derived the wall from those inputs; it could not see the deployment's
 * #12699 carve-out and stamped a wrong key on that population (#15706, ruled
 * 2026-09-05: the mirror is deleted, not taught one more clause). Those pins
 * were RETARGETED here, deliberately and visibly — the object-shape and
 * rung-shape populations now live where the wall is computed
 * (`plugin-security/src/tenant-layer0-verdict-on-operation.test.ts`), and the
 * one end-to-end weld — real engine, real plugin, real event — lives beside
 * them.
 *
 * What makes these pins discriminate rather than pass against the live
 * defect ("the key is absent on every event" — an absence-only suite reported
 * 25/25 green against exactly that on #14970):
 *
 *  1. **The verdict, not the context.** The positive pins record a verdict
 *     naming an organization the context does NOT carry as `tenantId`, and
 *     expect the verdict's organization — substituting any context field
 *     fails them.
 *  2. **The wall, not the rows.** The stub driver composes no wall at all, so
 *     the rows a sweep touches are whatever was seeded; the negative pins
 *     seed rows across two organizations on purpose, and the answer is still
 *     decided by the recorded verdict, never by a row read.
 *  3. **No verdict ⇒ absent, whatever the posture and context say.** The
 *     mirror-deleted pin: an engine handed `isolated` by its posture provider,
 *     a member context with an active organization, and NO recording
 *     middleware publishes the key ABSENT. Any re-derivation from posture +
 *     context turns this pin red first.
 *  4. **Absence is asserted as OMISSION** (`hasOwnProperty === false`), never
 *     `=== undefined`: the schema refuses `''` outright, and an explicit
 *     `undefined` survives `parse` as a PRESENT key.
 *
 * The verdict reaches the engine the way plugin-security delivers it in a
 * real composition — a registered middleware writing
 * `ctx.tenantLayer0Verdict` before `next()` — with the posture provider set
 * to `isolated` throughout so no pin below can pass by the posture being
 * inert.
 */
describe('#15225 / #15813 — a published BulkDataEvent names the organization the RECORDED Layer 0 verdict named', () => {
  /** Tenant-scoped: the kernel-injected `organization_id` is declared. */
  const invoice = {
    name: 'invoice',
    label: 'Invoice',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      amount: { name: 'amount', type: 'text' as const },
      status: { name: 'status', type: 'text' as const },
      organization_id: { name: 'organization_id', type: 'text' as const },
    },
  };

  const ACTIVE_ORG = 'org_acme';
  const OTHER_ORG = 'org_globex';
  /** System context: the only caller that may seed rows into ANY organization. */
  const sysCtx = { isSystem: true, tenantId: ACTIVE_ORG, userId: 'usr_admin' };
  /** An ordinary resolved session under `isolated`: rung carried, active org set. */
  const member = { userId: 'usr_member', tenantId: ACTIVE_ORG, posture: 'MEMBER' };

  let engine: ObjectQL;
  let published: RealtimeEventPayload[];
  let realtime: IRealtimeService;
  /**
   * What the recording middleware writes on the operation, per pin. `NOT_SET`
   * = the middleware is present but records nothing (it never touched the
   * member); the "no middleware at all" pin uses a bare engine instead.
   */
  const NOT_SET = Symbol('not-set');
  let recorded: unknown = NOT_SET;

  const payloadOf = (i = 0) => published[i].payload as Record<string, unknown>;
  const hasOrgKey = (i = 0) =>
    Object.prototype.hasOwnProperty.call(payloadOf(i), 'organizationId');
  const bulkEvent = (i = 0) => BulkDataEventSchema.parse(payloadOf(i));

  const seed = async (rows: Array<Record<string, unknown>>) => {
    await engine.insert('invoice', rows, { context: sysCtx } as any);
    published.length = 0;
  };
  const sweepUpdate = (context: Record<string, unknown>) =>
    engine.update('invoice', { amount: '0' }, { multi: true, where: { status: 'open' }, context } as any);
  const sweepDelete = (context: Record<string, unknown>) =>
    engine.delete('invoice', { multi: true, where: { status: 'open' }, context } as any);

  beforeEach(async () => {
    published = [];
    recorded = NOT_SET;
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
    engine.setTenancyPostureProvider(() => 'isolated');
    // The enforcement layer's seam, as plugin-security drives it: the verdict
    // is written on the operation context the executor closure holds, ahead
    // of `next()`. A system context takes the plugin's first exit and records
    // nothing (pinned on the plugin side); mirrored here so the harness never
    // records a verdict the real middleware would not.
    engine.registerMiddleware(async (ctx, next) => {
      if (recorded !== NOT_SET && ctx.context?.isSystem !== true && ctx.ast) {
        ctx.tenantLayer0Verdict = recorded as any;
      }
      await next();
    });
    vi.spyOn((engine as any).logger, 'warn').mockImplementation(() => undefined);
  });

  const savedPosture = process.env.OS_TENANCY_POSTURE;
  afterEach(() => {
    if (savedPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = savedPosture;
  });

  it('a recorded `organization` verdict is stamped on a predicate UPDATE — the VERDICT\'s organization, not the context\'s', async () => {
    // The discriminating case: the context's active organization is NOT the
    // one the wall named. Only a reader of the verdict answers `org_plant_a`.
    recorded = { kind: 'organization', organizationId: 'org_plant_a' };
    await seed([
      { amount: '1', status: 'open', organization_id: 'org_plant_a' },
      { amount: '2', status: 'open', organization_id: 'org_plant_a' },
    ]);

    await sweepUpdate({ userId: 'usr_plant', tenantId: 'org_hq', posture: 'MEMBER' });

    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('data.records.updated');
    const event = bulkEvent();
    expect(event.matched).toBe(2);
    expect(hasOrgKey()).toBe(true);
    expect(event.organizationId).toBe('org_plant_a');
    expect(event.organizationId).not.toBe('org_hq');
  });

  it('the predicate DELETE path stamps it too — the branch with no post-state', async () => {
    recorded = { kind: 'organization', organizationId: ACTIVE_ORG };
    await seed([
      { amount: '1', status: 'open', organization_id: ACTIVE_ORG },
      { amount: '2', status: 'kept', organization_id: ACTIVE_ORG },
    ]);

    await sweepDelete(member);

    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('data.records.deleted');
    expect(bulkEvent().matched).toBe(1);
    expect(hasOrgKey()).toBe(true);
    expect(bulkEvent().organizationId).toBe(ACTIVE_ORG);
  });

  it('a one-member `organizations` verdict (the `group` wall over a singleton membership) names that member', async () => {
    recorded = { kind: 'organizations', organizationIds: ['org_plant_a'] };
    await seed([{ amount: '1', status: 'open', organization_id: 'org_plant_a' }]);

    await sweepUpdate({ userId: 'usr_plant', tenantId: 'org_hq', accessible_org_ids: ['org_plant_a'], posture: 'MEMBER' });

    expect(published).toHaveLength(1);
    expect(hasOrgKey()).toBe(true);
    expect(bulkEvent().organizationId).toBe('org_plant_a');
  });

  it('an `organizations` verdict over TWO organizations publishes it ABSENT — never the active organization as a stand-in', async () => {
    // The option-C mislabel (PR #14635 open question 1, rejected): the caller
    // HAS an active organization, and it must not label a sweep the wall let
    // reach two organizations' rows.
    recorded = { kind: 'organizations', organizationIds: ['org_plant_a', 'org_plant_b'] };
    await seed([
      { amount: '1', status: 'open', organization_id: 'org_plant_a' },
      { amount: '2', status: 'open', organization_id: 'org_plant_b' },
    ]);

    await sweepUpdate({ userId: 'usr_hq', tenantId: 'org_plant_a', accessible_org_ids: ['org_plant_a', 'org_plant_b'], posture: 'MEMBER' });

    expect(published).toHaveLength(1);
    expect(bulkEvent().matched).toBe(2);
    expect(hasOrgKey()).toBe(false);
    expect(bulkEvent().organizationId).toBeUndefined();
  });

  it('a `none` verdict publishes it ABSENT under an armed posture and a member with an active organization — the #15706 population', async () => {
    // The wall RAN and contributed nothing: a deployment-exempted object
    // (#12699), a tenancy-disabled object, an exempt PLATFORM_ADMIN. The
    // previous producer stamped `org_acme` here from the context; the batch
    // below spans two organizations, so that key was WRONG.
    recorded = { kind: 'none' };
    await seed([
      { amount: '1', status: 'open', organization_id: ACTIVE_ORG },
      { amount: '2', status: 'open', organization_id: OTHER_ORG },
    ]);

    await sweepUpdate(member);

    expect(published).toHaveLength(1);
    expect(bulkEvent().matched).toBe(2);
    expect(hasOrgKey()).toBe(false);
  });

  it('a `deny` verdict publishes it ABSENT (and the event still publishes if the driver matched rows)', async () => {
    recorded = { kind: 'deny' };
    await seed([{ amount: '1', status: 'open', organization_id: ACTIVE_ORG }]);

    await sweepUpdate(member);

    expect(published).toHaveLength(1);
    expect(hasOrgKey()).toBe(false);
  });

  it('NO recorded verdict ⇒ ABSENT, whatever the posture provider and the context say — the mirror is deleted, not moved', async () => {
    // `isolated` from the provider, a member with an active organization, rows
    // all in that organization: every input the FORMER producer read says
    // `org_acme`. The producer reads none of them.
    await seed([
      { amount: '1', status: 'open', organization_id: ACTIVE_ORG },
      { amount: '2', status: 'open', organization_id: ACTIVE_ORG },
    ]);

    await sweepUpdate(member);

    expect(published).toHaveLength(1);
    expect(bulkEvent().matched).toBe(2);
    expect(hasOrgKey()).toBe(false);
  });

  it('a system-context predicate write publishes it ABSENT — the middleware takes its first exit and records nothing', async () => {
    recorded = { kind: 'organization', organizationId: ACTIVE_ORG };
    await seed([
      { amount: '1', status: 'open', organization_id: ACTIVE_ORG },
      { amount: '2', status: 'open', organization_id: OTHER_ORG },
    ]);

    await sweepUpdate(sysCtx);

    expect(published).toHaveLength(1);
    expect(bulkEvent().matched).toBe(2);
    expect(hasOrgKey()).toBe(false);
  });

  it('no enforcement layer at all ⇒ ABSENT even with OS_TENANCY_POSTURE=isolated in the env and a posture provider', async () => {
    // A bare engine: no middleware ever records a verdict. The env fallback
    // the #8844 write refusal consults (`resolveEnginePosture`) is deliberately
    // not consulted, and neither is the provider — a posture is not a wall.
    process.env.OS_TENANCY_POSTURE = 'isolated';
    const bare = new ObjectQL();
    const { driver } = makeStubDriver();
    bare.registerDriver(driver, true);
    await bare.init();
    bare.registry.registerObject(invoice);
    bare.setRealtimeService(realtime);
    bare.setTenancyPostureProvider(() => 'isolated');
    vi.spyOn((bare as any).logger, 'warn').mockImplementation(() => undefined);
    await bare.insert('invoice', [{ amount: '1', status: 'open', organization_id: ACTIVE_ORG }], { context: sysCtx } as any);
    published.length = 0;

    await bare.update('invoice', { amount: '0' }, { multi: true, where: { status: 'open' }, context: member } as any);

    expect(published).toHaveLength(1);
    expect(hasOrgKey()).toBe(false);
  });

  it.each([
    ['an unknown kind', { kind: 'organisation', organizationId: ACTIVE_ORG }],
    ['an empty organization id', { kind: 'organization', organizationId: '' }],
    ['an empty set', { kind: 'organizations', organizationIds: [] }],
    ['a duplicated set', { kind: 'organizations', organizationIds: [ACTIVE_ORG, ACTIVE_ORG] }],
    ['a filter shape (the wall\'s output, not its verdict)', { organization_id: ACTIVE_ORG }],
    ['a bare string', ACTIVE_ORG],
  ])('a recorded value that is not a verdict — %s — publishes it ABSENT and still publishes', async (_label, junk) => {
    // Junk reads as "no verdict", never as an organization: the schema is the
    // gate, and the failure direction that matters is a WRONG key.
    recorded = junk;
    await seed([{ amount: '1', status: 'open', organization_id: ACTIVE_ORG }]);

    await sweepUpdate(member);

    expect(published).toHaveLength(1);
    expect(hasOrgKey()).toBe(false);
    expect(() => bulkEvent()).not.toThrow();
  });

  it('BulkDataEventSchema.parse at the publish site stays the validator, the key is fed THROUGH it, and the resolver reads the verdict ALONE', () => {
    // A source pin, on the same terms as the #7809 vocabulary weld next door:
    // the runtime pins above prove the key is emitted; this one proves it is
    // emitted INSIDE the `parse` call — a stamp added onto the envelope after
    // validation would pass every pin above while bypassing the contract.
    const testPath = expect.getState().testPath;
    if (!testPath) throw new Error('vitest did not report a testPath — cannot locate engine.ts');
    const src = readFileSync(join(dirname(testPath), 'engine.ts'), 'utf8');
    const start = src.indexOf('private async publishBulkDataEvent(');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    const parseCalls = body.match(/BulkDataEventSchema\.parse\(\{[\s\S]*?\n\s*\}\);/g) ?? [];
    expect(parseCalls).toHaveLength(1);
    expect(parseCalls[0]).toContain('organizationId');
    // The value is resolved by the verdict reader, never the row helper (there
    // is no row) and never `tenantId` on its own.
    expect(body).toContain('bulkEventOrganizationId(');
    expect(body).not.toContain('eventOrganizationId(');

    // [#15813] The reader composes NOTHING: its body names the verdict schema
    // and none of the wall's inputs. The slice starts at the `function`
    // keyword, so the docblock above it (which is allowed to NAME what is not
    // read) is outside the window; keep the body itself free of prose that
    // names an input — the sentence belongs in the docblock.
    const fnStart = src.indexOf('\nfunction bulkEventOrganizationId(');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, src.indexOf('\n}\n', fnStart));
    expect(fnBody).toContain('TenantLayer0VerdictSchema.safeParse(');
    for (const input of ['tenantId', 'accessible_org_ids', 'posture', 'isSystem', 'carriesTenantScopeColumn', 'getObject(', 'enforcedTenancyPosture', 'resolveEnginePosture']) {
      expect(fnBody, `bulkEventOrganizationId reads '${input}' — the mirror is back`).not.toContain(input);
    }
  });
});
