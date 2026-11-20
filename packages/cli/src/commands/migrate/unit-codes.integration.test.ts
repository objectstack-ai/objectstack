// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os migrate unit-codes` (ADR-0158 U7 R1; Open items 8 and 12): the walk on a
 * real engine over SQL (`ObjectQL` + sqlite `SqlDriver`). The in-memory face
 * is `@objectstack/objectql`'s `unit-code-backfill.test.ts`; the command's
 * flags, prompt and `--json` envelope are `unit-codes.test.ts`.
 *
 * The free text is written with the driver's own query builder, below the
 * engine's write check: what a SQL table holds after a `text` column of free
 * text was declared a unit code field. The run's writes go through the real
 * engine, so U5 judges each converted code as it judges any caller's, and
 * every value read back is the one the table stores.
 *
 * Pinned: a dry run lists each stored value and writes nothing; `--apply` over
 * a value with no mapping entry is refused `VALIDATION_ERROR` / 400 naming it,
 * before any row is written; a full mapping converts the mapped rows, the
 * organization's own unit included, and leaves members and blanks as stored;
 * a re-run reads nothing to rewrite and writes nothing (idempotent); `--org`
 * leaves another organization's rows as stored; a row resting on a retired
 * unit keeps its code (L1); a standalone `unitMode: 'code'` field is reached
 * too.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL, backfillUnitCodes, unitCodeBackfillComplete } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

const UNIT = {
  name: 'sys_unit', label: 'Unit', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    code: { name: 'code', type: 'text' as const },
    dimension: { name: 'dimension', type: 'text' as const },
    retired: { name: 'retired', type: 'boolean' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
  },
};
const MATERIAL = {
  name: 'uc_material', label: 'Material', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    organization_id: { name: 'organization_id', type: 'text' as const },
    uom: { name: 'uom', type: 'text' as const },
    weight: { name: 'weight', type: 'number' as const, unitConfig: { unitMode: 'record', unitField: 'uom', unitDimension: 'mass' } },
    base_uom: { name: 'base_uom', type: 'text' as const, unitConfig: { unitMode: 'code' } },
  },
};
const ROWS: Array<Record<string, unknown>> = [
  { id: 'm1', organization_id: 'org_a', uom: 'kg', weight: 1, base_uom: 'kg' },
  { id: 'm2', organization_id: 'org_a', uom: '公斤', weight: 2, base_uom: 'KGM' },
  { id: 'm3', organization_id: 'org_a', uom: 'KGM', weight: 3, base_uom: null },
  { id: 'm4', organization_id: 'org_a', uom: '斤', weight: 4, base_uom: null },
  { id: 'm5', organization_id: 'org_a', uom: null, weight: 5, base_uom: null },
  { id: 'm6', organization_id: 'org_a', uom: 'lbs', weight: 6, base_uom: null },
  { id: 'b1', organization_id: 'org_b', uom: 'kg', weight: 7, base_uom: null },
];
const FULL = { kg: 'KGM', '公斤': 'KGM', '斤': 'JIN1', lbs: 'LBR', '': 'KGM' };

const quiet = { info: () => {}, warn: () => {} };
type Thrown = (Error & Record<string, any>) | null;
const refusal = (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e) => e as Thrown);

