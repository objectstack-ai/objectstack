// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An activity summary names a referenced record by a title the writer may
 * read, else by its id.
 *
 * Two summary branches name a referenced record: the tracked-change diff
 * (`Vault: A → B`) and a fired milestone's `{token}` (`Escalated to {vault}`).
 * Both take the title from one resolver, `resolveLookupTitles` in
 * `audit-writers.ts`, which reads in the WRITER's scope (the hook's own
 * `api`), the scope the record's own label is read in. The rule holds per id:
 * one read answers every id of a target, and an id the writer may read is
 * titled while an id beside it the writer may not read keeps its id.
 *
 * What is pinned, for each branch:
 *  - a writer the security layer refuses the target ROW (its row scope) names
 *    the record by its id;
 *  - a writer refused the target OBJECT names the record by its id, and the
 *    write and its activity row still land;
 *  - a writer served the target row without its title column names the record
 *    by its id;
 *  - a writer who may read the target names it by its title, and so does a
 *    system write (no regression);
 *  - the stored summary CODE (the message the read side composes per reader)
 *    carries the same value as the stored sentence.
 *
 * A bare engine, the real `installAuditWriters`, and a copy-returning store.
 * The three refusals are engine middleware on the target object, the layer
 * the security service enforces on: a row filtered out of the result, a
 * refused read, and a result served without the column.
 *
 * ⚠️ No test title states a value.
 */

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { installAuditWriters } from './audit-writers.js';
import { singlePostureDefaultOrganization } from './__tests__/single-posture-tenancy.js';

const f = (name: string, type: string, extra: Record<string, unknown> = {}) =>
  ({ name, label: name, type, ...extra }) as any;

const sysAuditLog = {
  name: 'sys_audit_log', label: 'Audit Log',
  fields: {
    id: f('id', 'text', { primaryKey: true }), action: f('action', 'text'),
    user_id: f('user_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), old_value: f('old_value', 'textarea'),
    new_value: f('new_value', 'textarea'), tenant_id: f('tenant_id', 'text'),
    actor: f('actor', 'text'), metadata: f('metadata', 'textarea'),
  },
};

const sysActivity = {
  name: 'sys_activity', label: 'Activity',
  fields: {
    id: f('id', 'text', { primaryKey: true }), type: f('type', 'text'),
    timestamp: f('timestamp', 'datetime'), summary: f('summary', 'text'),
    actor_id: f('actor_id', 'text'), object_name: f('object_name', 'text'),
    record_id: f('record_id', 'text'), record_label: f('record_label', 'text'),
    metadata: f('metadata', 'textarea'),
  },
};

/** The referenced object, titled by `name`. */
const vault = {
  name: 'wst_vault', label: 'Vault', nameField: 'name',
  fields: { id: f('id', 'text', { primaryKey: true }), name: f('name', 'text') },
};

/**
 * The audited object: one tracked lookup, and a milestone whose sentence names
 * that lookup. `stage` is untracked, so a stage-only update fires the
 * milestone and nothing else.
 */
const caseObject = {
  name: 'wst_case', label: 'Case', nameField: 'subject',
  fields: {
    id: f('id', 'text', { primaryKey: true }),
    subject: f('subject', 'text'),
    stage: f('stage', 'text', { label: 'Stage' }),
    vault: f('vault', 'lookup', { label: 'Vault', reference: 'wst_vault', trackHistory: true }),
  },
  activityMilestones: [{ field: 'stage', value: 'escalated', summary: 'Escalated to {vault}' }],
};

function makeStore() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
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
  const select = (object: string, where: any, limit?: number) => {
    const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, where));
    const page = typeof limit === 'number' ? rows.slice(0, limit) : rows;
    return page.map(copy);
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) { return select(object, ast?.where, ast?.limit); },
    async findOne(object: string, ast: any) { return select(object, ast?.where, 1)[0] ?? null; },
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
  return { driver, storeFor };
}

