// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #31328 — Oracle as a federation dialect, held to the shared conformance
 * case-sets over a LIVE Oracle Database (ADR-0015 §4.6).
 *
 * ## Why this is its own file and not a cell of `DIALECT_CELLS`
 *
 * Every matrix suite in this package builds its fixture with `initObjects` —
 * managed DDL. Oracle is federation-only: the driver refuses every DDL
 * operation on it by name, so those suites cannot run a cell there. This file
 * runs the case-sets the way a federated datasource actually meets them:
 *
 *  1. the remote table is created by RAW DDL, the way the remote system's
 *     owner created it — UPPER-case unquoted identifiers, Oracle's own types
 *     (`VARCHAR2`, `NUMBER(1)` flags, `TIMESTAMP WITH TIME ZONE`, `DATE`);
 *  2. the object is bound with `registerExternalObject`, its fields mapped
 *     from those columns by `external.columnMap` — which is how
 *     `import_object` binds every Oracle table, since its columns are
 *     upper-case;
 *  3. rows are written through the driver's own `create()` (the federation
 *     write path), and every case is read back through `find()` /
 *     `aggregate()`.
 *
 * The SQLite cell runs the SAME harness — raw DDL, columnMap, external mode —
 * as the control: a case that fails on both is a harness defect, one that
 * fails on Oracle alone is a dialect defect.
 *
 * ## The case-sets, and the ones that do not apply
 *
 * Run here: `FILTER_LOGIC_CASES`, `FILTER_TEXT_CASES`, `PAGINATION_CASES`,
 * `PAGINATION_UNORDERED_CASES`, `PAGINATION_ZERO_LIMIT_CASES`,
 * `FILTER_COMPARAND_TYPE_CASES` (the executed half — the door-refusal half is
 * settled before any dialect is chosen and is pinned dialect-free in
 * `sql-driver-comparand-type-conformance.test.ts`), `AGGREGATION_CASES` and
 * `TEMPORAL_CASES`.
 *
 * Not run, each for a reason of the dialect's federation scope rather than a
 * gap: `TEMPORAL_TIME_CASES` (Oracle has no TIME type; a remote time-of-day
 * column has no one storage form to hold the case-set to),
 * `VALUE_ROUNDTRIP_CASES` / `READABLE_IDS_CASES` / `UNIQUE_NULL_DISTINCT_CASES`
 * (they pin what the driver's OWN schema stores and enforces — managed
 * storage forms and indexes), and `BULK_WRITE_HOOK` (an engine-layer
 * contract, not a dialect one).
 *
 * ## The one declared divergence: `''`
 *
 * Oracle stores `''` as NULL, so an equality or range comparand of `''` cannot
 * mean what it means on every other dialect; the driver refuses it with
 * INVALID_FILTER (`assertOracleComparandNotEmptyString`). No case-set row run
 * here carries one — the empty `$icontains` comparand is refused on every
 * dialect by the case-set itself — so the refusal is pinned by the compile
 * level suite (`sql-driver-oracle-dialect.test.ts`) and asserted live below.
 *
 * ## Provisioning
 *
 * `OS_TEST_ORACLE_URL=oracle://user:password@host:port/service`, e.g. against
 * `gvenzl/oracle-free` (`oracle://os_test:os_test@localhost:1521/FREEPDB1`).
 * Without it the Oracle cell is a NAMED SKIP, never a pass;
 * `OS_EXPECT_LIVE_ORACLE=1` turns that skip into a failure for a runner that
 * provisioned the server.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import {
  AGGREGATION_CASES,
  AGGREGATION_ROWS,
  FILTER_COMPARAND_TYPE_CASES,
  FILTER_COMPARAND_TYPE_ROWS,
  FILTER_LOGIC_CASES,
  FILTER_LOGIC_ROWS,
  FILTER_TEXT_CASES,
  FILTER_TEXT_ROWS,
  PAGINATION_ALL_IDS,
  PAGINATION_CASES,
  PAGINATION_ROWS,
  PAGINATION_UNORDERED_CASES,
  PAGINATION_ZERO_LIMIT_CASES,
  TEMPORAL_CASES,
  TEMPORAL_ROWS,
  lowerFilterCondition,
  markFilterSubtreeProvenance,
  parseFilterAST,
  type AggregationCase,
  type FilterCondition,
} from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import {
  ORACLE_CELL,
  declareDialectCell,
  dialectCell,
  type DialectCell,
  type FederationDialectCell,
} from './live-dialect-matrix.testkit.js';

