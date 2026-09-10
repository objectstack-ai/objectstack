// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16318] The NUMERIC family's stated physical representation, read off the
 * SERVER's own catalog on the two dialects the representation exists for.
 *
 * ## Why this file exists as well as the SQLite one
 *
 * `sql-driver-16318-numeric-representation.test.ts` is honest about its own
 * reach and says so in its head note: SQLite applies neither precision nor
 * scale, so it can pin the ARM (`float` vs `integer`) and the storage class and
 * nothing else. Every claim the change is actually about — a
 * `numeric(65,30)` column, a `rating` that refuses or rounds a half star, and a
 * read path that hands back a JS `number` where node-postgres and mysql2 hand
 * back a STRING — is a PostgreSQL/MySQL claim, and on SQLite it cannot fire at
 * all: SQLite never returns a string for a `float` column, so the read-path
 * assertion over there passes on a driver that lost the coercion entirely.
 *
 * ⇒ Without this file the every-dialect `formatOutput` move has zero automated
 * coverage on the two dialects it was made for, and the precision/scale the
 * whole table decides is prose in a pull request.
 *
 * ## What is asserted, and against what authority
 *
 * `information_schema.columns` — the server's own catalog, spelled the same way
 * on both dialects — read for `numeric_precision` / `numeric_scale`, compared
 * against `packages/spec`'s {@link numericColumnFor} rather than against a
 * transcribed literal. A second width table here would re-create the very drift
 * #16318 closes; what is pinned is that the SERVER agrees with the SPEC.
 *
 * ⚠️ `rating`'s fractional disposition is asserted PER DIALECT because the two
 * dialects genuinely differ, and stating one answer for both is the defect this
 * cell was added for: PostgreSQL REFUSES `4.5` into an `integer` column, and
 * MySQL does not refuse — it ROUNDS to `5`. Both are silent-alteration-class
 * facts a changelog must not average into one sentence.
 *
 * Opt-in — these need real servers:
 *
 *   OS_TEST_MYSQL_URL=mysql://root:root@127.0.0.1:3306/conformance \
 *   OS_TEST_POSTGRES_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
 *     pnpm --filter @objectstack/driver-sql test
 *
 * Unprovisioned, each cell reports itself as a named SKIP and is a FAILURE
 * under `OS_EXPECT_LIVE_DIALECT_MATRIX=1` — the "Temporal Conformance (live PG
 * + MySQL)" job, which runs this package's whole test script.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { NUMERIC_VALUE_TYPES, numericColumnFor } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import {
  MYSQL_CELL,
  PG_CELL,
  currentLiveSchema,
  declareDialectCell,
  type DialectCell,
} from './live-dialect-matrix.testkit.js';

const T = 'os16318_numeric';

/** Every member of the family, from the spec's own membership authority. */
const NUMERIC_TYPES = [...NUMERIC_VALUE_TYPES].sort();

/** One object carrying the whole family, one column per member. */
const numericObject = () => {
  const fields: Record<string, unknown> = { name: { type: 'text', maxLength: 64 } };
  for (const t of NUMERIC_TYPES) fields[`f_${t}`] = { type: t };
  return { name: T, fields };
};

/** What the SERVER says about a column, normalised across the two dialects. */
interface CatalogColumn {
  dataType: string;
  precision: number | null;
  scale: number | null;
}

/**
 * Read the catalog through the driver's own connection.
 *
 * `information_schema.columns` is standard on both dialects, and `table_schema`
 * is the per-file isolation name in both — a SCHEMA on PostgreSQL, a DATABASE
 * on MySQL, which is the same concept there. The select list is ALIASED so the
 * two client libraries hand back the same keys (MySQL's catalog spells its
 * columns upper-case).
 */
async function catalogColumns(driver: SqlDriver, schema: string): Promise<Map<string, CatalogColumn>> {
  // The schema name is derived by `liveSchemaNameFor`, which refuses anything
  // outside /^[a-z][a-z0-9_]*$/ — so it cannot carry a quote into this SQL.
  const res: any = await driver.execute(
    `select column_name as c, data_type as d, numeric_precision as p, numeric_scale as s ` +
      `from information_schema.columns ` +
      `where table_schema = '${schema}' and table_name = '${T}'`,
  );
  const rows: any[] = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : (res?.rows ?? res);
  const out = new Map<string, CatalogColumn>();
  for (const r of rows) {
    const name = String(r.c ?? r.C ?? r.column_name ?? r.COLUMN_NAME);
    out.set(name, {
      dataType: String(r.d ?? r.D).toLowerCase(),
      precision: r.p === null || r.p === undefined ? null : Number(r.p),
      scale: r.s === null || r.s === undefined ? null : Number(r.s),
    });
  }
  return out;
}

