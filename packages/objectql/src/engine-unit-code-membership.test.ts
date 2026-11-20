// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0158 U5; Open items 9 and 11] The unit-of-measure write check and the
// `sys_unit` delete refusal through the engine's own seams (insert,
// insertMany, by-id update, predicate update, the validate() preview, and
// delete), on the in-memory face: a driver double whose `find` is the
// engine's own in-memory reading of a driver query (`applyDriverQueryInMemory`).
// ⛔ No driver-memory arm (`check:driver-memory-census`).
//
// The double ignores `tenantId`, so the organization read's isolation rests
// here on its explicit `organization_id` predicate, which this file pins with
// a second organization's unit. The same seams on a real stack (SqlDriver,
// the real `sys_unit`, the shipped permission sets) are plugin-security's
// `default-permission-sets.unit-of-measure.integration.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';

function makeDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const finds: Record<string, number> = {};
  let n = 0;
  const select = (object: string, ast: any) =>
    applyDriverQueryInMemory(Array.from(storeFor(object).values()), {
      where: ast?.where, orderBy: ast?.orderBy, limit: ast?.limit, offset: ast?.offset,
    });
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      finds[object] = (finds[object] ?? 0) + 1;
      return select(object, ast).map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      const [hit] = select(object, { ...ast, limit: 1 });
      return hit ? { ...hit } : null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      const hits = select(object, ast);
      for (const r of hits) s.set(r.id as string, { ...s.get(r.id as string), ...data });
      return hits.length;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async deleteMany(object: string, ast: any) {
      const s = storeFor(object);
      const hits = select(object, ast);
      for (const r of hits) s.delete(r.id as string);
      return hits.length;
    },
    async count(object: string, ast: any) { return select(object, ast).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, finds };
}

/** The organization units' shape (`sys_unit`, owned by platform-objects; a stand-in here). */
const UNIT_OBJECT = {
  name: 'sys_unit',
  fields: {
    code: { type: 'text' },
    dimension: { type: 'text' },
    retired: { type: 'boolean' },
    organization_id: { type: 'text' },
  },
};

const MATERIAL = {
  name: 'uom_material',
  fields: {
    title: { type: 'text' },
    uom: { type: 'text' },
    weight: { type: 'number', unitConfig: { unitMode: 'record', unitField: 'uom', unitDimension: 'mass' } },
    base_uom: { type: 'text', unitConfig: { unitMode: 'code' } },
  },
};

const ORG = 'org_a';
const CTX = { context: { isSystem: true, tenantId: ORG } } as const;

type Thrown = (Error & { code?: string; status?: number; field?: string }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e) => e as Thrown);
const envelope = (e: Thrown) => e && { code: e.code, status: e.status };

async function boot() {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject(UNIT_OBJECT as any);
  engine.registry.registerObject(MATERIAL as any);
  const unit = (id: string, code: string, dimension: string, retired = false, organization_id = ORG) =>
    d.storeFor('sys_unit').set(id, { id, code, dimension, retired, organization_id });
  unit('u1', 'JIN1', 'mass');
  unit('u2', 'SACK_50', 'mass', true);
  unit('u3', 'TAEL_1', 'mass', false, 'org_b');
  return { engine, ...d };
}

describe('insert and insertMany: each stored code is a member of the row\'s organization', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  beforeEach(async () => { t = await boot(); });

  it('stores a standard code and an organization unit; a batch reads the organization\'s units once', async () => {
    const before = t.finds.sys_unit ?? 0;
    await t.engine.insert('uom_material', [
      { title: 'a', uom: 'KGM', weight: 1 },
      { title: 'b', uom: 'JIN1', weight: 2, base_uom: 'JIN1' },
      { title: 'c', base_uom: 'H87' },
    ], CTX as never);
    expect(t.storeFor('uom_material').size).toBe(3);
    expect((t.finds.sys_unit ?? 0) - before).toBe(1);
  });

  it('reads no unit row for standard codes alone', async () => {
    const before = t.finds.sys_unit ?? 0;
    await t.engine.insert('uom_material', { title: 'a', uom: 'GRM', weight: 1 }, CTX as never);
    expect((t.finds.sys_unit ?? 0) - before).toBe(0);
  });

  it.each([
    [{ uom: 'kgm', weight: 1 }, 'ERR_UNIT_CODE_UNKNOWN', 'uom'],
    [{ uom: 'TAEL_1', weight: 1 }, 'ERR_UNIT_CODE_UNKNOWN', 'uom'],
    [{ uom: 'SACK_50', weight: 1 }, 'ERR_UNIT_CODE_RETIRED', 'uom'],
    [{ uom: 'MTR', weight: 1 }, 'ERR_UNIT_DIMENSION_MISMATCH', 'uom'],
    [{ weight: 1 }, 'ERR_UNIT_CODE_REQUIRED', 'uom'],
    [{ base_uom: 'EA' }, 'ERR_UNIT_CODE_UNKNOWN', 'base_uom'],
  ])('refuses %j with %s / 400 on `%s`, and nothing is written', async (row, code, field) => {
    const e = await refusalOf(t.engine.insert('uom_material', { title: 'x', ...row }, CTX as never));
    expect({ ...envelope(e), field: e?.field }).toEqual({ code, status: 400, field });
    expect(t.storeFor('uom_material').size).toBe(0);
  });

  it('insertMany culls the refused row and stores the rest', async () => {
    const outcomes = await t.engine.insertMany('uom_material', [
      { title: 'ok', uom: 'KGM', weight: 1 },
      { title: 'retired', uom: 'SACK_50', weight: 1 },
    ], CTX as never);
    expect(outcomes.map((o: any) => [o.ok, o.error?.code])).toEqual([[true, undefined], [false, 'ERR_UNIT_CODE_RETIRED']]);
    expect([...t.storeFor('uom_material').values()].map((r) => r.title)).toEqual(['ok']);
  });
});

