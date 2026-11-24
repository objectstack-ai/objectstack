// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0153 D4] The sync-in provenance columns on a `managedBy: 'synced'`
 * object, as the registry and the engine hold them:
 *
 *  - `applySystemFields` injects the five `_sync_` columns the spec's plan
 *    names, and the (`organization_id`, `_sync_source`, `_sync_external_id`)
 *    index after the tenant index; its write-side inverse takes the index off
 *    again so a served document round-trips;
 *  - the engine refuses a `_sync_` column in any write but the pull's,
 *    `isSystem` included, and the pull's mark reaches exactly the one write it
 *    is put on — a hook's `ctx.api` write inside it is refused like any other,
 *    and so is a `_sync_` key a `before*` hook assigns, changes or removes,
 *    on any write, the pull's own included.
 *
 * A REAL {@link ObjectQL} over a minimal stub driver, the shape
 * `engine-audit-anchor-write.test.ts` uses.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SYNC_PROVENANCE_COLUMNS, SYNC_PROVENANCE_FIELD_DEFS } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { applySystemFields } from './registry.js';
import { provisionSyncProvenanceIndex, stripProvisionedSyncProvenanceIndexFrom } from './sync-provenance-index.js';
import {
  SYNC_PROVENANCE_WRITE_REFUSED_CODE,
  SYNC_PULL_WRITE,
  markSyncPullWrite,
} from './sync-provenance-write.js';

const SYNCED = {
  name: 'erp_customer',
  label: 'ERP customer',
  managedBy: 'synced',
  sharingModel: 'read',
  fields: {
    code: { name: 'code', label: 'Code', type: 'text' as const },
    title: { name: 'title', label: 'Title', type: 'text' as const },
  },
};

const PLAIN = {
  name: 'crm_note',
  label: 'Note',
  fields: { title: { name: 'title', label: 'Title', type: 'text' as const } },
};

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const calls = { create: 0, update: 0 };
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
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      calls.create += 1;
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row: Record<string, unknown> = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      calls.update += 1;
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const updated = { ...cur, ...data, id };
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
    async updateMany() { return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores, calls };
}

describe('[ADR-0153 D4] applySystemFields — the provenance columns and their index on a synced object', () => {
  it('injects the five _sync_ columns, each the platform definition', () => {
    const out: any = applySystemFields(SYNCED as any, { multiTenant: false });
    for (const name of SYNC_PROVENANCE_COLUMNS) {
      expect(out.fields[name]).toEqual(SYNC_PROVENANCE_FIELD_DEFS[name]);
      expect(out.fields[name]).toMatchObject({ readonly: true, system: true, hidden: true });
    }
  });

  it('CONTROL: an object of no other bucket gets none of them', () => {
    const out: any = applySystemFields(PLAIN as any, { multiTenant: true });
    for (const name of SYNC_PROVENANCE_COLUMNS) expect(out.fields[name]).toBeUndefined();
    expect(out.fields.owner_id).toBeDefined();
  });

  it('withholds them where the plan withholds every column (systemFields: false)', () => {
    const out: any = applySystemFields({ ...SYNCED, systemFields: false } as any, { multiTenant: true });
    for (const name of SYNC_PROVENANCE_COLUMNS) expect(out.fields[name]).toBeUndefined();
    expect(out.indexes).toBeUndefined();
  });

  it('appends the provenance index LAST, after the tenant index, led by the tenant column', () => {
    const out: any = applySystemFields(SYNCED as any, { multiTenant: true });
    expect(out.indexes).toEqual([
      { fields: ['organization_id'] },
      { fields: ['organization_id', '_sync_source', '_sync_external_id'] },
    ]);
  });

  it('drops the tenant column from the index when the object has none', () => {
    const out: any = applySystemFields({ ...SYNCED, tenancy: { enabled: false } } as any, { multiTenant: true });
    expect(out.fields.organization_id).toBeUndefined();
    expect(out.indexes).toEqual([{ fields: ['_sync_source', '_sync_external_id'] }]);
  });

  it('keeps an author index of the same columns instead of adding a second one', () => {
    const declared = { ...SYNCED, indexes: [{ fields: ['organization_id', '_sync_source', '_sync_external_id'], name: 'mine' }] };
    const out: any = applySystemFields(declared as any, { multiTenant: false });
    expect(out.indexes).toEqual(declared.indexes);
  });

  it('is idempotent: a second pass over the registered schema adds nothing', () => {
    const once: any = applySystemFields(SYNCED as any, { multiTenant: true });
    expect(provisionSyncProvenanceIndex(once)).toBe(once);
  });

  it('the write-side inverse takes the stamp off, and leaves the tenant stamp last for its own inverse', () => {
    const served: any = applySystemFields(SYNCED as any, { multiTenant: true });
    const stripped: any = stripProvisionedSyncProvenanceIndexFrom(served);
    expect(stripped.indexes).toEqual([{ fields: ['organization_id'] }]);
  });

  it('the inverse runs on a body whose injected columns are already gone (plan-gated)', () => {
    const body = { ...SYNCED, indexes: [{ fields: ['organization_id', '_sync_source', '_sync_external_id'] }] };
    const stripped: any = stripProvisionedSyncProvenanceIndexFrom(body);
    expect('indexes' in stripped).toBe(false);
  });

  it('CONTROL: the inverse keeps an author entry (a name) and any entry on another bucket', () => {
    const named = { ...SYNCED, indexes: [{ fields: ['_sync_source', '_sync_external_id'], name: 'mine' }] };
    expect(stripProvisionedSyncProvenanceIndexFrom(named)).toBe(named);
    const other = { ...PLAIN, indexes: [{ fields: ['_sync_source', '_sync_external_id'] }] };
    expect(stripProvisionedSyncProvenanceIndexFrom(other)).toBe(other);
  });
});