for (const cell of [PG_CELL, MYSQL_CELL]) {
  declareDialectCell(cell, 'numeric column representation (#16318)', (c: DialectCell) => {
    describe(`numeric column representation on ${c.label} (#16318)`, () => {
      let live: SqlDriver;

      afterEach(async () => {
        await live?.execute(`drop table if exists ${T}`).catch(() => {});
        await live?.disconnect().catch(() => {});
      });

      const boot = async () => {
        live = new SqlDriver(c.config());
        await live.execute(`drop table if exists ${T}`).catch(() => {});
        await live.initObjects([numericObject()] as never);
      };

      it('creates the exact column `packages/spec` states — precision and scale read off the server', async () => {
        await boot();
        const cols = await catalogColumns(live, currentLiveSchema());

        // Non-vacuity, first: the catalog read really answered. Without this an
        // empty result set would satisfy every loop below.
        expect(NUMERIC_TYPES.length, 'the family is empty').toBeGreaterThanOrEqual(7);
        for (const t of NUMERIC_TYPES) expect(cols.has(`f_${t}`), `f_${t} absent from the catalog`).toBe(true);

        for (const t of NUMERIC_TYPES) {
          const want = numericColumnFor(t);
          expect(want, t).toBeDefined();
          const got = cols.get(`f_${t}`)!;
          if (want!.kind === 'integer') {
            // PostgreSQL says `integer`, MySQL says `int` — one substring, no
            // second table.
            expect(got.dataType, t).toMatch(/^int(eger)?$/);
            expect(got.scale, `${t} scale`).toBe(0);
          } else {
            expect(got.dataType, t).toMatch(/^(numeric|decimal)$/);
            // ⭐ THE ASSERTION the whole card is about, against the SPEC's
            // numbers rather than a transcribed pair.
            expect(got.precision, `${t} precision`).toBe(want!.precision);
            expect(got.scale, `${t} scale`).toBe(want!.scale);
          }
        }

        // The two arms really are two — a chain that answered `integer` (or
        // `numeric`) for everything satisfies each assertion above in isolation.
        expect(new Set(NUMERIC_TYPES.map((t) => cols.get(`f_${t}`)!.dataType)).size).toBe(2);
      });

      it('reads every member back as a JS number, where the client library hands back a string', async () => {
        await boot();

        // ⛔ The discriminating value: node-postgres parses `numeric` to a
        // STRING and mysql2 does the same for `DECIMAL`, so without
        // `formatOutput`'s every-dialect `numericFields` coercion these come
        // back as `'0.333330000000000000000000000000'` and the wire contract
        // (`z.number().finite()`) is broken. On SQLite this assertion cannot
        // fire at all, which is why it lives here.
        const written: Record<string, number> = {};
        for (const t of NUMERIC_TYPES) written[`f_${t}`] = t === 'rating' ? 4 : 0.33333;
        await live.create(T, { id: 'n1', name: 'rt', ...written });

        const [back]: any[] = await live.find(T, { filters: ['name', '=', 'rt'] } as never);
        expect(back, 'the row did not come back').toBeDefined();
        for (const [k, v] of Object.entries(written)) {
          expect(typeof back[k], `${k} came back as ${typeof back[k]}`).toBe('number');
          expect(back[k], k).toBe(v);
        }
      });

      it('holds a value the previous `real` column lost, and the previous narrow decimals rounded', async () => {
        await boot();

        // `1234567.89` is the money value binary32 could not hold: measured on
        // a `real` column it read back `1234567.9`. `33.333` is the percent the
        // sql format's `numeric(5,2)` rounded to `33.33`.
        await live.create(T, { id: 'n2', name: 'exact', f_currency: 1234567.89, f_percent: 33.333 });
        const [row]: any[] = await live.find(T, { filters: ['name', '=', 'exact'] } as never);
        expect(row.f_currency).toBe(1234567.89);
        expect(row.f_percent).toBe(33.333);
      });

      it('disposes of a fractional star count the way THIS dialect does — refuse on PostgreSQL, round on MySQL', async () => {
        await boot();

        // ⚠️ The two dialects genuinely differ, and a changelog that states one
        // answer for both is the finding this cell was added for. Asserted per
        // dialect, never averaged.
        const outcome = await live
          .create(T, { id: 'n3', name: 'half', f_rating: 4.5 })
          .then(() => 'accepted' as const)
          .catch(() => 'refused' as const);

        if (c.id === 'pg') {
          expect(outcome, 'PostgreSQL accepted a fractional value into an integer column').toBe('refused');
          const rows: any[] = await live.find(T, { filters: ['name', '=', 'half'] } as never);
          expect(rows, 'the refused row was written anyway').toHaveLength(0);
        } else {
          expect(outcome, 'MySQL refused a fractional value it is documented to round').toBe('accepted');
          const [row]: any[] = await live.find(T, { filters: ['name', '=', 'half'] } as never);
          // ⭐ The silent alteration itself: no error, and the star count the
          // caller wrote is NOT the star count the database now holds.
          expect(row.f_rating, 'MySQL did not round 4.5 to 5').toBe(5);
          expect(row.f_rating).not.toBe(4.5);
        }
      });
    });
  });
}