describe('backfillUnitCodes on SQL (ObjectQL + SqlDriver, better-sqlite3)', () => {
  let engine: ObjectQL;
  let knex: any;
  /** Every column the table stores, read with the driver's own query builder. */
  const table = async (column: string): Promise<Record<string, unknown>> => Object.fromEntries(
    ((await knex('uc_material').select('id', column).orderBy('id')) as Array<Record<string, unknown>>).map((r) => [r.id, r[column]]),
  );
  const run = (options: Record<string, unknown>) =>
    backfillUnitCodes(engine as any, quiet, { object: 'uc_material', field: 'uom', organizationId: 'org_a', ...options });

  beforeEach(async () => {
    engine = new ObjectQL();
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [UNIT, MATERIAL]) engine.registry.registerObject(o as any);
    await engine.syncSchemas();
    knex = (driver as any).knex;
    await knex('sys_unit').insert([
      { id: 'u1', code: 'JIN1', dimension: 'mass', retired: false, organization_id: 'org_a' },
      { id: 'u2', code: 'SACK_50', dimension: 'mass', retired: true, organization_id: 'org_a' },
    ]);
    await knex('uc_material').insert(ROWS);
  });
  afterEach(async () => {
    try { await engine.destroy(); } catch { /* noop */ }
  });

  it('a dry run lists every stored value of the organization with its rows, and writes nothing', async () => {
    const before = await table('uom');
    const report = await run({ mapping: { kg: 'KGM' } });
    expect(report).toMatchObject({ scannedRecords: 6, mapped: 1, unmatched: 3, skippedMember: 1, blankBesideQuantity: 1, applied: false });
    expect(report.values.map((v) => [v.value, v.rows, v.disposition])).toEqual([
      ['KGM', 1, 'member'], ['kg', 1, 'mapped'], ['lbs', 1, 'unmatched'], ['公斤', 1, 'unmatched'], ['斤', 1, 'unmatched'],
    ]);
    expect(await table('uom')).toEqual(before);
  });

  it('--apply over a value with no mapping entry is refused VALIDATION_ERROR / 400 naming each value, before any row is written', async () => {
    const before = await table('uom');
    const err = await refusal(run({ mapping: { kg: 'KGM', '公斤': 'KGM' }, apply: true }));
    expect({ code: err?.code, status: err?.status, field: err?.field }).toEqual({ code: 'VALIDATION_ERROR', status: 400, field: 'mapping' });
    expect(err?.unmatched).toEqual([{ value: 'lbs', rows: 1, disposition: 'unmatched' }, { value: '斤', rows: 1, disposition: 'unmatched' }]);
    expect(err?.message).toContain('"lbs" (1 row(s)), "斤" (1 row(s))');
    expect(await table('uom')).toEqual(before);
  });

  it('a full mapping converts the organization\'s rows, its own unit included; members and the other organization stay as stored', async () => {
    const report = await run({ mapping: FULL, apply: true });
    expect(report).toMatchObject({ mapped: 5, written: 5, unmatched: 0, skippedMember: 1, failures: [] });
    expect(unitCodeBackfillComplete(report)).toBe(true);
    expect(await table('uom')).toEqual({ b1: 'kg', m1: 'KGM', m2: 'KGM', m3: 'KGM', m4: 'JIN1', m5: 'KGM', m6: 'LBR' });
    // The quantities are untouched: only the unit code column is written.
    expect(await table('weight')).toEqual({ b1: 7, m1: 1, m2: 2, m3: 3, m4: 4, m5: 5, m6: 6 });
  });

  it('is idempotent: a re-run reads nothing to rewrite, writes nothing, and leaves the table as the first run did', async () => {
    await run({ mapping: FULL, apply: true });
    const after = await table('uom');
    const again = await run({ mapping: FULL, apply: true });
    expect(again).toMatchObject({ scannedRecords: 6, mapped: 0, written: 0, unmatched: 0, skippedMember: 6, blankBesideQuantity: 0 });
    expect(await table('uom')).toEqual(after);
  });

  it('a retired organization unit as a target is refused INVALID_FIELD / 400 before the walk reads a row', async () => {
    const err = await refusal(run({ mapping: { ...FULL, '斤': 'SACK_50' }, apply: true }));
    expect({ code: err?.code, status: err?.status, field: err?.field }).toEqual({ code: 'INVALID_FIELD', status: 400, field: 'uom' });
    expect(err?.message).toContain('Refused before the walk read or wrote any row.');
    expect((await table('uom')).m1).toBe('kg');
  });

  it('a row resting on a retired unit holds a unit code: left as stored, never unmatched (L1)', async () => {
    await knex('uc_material').insert({ id: 'm7', organization_id: 'org_a', uom: 'SACK_50', weight: 2, base_uom: null });
    const report = await run({ mapping: FULL, apply: true });
    expect(report).toMatchObject({ mapped: 5, written: 5, unmatched: 0, skippedMember: 2, failures: [] });
    expect(report.values.find((v) => v.value === 'SACK_50')).toEqual({ value: 'SACK_50', rows: 1, disposition: 'member' });
    expect((await table('uom')).m7).toBe('SACK_50');
  });

  it('a standalone unitMode code field is reached too', async () => {
    const report = await run({ field: 'base_uom', mapping: { kg: 'KGM' }, apply: true });
    expect(report).toMatchObject({ quantityFields: [], mapped: 1, written: 1, skippedMember: 1, skippedBlank: 4 });
    expect((await table('base_uom')).m1).toBe('KGM');
  });
});
