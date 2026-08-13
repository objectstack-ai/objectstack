// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8269 — the first CONCURRENT autonumber insert into a COLD object fails on
 * Postgres with `25P02 current transaction is aborted`.
 *
 * `getNextSequenceValue` handled the first-insert race by catching the unique
 * violation and recovering **inside the same transaction**. On Postgres any
 * statement error aborts the whole transaction, so the recovery `SELECT … FOR
 * UPDATE` was itself the statement that raised the error — the recovery path
 * could never run there. The fix runs each speculative statement under a
 * SAVEPOINT (`attemptWithoutPoisoning`).
 *
 * ## Why this file needs a live Postgres, and all four conditions
 *
 * The reporter measured that dropping any single condition hides the defect,
 * which is why the (SQLite-backed, single-tenant, warm) autonumber suite never
 * caught it in the first place:
 *
 *   - **Postgres**: SQLite and MySQL do not abort a transaction on a statement
 *     error, so the buggy recovery path works there. SQLite is not a weaker
 *     version of this test — it is a test that cannot fail.
 *   - **cold**: a counter row that already exists takes the UPDATE path and
 *     never reaches the speculative INSERT. Warm bursts pass unfixed.
 *   - **concurrent**: serial writers never race the first INSERT.
 *   - **cross-tenant**: two tenants means two cold counter rows, which is what
 *     makes the race window near-certain to be hit rather than occasional.
 *
 * That last point is a REFINEMENT of the report, measured here on `postgres:16`
 * before the fix: single-tenant cold bursts are not safe, only *flaky* — 5
 * rounds each of 1 tenant × N cold concurrent inserts failed 0/5 (N=2), 1/5
 * (N=4), 3/5 (N=6) and 2/5 (N=12) with the same `25P02`. The tenant boundary is
 * not a precondition of the defect, only an amplifier, so single-org
 * deployments were exposed too. The guard below is still written cross-tenant
 * because that is the shape that fails deterministically.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { DIALECT_CELLS, declareUnprovisionedCell, type DialectCell } from './live-dialect-matrix.testkit.js';

const TABLE = 'os8269_cold_race';
const SEQUENCES_TABLE = '_objectstack_sequences';

const SHAPE = {
  name: TABLE,
  fields: {
    organization_id: { type: 'string' },
    code: { type: 'autonumber', format: 'TK-{0000}' },
    name: { type: 'string' },
  },
} as any;

/** Rows of a raw result, across knex's three dialect shapes. */
function rowsOf(res: any): any[] {
  if (Array.isArray(res) && Array.isArray(res[0])) return res[0]; // mysql2: [rows, fields]
  if (Array.isArray(res)) return res; // better-sqlite3
  return res?.rows ?? []; // pg
}