describe('by-id and predicate update: the row image, when the write touches the pair (Open item 9)', () => {
  let t: Awaited<ReturnType<typeof boot>>;
  const rest = (id: string, row: Record<string, unknown>) => t.storeFor('uom_material').set(id, { id, ...row });
  beforeEach(async () => {
    t = await boot();
    // Rows resting on a since-retired unit and on free text from before the declaration.
    rest('m1', { title: 'batch', uom: 'SACK_50', weight: 5 });
    rest('m2', { title: 'batch', uom: 'kg', weight: 7 });
  });

  it('a quantity edit beside a resting non-member code is refused (case 2), the row unchanged', async () => {
    const e = await refusalOf(t.engine.update('uom_material', { weight: 6 }, { where: { id: 'm1' }, ...CTX } as never));
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_RETIRED', status: 400 });
    const free = await refusalOf(t.engine.update('uom_material', { weight: 8 }, { where: { id: 'm2' }, ...CTX } as never));
    expect(envelope(free)).toEqual({ code: 'ERR_UNIT_CODE_UNKNOWN', status: 400 });
    expect(t.storeFor('uom_material').get('m1')).toMatchObject({ weight: 5 });
    expect(t.storeFor('uom_material').get('m2')).toMatchObject({ weight: 7 });
  });

  it('an edit of another field is not judged, and moving the row to a member admits the quantity', async () => {
    await t.engine.update('uom_material', { title: 'renamed' }, { where: { id: 'm1' }, ...CTX } as never);
    await t.engine.update('uom_material', { uom: 'JIN1', weight: 6 }, { where: { id: 'm1' }, ...CTX } as never);
    expect(t.storeFor('uom_material').get('m1')).toMatchObject({ title: 'renamed', uom: 'JIN1', weight: 6 });
  });

  it('a predicate update judges every matched row, and writes none when one is refused', async () => {
    const e = await refusalOf(t.engine.update('uom_material', { weight: 9 }, { where: { title: 'batch' }, multi: true, ...CTX } as never));
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_RETIRED', status: 400 });
    expect([...t.storeFor('uom_material').values()].map((r) => r.weight)).toEqual([5, 7]);
    await t.engine.update('uom_material', { uom: 'KGM', weight: 9 }, { where: { title: 'batch' }, multi: true, ...CTX } as never);
    expect([...t.storeFor('uom_material').values()].map((r) => [r.uom, r.weight])).toEqual([['KGM', 9], ['KGM', 9]]);
  });

  it('clearing the code beside a resting quantity is refused (case 3)', async () => {
    rest('m3', { title: 'one', uom: 'KGM', weight: 1 });
    const e = await refusalOf(t.engine.update('uom_material', { uom: null }, { where: { id: 'm3' }, ...CTX } as never));
    expect(envelope(e)).toEqual({ code: 'ERR_UNIT_CODE_REQUIRED', status: 400 });
  });
});

describe('validate(): the preview refuses what the write refuses', () => {
  it('insert and by-id update previews answer the unit refusal as the row\'s finding', async () => {
    const t = await boot();
    const preview = await t.engine.validate('uom_material', [
      { title: 'p1', uom: 'SACK_50', weight: 1 },
      { title: 'p2', uom: 'JIN1', weight: 1 },
    ], CTX as never);
    expect(preview.results?.map((r) => r.valid)).toEqual([false, true]);
    expect(preview.results?.[0]?.errors).toEqual([
      { field: 'uom', code: 'ERR_UNIT_CODE_RETIRED', message: expect.stringContaining('retired') },
    ]);
    t.storeFor('uom_material').set('m1', { id: 'm1', title: 'x', uom: 'kg', weight: 1 });
    const update = await t.engine.validate('uom_material', { id: 'm1', weight: 2 }, { mode: 'update', ...CTX } as never);
    expect(update.results?.[0]?.errors?.map((e) => e.code)).toEqual(['ERR_UNIT_CODE_UNKNOWN']);
    expect((await t.engine.validate('uom_material', { id: 'm1', title: 'y' }, { mode: 'update', ...CTX } as never)).valid).toBe(true);
  });
});

describe('Requirement 1 (7030061316): a `sys_unit` row is never deleted, in any context', () => {
  it.each([
    ['a system writer', { isSystem: true, tenantId: ORG }],
    ['a user', { userId: 'u_admin', tenantId: ORG }],
    ['no context at all', undefined],
  ])('refuses %s, by id and batched, ERR_UNIT_DELETE_REFUSED / 405, nothing removed', async (_who, context) => {
    const t = await boot();
    const single = await refusalOf(t.engine.delete('sys_unit', { where: { id: 'u1' }, ...(context ? { context } : {}) } as never));
    expect(envelope(single)).toEqual({ code: 'ERR_UNIT_DELETE_REFUSED', status: 405 });
    const batch = await refusalOf(t.engine.delete('sys_unit', { where: { dimension: 'mass' }, multi: true, ...(context ? { context } : {}) } as never));
    expect(envelope(batch)).toEqual({ code: 'ERR_UNIT_DELETE_REFUSED', status: 405 });
    expect(t.storeFor('sys_unit').size).toBe(3);
  });

  it('another object deletes as before', async () => {
    const t = await boot();
    t.storeFor('uom_material').set('m1', { id: 'm1', title: 'x' });
    await t.engine.delete('uom_material', { where: { id: 'm1' }, ...CTX } as never);
    expect(t.storeFor('uom_material').size).toBe(0);
  });
});
