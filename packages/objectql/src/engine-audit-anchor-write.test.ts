// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#4447] `created_at` is engine-owned: a client-supplied value on an ordinary
 * write is DROPPED, not persisted.
 *
 * Reproduction harness: a REAL {@link ObjectQL} engine over a minimal in-memory
 * driver whose `update` lets incoming data win (`{...cur, ...data}`) — the same
 * shape driver-sql has, which is why a value that survives the engine's strip
 * reaches the row.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const taskObject = {
  name: 'audit_task',
  label: 'Task',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    progress: { name: 'progress', label: 'Progress', type: 'number' as const },
  },
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
    },
    findStream() { throw new Error('not implemented'); },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      // driver-sql's `stampInsertTimestamps`: fills the audit timestamps ONLY
      // when absent, so a supplied `created_at` survives the driver. That is
      // why the insert-side protection has to be the engine's strip.
      const row: Record<string, unknown> = { ...data, id };
      const iso = new Date(Date.now() - 86_400_000).toISOString();
      if (row.created_at == null) row.created_at = iso;
      if (row.updated_at == null) row.updated_at = iso;
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      // driver-sql's `update`: incoming data wins, and it force-advances
      // `updated_at` but never touches `created_at`. So anything the engine
      // failed to strip off `created_at` lands on the row — which is exactly
      // why `updated_at` LOOKED protected while the anchor did not.
      const updated = { ...cur, ...data, id, updated_at: new Date().toISOString() };
      s.set(id, updated);
      return updated;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
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
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

const FORGED = '1999-01-01T00:00:00.000Z';

describe('[#4447] created_at is engine-owned on an ordinary write', () => {
  let engine: ObjectQL;

  beforeEach(async () => {
    engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(taskObject as any);
  });

  /** An ordinary authenticated caller — NOT `isSystem`, no `preserveAudit`. */
  const userCtx = { userId: 'u1' };

  async function seed() {
    return engine.insert('audit_task', { title: 'T', progress: 1 }, { context: userCtx } as any);
  }

  it('the injected field metadata marks it read-only and system', () => {
    // The premise: if this is ever `readonly: false`, the strip has nothing to
    // key off and every assertion below becomes vacuous.
    const schema: any = engine.registry.getObject('audit_task');
    expect(schema.fields.created_at).toMatchObject({ readonly: true, system: true });
  });

  it('a client-supplied created_at on UPDATE is dropped, not persisted', async () => {
    const row: any = await seed();
    const realCreatedAt = row.created_at;
    expect(realCreatedAt).toBeTruthy();

    await engine.update(
      'audit_task',
      { progress: 42, created_at: FORGED },
      { where: { id: row.id }, context: userCtx } as any,
    );

    const after: any = await engine.findOne('audit_task', { where: { id: row.id } } as any);
    // The legitimate half of the same request still lands.
    expect(after.progress).toBe(42);
    // The audit anchor does not move.
    expect(after.created_at).toBe(realCreatedAt);
    expect(after.created_at).not.toBe(FORGED);
  });

  it('reports the drop through onFieldsDropped, so the caller is not left guessing', async () => {
    const row: any = await seed();
    const dropped: any[] = [];
    await engine.update(
      'audit_task',
      { progress: 7, created_at: FORGED },
      {
        where: { id: row.id },
        context: userCtx,
        onFieldsDropped: (e: any) => dropped.push(e),
      } as any,
    );
    // #3794's `droppedFields` contract: this is exactly the case the key exists
    // for, and it had no live producer on the audit trio before this fix.
    expect(dropped.flatMap((e) => e.fields)).toContain('created_at');
  });

  it('its two siblings behave the same way — one posture, not three', async () => {
    const row: any = await seed();
    const before: any = await engine.findOne('audit_task', { where: { id: row.id } } as any);

    await engine.update(
      'audit_task',
      { progress: 3, created_at: FORGED, created_by: 'forged_user', updated_by: 'forged_user' },
      { where: { id: row.id }, context: userCtx } as any,
    );

    const after: any = await engine.findOne('audit_task', { where: { id: row.id } } as any);
    expect(after.created_at).toBe(before.created_at);
    expect(after.created_by).toBe(before.created_by);
    expect(after.updated_by).not.toBe('forged_user');
  });


  it('a bulk update cannot forge it either — the call site, not just the switch', async () => {
    // AGENTS.md PD #10's lesson: a guard wired into single-id writes only is
    // still a hole one call site over.
    const row: any = await seed();
    const before: any = await engine.findOne('audit_task', { where: { id: row.id } } as any);

    await engine.update(
      'audit_task',
      { progress: 9, created_at: FORGED },
      { where: { progress: 1 }, multi: true, context: userCtx } as any,
    );

    const after: any = await engine.findOne('audit_task', { where: { id: row.id } } as any);
    expect(after.created_at).toBe(before.created_at);
  });

  it('the historical-import path may still reinstate it (preserveAudit)', async () => {
    // The deliberate escape hatch #3479/#3493 argues for. It must keep working:
    // this fix closes the ORDINARY write path, it does not remove back-dating.
    const row: any = await seed();
    await engine.update(
      'audit_task',
      { created_at: FORGED },
      { where: { id: row.id }, context: { ...userCtx, preserveAudit: true } } as any,
    );
    const after: any = await engine.findOne('audit_task', { where: { id: row.id } } as any);
    expect(after.created_at).toBe(FORGED);
  });

  it('a system-context write is still exempt', async () => {
    const row: any = await seed();
    await engine.update(
      'audit_task',
      { created_at: FORGED },
      { where: { id: row.id }, context: { isSystem: true } } as any,
    );
    const after: any = await engine.findOne('audit_task', { where: { id: row.id } } as any);
    expect(after.created_at).toBe(FORGED);
  });
});