// ── The "new tables only" bound on the READ path (#16318 F4) ────────────────
//
// Moving `formatOutput`'s numeric coercion off the SQLite-only arm is what the
// exact-decimal column forced, and `numericFields` carries the driver-internal
// aliases `integer` / `int` / `float` — which is how an EXTERNAL, introspected
// table's columns reach this driver. PostgreSQL is where that matters: node-
// postgres hands back `int8` as a STRING precisely because it does not fit a JS
// double, so an unscoped pass would `Number()` it and silently round above
// 2^53 on a table this change never created.
//
// ⛔ Not a MySQL cell: mysql2 hands `BIGINT` back as a JS number already, so
// there is no string for any pass to touch and the reading would be vacuous.

const EXT_TABLE = 'os16318_ext_bigint';
const EXT_OBJECT = 'os16318_ext';
/** 2^53 + 1 — the smallest integer a JS double cannot represent. */
const BEYOND_DOUBLE = '9007199254740993';

declareDialectCell(PG_CELL, 'numeric read-path scope (#16318)', (c: DialectCell) => {
  describe(`the numeric read coercion leaves an EXISTING external bigint alone on ${c.label} (#16318)`, () => {
    let live: SqlDriver;

    afterEach(async () => {
      await live?.execute(`drop table if exists ${EXT_TABLE}`).catch(() => {});
      await live?.disconnect().catch(() => {});
    });

    it('hands back the bigint string unrounded, while an authorable numeric field IS coerced', async () => {
      live = new SqlDriver(c.config());
      await live.execute(`drop table if exists ${EXT_TABLE}`).catch(() => {});
      // A table this change did not create, shaped the way an introspected one
      // is: a `bigint` under a driver ALIAS field type, beside an authorable
      // `number` under the exact-decimal column this change does create.
      await live.execute(
        `create table ${EXT_TABLE} (id varchar(64) primary key, big bigint, amount numeric(65,30))`,
      );
      await live.execute(
        `insert into ${EXT_TABLE} (id, big, amount) values ('e1', ${BEYOND_DOUBLE}, 12.5)`,
      );

      live.registerExternalObject!({
        name: EXT_OBJECT,
        external: { remoteName: EXT_TABLE },
        fields: { big: { type: 'integer' }, amount: { type: 'number' } },
      } as never);

      const [row]: any[] = await live.find(EXT_OBJECT, { filters: ['id', '=', 'e1'] } as never);
      expect(row, 'the external row did not come back').toBeDefined();

      // ⭐ THE ASSERTION. `Number('9007199254740993')` is 9007199254740992 — a
      // silent one-off on an existing column, outside the "new tables only"
      // bound the ruling drew. The value must arrive as the server sent it.
      expect(typeof row.big, 'a bigint under a driver alias was coerced through a JS double').toBe(
        'string',
      );
      expect(row.big).toBe(BEYOND_DOUBLE);

      // ⛔ Non-vacuity, and the discriminating half: the SAME pass, in the SAME
      // read, still coerces the authorable numeric field — otherwise this test
      // would pass on a driver that lost the coercion altogether.
      expect(typeof row.amount, 'the authorable numeric field was NOT coerced').toBe('number');
      expect(row.amount).toBe(12.5);
    });
  });
});
