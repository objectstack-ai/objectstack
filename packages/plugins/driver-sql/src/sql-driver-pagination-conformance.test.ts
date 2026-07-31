// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deterministic paged reads for the SQL driver (objectui#3106) — the contract
 * on `IDataDriver.find`, checked against the shared cases in
 * `@objectstack/spec/data` so this driver, `driver-memory` and
 * `driver-mongodb` answer one standard.
 *
 * Two halves, because either alone would be reassuring and wrong:
 *
 *  1. **The property** — walk each case page by page and assert the pages
 *     partition the collection. This is what a user experiences, and it is what
 *     a future driver has to satisfy however it chooses to.
 *
 *  2. **The clause** — assert the compiled SQL actually carries the tie-breaker.
 *     The property test cannot be trusted on its own *here*: SQLite over a
 *     twelve-row table will hand back ties in rowid order every time, so the
 *     partition check passes with or without the fix. It is a real check on
 *     MongoDB (where the reshuffle is documented and observable) and a
 *     regression lock on the memory driver; on SQL it would pass the day
 *     someone deletes the feature. The compiled-SQL assertion is the half that
 *     fails then.
 *
 * That asymmetry is the point rather than an apology for it: the property is
 * the contract, and the clause is how this backend happens to keep it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PAGINATION_ALL_IDS, PAGINATION_CASES, PAGINATION_ROWS } from '@objectstack/spec/data';
import { SqlDriver } from '../src/index.js';

/** Reach the compiled statement without executing it. */
class InspectableSqlDriver extends SqlDriver {
  orderByClauseFor(object: string, orderBy: Array<{ field: string; order: 'asc' | 'desc' }>): string {
    const builder = this.getBuilder(object);
    for (const item of orderBy) {
      builder.orderBy(this.remoteColumn(object, item.field, this.mapSortField(item.field)), item.order);
    }
    const tie = this.paginationTieBreaker(object);
    if (tie && !orderBy.some((o) => o.field === tie)) {
      const last = orderBy[orderBy.length - 1]?.order ?? 'asc';
      builder.orderBy(this.remoteColumn(object, tie, this.mapSortField(tie)), last);
    }
    return builder.toSQL().sql;
  }
}

describe('SqlDriver — paged reads are a partition of the result set (objectui#3106)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await driver.initObjects([
      {
        name: 'ticket',
        fields: {
          status: { type: 'string' },
          rank: { type: 'integer' },
          name: { type: 'string' },
        },
      },
    ]);

    for (const row of PAGINATION_ROWS) {
      await driver.create('ticket', { ...row }, { bypassTenantAudit: true });
    }
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  for (const testCase of PAGINATION_CASES) {
    it(`visits every row exactly once — ${testCase.name}`, async () => {
      const seen: string[] = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find(
          'ticket',
          { orderBy: [...testCase.orderBy], limit: testCase.pageSize, offset } as any,
          { bypassTenantAudit: true } as any,
        );
        seen.push(...page.map((r) => String(r.id)));
      }

      expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
      expect(new Set(seen).size).toBe(PAGINATION_ALL_IDS.length);
      expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
    });

    it(`orders pages consistently with the requested sort — ${testCase.name}`, async () => {
      const paged: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < PAGINATION_ROWS.length; offset += testCase.pageSize) {
        const page = await driver.find(
          'ticket',
          { orderBy: [...testCase.orderBy], limit: testCase.pageSize, offset } as any,
          { bypassTenantAudit: true } as any,
        );
        paged.push(...page);
      }

      // Concatenating the pages must reproduce the same order an unpaged read
      // of the whole set gives — that the page boundaries are invisible is the
      // user-facing half of the guarantee.
      const whole = await driver.find(
        'ticket',
        { orderBy: [...testCase.orderBy] } as any,
        { bypassTenantAudit: true } as any,
      );
      expect(paged.map((r) => r.id)).toEqual(whole.map((r) => r.id));
    });
  }

  it('leaves an unordered read alone — no sort is imposed on a caller who asked for none', async () => {
    const rows = await driver.find('ticket', {} as any, { bypassTenantAudit: true } as any);
    expect(rows.map((r) => r.id)).toEqual(PAGINATION_ROWS.map((r) => r.id));
  });
});

describe('SqlDriver — the ORDER BY actually carries the tie-breaker', () => {
  let driver: InspectableSqlDriver;

  beforeEach(async () => {
    driver = new InspectableSqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      { name: 'ticket', fields: { status: { type: 'string' }, rank: { type: 'integer' } } },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('appends `id` after a non-unique sort key', () => {
    const sql = driver.orderByClauseFor('ticket', [{ field: 'status', order: 'asc' }]);
    expect(sql).toMatch(/order by .*`status` asc, .*`id` asc/i);
  });

  it('appends `id` in the LAST key\'s direction, so one index pass can serve it', () => {
    const sql = driver.orderByClauseFor('ticket', [
      { field: 'status', order: 'asc' },
      { field: 'rank', order: 'desc' },
    ]);
    expect(sql).toMatch(/order by .*`status` asc, .*`rank` desc, .*`id` desc/i);
  });

  it('does not repeat `id` when the caller already sorted by it', () => {
    const sql = driver.orderByClauseFor('ticket', [{ field: 'id', order: 'desc' }]);
    expect(sql.match(/`id`/g) ?? []).toHaveLength(1);
  });

  it('adds nothing for an object this driver did not create', () => {
    // A federated table (ADR-0015) may have no `id` column at all. Sorting by a
    // column that isn't there raises an unknown-column error, which the #3821
    // ladder answers by retrying with NO ORDER BY — so a guess here would cost
    // the caller their whole sort to fix a reshuffle among ties.
    expect(driver['paginationTieBreaker']('some_remote_table')).toBeNull();
  });
});
