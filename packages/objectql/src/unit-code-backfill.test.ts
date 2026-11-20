// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0158 U7 R1; Open items 8 and 12] `os migrate unit-codes` — the
// conversion of the free text a unit code field stored before it was declared
// one, on the in-memory face: a driver double whose `find` is the engine's own
// in-memory reading of a driver query (`applyDriverQueryInMemory`). ⛔ No
// driver-memory arm (`check:driver-memory-census`). The same run on SQL is the
// CLI's `unit-codes.integration.test.ts`.
//
// Every fixture row is written STRAIGHT INTO THE DRIVER STORE, below the
// engine's write check: what a database holds after a `text` column of free
// text was declared a unit code field. The run's own writes go through the
// real engine, so U5 judges each converted code like any caller's.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';
import { backfillUnitCodes, formatUnitCodeBackfillReport, unitCodeBackfillComplete, unitCodeMappingOf } from './unit-code-backfill.js';

function makeDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const finds: Record<string, number> = {};
  const writes: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
  const select = (object: string, ast: any) =>
    applyDriverQueryInMemory(Array.from(storeFor(object).values()), { where: ast?.where, orderBy: ast?.orderBy, limit: ast?.limit, offset: ast?.offset });
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
      storeFor(object).set(String(data.id), { ...data });
      return { ...data };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push({ object, id, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return select(object, ast).length; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, finds, writes };
}

const UNIT_OBJECT = {
  name: 'sys_unit',
  fields: { code: { type: 'text' }, dimension: { type: 'text' }, retired: { type: 'boolean' }, organization_id: { type: 'text' } },
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
const quiet = { info: () => {}, warn: () => {} };
type Thrown = (Error & Record<string, any>) | null;
const refusal = (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e) => e as Thrown);