const OWNER_PACKAGE = 'com.objectstack.test.activity-summary-title-writer-scope';
/** The record the restricted writers may not read (or whose title they may not read). */
const SEALED = 'vlt_sealed_000000000000000000000';
const SEALED_TITLE = 'Sealed Vault Title';
/** A record every writer may read. */
const OPEN = 'vlt_open_00000000000000000000000';
const OPEN_TITLE = 'Open Vault Title';

const ALLOWED_WRITER = 'usr_allowed_writer';
/** Its row scope leaves the sealed vault out of every result. */
const ROW_REFUSED_WRITER = 'usr_row_refused_writer';
/** Refused every read of the vault object. */
const OBJECT_REFUSED_WRITER = 'usr_object_refused_writer';
/** Served vault rows without their `name` column. */
const NAMELESS_WRITER = 'usr_nameless_writer';

async function boot() {
  const engine = new ObjectQL();
  const store = makeStore();
  engine.registerDriver(store.driver, true);
  await engine.init();
  for (const o of [sysAuditLog, sysActivity, vault, caseObject]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  installAuditWriters(engine as any, 'test.audit', { getDefaultOrganizationId: singlePostureDefaultOrganization });
  // The security layer's three answers on the referenced object, at the layer
  // it enforces on. A system read is never restricted.
  engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
    const userId = op.context && !op.context.isSystem ? op.context.userId : undefined;
    if (op.operation === 'find' && userId === OBJECT_REFUSED_WRITER) {
      throw Object.assign(new Error('PERMISSION_DENIED: no read on wst_vault'), { code: 'PERMISSION_DENIED', status: 403 });
    }
    await next();
    if (op.operation !== 'find' || !Array.isArray(op.result)) return;
    if (userId === ROW_REFUSED_WRITER) {
      op.result = op.result.filter((row: Record<string, unknown>) => row?.id !== SEALED);
    }
    if (userId === NAMELESS_WRITER) {
      op.result = op.result.map(({ name: _hidden, ...rest }: Record<string, unknown>) => rest);
    }
  }, { object: 'wst_vault' });
  const system = { context: { isSystem: true } } as any;
  await engine.insert('wst_vault', { id: SEALED, name: SEALED_TITLE }, system);
  await engine.insert('wst_vault', { id: OPEN, name: OPEN_TITLE }, system);
  await engine.insert('wst_case', { id: 'case_1', subject: 'Case One', stage: 'new', vault: SEALED }, system);
  return { engine, ...store };
}

const as = (userId: string) => ({ context: { userId } });
const asSystem = { context: { isSystem: true } };

/**
 * The activity row the write under test produced: the record's rows are its
 * seeding create and then exactly one update.
 */
const lastUpdateRow = (storeFor: (o: string) => Map<string, Record<string, unknown>>): Record<string, unknown> => {
  const rows = Array.from(storeFor('sys_activity').values()).filter((r) => r.record_id === 'case_1');
  expect(rows.map((r) => r.type)).toEqual(['created', 'updated']);
  return rows[1];
};

/** The stored summary code, serialized: the message the read side composes each reader's summary from. */
const storedCode = (row: Record<string, unknown>): string => {
  const code = JSON.parse(String(row.metadata)).summary_message;
  expect(code, 'the row stores a summary code').toBeDefined();
  return JSON.stringify(code);
};

/** A tracked change of the lookup: sealed → cleared, by `ctx`. */
const clearVault = (engine: ObjectQL, ctx: object) =>
  engine.update('wst_case', { vault: null }, { where: { id: 'case_1' }, ...ctx } as any);

/** A stage-only update that fires the milestone naming the lookup, by `ctx`. */
const escalate = (engine: ObjectQL, ctx: object) =>
  engine.update('wst_case', { stage: 'escalated' }, { where: { id: 'case_1' }, ...ctx } as any);