type Cell = DialectCell | FederationDialectCell;
type ColumnKind = 'id' | 'text' | 'number' | 'integer' | 'flag' | 'datetime' | 'date';

/** One remote table: its UPPER-case columns, the field each maps to, and the field's type. */
interface RemoteFixture {
  /** Remote table name (Oracle folds it upper-case; quoted here as such). */
  table: string;
  /** The object it is bound as. */
  object: string;
  columns: ReadonlyArray<{ column: string; field: string; kind: ColumnKind }>;
}

const FIELD_TYPE: Record<Exclude<ColumnKind, 'id'>, string> = {
  text: 'text', number: 'number', integer: 'integer', flag: 'boolean', datetime: 'datetime', date: 'date',
};

/** The remote column type, as the remote system's owner would have declared it. */
function sqlType(cell: Cell, kind: ColumnKind): string {
  if (cell.id === 'oracle') {
    return {
      id: 'VARCHAR2(64) PRIMARY KEY',
      text: 'VARCHAR2(200)',
      number: 'NUMBER',
      integer: 'NUMBER(10,0)',
      flag: 'NUMBER(1)',
      datetime: 'TIMESTAMP(3) WITH TIME ZONE',
      date: 'DATE',
    }[kind];
  }
  return {
    id: 'TEXT PRIMARY KEY', text: 'TEXT', number: 'REAL', integer: 'INTEGER', flag: 'INTEGER', datetime: 'TEXT', date: 'TEXT',
  }[kind];
}

const FIXTURES = {
  logic: {
    table: 'OSFC_LOGIC', object: 'fc_logic',
    columns: [
      { column: 'ID', field: 'id', kind: 'id' },
      ...['a', 'b', 'c', 'd', 'owner', 'status', 'parent_object', 'parent_id']
        .map((f) => ({ column: f.toUpperCase(), field: f, kind: 'text' as const })),
    ],
  },
  text: {
    table: 'OSFC_TEXT', object: 'fc_text',
    columns: [
      { column: 'ID', field: 'id', kind: 'id' },
      { column: 'NAME', field: 'name', kind: 'text' },
      { column: 'SCORE', field: 'score', kind: 'number' },
    ],
  },
  paged: {
    table: 'OSFC_PAGED', object: 'fc_paged',
    columns: [
      { column: 'ID', field: 'id', kind: 'id' },
      { column: 'STATUS', field: 'status', kind: 'text' },
      { column: 'RANK', field: 'rank', kind: 'integer' },
      { column: 'NAME', field: 'name', kind: 'text' },
    ],
  },
  comparand: {
    table: 'OSFC_COMPARAND', object: 'fc_comparand',
    columns: [
      { column: 'ID', field: 'id', kind: 'id' },
      { column: 'QTY', field: 'qty', kind: 'integer' },
      { column: 'LABEL', field: 'label', kind: 'text' },
      { column: 'ACTIVE', field: 'active', kind: 'flag' },
      { column: 'NOTE', field: 'note', kind: 'text' },
    ],
  },
  agg: {
    table: 'OSFC_AGG', object: 'fc_agg',
    columns: [
      { column: 'ID', field: 'id', kind: 'id' },
      { column: 'REGION', field: 'region', kind: 'text' },
      { column: 'STAGE', field: 'stage', kind: 'text' },
      { column: 'SCORE', field: 'score', kind: 'number' },
      { column: 'AMOUNT', field: 'amount', kind: 'number' },
      { column: 'FLAG', field: 'flag', kind: 'flag' },
    ],
  },
  temporal: {
    table: 'OSFC_TEMPORAL', object: 'fc_temporal',
    columns: [
      { column: 'ID', field: 'id', kind: 'id' },
      { column: 'AT_TS', field: 'at', kind: 'datetime' },
      { column: 'ON_DAY', field: 'on', kind: 'date' },
      { column: 'WHY', field: 'why', kind: 'text' },
    ],
  },
} satisfies Record<string, RemoteFixture>;