describe('backfillUnitCodes — free text stored before the field was a unit code field', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  const stored = (id: string, row: Record<string, unknown>) =>
    d.storeFor('uom_material').set(id, { id, title: id, organization_id: 'org_a', ...row });
  const uom = (id: string) => d.storeFor('uom_material').get(id)?.uom;
  const run = (options: Record<string, unknown> = {}) =>
    backfillUnitCodes(engine, quiet, { object: 'uom_material', field: 'uom', ...options });
  const MAPPING = { kg: 'KGM', '公斤': 'KGM', 'kg ': 'KGM', lbs: 'LBR' };

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(UNIT_OBJECT as any);
    engine.registry.registerObject(MATERIAL as any);
    const unit = (id: string, code: string, dimension: string, retired = false, organization_id = 'org_a') =>
      d.storeFor('sys_unit').set(id, { id, code, dimension, retired, organization_id });
    unit('u1', 'JIN1', 'mass');
    unit('u2', 'SACK_50', 'mass', true);
    unit('u3', 'TAEL_1', 'mass', false, 'org_b');
    unit('u4', 'BOX_12', 'package');
    stored('m1', { uom: 'kg', weight: 1 });
    stored('m2', { uom: '公斤', weight: 2 });
    stored('m3', { uom: 'KGM', weight: 3 });   // a member: never touched
    stored('m4', { uom: 'kg ', weight: 4 });   // exact matching: its own key
    stored('m5', { uom: null, weight: 5 });    // a blank unit beside a quantity
    stored('m6', { uom: null, weight: null }); // nothing owed
    stored('m7', { uom: 'JIN1', weight: 7 });  // the organization's own unit: a member
    stored('m8', { uom: 'lbs', weight: null }); // free text with no quantity is still free text
  });

  it('a dry run lists every distinct stored value with its row count and writes nothing', async () => {
    const report = await run({ mapping: { kg: 'KGM', '公斤': 'KGM' } });
    expect(report).toMatchObject({
      field: 'uom', quantityFields: ['weight'], scannedRecords: 8, mapped: 2, written: 0, unmatched: 2,
      skippedMember: 2, skippedRetired: 0, skippedOtherDimension: 0, skippedBlank: 1, blankBesideQuantity: 1, applied: false, failures: [],
    });
    expect(report.values).toEqual([
      { value: 'JIN1', rows: 1, disposition: 'member' },
      { value: 'KGM', rows: 1, disposition: 'member' },
      { value: 'kg', rows: 1, disposition: 'mapped', code: 'KGM' },
      { value: 'kg ', rows: 1, disposition: 'unmatched' },
      { value: 'lbs', rows: 1, disposition: 'unmatched' },
      { value: '公斤', rows: 1, disposition: 'mapped', code: 'KGM' },
    ]);
    expect(d.writes).toEqual([]);
    expect(unitCodeBackfillComplete(report)).toBe(false);
  });

  it('an apply run with an unmatched value is refused before any write, naming each value and its rows', async () => {
    const err = await refusal(run({ mapping: { kg: 'KGM' }, apply: true }));
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, httpStatus: 400, field: 'mapping' });
    expect(err?.unmatched.map((v: any) => [v.value, v.rows])).toEqual([['kg ', 1], ['lbs', 1], ['公斤', 1]]);
    expect(err?.message).toContain('"kg " (1 row(s))');
    expect(d.writes).toEqual([]);
    expect(uom('m1')).toBe('kg');
  });

  it('apply rewrites the mapped values through the engine; members and blanks stay as stored', async () => {
    const report = await run({ mapping: MAPPING, apply: true });
    expect(report).toMatchObject({ mapped: 4, written: 4, unmatched: 0, skippedMember: 2, blankBesideQuantity: 1, failures: [] });
    expect(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].map(uom)).toEqual(['KGM', 'KGM', 'KGM', 'KGM', null, null, 'JIN1', 'LBR']);
    expect(d.writes.map((w) => [w.id, w.data.uom]).sort()).toEqual([['m1', 'KGM'], ['m2', 'KGM'], ['m4', 'KGM'], ['m8', 'LBR']]);
    // The quantities are the rows' own and are never rewritten.
    expect(d.storeFor('uom_material').get('m1')?.weight).toBe(1);
    // m5's blank unit beside a quantity is still refused at its next quantity edit: not complete.
    expect(unitCodeBackfillComplete(report)).toBe(false);
  });

  it('the "" entry writes a blank unit beside a quantity, and only there', async () => {
    const report = await run({ mapping: { ...MAPPING, '': 'KGM' }, apply: true });
    expect(report).toMatchObject({ mapped: 5, written: 5, blankBesideQuantity: 0, skippedBlank: 1 });
    expect(uom('m5')).toBe('KGM');
    expect(uom('m6')).toBeNull();
    expect(unitCodeBackfillComplete(report)).toBe(true);
  });

  it('is idempotent: a second apply run finds nothing to rewrite and writes nothing', async () => {
    const FULL = { ...MAPPING, '': 'KGM' };
    await run({ mapping: FULL, apply: true });
    const writes = d.writes.length;
    const again = await run({ mapping: FULL, apply: true });
    expect(again).toMatchObject({ mapped: 0, written: 0, unmatched: 0, skippedMember: 7, blankBesideQuantity: 0, skippedBlank: 1 });
    expect(d.writes.length).toBe(writes);
    expect(formatUnitCodeBackfillReport(again)).toContain('✓ Every uom_material.uom value is a unit code the field admits — nothing to convert.');
    expect(unitCodeBackfillComplete(again)).toBe(true);
  });

  it('a blank unit beside a quantity that the mapping leaves earns no ✓: the report counts it, and the run is not complete', async () => {
    await run({ mapping: MAPPING, apply: true });
    const writes = d.writes.length;
    const again = await run({ mapping: MAPPING, apply: true });
    expect(again).toMatchObject({ mapped: 0, written: 0, unmatched: 0, skippedMember: 6, blankBesideQuantity: 1 });
    expect(d.writes.length).toBe(writes);
    const lines = formatUnitCodeBackfillReport(again);
    expect(lines.some((l) => l.startsWith('✓'))).toBe(false);
    expect(lines).toContain('Nothing to rewrite from the mapping, but 1 row(s) of uom_material.uom hold no unit code the field admits (below).');
    expect(lines).toContain('⚠ 1 blank unit(s) beside a quantity left blank: each row is refused at its next quantity edit until it holds ' +
      'a unit code. A "" entry in the mapping writes them.');
    expect(unitCodeBackfillComplete(again)).toBe(false);
  });

  it('a row resting on a retired unit, or on a code of another dimension, holds a unit code: left as stored, never unmatched (L1)', async () => {
    stored('r1', { uom: 'SACK_50', weight: 9 }); // a unit org_a retired: L1 keeps the resting row's code
    stored('r2', { uom: 'MTR', weight: 3 });     // a standard code of the length dimension
    const report = await run({ mapping: { ...MAPPING, '': 'KGM' }, apply: true });
    expect(report).toMatchObject({
      mapped: 5, written: 5, unmatched: 0, skippedMember: 2, skippedRetired: 1, skippedOtherDimension: 1, blankBesideQuantity: 0, failures: [],
    });
    expect(report.values.filter((v) => ['SACK_50', 'MTR'].includes(v.value))).toEqual([
      { value: 'MTR', rows: 1, disposition: 'other-dimension' },
      { value: 'SACK_50', rows: 1, disposition: 'retired' },
    ]);
    expect([uom('r1'), uom('r2')]).toEqual(['SACK_50', 'MTR']);
    expect(d.writes.map((w) => w.id)).not.toContain('r1');
    expect(d.writes.map((w) => w.id)).not.toContain('r2');
    // Both rows are still refused at their next quantity edit, so the operator is told, and the run is not complete.
    const lines = formatUnitCodeBackfillReport(report);
    expect(lines).toContain('  "SACK_50": 1 row(s), a retired unit, left as stored (refused at its next quantity edit)');
    expect(lines).toContain('  "MTR": 1 row(s), a unit code of another dimension, left as stored (refused at its next quantity edit)');
    expect(lines).toContain('⚠ 1 row(s) rest on a retired unit, left as stored (a unit code is never rewritten): each is refused at its ' +
      'next quantity edit until the record is given a current unit.');
    expect(lines).toContain("⚠ 1 row(s) hold a unit code of another dimension than the field's unitDimension, left as stored: each is " +
      'refused at its next quantity edit until the record is corrected.');
    expect(unitCodeBackfillComplete(report)).toBe(false);
    // A second run rewrites nothing, and still earns no ✓.
    const again = await run({ mapping: { ...MAPPING, '': 'KGM' }, apply: true });
    expect(again).toMatchObject({ mapped: 0, written: 0, skippedRetired: 1, skippedOtherDimension: 1 });
    expect(formatUnitCodeBackfillReport(again)).toContain(
      'Nothing to rewrite from the mapping, but 2 row(s) of uom_material.uom hold no unit code the field admits (below).');
  });

  it.each([
    ['kgm', 'is not a unit code in organization org_a'],
    ['TAEL_1', 'is not a unit code in organization org_a'], // another organization's unit
    ['SACK_50', 'is a retired unit in organization org_a'],
    ['MTR', 'is a unit of the length dimension'],
    ['BOX_12', 'is a unit of the package dimension'],
  ])('a mapping target %s that is no member of the field is refused before any row is read', async (target, why) => {
    const err = await refusal(run({ mapping: { kg: target }, organizationId: 'org_a', apply: true }));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, httpStatus: 400, field: 'uom' });
    expect(err?.message).toContain(why);
    expect(err?.message).toContain('Refused before the walk read or wrote any row.');
    expect(d.finds.uom_material ?? 0).toBe(0);
    expect(d.writes).toEqual([]);
  });

  it('a standard target of another dimension is refused before any row is read, unscoped too', async () => {
    const err = await refusal(run({ mapping: { kg: 'MTR' } }));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'uom' });
    expect(d.finds.uom_material ?? 0).toBe(0);
  });

  it('[Open item 8] a standalone unit code field is reached by the same door', async () => {
    stored('s1', { base_uom: 'pcs' });
    stored('s2', { base_uom: 'H87' });
    stored('s3', { base_uom: '' });
    const report = await backfillUnitCodes(engine, quiet, { object: 'uom_material', field: 'base_uom', mapping: { pcs: 'H87', '': 'H87' }, apply: true });
    expect(report).toMatchObject({ field: 'base_uom', quantityFields: [], mapped: 1, written: 1, skippedMember: 1, unmatched: 0 });
    expect(d.storeFor('uom_material').get('s1')?.base_uom).toBe('H87');
    // No quantity beside it, so a blank is owed nothing, "" entry or not.
    expect(d.storeFor('uom_material').get('s3')?.base_uom).toBe('');
  });

  it.each([
    ['weight', "it is a quantity, whose unit code is stored in 'uom'; name that field"],
    ['title', 'no quantity names it in unitConfig.unitField'],
    ['nope', "'uom_material' declares no field 'nope'"],
  ])('a field %s that is no unit code field is refused before any row is read', async (field, why) => {
    const err = await refusal(run({ field, mapping: MAPPING }));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, field });
    expect(err?.message).toContain(why);
    expect(d.finds.uom_material ?? 0).toBe(0);
  });

  it('an object the registry does not declare is refused with OBJECT_NOT_FOUND', async () => {
    await expect(run({ object: 'nope' })).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
  });

  it.each([
    [['kg'], 'must be a JSON object'],
    [{ kg: 3 }, 'maps to no unit code'],
    [{ kg: ' ' }, 'maps to no unit code'],
    [{ '  ': 'KGM' }, 'a blank unit is spelled "" in the mapping'],
  ])('a malformed mapping %j is refused before any row is read', async (mapping, why) => {
    expect(() => unitCodeMappingOf(mapping)).toThrow(why);
    const err = await refusal(run({ mapping }));
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, field: 'mapping' });
    expect(d.finds.uom_material ?? 0).toBe(0);
  });

  it('the dry-run report names each value, what it would write, and claims no row or table', async () => {
    const report = await run({ mapping: MAPPING });
    expect(formatUnitCodeBackfillReport(report)).toEqual([
      'Scanned 8 row(s) of uom_material for the unit code in uom.',
      '  "JIN1": 1 row(s), already a unit code (never rewritten)',
      '  "KGM": 1 row(s), already a unit code (never rewritten)',
      '  "kg": 1 row(s), → KGM',
      '  "kg ": 1 row(s), → KGM',
      '  "lbs": 1 row(s), → LBR',
      '  "公斤": 1 row(s), → KGM',
      'Would rewrite 4 row(s) from the mapping.',
      '  e.g. m1, m2, m4, m8',
      '· Skipped: 2 row(s) already holding a unit code (never rewritten), 1 blank row(s) with no quantity (no unit owed).',
      '⚠ 1 blank unit(s) beside a quantity left blank: each row is refused at its next quantity edit until it holds a unit code. ' +
        'A "" entry in the mapping writes them.',
      'Dry run — no row or table was written. Re-run with --apply to convert.',
    ]);
  });
});