// ---------------------------------------------------------------------------
// The ROOT CAUSE. `showcase_task` never declares `created_at` in source, yet
// the built app artifact ships one:
//
//   "created_at": {"label":"Created At","type":"datetime","readonly":false, …}
//
// i.e. a materialized field carrying only FieldSchema DEFAULTS. Because the
// object then HAS the field, `applySystemFields` skipped injecting
// `AUDIT_FIELD_DEFS.created_at` (`readonly: true`) and the author-wins merge
// let the default-valued one through — so `stripReadonlyFields` had nothing to
// key off and a forged value went straight to the row.
// ---------------------------------------------------------------------------
describe('[#4447] a declared audit field cannot loosen the platform posture', () => {
  const shadowed = {
    name: 'audit_shadow',
    label: 'Shadowed',
    fields: {
      id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
      title: { name: 'title', label: 'Title', type: 'text' as const },
      // Verbatim from examples/app-showcase/dist/objectstack.json.
      created_at: {
        label: 'Created At', type: 'datetime' as const, required: false,
        searchable: false, multiple: false, unique: false,
        deleteBehavior: 'set_null' as const, hidden: false,
        readonly: false, sortable: true, externalId: false,
      },
    },
  };

  let engine: ObjectQL;
  beforeEach(async () => {
    engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(shadowed as any);
  });

  it('the registry restores the engine-owned governance', () => {
    const schema: any = engine.registry.getObject('audit_shadow');
    expect(schema.fields.created_at).toMatchObject({ readonly: true, system: true });
    // …without discarding what the author legitimately set.
    expect(schema.fields.created_at.label).toBe('Created At');
    expect(schema.fields.created_at.sortable).toBe(true);
  });

  it('and the forged PATCH no longer lands — the issue\'s exact repro', async () => {
    const row: any = await engine.insert(
      'audit_shadow', { title: 'T' }, { context: { userId: 'u1' } } as any,
    );
    const real = row.created_at;
    await engine.update(
      'audit_shadow',
      { title: 'T2', created_at: FORGED },
      { where: { id: row.id }, context: { userId: 'u1' } } as any,
    );
    const after: any = await engine.findOne('audit_shadow', { where: { id: row.id } } as any);
    expect(after.title).toBe('T2');
    expect(after.created_at).toBe(real);
  });

  it('an author keeps every non-governance key they declared', () => {
    engine.registry.registerObject({
      name: 'audit_labelled',
      label: 'Labelled',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        created_at: {
          label: '建档时间', type: 'datetime' as const,
          description: 'When the file was opened', hidden: true, group: 'meta',
        },
      },
    } as any);
    const f: any = engine.registry.getObject('audit_labelled').fields.created_at;
    expect(f).toMatchObject({
      label: '建档时间',
      description: 'When the file was opened',
      hidden: true,
      group: 'meta',
      readonly: true,
      system: true,
    });
  });
});