describe('a tracked-change summary names a referenced record by a title the writer may read, else by its id', () => {
  it('control: a writer who may read the referenced record names it by its title', async () => {
    const { engine, storeFor } = await boot();

    await clearVault(engine, as(ALLOWED_WRITER));

    const row = lastUpdateRow(storeFor);
    expect(String(row.summary)).toContain(SEALED_TITLE);
    expect(String(row.summary)).not.toContain(SEALED);
  });

  it('control: a system write names the referenced record by its title', async () => {
    const { engine, storeFor } = await boot();

    await clearVault(engine, asSystem);

    expect(String(lastUpdateRow(storeFor).summary)).toContain(SEALED_TITLE);
  });

  it('a writer whose row scope excludes the referenced record names it by its id', async () => {
    const { engine, storeFor } = await boot();

    await clearVault(engine, as(ROW_REFUSED_WRITER));

    const row = lastUpdateRow(storeFor);
    expect(String(row.summary)).toContain(SEALED);
    expect(String(row.summary)).not.toContain(SEALED_TITLE);
    expect(storedCode(row)).not.toContain(SEALED_TITLE);
  });

  it('a writer refused the referenced object names the record by its id, and the write still lands', async () => {
    const { engine, storeFor } = await boot();

    await clearVault(engine, as(OBJECT_REFUSED_WRITER));

    const row = lastUpdateRow(storeFor);
    expect(String(row.summary)).toContain(SEALED);
    expect(String(row.summary)).not.toContain(SEALED_TITLE);
    expect(storedCode(row)).not.toContain(SEALED_TITLE);
    expect(storeFor('wst_case').get('case_1')?.vault ?? null).toBeNull();
  });

  it('a writer served the referenced record without its title column names it by its id', async () => {
    const { engine, storeFor } = await boot();

    await clearVault(engine, as(NAMELESS_WRITER));

    const row = lastUpdateRow(storeFor);
    expect(String(row.summary)).toContain(SEALED);
    expect(String(row.summary)).not.toContain(SEALED_TITLE);
    expect(storedCode(row)).not.toContain(SEALED_TITLE);
  });

  it('the rule holds per id: one change titles the side the writer may read and keeps the id of the side it may not', async () => {
    const { engine, storeFor } = await boot();

    await engine.update('wst_case', { vault: OPEN }, { where: { id: 'case_1' }, ...as(ROW_REFUSED_WRITER) } as any);

    const row = lastUpdateRow(storeFor);
    expect(String(row.summary)).toContain(SEALED);
    expect(String(row.summary)).not.toContain(SEALED_TITLE);
    expect(String(row.summary)).toContain(OPEN_TITLE);
    expect(String(row.summary)).not.toContain(OPEN);
  });
});

describe('a fired milestone summary names a referenced record by a title the writer may read, else by its id', () => {
  it('control: a writer who may read the referenced record names it by its title', async () => {
    const { engine, storeFor } = await boot();

    await escalate(engine, as(ALLOWED_WRITER));

    expect(lastUpdateRow(storeFor).summary).toBe(`Escalated to ${SEALED_TITLE}`);
  });

  it('control: a system write names the referenced record by its title', async () => {
    const { engine, storeFor } = await boot();

    await escalate(engine, asSystem);

    expect(lastUpdateRow(storeFor).summary).toBe(`Escalated to ${SEALED_TITLE}`);
  });

  it('a writer whose row scope excludes the referenced record names it by its id', async () => {
    const { engine, storeFor } = await boot();

    await escalate(engine, as(ROW_REFUSED_WRITER));

    const row = lastUpdateRow(storeFor);
    expect(row.summary).toBe(`Escalated to ${SEALED}`);
    expect(String(row.metadata)).not.toContain(SEALED_TITLE);
  });

  it('a writer refused the referenced object names the record by its id, and the write still lands', async () => {
    const { engine, storeFor } = await boot();

    await escalate(engine, as(OBJECT_REFUSED_WRITER));

    const row = lastUpdateRow(storeFor);
    expect(row.summary).toBe(`Escalated to ${SEALED}`);
    expect(String(row.metadata)).not.toContain(SEALED_TITLE);
    expect(storeFor('wst_case').get('case_1')?.stage).toBe('escalated');
  });

  it('a writer served the referenced record without its title column names it by its id', async () => {
    const { engine, storeFor } = await boot();

    await escalate(engine, as(NAMELESS_WRITER));

    const row = lastUpdateRow(storeFor);
    expect(row.summary).toBe(`Escalated to ${SEALED}`);
    expect(String(row.metadata)).not.toContain(SEALED_TITLE);
  });
});
