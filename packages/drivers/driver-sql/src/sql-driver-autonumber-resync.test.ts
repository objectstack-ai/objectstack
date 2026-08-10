// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5495] The autonumber counter re-seeds from the data table when it can prove
 * a collision was its own — and refuses to when it cannot.
 *
 * # The defect
 *
 * `getNextSequenceValue` bootstraps from `MAX(existing)` exactly once, in its
 * `if (!existing)` branch. After that the data table is never consulted again.
 * Any row landing by a path that bypasses `fillAutoNumberFields` — an
 * `isSystem` seed replay, a `preserveAudit` historical import (both
 * strip-exempt under #5503, keeping their explicit numbers), or direct SQL —
 * therefore never raises the sequence, and once the counter sits below `MAX`
 * it is permanently behind. Every create then collides, burns a number and
 * fails the request, until the counter has ground past the seeded range one
 * 409 at a time.
 *
 * Measured on `main` @ `86e6f6c`, on the fixture below (counter seeded at 10,
 * rows 11–39 landed by a bypass path):
 *
 * | | before | after |
 * |:---|:---|:---|
 * | caller-visible 409s | **29** | **0** |
 * | value the caller finally got | `CASE-00040`, on attempt 30 | `CASE-00040`, on attempt 1 |
 * | `last_value` afterwards | 40, reached by 29 burns | 40, reached by one re-seed |
 *
 * That is the filing's own shape: 25 consecutive 409s climbing one per failure,
 * "a one-time storm per database" that stops once the counter grinds past the
 * seeds. Which is also why the repro here starts from a **fresh database with
 * seeded rows above the counter** — on a database already ground past them
 * every create succeeds on attempt 1 and the defect is invisible.
 *
 * # Why the retry cannot be decided from the error text
 *
 * The obvious predicate — "retry when the conflicting column is this autonumber
 * field" — needs `uniqueViolationColumn()` (#6544) to name a column. On the
 * configuration this card was filed against it never does, for two independent
 * reasons, both measured and both pinned below:
 *
 *  - the filing's own message is a **composite** —
 *    `UNIQUE constraint failed: crm_case.organization_id, crm_case.case_number`
 *    — and `uniqueViolationColumn` refuses composites by contract;
 *  - what this repo builds **today** is narrower still: ADR-0120 D3 makes the
 *    tenanted unique index `(COALESCE(organization_id,'__global__'), field)`,
 *    an *expression* index, on which SQLite reports
 *    `UNIQUE constraint failed: index 'uniq_…'` and names no column at all.
 *
 * So the "column not determinable" limb is not an edge case on this path — it
 * is the only limb that ever runs for a tenanted autonumber. The discriminator
 * is therefore the DATA (`autoNumberValueExists`): if the value this driver
 * just generated is already present, the collision was this counter's. If it is
 * not, the duplicate is on a value the caller typed and the 409 is theirs.
 *
 * # On the assertion style
 *
 * ADR-0112's `code`/`status` envelope is a *wire* contract; what a refused
 * INSERT throws here is the driver's raw error, which carries neither. These
 * tests assert something stronger than a bare `toThrow()` in its place: the
 * specific constraint text, `isUniqueViolationError` agreeing, and — for the
 * case that must NOT be retried — that the error names the CALLER's field.
 * That matches the spelling `sql-driver-unique-tenancy.test.ts` already uses,
 * which #6543 deliberately left in place for exactly this reason.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isUniqueViolationError, uniqueViolationColumn } from '@objectstack/types';
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

describe('[#5495] autonumber sequence re-seed on a provable collision', () => {
  let driver: SqlDriver;

  const knex = () => (driver as any).knex;

  /** `last_value` for one tenant's counter, or `undefined` when no row exists. */
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

  beforeEach(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('serves the create that used to take 30 attempts on the first one', async () => {
    await driver.initObjects([CRM_CASE]);

    // A fresh database holding seeded rows: the first create bootstraps from
    // MAX and is correct.
    await bypassInsert('orgA', 9, 9);
    expect((await driver.create('crm_case', { organization_id: 'orgA', title: 'first' })).case_number).toBe('CASE-00010');
    expect(await lastValue('orgA')).toBe(10);

    // More seeded rows land ABOVE the counter. Nothing tells the sequence.
    await bypassInsert('orgA', 11, 39);

    const created = await driver.create('crm_case', { organization_id: 'orgA', title: 'after the seeds' });
    expect(created.case_number).toBe('CASE-00040');
    expect(await lastValue('orgA')).toBe(40);

    // And the counter is simply +1 from here — the re-seed is not a mode the
    // driver stays in.
    expect((await driver.create('crm_case', { organization_id: 'orgA', title: 'next' })).case_number).toBe('CASE-00041');
  });

  it('re-seeds only the tenant that collided', async () => {
    await driver.initObjects([CRM_CASE]);

    await driver.create('crm_case', { organization_id: 'orgA', title: 'a1' });
    await driver.create('crm_case', { organization_id: 'orgB', title: 'b1' });
    await bypassInsert('orgA', 2, 30);

    expect((await driver.create('crm_case', { organization_id: 'orgA', title: 'a2' })).case_number).toBe('CASE-00031');
    // orgB never collided, so its counter is untouched by orgA's re-seed.
    expect((await driver.create('crm_case', { organization_id: 'orgB', title: 'b2' })).case_number).toBe('CASE-00002');
    expect(await lastValue('orgB')).toBe(2);
  });

  it('does not swallow a duplicate on a field the CALLER supplied', async () => {
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
      .create('crm_case', { organization_id: 'orgA', email: 'dup@example.com', title: 'two' })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    // The 409 reaches the caller, and it is the CALLER's field that is named —
    // not retried away because some unique constraint happened to fire.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/UNIQUE constraint failed|duplicate key value/);
    expect(isUniqueViolationError(caught)).toBe(true);
    expect(uniqueViolationColumn(caught)).toBe('email');
  });

  it('re-seeds when the dialect DOES name the column (the determinable limb)', async () => {
    // No tenant column, so the unique index is single-column and SQLite names
    // it — the one shape where `uniqueViolationColumn` answers.
    await driver.initObjects([
      { name: 'contract', fields: { contract_number: { type: 'autonumber', format: 'CTR-{0000}', unique: true }, name: { type: 'string' } } } as any,
    ]);

    await driver.create('contract', { name: 'first' });
    await knex()('contract').insert({ id: 'bypass', contract_number: 'CTR-0002', name: 'seed replay' });

    expect((await driver.create('contract', { name: 'after' })).contract_number).toBe('CTR-0003');
  });

  it('leaves the caller transaction path exactly as it was', async () => {
    await driver.initObjects([CRM_CASE]);
    await driver.create('crm_case', { organization_id: 'orgA', title: 'warm' });
    await bypassInsert('orgA', 2, 2);

    const before = await lastValue('orgA');
    const caught = await knex()
      .transaction(async (trx: any) => {
        await driver.create('crm_case', { organization_id: 'orgA', title: 'in-trx' }, { transaction: trx } as any);
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    // Still refused — the caller owns the retry inside their own transaction
    // (on Postgres a constraint failure aborts it outright). And the sequence
    // UPDATE rolled back with the INSERT, so nothing was burned.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/UNIQUE constraint failed|duplicate key value/);
    expect(await lastValue('orgA')).toBe(before);
  });

  it('pins WHY the column-name predicate cannot carry this decision', async () => {
    await driver.initObjects([CRM_CASE]);

    // 1. What this repo builds today: an expression composite, on which SQLite
    //    reports the INDEX and no column.
    const indexes: any[] = await knex().raw(
      `select name, sql from sqlite_master where type='index' and tbl_name='crm_case'`,
    );
    const declared = indexes.find((r) => r.name === 'uniq_crm_case_organization_id_case_number');
    expect(declared?.sql).toContain(`COALESCE(\`organization_id\`, '__global__')`);

    await knex()('crm_case').insert({ id: 'd1', organization_id: 'orgA', case_number: 'CASE-00001', title: 'a' });
    const caught = await knex()('crm_case')
      .insert({ id: 'd2', organization_id: 'orgA', case_number: 'CASE-00001', title: 'b' })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(isUniqueViolationError(caught)).toBe(true);
    expect((caught as Error).message).toMatch(/UNIQUE constraint failed: index '/);
    expect(uniqueViolationColumn(caught)).toBeUndefined();

    // 2. And the message the filing itself reported — the plain composite that
    //    predates ADR-0120 D3 — is refused for the other reason.
    expect(
      uniqueViolationColumn('UNIQUE constraint failed: crm_case.organization_id, crm_case.case_number'),
    ).toBeUndefined();
  });

  /**
   * The three-state routing, held against the shapes Postgres and MySQL
   * actually hand knex.
   *
   * This package's unit suite boots SQLite only, so the other two dialects'
   * errors are INJECTED rather than driven through a live server — the same
   * method, and the same reason, as `sql-driver-unique-violation-predicate`.
   * What it buys: the routing is what decides whether a caller's 409 survives,
   * and on MySQL — where `uniqueViolationColumn` can never answer, by contract
   * — state 3 is the only state that exists. Reasoning about that limb is not
   * the same as pinning it.
   */
  describe('three-state routing on the dialects this package ships', () => {
    const reservation = {
      field: 'case_number',
      tableName: 'crm_case',
      prefix: 'CASE-',
      scope: '',
      suffix: '',
      tenantField: 'organization_id',
      tenantId: 'orgA',
      value: 'CASE-00001',
    };

    /** Route one injected error, against a table where `CASE-00001` DOES exist. */
    const route = async (error: unknown) => {
      const colliding = await (driver as any).collidingAutoNumberReservations(error, [reservation]);
      return colliding.map((r: any) => r.field);
    };

    beforeEach(async () => {
      await driver.initObjects([CRM_CASE]);
      await knex()('crm_case').insert({ id: 'taken', organization_id: 'orgA', case_number: 'CASE-00001', title: 'taken' });
    });

    it('state 1 — Postgres names our column in its DETAIL line', async () => {
      const err: any = new Error('insert into "crm_case" … - duplicate key value violates unique constraint "uniq_crm_case_case_number"');
      err.code = '23505';
      err.detail = 'Key (case_number)=(CASE-00001) already exists.';
      expect(uniqueViolationColumn(err)).toBe('case_number');
      expect(await route(err)).toEqual(['case_number']);
    });

    it('state 2 — Postgres names a column the CALLER supplied, so nothing is retried', async () => {
      const err: any = new Error('insert into "crm_case" … - duplicate key value violates unique constraint "uniq_crm_case_email"');
      err.code = '23505';
      err.detail = 'Key (email)=(dup@example.com) already exists.';
      expect(uniqueViolationColumn(err)).toBe('email');
      // Decided WITHOUT probing the data — and the data would have said yes,
      // since CASE-00001 is present. That is the whole point: a named column
      // that is not ours ends the matter.
      expect(await route(err)).toEqual([]);
    });

    it('state 3 — Postgres composite DETAIL names no single column, so the DATA decides', async () => {
      const err: any = new Error('insert into "crm_case" … - duplicate key value violates unique constraint "uniq_crm_case_org_case"');
      err.code = '23505';
      err.detail = 'Key (organization_id, case_number)=(orgA, CASE-00001) already exists.';
      expect(uniqueViolationColumn(err)).toBeUndefined();
      expect(await route(err)).toEqual(['case_number']);
    });

    it('state 3 — MySQL can only ever name an index, so the DATA decides there always', async () => {
      const err: any = new Error("insert into `crm_case` … - ER_DUP_ENTRY: Duplicate entry 'orgA-CASE-00001' for key 'uniq_crm_case_org_case'");
      err.errno = 1062;
      err.code = 'ER_DUP_ENTRY';
      expect(isUniqueViolationError(err)).toBe(true);
      expect(uniqueViolationColumn(err)).toBeUndefined();
      expect(await route(err)).toEqual(['case_number']);
    });

    it('state 3 — but an undeterminable violation on someone ELSE’s value is still not ours', async () => {
      const err: any = new Error("insert into `crm_case` … - ER_DUP_ENTRY: Duplicate entry 'x' for key 'uniq_crm_case_email'");
      err.errno = 1062;
      const other = { ...reservation, value: 'CASE-99999' }; // never written
      const colliding = await (driver as any).collidingAutoNumberReservations(err, [other]);
      expect(colliding).toEqual([]);
    });

    it('a failure that is not a unique violation at all is never routed here', async () => {
      const err: any = new Error('insert into `crm_case` … - NOT NULL constraint failed: crm_case.title');
      expect(isUniqueViolationError(err)).toBe(false);
      expect(await route(err)).toEqual([]);
    });
  });

  it('gives the caller the original error when the collision is not the counter’s', async () => {
    // A value the caller supplies explicitly is not a reservation, so no probe
    // and no retry can apply to it even though it IS the autonumber column.
    await driver.initObjects([CRM_CASE]);
    await driver.create('crm_case', { organization_id: 'orgA', title: 'first' });

    const caught = await driver
      .create('crm_case', { organization_id: 'orgA', case_number: 'CASE-00001', title: 'explicit duplicate' })
      .then(
        () => undefined,
        (e: unknown) => e,
      );

    expect(caught).toBeInstanceOf(Error);
    expect(isUniqueViolationError(caught)).toBe(true);
    // Unchanged: an explicit value is preserved, never regenerated.
    expect(await lastValue('orgA')).toBe(1);
  });
});
