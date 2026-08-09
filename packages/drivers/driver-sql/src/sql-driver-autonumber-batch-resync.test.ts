// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6943] `bulkCreate` and `upsert` re-seed a stale autonumber counter, the way
 * `create()` began to at #5495.
 *
 * # Two different shapes, measured rather than assumed
 *
 * The card said these two "burn a number per collision, like `create()`". Only
 * one of them does.
 *
 * **`upsert` does** — it is single-row, so a stale counter costs it exactly one
 * burned number per call, which is `create()`'s pre-#5495 shape exactly. Its
 * `ON CONFLICT (mergeKeys) DO UPDATE` absorbs a conflict on the merge key only;
 * the tenanted autonumber lives under a *different* unique index, so its
 * violation is still raised. Measured on `main` @ `c8ff269`: `last_value`
 * 1 → 2 → 3 across two refused upserts.
 *
 * **`bulkCreate` does not — it is worse.** Every row reserves its own number in
 * its own committed transaction, then the whole batch goes in as ONE insert. So
 * one colliding row burns *every* number the batch reserved and fails the whole
 * request. Measured on the same commit, counter at 10 with rows 11–39 landed by
 * a bypass path:
 *
 * | 3-row `bulkCreate` | before | after |
 * |:---|:---|:---|
 * | caller-visible failures | **2 of 2 calls threw** | **0** |
 * | rows written | **0** | 3 |
 * | `last_value` | 10 → 13, then 13 → 16 | 10 → 42, by one re-seed |
 *
 * And this is the worst path to have no recovery on: framework#2678 made
 * `bulkCreate` the common case for seed/import, and seed/import is precisely
 * what *creates* the staleness — an `isSystem` replay or a `preserveAudit`
 * import keeps its explicit numbers and never enters `fillAutoNumberFields`
 * (#5495/#5503).
 *
 * # Batch semantics are unchanged, and that is a measurement, not a taste
 *
 * The card expected a decision about partial success and transaction
 * boundaries. There is none to make: `insert(rows[])` is a SINGLE statement, so
 * the batch is already all-or-nothing — the failed batch above left the table
 * exactly as it found it (31 rows before, 31 after). Re-issuing and retrying
 * the whole batch therefore preserves the existing contract exactly. The
 * alternatives that would have changed it — per-row retry, a driver-opened
 * transaction — are rejected in `bulkCreate`'s own comment with the reasons.
 *
 * # The one thing the batch may NOT borrow from `create()`
 *
 * `create()` keeps a reservation that did not collide, to avoid burning a
 * second number. A batch cannot: one that straddles the seeded range has its
 * low rows collide and its high rows not, and regenerating only the low ones
 * hands them numbers *above* the kept ones — an intra-batch duplicate the
 * driver would have manufactured itself. So re-issue is per *counter*: every
 * row drawn from a counter that went stale is re-issued. Pinned below.
 *
 * # On the assertion style
 *
 * Same as #5495's file, and for the same reason: ADR-0112's `code`/`status`
 * envelope is a *wire* contract, and what a refused INSERT throws here is the
 * driver's raw error, which carries neither. These assert something stronger
 * than a bare `toThrow()`: the specific constraint text, `isUniqueViolationError`
 * agreeing, and — for the cases that must NOT be retried — that the error names
 * the CALLER's field and that no row landed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isUniqueViolationError } from '@objectstack/types';
import { SqlDriver } from './index.js';

const SEQUENCES_TABLE = '_objectstack_sequences';

const CRM_CASE = {
  name: 'crm_case',
  fields: {
    organization_id: { type: 'string' },
    case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
    title: { type: 'string' },
  },
} as any;

describe('[#6943] batch and upsert re-seed a stale autonumber counter', () => {
  let driver: SqlDriver;

  const knex = () => (driver as any).knex;

  const lastValue = async (tenant: string): Promise<number | undefined> => {
    const rows = await knex()(SEQUENCES_TABLE).select('*');
    const row = rows.find((r: any) => r.object === 'crm_case' && r.field === 'case_number' && r.tenant_id === tenant);
    return row ? Number(row.last_value) : undefined;
  };

  /** Land rows by a path that bypasses `fillAutoNumberFields`, as a seed replay does. */
  const bypassInsert = async (org: string, from: number, to: number) => {
    const rows = [];
    for (let n = from; n <= to; n++) {
      rows.push({ id: `${org}-s${n}`, organization_id: org, case_number: `CASE-${String(n).padStart(5, '0')}`, title: `seed ${n}` });
    }
    await knex()('crm_case').insert(rows);
  };

  const rowCount = async () => Number((await knex()('crm_case').count({ c: '*' }).first()).c);

  /** Every `case_number` in the table, for the duplicate check. */
  const allNumbers = async (): Promise<string[]> =>
    (await knex()('crm_case').select('case_number')).map((r: any) => r.case_number);

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  // ---------------------------------------------------------------- bulkCreate

  it('serves a batch that used to fail outright, and burns the batch only once', async () => {
    await driver.initObjects([CRM_CASE]);

    await bypassInsert('orgA', 9, 9);
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' }); // counter -> 10
    await bypassInsert('orgA', 11, 39); // seeds land ABOVE the counter; nothing tells the sequence

    const created = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'b1' },
      { organization_id: 'orgA', title: 'b2' },
      { organization_id: 'orgA', title: 'b3' },
    ]);

    // Before this change the same call threw and wrote nothing.
    expect(created.map((r: any) => r.case_number)).toEqual(['CASE-00040', 'CASE-00041', 'CASE-00042']);
    expect(await rowCount()).toBe(34);

    // And the counter is simply +1 from here — re-seeding is not a mode the
    // driver stays in.
    const next = await driver.bulkCreate('crm_case', [{ organization_id: 'orgA', title: 'b4' }]);
    expect(next[0].case_number).toBe('CASE-00043');
  });

  it('re-issues the WHOLE batch drawn from a stale counter, so it cannot duplicate itself', async () => {
    // The straddle case: the batch is longer than the stale gap, so its low
    // rows collide and its high rows do not. Re-issuing only the collided ones
    // would hand them numbers above the kept ones.
    await driver.initObjects([CRM_CASE]);

    await bypassInsert('orgA', 9, 9);
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' }); // counter -> 10
    await bypassInsert('orgA', 11, 39);

    const batch = Array.from({ length: 60 }, (_, i) => ({ organization_id: 'orgA', title: `straddle ${i}` }));
    const created = await driver.bulkCreate('crm_case', batch);

    expect(created).toHaveLength(60);
    const numbers = await allNumbers();
    expect(new Set(numbers).size).toBe(numbers.length); // no duplicate anywhere in the table
    // Every row of the batch sits above the seeded range it straddled.
    for (const r of created) expect(Number(r.case_number.slice('CASE-'.length))).toBeGreaterThan(39);
  });

  it('re-seeds only the counter that went stale, leaving a co-tenant in the same batch alone', async () => {
    await driver.initObjects([CRM_CASE]);

    await driver.create('crm_case', { organization_id: 'orgA', title: 'a1' }); // A -> 1
    await driver.create('crm_case', { organization_id: 'orgB', title: 'b1' }); // B -> 1
    await bypassInsert('orgA', 2, 20); // only A goes stale

    const created = await driver.bulkCreate('crm_case', [
      { organization_id: 'orgA', title: 'a2' },
      { organization_id: 'orgA', title: 'a3' },
      { organization_id: 'orgB', title: 'b2' },
    ]);

    expect(created.map((r: any) => r.case_number)).toEqual(['CASE-00021', 'CASE-00022', 'CASE-00002']);
    // B never collided, so its reservation was kept rather than burned and
    // re-issued: one number consumed, not two.
    expect(await lastValue('orgB')).toBe(2);
  });

  it('does not swallow a duplicate the CALLER supplied, and still writes nothing', async () => {
    await driver.initObjects([
      {
        name: 'crm_case',
        fields: {
          organization_id: { type: 'string' },
          email: { type: 'string', unique: 'global' },
          case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
          title: { type: 'string' },
        },
      } as any,
    ]);

    await driver.create('crm_case', { organization_id: 'orgA', email: 'dup@example.com', title: 'one' });
    const before = await rowCount();

    const caught = await driver
      .bulkCreate('crm_case', [
        { organization_id: 'orgA', email: 'fresh@example.com', title: 'ok' },
        { organization_id: 'orgA', email: 'dup@example.com', title: 'the caller’s 409' },
      ])
      .then(() => undefined, (e: unknown) => e);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/UNIQUE constraint failed|duplicate key value/);
    expect(isUniqueViolationError(caught)).toBe(true);
    // The 409 is the client's: not retried away, and the batch is still
    // all-or-nothing — the sibling row did not sneak in.
    expect(await rowCount()).toBe(before);
  });

  it('leaves the caller-transaction path exactly as it was', async () => {
    await driver.initObjects([CRM_CASE]);
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' });
    await bypassInsert('orgA', 2, 2);

    const before = await lastValue('orgA');
    const caught = await knex()
      .transaction(async (trx: any) => {
        await driver.bulkCreate(
          'crm_case',
          [{ organization_id: 'orgA', title: 't1' }, { organization_id: 'orgA', title: 't2' }],
          { transaction: trx } as any,
        );
      })
      .then(() => undefined, (e: unknown) => e);

    // Still refused, and nothing burned: the sequence UPDATE shares the
    // caller's transaction and rolls back with the refused INSERT. On Postgres
    // a constraint failure aborts the transaction outright, so a retry issued
    // on it could not succeed — the caller owns that retry.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/UNIQUE constraint failed|duplicate key value/);
    expect(await lastValue('orgA')).toBe(before);
  });

  it('leaves a batch with no autonumber field completely untouched', async () => {
    await driver.initObjects([
      { name: 'note', fields: { organization_id: { type: 'string' }, body: { type: 'string' } } } as any,
    ]);
    const created = await driver.bulkCreate('note', [
      { organization_id: 'orgA', body: 'one' },
      { organization_id: 'orgA', body: 'two' },
    ]);
    expect(created).toHaveLength(2);
  });

  // -------------------------------------------------------------------- upsert

  it('upsert: serves the insert that used to be refused by a stale counter', async () => {
    await driver.initObjects([CRM_CASE]);

    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' }); // counter -> 1
    await bypassInsert('orgA', 2, 20);

    const upserted = await driver.upsert('crm_case', { organization_id: 'orgA', title: 'u1' });
    expect(upserted.case_number).toBe('CASE-00021');

    // +1 from here, like every other path.
    expect((await driver.upsert('crm_case', { organization_id: 'orgA', title: 'u2' })).case_number).toBe('CASE-00022');
  });

  it('upsert: a duplicate on a CALLER-supplied unique field still reaches the caller', async () => {
    await driver.initObjects([
      {
        name: 'crm_case',
        fields: {
          organization_id: { type: 'string' },
          email: { type: 'string', unique: 'global' },
          case_number: { type: 'autonumber', format: 'CASE-{00000}', unique: true },
          title: { type: 'string' },
        },
      } as any,
    ]);

    await driver.create('crm_case', { organization_id: 'orgA', email: 'dup@example.com', title: 'one' });

    const caught = await driver
      .upsert('crm_case', { organization_id: 'orgA', email: 'dup@example.com', title: 'two' })
      .then(() => undefined, (e: unknown) => e);

    expect(caught).toBeInstanceOf(Error);
    expect(isUniqueViolationError(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/email/);
  });

  it('upsert: an explicit autonumber value is preserved, never regenerated', async () => {
    await driver.initObjects([CRM_CASE]);
    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });

    const caught = await driver
      .upsert('crm_case', { organization_id: 'orgA', case_number: 'CASE-00001', title: 'explicit duplicate' })
      .then(() => undefined, (e: unknown) => e);

    expect(caught).toBeInstanceOf(Error);
    expect(isUniqueViolationError(caught)).toBe(true);
    // A caller-supplied value is not a reservation, so no probe and no retry
    // can apply to it — and no number was consumed.
    expect(await lastValue('orgA')).toBe(1);
  });

  it('upsert: leaves the caller-transaction path exactly as it was', async () => {
    await driver.initObjects([CRM_CASE]);
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' });
    await bypassInsert('orgA', 2, 2);

    const before = await lastValue('orgA');
    const caught = await knex()
      .transaction(async (trx: any) => {
        await driver.upsert('crm_case', { organization_id: 'orgA', title: 'in-trx' }, undefined, { transaction: trx } as any);
      })
      .then(() => undefined, (e: unknown) => e);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/UNIQUE constraint failed|duplicate key value/);
    expect(await lastValue('orgA')).toBe(before);
  });

  it('upsert: still merges onto an existing row rather than inserting a second', async () => {
    // The merge branch is untouched by this change — kept here so a future
    // edit to the retry loop cannot quietly turn an update into an insert.
    await driver.initObjects([CRM_CASE]);
    const first = await driver.create('crm_case', { organization_id: 'orgA', title: 'original' });

    const merged = await driver.upsert('crm_case', { id: first.id, organization_id: 'orgA', title: 'edited' });
    expect(merged.id).toBe(first.id);
    expect(merged.title).toBe('edited');
    expect(await rowCount()).toBe(1);
  });
});