const ALL_FIXTURES: readonly RemoteFixture[] = Object.values(FIXTURES);

async function dropRemote(knex: Knex, cell: Cell, table: string): Promise<void> {
  if (cell.id === 'oracle') {
    await knex.raw(
      `BEGIN EXECUTE IMMEDIATE 'DROP TABLE "${table}" PURGE'; EXCEPTION WHEN OTHERS THEN IF SQLCODE != -942 THEN RAISE; END IF; END;`,
    );
  } else {
    await knex.raw(`DROP TABLE IF EXISTS "${table}"`);
  }
}

/** Raw DDL, the remote owner's: the driver creates nothing on a federated datasource. */
async function createRemote(knex: Knex, cell: Cell, fx: RemoteFixture): Promise<void> {
  await dropRemote(knex, cell, fx.table);
  const cols = fx.columns.map((c) => `"${c.column}" ${sqlType(cell, c.kind)}`).join(', ');
  await knex.raw(`CREATE TABLE "${fx.table}" (${cols})`);
}

function bind(driver: SqlDriver, fx: RemoteFixture): void {
  (driver as any).registerExternalObject({
    name: fx.object,
    external: {
      remoteName: fx.table,
      columnMap: Object.fromEntries(fx.columns.map((c) => [c.column, c.field])),
    },
    fields: Object.fromEntries(
      fx.columns.filter((c) => c.kind !== 'id').map((c) => [c.field, { type: FIELD_TYPE[c.kind as Exclude<ColumnKind, 'id'>] }]),
    ),
  });
}

const BYPASS = { bypassTenantAudit: true } as const;

interface WireBearingError extends Error { code?: string; status?: number }

declareDialectCell(dialectCell('sqlite'), 'oracle federation conformance (control)', (cell) => {
  declareFederationSweep(cell, () => new SqlDriver({ ...cell.config(), schemaMode: 'external' } as any));
});
declareDialectCell(ORACLE_CELL, 'oracle federation conformance', (cell) => {
  declareFederationSweep(cell, () => new SqlDriver(cell.config()));
});