function coldRaceSuite(cell: DialectCell, role: string) {
  describe(`sql-driver — autonumber cold cross-tenant race (${cell.label}) [#8269]`, () => {
    let driver: SqlDriver;

    beforeEach(async () => {
      driver = new SqlDriver(cell.config());
      // COLD is the whole point: drop the data table AND the counter rows, so
      // every run starts with no sequence row for this object.
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver
        .execute(`delete from ${SEQUENCES_TABLE} where "object" = '${TABLE}'`)
        .catch(() => {});
      await driver.initObjects([SHAPE]);
    });

    afterEach(async () => {
      await driver.execute(`drop table if exists ${TABLE}`).catch(() => {});
      await driver
        .execute(`delete from ${SEQUENCES_TABLE} where "object" = '${TABLE}'`)
        .catch(() => {});
      await driver.disconnect();
    });

    it(`issues a contiguous band per tenant on a cold concurrent cross-tenant burst (${role})`, async () => {
      const tenants = ['os8269_orgA', 'os8269_orgB'];
      const per = 6;

      // One burst, both tenants interleaved, nothing warmed up first. Unfixed,
      // this rejects with 25P02 on Postgres.
      const rows = await Promise.all(
        tenants.flatMap((t) =>
          Array.from({ length: per }, (_, i) =>
            driver.create(TABLE, { organization_id: t, name: `${t}-${i}` }),
          ),
        ),
      );

      expect(rows).toHaveLength(tenants.length * per);
      for (const t of tenants) {
        const issued = rows
          .filter((r: any) => r.organization_id === t)
          .map((r: any) => r.code)
          .sort();
        // Each tenant gets its own counter, so each band starts at 1 and is
        // contiguous — no duplicates, and no numbers burned by a failed attempt
        // (the permanent gap the report saw after retrying a failed burst).
        expect(issued).toEqual(
          Array.from({ length: per }, (_, i) => `TK-${String(i + 1).padStart(4, '0')}`),
        );
      }
    });

    it(`advances each tenant's counter exactly once per issued number (${role})`, async () => {
      const tenants = ['os8269_orgC', 'os8269_orgD'];
      const per = 4;
      await Promise.all(
        tenants.flatMap((t) =>
          Array.from({ length: per }, (_, i) =>
            driver.create(TABLE, { organization_id: t, name: `${t}-${i}` }),
          ),
        ),
      );

      const counters = rowsOf(
        await driver.execute(
          `select tenant_id, last_value from ${SEQUENCES_TABLE} where "object" = '${TABLE}' order by tenant_id`,
        ),
      );
      // `last_value` is a bigint — pg returns it as a string.
      expect(counters.map((r: any) => [String(r.tenant_id), Number(r.last_value)])).toEqual(
        tenants.map((t) => [t, per]),
      );
    });
  });
}

const pgCell = DIALECT_CELLS.find((c) => c.id === 'pg')!;
if (pgCell.available) {
  // THE regression guard. Postgres is the only dialect that aborts a
  // transaction on a statement error, so it is the only one that can fail.
  coldRaceSuite(pgCell, 'regression guard');
} else {
  declareUnprovisionedCell(pgCell, 'autonumber cold cross-tenant race');
}

// A control, not coverage: SQLite passed this before the fix (the report
// measured it) and must still pass after, which is what pins "the savepoint
// changed nothing on the dialects that were already correct". Deleting the
// Postgres cell above and leaving this one would be a suite that cannot fail.
coldRaceSuite(
  DIALECT_CELLS.find((c) => c.id === 'sqlite')!,
  'unaffected control — passes before AND after the fix',
);

describe(`sql-driver — attemptWithoutPoisoning (${pgCell.available ? 'live postgres' : 'skipped'}) [#8269]`, () => {
  // The mechanism itself, pinned directly: this is what makes the SECOND
  // speculative site (`SELECT … FOR UPDATE`, which has no `ON CONFLICT` form)
  // safe as well. Postgres-only for the same reason as above.
  it.skipIf(!pgCell.available)(
    'leaves the surrounding transaction usable after a statement error',
    async () => {
      const driver = new SqlDriver(pgCell.config());
      const probe = 'os8269_poison_probe';
      try {
        const knex = (driver as any).knex;
        await knex.schema.dropTableIfExists(probe);
        await knex.schema.createTable(probe, (t: any) => {
          t.string('k').primary();
          t.integer('v');
        });

        await knex.transaction(async (trx: any) => {
          await trx(probe).insert({ k: 'a', v: 1 });

          const failed = await (driver as any).attemptWithoutPoisoning(trx, (scoped: any) =>
            scoped(probe).insert({ k: 'a', v: 2 }),
          );
          // The original error is preserved, not swallowed — the caller needs it
          // to tell "another writer raced me" from anything else.
          expect(failed.ok).toBe(false);
          expect((failed.error as any).code).toBe('23505');

          // Unfixed, this read is where 25P02 surfaced.
          const row = await trx(probe).where({ k: 'a' }).forUpdate().first();
          expect(Number(row.v)).toBe(1);

          const ok = await (driver as any).attemptWithoutPoisoning(trx, (scoped: any) =>
            scoped(probe).insert({ k: 'b', v: 3 }),
          );
          expect(ok.ok).toBe(true);
        });

        await knex.schema.dropTableIfExists(probe);
      } finally {
        await driver.disconnect();
      }
    },
  );
});