// [ADR-0144 Open item 13, ruling 6670707546, mirrored by Open item 12 point 7]
// One organization at a time; an organization code is judged in each
// organization the run writes it in.
describe('backfillUnitCodes — organizations', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  const run = (options: Record<string, unknown>) =>
    backfillUnitCodes(engine, quiet, { object: 'uom_material', field: 'uom', ...options });
  const uom = (id: string) => d.storeFor('uom_material').get(id)?.uom;

  beforeEach(async () => {
    engine = new ObjectQL();
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(UNIT_OBJECT as any);
    engine.registry.registerObject(MATERIAL as any);
    d.storeFor('sys_unit').set('u1', { id: 'u1', code: 'JIN1', dimension: 'mass', retired: false, organization_id: 'org_a' });
    for (const [id, org, value] of [['a1', 'org_a', 'jin'], ['a2', 'org_a', 'JIN1'], ['b1', 'org_b', 'jin'], ['b2', 'org_b', 'JIN1']]) {
      d.storeFor('uom_material').set(id!, { id, organization_id: org, uom: value, weight: 1 });
    }
  });

  it('an unscoped run over two organizations is refused before any write, with each one\'s counts', async () => {
    const err = await refusal(run({ mapping: { jin: 'KGM', JIN1: 'KGM' }, apply: true }));
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, field: 'organizationId' });
    expect(err?.organizations.map((o: any) => [o.organizationId, o.mapped, o.skippedMember])).toEqual([['org_a', 1, 1], ['org_b', 2, 0]]);
    expect(d.writes).toEqual([]);
  });

  it('an organization scope reads, judges and writes that organization only; its own unit is a member there', async () => {
    const report = await run({ organizationId: 'org_a', mapping: { jin: 'JIN1' }, apply: true });
    expect(report).toMatchObject({ organizationId: 'org_a', scannedRecords: 2, mapped: 1, written: 1, skippedMember: 1 });
    expect([uom('a1'), uom('b1'), uom('b2')]).toEqual(['JIN1', 'jin', 'JIN1']);
  });

  it('all organizations: an organization code is refused before any write where that organization holds no such unit', async () => {
    const err = await refusal(run({ allOrganizations: true, mapping: { jin: 'JIN1', JIN1: 'KGM' }, apply: true }));
    expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, field: 'uom' });
    expect(err?.message).toContain("'JIN1' is not a unit code in organization org_b");
    expect(err?.message).toContain('Refused before any row was written.');
    expect(d.writes).toEqual([]);
    // A standard target is a member in every organization.
    const report = await run({ allOrganizations: true, mapping: { jin: 'KGM', JIN1: 'KGM' }, apply: true });
    expect(report.organizations.map((o) => [o.organizationId, o.written])).toEqual([['org_a', 1], ['org_b', 2]]);
    expect([uom('a1'), uom('a2'), uom('b1'), uom('b2')]).toEqual(['KGM', 'JIN1', 'KGM', 'KGM']);
  });
});