describe('[ADR-0153 D4] the engine refuses a _sync_ column in any write but the pull\'s', () => {
  let engine: ObjectQL;
  let rig: ReturnType<typeof makeStubDriver>;
  const system = { isSystem: true };

  beforeEach(async () => {
    engine = new ObjectQL();
    rig = makeStubDriver();
    engine.registerDriver(rig.driver, true);
    await engine.init();
    engine.registry.registerObject(SYNCED as any);
    engine.registry.registerObject(PLAIN as any);
  });

  it('the registered synced object carries the columns and the index', () => {
    const schema: any = engine.registry.getObject('erp_customer');
    for (const name of SYNC_PROVENANCE_COLUMNS) expect(schema.fields[name]).toBeDefined();
    expect(schema.indexes.at(-1).fields).toContain('_sync_external_id');
  });

  it('refuses a system insert naming a _sync_ column, before the driver is asked', async () => {
    const err: any = await engine
      .insert('erp_customer', { code: 'C1', _sync_source: 'forged' }, { context: system } as any)
      .catch((e) => e);
    expect(err?.code).toBe(SYNC_PROVENANCE_WRITE_REFUSED_CODE);
    expect(err?.status).toBe(400);
    expect(err?.fields).toEqual(['_sync_source']);
    expect(rig.calls.create).toBe(0);
  });

  it('refuses a system update naming a _sync_ column, before the driver is asked', async () => {
    const row: any = await engine.insert('erp_customer', { code: 'C1' }, { context: system } as any);
    const err: any = await engine
      .update('erp_customer', { id: row.id, _sync_deleted_at: new Date().toISOString() }, { context: system } as any)
      .catch((e) => e);
    expect(err?.code).toBe(SYNC_PROVENANCE_WRITE_REFUSED_CODE);
    expect(err?.status).toBe(400);
    expect(rig.calls.update).toBe(0);
  });

  it('CONTROL: a system write of the mapped fields alone goes through', async () => {
    const row: any = await engine.insert('erp_customer', { code: 'C1', title: 'Acme' }, { context: system } as any);
    expect(row.title).toBe('Acme');
  });

  it('admits the pull\'s marked write, and the stamps land', async () => {
    const row: any = await engine.insert(
      'erp_customer',
      { code: 'C1', _sync_source: 'erp_customers', _sync_external_id: 'C1' },
      { context: markSyncPullWrite(system) } as any,
    );
    expect(row._sync_source).toBe('erp_customers');
    expect(row._sync_external_id).toBe('C1');
    const updated: any = await engine.update(
      'erp_customer',
      { id: row.id, _sync_run_id: 'run_2' },
      { context: markSyncPullWrite(system) } as any,
    );
    expect(updated._sync_run_id).toBe('run_2');
  });

  it('consumes the mark: the hooks of the pull\'s write see a context without it', async () => {
    const seen: unknown[] = [];
    engine.registerHook('beforeInsert', async (ctx: any) => {
      seen.push(ctx.input?.options?.context);
    }, { object: 'erp_customer' });
    await engine.insert('erp_customer', { code: 'C1', _sync_source: 'm' }, { context: markSyncPullWrite(system) } as any);
    expect(seen).toHaveLength(1);
    const hookContext = seen[0] as Record<PropertyKey, unknown>;
    expect(hookContext?.isSystem).toBe(true);
    expect(SYNC_PULL_WRITE in hookContext).toBe(false);
  });

  it('a beforeInsert hook that assigns a _sync_ key on a system write is refused before the driver', async () => {
    engine.registerHook('beforeInsert', async (ctx: any) => {
      ctx.input.data._sync_deleted_at = new Date().toISOString();
    }, { object: 'erp_customer' });
    const err: any = await engine.insert('erp_customer', { code: 'C1' }, { context: system } as any).catch((e) => e);
    expect(err?.code).toBe(SYNC_PROVENANCE_WRITE_REFUSED_CODE);
    expect(err?.status).toBe(400);
    expect(err?.by).toBe('hook');
    expect(err?.fields).toEqual(['_sync_deleted_at']);
    expect(rig.calls.create).toBe(0);
  });

  it('a beforeInsert hook that rewrites the pull\'s own stamp is refused, by in-place write or by replacing the payload', async () => {
    engine.registerHook('beforeInsert', async (ctx: any) => {
      if (ctx.input.data.code === 'C1') ctx.input.data._sync_source = 'forged';
      else ctx.input.data = { ...ctx.input.data, _sync_source: undefined };
    }, { object: 'erp_customer' });
    for (const code of ['C1', 'C2']) {
      const err: any = await engine
        .insert('erp_customer', { code, _sync_source: 'erp_customers' }, { context: markSyncPullWrite(system) } as any)
        .catch((e) => e);
      expect(err?.code, code).toBe(SYNC_PROVENANCE_WRITE_REFUSED_CODE);
      expect(err?.fields, code).toEqual(['_sync_source']);
    }
    expect(rig.calls.create).toBe(0);
  });

  it('a beforeUpdate hook that assigns a _sync_ key on a system update is refused before the driver', async () => {
    const row: any = await engine.insert('erp_customer', { code: 'C1' }, { context: system } as any);
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data._sync_source = 'forged';
    }, { object: 'erp_customer' });
    const err: any = await engine
      .update('erp_customer', { id: row.id, title: 'x' }, { context: system } as any)
      .catch((e) => e);
    expect(err?.code).toBe(SYNC_PROVENANCE_WRITE_REFUSED_CODE);
    expect(err?.by).toBe('hook');
    expect(rig.calls.update).toBe(0);
  });

  it('a beforeUpdate hook that rewrites the pull\'s stamp on its update is refused', async () => {
    const row: any = await engine.insert('erp_customer', { code: 'C1', _sync_run_id: 'run_1' }, { context: markSyncPullWrite(system) } as any);
    engine.registerHook('beforeUpdate', async (ctx: any) => {
      ctx.input.data._sync_run_id = 'run_x';
    }, { object: 'erp_customer' });
    const err: any = await engine
      .update('erp_customer', { id: row.id, _sync_run_id: 'run_2' }, { context: markSyncPullWrite(system) } as any)
      .catch((e) => e);
    expect(err?.code).toBe(SYNC_PROVENANCE_WRITE_REFUSED_CODE);
    expect(err?.fields).toEqual(['_sync_run_id']);
    expect(rig.calls.update).toBe(0);
  });

  it('CONTROL: a hook that writes a mapped field of the pull\'s write lets the stamps through untouched', async () => {
    engine.registerHook('beforeInsert', async (ctx: any) => {
      ctx.input.data.title = 'from hook';
    }, { object: 'erp_customer' });
    const row: any = await engine.insert(
      'erp_customer',
      { code: 'C1', _sync_source: 'erp_customers', _sync_external_id: 'C1' },
      { context: markSyncPullWrite(system) } as any,
    );
    expect(row).toMatchObject({ title: 'from hook', _sync_source: 'erp_customers', _sync_external_id: 'C1' });
  });

  it('a hook\'s ctx.api write inside the pull\'s write is refused like any other', async () => {
    let nested: any;
    engine.registerHook('beforeInsert', async (ctx: any) => {
      nested = await ctx.api.object('erp_customer').insert({ code: 'X', _sync_source: 'forged' }).catch((e: unknown) => e);
    }, { object: 'crm_note' });
    await engine.insert('crm_note', { title: 'n' }, { context: markSyncPullWrite(system) } as any);
    expect(nested?.code).toBe(SYNC_PROVENANCE_WRITE_REFUSED_CODE);
  });
});