function declareFederationSweep(cell: Cell, build: () => SqlDriver): void {
  describe(`SqlDriver — federation conformance over raw remote tables (${cell.label})`, () => {
    let driver: SqlDriver;
    let knex: Knex;

    beforeAll(async () => {
      driver = build();
      (driver as any).name = 'fc';
      await driver.connect();
      knex = driver.getKnex();
      for (const fx of ALL_FIXTURES) {
        await createRemote(knex, cell, fx);
        bind(driver, fx);
      }
      for (const r of FILTER_LOGIC_ROWS) await driver.create(FIXTURES.logic.object, { ...r }, BYPASS);
      for (const r of FILTER_TEXT_ROWS) await driver.create(FIXTURES.text.object, { ...r }, BYPASS);
      for (const r of PAGINATION_ROWS) await driver.create(FIXTURES.paged.object, { ...r }, BYPASS);
      for (const r of FILTER_COMPARAND_TYPE_ROWS) await driver.create(FIXTURES.comparand.object, { ...r }, BYPASS);
      for (const r of AGGREGATION_ROWS) await driver.create(FIXTURES.agg.object, { ...r }, BYPASS);
      for (const r of TEMPORAL_ROWS) {
        await driver.create(
          FIXTURES.temporal.object,
          { id: r.id, at: r.writerForm === 'native' ? new Date(r.at) : r.at, on: r.on, why: r.why },
          BYPASS,
        );
      }
    }, 120_000);

    afterAll(async () => {
      if (knex) for (const fx of ALL_FIXTURES) await dropRemote(knex, cell, fx.table).catch(() => {});
      await driver?.disconnect?.();
    });

    const ids = async (object: string, where?: FilterCondition): Promise<string[]> => {
      const rows = await driver.find(object, where ? { where } : {}, BYPASS);
      return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    };

    // ── The fixture, read back before any case trusts it ────────────────────
    describe('the fixture', () => {
      it('every seeded row is readable, nulls stored as nulls and flags read as booleans', async () => {
        expect(await ids(FIXTURES.logic.object)).toEqual(FILTER_LOGIC_ROWS.map((r) => r.id).sort());
        expect((await driver.find(FIXTURES.logic.object, { where: { d: null } }, BYPASS)).map((r) => r.id).sort())
          .toEqual(['3', '4']);
        const text = await driver.find(FIXTURES.text.object, {}, BYPASS);
        expect(new Map(text.map((r) => [String(r.id), r.name]))).toEqual(new Map(FILTER_TEXT_ROWS.map((r) => [r.id, r.name])));
        for (const r of text) expect(typeof r.score, String(r.id)).toBe('number');
        const comparand = await driver.find(FIXTURES.comparand.object, { orderBy: [{ field: 'id', order: 'asc' }] }, BYPASS);
        expect(comparand.map((r) => [r.id, r.qty, r.label, r.active, r.note ?? null]))
          .toEqual(FILTER_COMPARAND_TYPE_ROWS.map((r) => [r.id, r.qty, r.label, r.active, r.note]));
      });

      it('every temporal row reads back as the instant / calendar day it was written as', async () => {
        const rows = await driver.find(FIXTURES.temporal.object, {}, BYPASS);
        const byId = new Map(rows.map((r) => [String(r.id), r]));
        for (const r of TEMPORAL_ROWS) {
          const read = byId.get(r.id)!;
          expect(new Date(read.at as string).toISOString(), r.id).toBe(r.at);
          expect(read.on, r.id).toBe(r.on);
        }
      });
    });

    // ── FILTER_LOGIC_CASES ─────────────────────────────────────────────────
    describe('FILTER_LOGIC_CASES', () => {
      // What a seam hands the driver: the shared lowering, which makes every
      // negated leaf NULL-safe (the fixture has no datetime column).
      const seamed = (where: FilterCondition) =>
        lowerFilterCondition(where, { isDatetimeColumn: () => false }) as FilterCondition;
      for (const c of FILTER_LOGIC_CASES) {
        it(c.name, async () => {
          expect(await ids(FIXTURES.logic.object, seamed(c.filter)), c.note ?? c.name).toEqual([...c.expected]);
        });
      }
    });

    // ── FILTER_TEXT_CASES ──────────────────────────────────────────────────
    describe('FILTER_TEXT_CASES', () => {
      for (const c of FILTER_TEXT_CASES) {
        it(c.name, async () => {
          if (c.expectRejection) {
            const where = markFilterSubtreeProvenance({ ...c.filter }, 'author');
            const err = await driver
              .find(FIXTURES.text.object, { where }, BYPASS)
              .then(() => null, (e: unknown) => e as WireBearingError);
            expect(err, 'the case-set requires this filter REFUSED, not answered').toBeInstanceOf(Error);
            expect(err!.code).toBe(c.code);
            expect(err!.status).toBe(400);
            for (const mention of c.mustMention) expect(err!.message).toContain(mention);
            return;
          }
          expect(await ids(FIXTURES.text.object, c.filter), c.note ?? c.name).toEqual([...c.expected]);
        });
      }
    });

    // ── PAGINATION_* ───────────────────────────────────────────────────────
    describe('PAGINATION_CASES / PAGINATION_UNORDERED_CASES / PAGINATION_ZERO_LIMIT_CASES', () => {
      const walk = async (query: Record<string, unknown>, pageSize: number) => {
        const paged: Array<Record<string, unknown>> = [];
        for (let offset = 0; offset < PAGINATION_ROWS.length; offset += pageSize) {
          paged.push(...(await driver.find(FIXTURES.paged.object, { ...query, limit: pageSize, offset } as any, BYPASS)));
        }
        return paged;
      };

      for (const c of PAGINATION_CASES) {
        it(`visits every row exactly once, in the requested order — ${c.name}`, async () => {
          const paged = await walk({ orderBy: [...c.orderBy] }, c.pageSize);
          const seen = paged.map((r) => String(r.id));
          expect(seen).toHaveLength(PAGINATION_ALL_IDS.length);
          expect([...seen].sort()).toEqual([...PAGINATION_ALL_IDS].sort());
          const whole = await driver.find(FIXTURES.paged.object, { orderBy: [...c.orderBy] } as any, BYPASS);
          expect(seen).toEqual(whole.map((r) => String(r.id)));
        });
      }
      for (const c of PAGINATION_UNORDERED_CASES) {
        it(`walks an unsorted read in id order, every row once — ${c.name}`, async () => {
          expect((await walk({}, c.pageSize)).map((r) => String(r.id))).toEqual([...PAGINATION_ALL_IDS].sort());
        });
      }
      for (const c of PAGINATION_ZERO_LIMIT_CASES) {
        it(c.name, async () => {
          expect(await driver.find(FIXTURES.paged.object, { ...c.query } as any, BYPASS)).toHaveLength(c.expectedRowCount);
        });
      }
    });

    // ── FILTER_COMPARAND_TYPE_CASES (the executed half) ─────────────────────
    describe('FILTER_COMPARAND_TYPE_CASES', () => {
      for (const c of FILTER_COMPARAND_TYPE_CASES) {
        if (c.verdict === 'door-refusal') continue;
        if (c.verdict === 'matches') {
          it(c.name, async () => {
            expect(await ids(FIXTURES.comparand.object, parseFilterAST(c.filter()) as FilterCondition), c.note)
              .toEqual([...c.expected]);
          });
        } else {
          it(`${c.name} — executes without refusal`, async () => {
            await expect(ids(FIXTURES.comparand.object, parseFilterAST(c.filter()) as FilterCondition)).resolves.toBeDefined();
          });
        }
      }
    });

    // ── AGGREGATION_CASES ──────────────────────────────────────────────────
    describe('AGGREGATION_CASES', () => {
      const actualFor = (c: AggregationCase, rows: Array<Record<string, unknown>>) => {
        const groupKey = c.groupByAlias ?? c.groupBy;
        return rows
          .map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: r.n === null ? null : Number(r.n) }))
          .sort((x, y) => String(x.group).localeCompare(String(y.group)));
      };
      for (const c of AGGREGATION_CASES) {
        it(c.name, async () => {
          const rows = await driver.aggregate(FIXTURES.agg.object, {
            object: FIXTURES.agg.object,
            aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
            ...(c.groupBy ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] } : {}),
          } as any);
          expect(actualFor(c, rows as any[]), c.note).toEqual([...c.expected]);
        });
      }
    });

    // ── TEMPORAL_CASES ─────────────────────────────────────────────────────
    describe('TEMPORAL_CASES', () => {
      // What a typed seam hands the driver: the shared lowering, reading the
      // object's declared field map (`datetime` columns only).
      const seamed = (where: unknown) =>
        lowerFilterCondition(where as FilterCondition, { isDatetimeColumn: (column) => column === 'at' }) as FilterCondition;
      for (const c of TEMPORAL_CASES) {
        it(c.name, async () => {
          expect(await ids(FIXTURES.temporal.object, seamed(c.filter)), c.note).toEqual([...c.expected].sort());
        });
      }
    });

    // ── The declared divergence ────────────────────────────────────────────
    if (cell.id === 'oracle') {
      describe("Oracle's '' is NULL: an equality comparand of '' is refused, not answered as IS NULL", () => {
        for (const where of [{ d: '' }, { d: { $ne: '' } }, { d: { $in: ['v1', ''] } }] as FilterCondition[]) {
          it(JSON.stringify(where), async () => {
            const err = await driver
              .find(FIXTURES.logic.object, { where }, BYPASS)
              .then(() => null, (e: unknown) => e as WireBearingError);
            expect(err, 'refused, not answered').toBeInstanceOf(Error);
            expect(err!.code).toBe('INVALID_FILTER');
            expect(err!.status).toBe(400);
          });
        }
      });
    }
  });
}
