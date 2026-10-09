// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22510] `sys_activity.actor_name` is WRITTEN — the acting user's display
 * name, captured when the activity row is written.
 *
 * `sys_activity` declares the column (and lists it among its highlight
 * fields) because its entries are "denormalized snapshots" read
 * chronologically. No writer filled it: every row carried `actor_id` and a
 * null `actor_name`, and the record History tab — which reads `actor_name` —
 * showed "Unknown user" for every entry, for every user.
 *
 * Pinned through the REAL engine (`ObjectQL`), so the user travels the way it
 * does in production — `ExecutionContext.userId` → the hook session — rather
 * than as a hand-built hook context:
 *
 *  1. a user's write names that user, on create, update and delete alike;
 *  2. `actor_id` is unchanged, and is the id the name was read for (control);
 *  3. a user whose name cannot be read leaves `actor_name` empty — never the
 *     id, which would read as a plausible name;
 *  4. a write with no user leaves it empty too: ADR-0118 D1 keeps the system
 *     actor `null`, and its "System" label is a rendering rule, not data;
 *  5. the read is one per user, not one per row — `writeAudit` runs once per
 *     row of a predicate write, and this is its hot path.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installAuditWriters } from './audit-writers.js';

const f = (name: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type, ...extra }) as any;

const sysAuditLog = {
  name: 'sys_audit_log', label: 'Audit Log',
  fields: {
    id: f('id', 'text', { primaryKey: true }), action: f('action', 'text'),
    user_id: f('user_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), old_value: f('old_value', 'textarea'),
    new_value: f('new_value', 'textarea'), tenant_id: f('tenant_id', 'text'),
  },
};

/** The two actor columns the shipped `sys_activity` declares, both present. */
const sysActivity = {
  name: 'sys_activity', label: 'Activity',
  fields: {
    id: f('id', 'text', { primaryKey: true }), type: f('type', 'text'),
    timestamp: f('timestamp', 'datetime'), summary: f('summary', 'text'),
    actor_id: f('actor_id', 'text'), actor_name: f('actor_name', 'text'),
    object_name: f('object_name', 'text'), record_id: f('record_id', 'text'),
    record_label: f('record_label', 'text'), metadata: f('metadata', 'textarea'),
  },
};

/** `nameField: 'name'`, as the shipped `sys_user` declares it. */
const sysUser = {
  name: 'sys_user', label: 'User', nameField: 'name',
  fields: {
    id: f('id', 'text', { primaryKey: true }), name: f('name', 'text'),
    email: f('email', 'email'),
  },
};

const bizTask = {
  name: 'biz_task', label: 'Task',
  fields: { id: f('id', 'text', { primaryKey: true }), title: f('title', 'text'), status: f('status', 'text') },
};

/** `enable.activities: false` — this object's writes produce no activity row. */
const bizQuiet = {
  name: 'biz_quiet', label: 'Quiet', enable: { activities: false },
  fields: { id: f('id', 'text', { primaryKey: true }), title: f('title', 'text') },
};

/** Copy-returning, read-counting store — the shape `audit-lookup-summary.test.ts` measures with. */
function makeCountingDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const reads: Record<string, number> = {};
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const copy = <T,>(r: T): T => (r == null ? r : JSON.parse(JSON.stringify(r)));
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries<any>(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((sub) => matches(row, sub))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && '$in' in v) {
        if (!(v.$in as unknown[]).includes(row[k])) return false;
        continue;
      }
      const expected = (v && typeof v === 'object' && '$eq' in v) ? v.$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      reads[object] = (reads[object] ?? 0) + 1;
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return copy(updated);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(object).has(id) ? this.update(object, id, data) : this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      const s = storeFor(object);
      for (const r of rows) s.set(r.id as string, { ...s.get(r.id as string), ...data, id: r.id });
      return rows.length;
    },
    async deleteMany(object: string, ast: any) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).delete(r.id as string);
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, storeFor };
}

const OWNER_PACKAGE = 'com.objectstack.test.activity-actor-name';
const ADA = 'usr_ada';

async function boot() {
  const engine = new ObjectQL();
  const stub = makeCountingDriver();
  engine.registerDriver(stub.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, sysUser, bizTask, bizQuiet]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  installAuditWriters(engine as any, 'test.audit');
  // Seeded with no context: a system write, which names nobody.
  await engine.insert('sys_user', { id: ADA, name: 'Ada Lovelace', email: 'ada@example.com' });
  return { engine, ...stub };
}

const as = (userId: string) => ({ context: { userId } });

/** Every activity row written about `recordId`, in write order. */
const activityFor = (storeFor: (o: string) => Map<string, Record<string, unknown>>, recordId: string) =>
  Array.from(storeFor('sys_activity').values()).filter((r) => r.record_id === recordId);

describe('[#22510] sys_activity.actor_name — the acting user\'s name, written with the row', () => {
  it('a user\'s create, update and delete each carry that user\'s name', async () => {
    const { engine, storeFor } = await boot();

    await engine.insert('biz_task', { id: 't1', title: 'Call Acme', status: 'open' }, as(ADA) as any);
    await engine.update('biz_task', { status: 'done' }, { where: { id: 't1' }, ...as(ADA) } as any);
    await engine.delete('biz_task', { where: { id: 't1' }, ...as(ADA) } as any);

    const rows = activityFor(storeFor, 't1');
    expect(rows.map((r) => r.type)).toEqual(['created', 'updated', 'deleted']);
    for (const row of rows) {
      expect(row.actor_name).toBe('Ada Lovelace');
      // Control: `actor_id` is exactly what it was — the same id the name was read for.
      expect(row.actor_id).toBe(ADA);
    }
  });

  it('names the human a system-authorized write is ATTRIBUTED to — the same id `actor_id` records', async () => {
    const { engine, storeFor } = await boot();

    // The better-auth envelope: authorized as the system, crediting a human
    // through provenance (`attributedUserId`) rather than the session.
    await engine.insert(
      'biz_task',
      { id: 't2', title: 'Grade change', status: 'open' },
      { context: { isSystem: true, attributedUserId: ADA } } as any,
    );

    const [row] = activityFor(storeFor, 't2');
    expect(row.actor_id).toBe(ADA);
    expect(row.actor_name).toBe('Ada Lovelace');
  });

  it('a user whose name cannot be read leaves actor_name empty — never the id', async () => {
    const { engine, storeFor } = await boot();
    await engine.insert('sys_user', { id: 'usr_blank', name: '   ', email: 'blank@example.com' });

    // No `sys_user` row at all, and a row whose name is blank.
    await engine.insert('biz_task', { id: 't3', title: 'Ghost', status: 'open' }, as('usr_ghost') as any);
    await engine.insert('biz_task', { id: 't4', title: 'Blank', status: 'open' }, as('usr_blank') as any);

    const [ghost] = activityFor(storeFor, 't3');
    const [blank] = activityFor(storeFor, 't4');
    expect(ghost.actor_id).toBe('usr_ghost');
    expect(ghost.actor_name ?? null).toBeNull();
    expect(blank.actor_id).toBe('usr_blank');
    expect(blank.actor_name ?? null).toBeNull();
  });

  it('a write with no user leaves actor_name empty (ADR-0118 D1: the system actor is null) and reads no user', async () => {
    const { engine, storeFor, reads } = await boot();
    const before = reads.sys_user ?? 0;

    await engine.insert('biz_task', { id: 't5', title: 'Nightly', status: 'open' }, { context: { isSystem: true } } as any);
    // A service principal on `actor` is not a user either (ADR-0118 D5: user or system).
    await engine.insert(
      'biz_task',
      { id: 't6', title: 'Flow', status: 'open' },
      { context: { isSystem: true, actor: 'svc:flow:nightly' } } as any,
    );

    for (const id of ['t5', 't6']) {
      const [row] = activityFor(storeFor, id);
      expect(row.actor_id).toBeNull();
      expect(row.actor_name ?? null).toBeNull();
    }
    expect((reads.sys_user ?? 0) - before).toBe(0);
  });
});

describe('[#22510] the name costs one read per user, not one per row', () => {
  it('a predicate update over three rows reads sys_user ONCE, and a later write by the same user not at all', async () => {
    const { engine, storeFor, reads } = await boot();
    for (const id of ['p1', 'p2', 'p3']) {
      await engine.insert('biz_task', { id, title: id, status: 'open' });
    }
    const before = reads.sys_user ?? 0;

    await engine.update('biz_task', { status: 'done' }, { where: { status: 'open' }, multi: true, ...as(ADA) } as any);

    const updated = Array.from(storeFor('sys_activity').values()).filter((r) => r.type === 'updated');
    expect(updated).toHaveLength(3);
    for (const row of updated) expect(row.actor_name).toBe('Ada Lovelace');
    expect((reads.sys_user ?? 0) - before).toBe(1);

    await engine.update('biz_task', { title: 'renamed' }, { where: { id: 'p1' }, ...as(ADA) } as any);
    expect((reads.sys_user ?? 0) - before).toBe(1);
  });

  it('an object with `enable.activities: false` writes no activity row and reads no user', async () => {
    const { engine, storeFor, reads } = await boot();
    const before = reads.sys_user ?? 0;

    await engine.insert('biz_quiet', { id: 'q1', title: 'Quiet' }, as(ADA) as any);

    expect(activityFor(storeFor, 'q1')).toHaveLength(0);
    expect((reads.sys_user ?? 0) - before).toBe(0);
  });
});
