// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31327] The shared conformance case-sets, run on SQL Server the way a
 * FEDERATED datasource meets them (ADR-0015).
 *
 * ## Why this file, and not one more cell in each matrix
 *
 * Every matrix suite in this package builds its fixture with `initObjects` —
 * a managed table — and the `mssql` client is federation-only: the driver
 * refuses to emit managed DDL there, by contract. So the cell cannot be added
 * to `DIALECT_CELLS` without turning every managed matrix red for a reason
 * that is the design. Here each case-set's fixture is instead what a federated
 * SQL Server database IS: a table created by the remote's own DDL (raw T-SQL
 * below, with SQL Server's own types — `nvarchar`, `bit`, `datetime2`, `date`,
 * `time`, `float`), bound with `registerExternalObject` exactly as the
 * datasource service binds an imported table, written through the double
 * opt-in write path (`INSERT … OUTPUT inserted.*`), and read through every
 * door the cases name.
 *
 * ## The case-sets, and the two this file does not run
 *
 * Run here, each over its own federated table: FILTER_LOGIC, FILTER_TEXT
 * (#6518 case folding), FILTER_COMPARAND_TYPE, TEMPORAL (+ TIME),
 * PAGINATION, AGGREGATION, VALUE_ROUNDTRIP, UNIQUE_NULL_DISTINCT, READABLE_IDS,
 * and the driver's CROSS_FIELD cases — the last as the refusal a federated
 * object gets on every dialect (see its block).
 *
 * - BULK_WRITE_HOOK is the ENGINE's hook-dispatch contract (which rows a
 *   bulk write hands a per-row hook); no driver executes it, on any dialect.
 * - The temporal LEGACY-storage sweeps: those are SQLite's pre-canonical
 *   on-disk forms. `datetime2` / `date` / `time` are real temporal types, so
 *   there is no legacy form to seed — the same reason the Postgres and MySQL
 *   cells skip them (`hasLegacyStorageForm: false`).
 *
 * ## Opt-in, never a claimed pass
 *
 * `OS_TEST_MSSQL_URL` provisions the cell (see `MSSQL_FEDERATION_CELL`).
 * Unset, the whole file is ONE named skip; with `OS_EXPECT_MSSQL_FEDERATION=1`
 * it is a named failure instead. No CI job provisions SQL Server today.
 *
 * The server-timezone axis (D-B3) is not asserted: `datetime2` carries no
 * zone and the driver never asks the server for "now", so the server's zone
 * cannot perturb any answer below — requiring one would manufacture a red that
 * says nothing about SQL Server.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  READABLE_IDS_CASES,
  READABLE_IDS_CHILD_OBJECT,
  READABLE_IDS_CHILD_ROWS,
  READABLE_IDS_PARENT_OBJECT,
  READABLE_IDS_PARENT_ROWS,
  READABLE_IDS_REFUSAL,
  ReadableIds,
  TEMPORAL_CASES,
  TEMPORAL_ROWS,
  TEMPORAL_TIME_CASES,
  TEMPORAL_TIME_ROWS,
  UNIQUE_NULL_DISTINCT_CASES,
  UNIQUE_NULL_DISTINCT_OBJECTS,
  VALUE_ROUNDTRIP_CASES,
  VALUE_ROUNDTRIP_FIELDS,
  VALUE_ROUNDTRIP_ROWS,
  lowerFilterCondition,
  markFilterSubtreeProvenance,
  parseFilterAST,
  uniqueNullDistinctDivergence,
  valueRoundTripDivergence,
  type AggregationCase,
  type DriverOptions,
  type FilterCondition,
  type QueryAST,
} from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';
import {
  EXPECT_MSSQL_FEDERATION,
  MSSQL_FEDERATION_CELL,
  currentLiveSchema,
} from './live-dialect-matrix.testkit.js';
import {
  CROSS_FIELD_AUTHORED_CASES,
  CROSS_FIELD_CASES,
  CROSS_FIELD_OBJECT_FIELDS,
  CROSS_FIELD_ROWS,
} from './cross-field-conformance-cases.js';

const BYPASS: DriverOptions = { bypassTenantAudit: true };

type FieldSpec = { type: string; multiple?: boolean; unique?: unknown };

/**
 * The SQL Server column a federated table would carry for a declared field —
 * the remote's own types, as an ERP's DDL spells them. `null` for a field
 * with no column (a formula). Text is `nvarchar(450)` so a unique index can
 * key it (an `nvarchar(max)` cannot be an index key); JSON and multi-valued
 * fields are `nvarchar(max)`, SQL Server having no JSON type.
 */
function mssqlColumnType(field: FieldSpec): string | null {
  if (field.type === 'formula') return null;
  if (field.multiple || field.type === 'json') return 'nvarchar(max)';
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
      return 'float';
    case 'integer':
      return 'int';
    case 'boolean':
      return 'bit';
    case 'datetime':
      return 'datetime2(3)';
    case 'date':
      return 'date';
    case 'time':
      return 'time(3)';
    default:
      return 'nvarchar(450)';
  }
}

if (!MSSQL_FEDERATION_CELL.available) {
  describe(`sql-driver — federation conformance (${MSSQL_FEDERATION_CELL.label})`, () => {
    it.skipIf(!EXPECT_MSSQL_FEDERATION)(
      `is provisioned — set ${MSSQL_FEDERATION_CELL.env} to run the SQL Server federation cell`,
      () => {
        expect.fail(
          `${MSSQL_FEDERATION_CELL.env} is unset while OS_EXPECT_MSSQL_FEDERATION=1: this runner ` +
            'declared it provisions SQL Server, so the federation cell must not be skipped.',
        );
      },
    );
  });
} else {
  declareFederationSweep();
}

function declareFederationSweep(): void {
  describe(`[#31327] sql-driver — shared conformance over a federated SQL Server (${MSSQL_FEDERATION_CELL.label})`, { timeout: 120_000 }, () => {
    let driver: SqlDriver;
    let knex: Knex;
    let schema: string;
    const tables: string[] = [];

    /** Create `[schema].[name]` from declared fields and bind it as an external object. */
    const federate = async (
      name: string,
      fields: Record<string, FieldSpec>,
      extra?: { uniqueIndexes?: string[][] },
    ): Promise<void> => {
      const columns = Object.entries(fields)
        .filter(([column]) => column !== 'id')
        .map(([column, field]) => [column, mssqlColumnType(field)] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== null)
        .map(([column, type]) => `[${column}] ${type} NULL`);
      await knex.raw(`IF OBJECT_ID(N'[${schema}].[${name}]') IS NOT NULL DROP TABLE [${schema}].[${name}]`);
      await knex.raw(
        `CREATE TABLE [${schema}].[${name}] ([id] nvarchar(64) NOT NULL PRIMARY KEY${columns.length ? ', ' : ''}${columns.join(', ')})`,
      );
      // The SQL Server idiom for a NULL-distinct unique key: a FILTERED unique
      // index over the rows whose key parts are all non-NULL. A plain UNIQUE
      // constraint on SQL Server admits ONE NULL (NULLs compare equal there),
      // and on a federated table the remote's DDL — not this driver — decides.
      for (const [i, key] of (extra?.uniqueIndexes ?? []).entries()) {
        const filter = key.map((c) => `[${c}] IS NOT NULL`).join(' AND ');
        await knex.raw(
          `CREATE UNIQUE INDEX [ux_${name}_${i}] ON [${schema}].[${name}] (${key.map((c) => `[${c}]`).join(', ')}) WHERE ${filter}`,
        );
      }
      tables.push(name);
      driver.registerExternalObject({
        name,
        fields: Object.fromEntries(Object.entries(fields).filter(([column]) => column !== 'id')),
        external: { remoteName: name, remoteSchema: schema },
      });
    };

    const writeRows = async (name: string, rows: readonly object[]): Promise<void> => {
      for (const row of rows) await driver.create(name, { ...row }, BYPASS);
    };

    beforeAll(async () => {
      driver = new SqlDriver(MSSQL_FEDERATION_CELL.config());
      knex = driver.getKnex();
      schema = currentLiveSchema();
      await knex.raw(`IF SCHEMA_ID(N'${schema}') IS NULL EXEC(N'CREATE SCHEMA [${schema}]')`);
    });

    afterAll(async () => {
      for (const name of tables.reverse()) {
        await knex?.raw(`IF OBJECT_ID(N'[${schema}].[${name}]') IS NOT NULL DROP TABLE [${schema}].[${name}]`).catch(() => {});
      }
      await knex?.raw(`IF SCHEMA_ID(N'${schema}') IS NOT NULL EXEC(N'DROP SCHEMA [${schema}]')`).catch(() => {});
      await driver?.disconnect?.();
    });

    const sortedIds = (rows: any[]): string[] => rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
    const seamed = (where: unknown, datetime: (column: string) => boolean = () => false): any =>
      lowerFilterCondition(where, { isDatetimeColumn: datetime });

    // ── FILTER_LOGIC ─────────────────────────────────────────────────────────
    describe('FILTER_LOGIC_CASES', () => {
      const T = 'fed_filter_logic';
      beforeAll(async () => {
        await federate(T, Object.fromEntries(
          ['a', 'b', 'c', 'd', 'owner', 'status', 'parent_object', 'parent_id'].map((f) => [f, { type: 'text' }]),
        ));
        await writeRows(T, FILTER_LOGIC_ROWS);
      });
      for (const c of FILTER_LOGIC_CASES) {
        it(c.name, async () => {
          expect(sortedIds(await driver.find(T, { where: seamed(c.filter) }, BYPASS)), c.note).toEqual(c.expected);
        });
      }
    });

    // ── FILTER_TEXT (#6518) ──────────────────────────────────────────────────
    describe('FILTER_TEXT_CASES', () => {
      const T = 'fed_filter_text';
      beforeAll(async () => {
        await federate(T, { name: { type: 'text' }, score: { type: 'number' } });
        await writeRows(T, FILTER_TEXT_ROWS);
      });
      it('stored every row with its case intact', async () => {
        const rows = await driver.find(T, {}, BYPASS);
        const byId = new Map(rows.map((r) => [String(r.id), String(r.name)]));
        expect(byId.get('1')).toBe('ACME Corp');
        expect(byId.get('2')).toBe('acme corp');
        expect(byId.get('3')).toBe('CAFÉ');
        expect(byId.get('4')).toBe('café');
      });
      for (const testCase of FILTER_TEXT_CASES) {
        it(testCase.name, async () => {
          if (testCase.expectRejection) {
            const where = markFilterSubtreeProvenance({ ...testCase.filter }, 'author');
            const err = await driver.find(T, { where }, BYPASS).then(() => null, (e: any) => e);
            expect(err, 'the case-set requires this filter REFUSED').toBeInstanceOf(Error);
            expect(err.code).toBe(testCase.code);
            expect(err.status).toBe(400);
            for (const mention of testCase.mustMention) expect(err.message).toContain(mention);
            return;
          }
          expect(sortedIds(await driver.find(T, { where: seamed(testCase.filter) }, BYPASS)), testCase.note ?? testCase.name)
            .toEqual([...testCase.expected]);
        });
      }
    });

    // ── FILTER_COMPARAND_TYPE (#7872) ────────────────────────────────────────
    describe('FILTER_COMPARAND_TYPE_CASES', () => {
      const T = 'fed_comparand_type';
      beforeAll(async () => {
        await federate(T, {
          qty: { type: 'integer' }, label: { type: 'text' }, active: { type: 'boolean' }, note: { type: 'text' },
        });
        await writeRows(T, FILTER_COMPARAND_TYPE_ROWS);
      });
      for (const c of FILTER_COMPARAND_TYPE_CASES) {
        if (c.verdict === 'door-refusal') continue; // refused before any dialect is chosen — pinned dialect-free
        it(c.name, async () => {
          const ids = async () => sortedIds(await driver.find(T, { fields: ['id'], where: parseFilterAST(c.filter()) as any }, BYPASS));
          if (c.verdict === 'matches') expect(await ids(), c.note).toEqual([...c.expected]);
          else await expect(ids()).resolves.toBeDefined();
        });
      }
    });

    // ── TEMPORAL + TIME ──────────────────────────────────────────────────────
    describe('TEMPORAL_CASES', () => {
      const T = 'fed_temporal';
      const isDatetime = (column: string) => column === 'at';
      beforeAll(async () => {
        await federate(T, { at: { type: 'datetime' }, on: { type: 'date' }, why: { type: 'text' } });
        for (const r of TEMPORAL_ROWS) {
          await driver.create(T, {
            id: r.id, at: r.writerForm === 'native' ? new Date(r.at) : r.at, on: r.on, why: r.why,
          }, BYPASS);
        }
      });
      for (const c of TEMPORAL_CASES) {
        it(c.name, async () => {
          expect(sortedIds(await driver.find(T, { where: seamed(c.filter, isDatetime) }, BYPASS)), c.note)
            .toEqual([...c.expected].sort((a, b) => a.localeCompare(b)));
        });
      }
    });

    describe('TEMPORAL_TIME_CASES', () => {
      const T = 'fed_temporal_time';
      beforeAll(async () => {
        await federate(T, { at: { type: 'time' }, why: { type: 'text' } });
        for (const r of TEMPORAL_TIME_ROWS) {
          await driver.create(T, {
            id: r.id, at: r.writerForm === 'native' ? new Date(`1970-01-01T${r.at}Z`) : r.at, why: r.why,
          }, BYPASS);
        }
      });
      for (const c of TEMPORAL_TIME_CASES) {
        it(c.name, async () => {
          expect(sortedIds(await driver.find(T, { where: seamed(c.filter) }, BYPASS)), c.note)
            .toEqual([...c.expected].sort((a, b) => a.localeCompare(b)));
        });
      }
    });

    // ── PAGINATION: OFFSET … FETCH ordered by the remote key ────────────────
    describe('PAGINATION_CASES', () => {
      const T = 'fed_pagination';
      beforeAll(async () => {
        await federate(T, { status: { type: 'text' }, rank: { type: 'integer' }, name: { type: 'text' } });
        await writeRows(T, PAGINATION_ROWS);
      });
      const walk = async (query: Omit<QueryAST, 'object'>, pageSize: number) => {
        const paged: Array<Record<string, unknown>> = [];
        for (let offset = 0; offset < PAGINATION_ROWS.length; offset += pageSize) {
          paged.push(...(await driver.find(T, { ...query, limit: pageSize, offset }, BYPASS)));
        }
        return paged;
      };
      for (const c of PAGINATION_CASES) {
        it(`visits every row exactly once, in the requested order — ${c.name}`, async () => {
          const paged = await walk({ orderBy: [...c.orderBy] }, c.pageSize);
          expect(new Set(paged.map((r) => r.id)).size).toBe(PAGINATION_ALL_IDS.length);
          const whole = await driver.find(T, { orderBy: [...c.orderBy] }, BYPASS);
          expect(paged.map((r) => r.id)).toEqual(whole.map((r) => r.id));
        });
      }
      for (const c of PAGINATION_UNORDERED_CASES) {
        it(`walks an UNSORTED read in the remote key's order — ${c.name}`, async () => {
          // The remote table declares `id` its PRIMARY KEY; nothing in the
          // binding names it. The order comes from the remote catalog.
          expect((await walk({}, c.pageSize)).map((r) => String(r.id))).toEqual([...PAGINATION_ALL_IDS].sort());
        });
      }
      for (const c of PAGINATION_ZERO_LIMIT_CASES) {
        it(`limit 0 — ${c.name}`, async () => {
          expect(await driver.find(T, { ...c.query }, BYPASS)).toHaveLength(c.expectedRowCount);
        });
      }
    });

    // ── AGGREGATION ──────────────────────────────────────────────────────────
    describe('AGGREGATION_CASES', () => {
      const T = 'fed_aggregation';
      beforeAll(async () => {
        await federate(T, {
          region: { type: 'text' }, stage: { type: 'text' }, score: { type: 'number' },
          amount: { type: 'number' }, flag: { type: 'boolean' },
        });
        await writeRows(T, AGGREGATION_ROWS);
      });
      const astFor = (c: AggregationCase): QueryAST => ({
        object: T,
        aggregations: [{ function: c.function, ...(c.field ? { field: c.field } : {}), alias: 'n' }],
        ...(c.groupBy ? { groupBy: [c.groupByAlias ? { field: c.groupBy, alias: c.groupByAlias } : c.groupBy] } : {}),
      });
      for (const c of AGGREGATION_CASES) {
        it(c.name, async () => {
          const groupKey = c.groupByAlias ?? c.groupBy;
          const rows = (await driver.aggregate(T, astFor(c))) as Array<Record<string, unknown>>;
          const actual = rows
            .map((r) => ({ group: groupKey ? String(r[groupKey]) : null, value: r.n === null ? null : Number(r.n) }))
            .sort((x, y) => String(x.group).localeCompare(String(y.group)));
          expect(actual, c.note).toEqual([...c.expected]);
        });
      }
    });

    // ── VALUE_ROUNDTRIP (#12393) ─────────────────────────────────────────────
    describe('VALUE_ROUNDTRIP_CASES', () => {
      const T = 'fed_value_roundtrip';
      beforeAll(async () => {
        await federate(T, { ...VALUE_ROUNDTRIP_FIELDS } as Record<string, FieldSpec>);
        await writeRows(T, VALUE_ROUNDTRIP_ROWS);
      });
      it('every case round-trips — the whole set at once', async () => {
        const rows = (await driver.find(T, {}, BYPASS)) as any[];
        const byLabel = new Map(rows.map((r) => [r.label, r]));
        const divergences = VALUE_ROUNDTRIP_CASES
          .map((c) => valueRoundTripDivergence(c, byLabel.get(c.name)?.[c.column]))
          .filter((d): d is string => d !== null);
        expect(divergences, `${VALUE_ROUNDTRIP_CASES.length - divergences.length}/${VALUE_ROUNDTRIP_CASES.length} faithful`).toEqual([]);
      });
    });

    // ── UNIQUE_NULL_DISTINCT (#29377) ────────────────────────────────────────
    describe('UNIQUE_NULL_DISTINCT_CASES', () => {
      const single = UNIQUE_NULL_DISTINCT_OBJECTS.unique_null_single;
      const compound = UNIQUE_NULL_DISTINCT_OBJECTS.unique_null_compound;
      beforeAll(async () => {
        await federate(single.name, { label: { type: 'text' }, code: { type: 'text' } }, { uniqueIndexes: [['code']] });
        await federate(compound.name, { label: { type: 'text' }, region: { type: 'text' }, tag: { type: 'text' } }, {
          uniqueIndexes: [[...compound.indexes[0].fields]],
        });
      });
      for (const c of UNIQUE_NULL_DISTINCT_CASES) {
        it(c.name, async () => {
          await driver.create(c.object, { ...c.first }, BYPASS);
          const second = await driver.create(c.object, { ...c.second }, BYPASS).then(() => 'admitted' as const, () => 'refused' as const);
          const stored = await driver.count(c.object, { where: { label: c.name } }, BYPASS);
          expect(uniqueNullDistinctDivergence(c, second, stored), c.note).toBeNull();
        });
      }
    });

    // ── READABLE_IDS (ADR-0139 D3) ───────────────────────────────────────────
    describe('READABLE_IDS_CASES', () => {
      const PARENT_FIELDS = { owner: { type: 'text' }, organization_id: { type: 'text' } };
      const CHILD_FIELDS = {
        object_name: { type: 'text' }, record_id: { type: 'text' }, label: { type: 'text' }, organization_id: { type: 'text' },
      };
      const BIG_PARENT = 'rid_big_parent';
      const BIG_CHILD = 'rid_big_child';
      const BIG_READABLE = 2_400;
      const insertChunked = async (table: string, rows: Record<string, unknown>[]) => {
        for (let i = 0; i < rows.length; i += 100) await knex(table).withSchema(schema).insert(rows.slice(i, i + 100));
      };
      beforeAll(async () => {
        await federate(READABLE_IDS_PARENT_OBJECT, PARENT_FIELDS);
        await federate(READABLE_IDS_CHILD_OBJECT, CHILD_FIELDS);
        await federate(BIG_PARENT, PARENT_FIELDS);
        await federate(BIG_CHILD, CHILD_FIELDS);
        await insertChunked(READABLE_IDS_PARENT_OBJECT, READABLE_IDS_PARENT_ROWS.map((r) => ({ ...r })));
        await insertChunked(READABLE_IDS_CHILD_OBJECT, READABLE_IDS_CHILD_ROWS.map((r) => ({ ...r })));
        const parents: Record<string, unknown>[] = [];
        const children: Record<string, unknown>[] = [];
        for (let i = 0; i < BIG_READABLE + 300; i++) {
          const id = `bp${String(i).padStart(5, '0')}`;
          parents.push({ id, owner: i < BIG_READABLE ? 'reader' : 'someone_else', organization_id: 'org_a' });
          children.push({ id: `bc${String(i).padStart(5, '0')}`, object_name: BIG_PARENT, record_id: id, label: 'x', organization_id: 'org_a' });
        }
        await insertChunked(BIG_PARENT, parents);
        await insertChunked(BIG_CHILD, children);
      });
      for (const c of READABLE_IDS_CASES) {
        it(c.name, async () => {
          if (c.verdict === 'matches') {
            const rows = await driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }, c.options);
            expect(sortedIds(rows), c.note).toEqual(c.expected);
            expect(await driver.count(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }, c.options), c.note).toBe(c.expected.length);
          } else {
            await expect(driver.find(READABLE_IDS_CHILD_OBJECT, { where: seamed(c.where()) }), c.note).rejects.toMatchObject(READABLE_IDS_REFUSAL);
          }
        });
      }
      it(`a reader with ${BIG_READABLE} readable candidates gets every visible row — past SQL Server's 2100-parameter ceiling`, async () => {
        const where = seamed({ record_id: { $in: ReadableIds.compose(ReadableIds.of(BIG_PARENT), { owner: 'reader' }) } });
        const rows = await driver.find(BIG_CHILD, { where }, { tenantId: 'org_a' });
        expect(rows).toHaveLength(BIG_READABLE);
        expect(await driver.count(BIG_CHILD, { where }, { tenantId: 'org_a' })).toBe(BIG_READABLE);
      });
    });

    // ── The write path on SQL Server's own terms ─────────────────────────────
    describe('writes: OUTPUT inserted.* on an ERP-shaped table', () => {
      const T = 'fed_write_path';
      beforeAll(async () => {
        await federate(T, { title: { type: 'text' }, qty: { type: 'integer' }, touched: { type: 'text' } });
        // An enabled trigger — routine on an ERP table — makes SQL Server
        // refuse `OUTPUT inserted.*` without `INTO` (error 334).
        await knex.raw(
          `CREATE TRIGGER [${schema}].[tr_${T}] ON [${schema}].[${T}] AFTER INSERT AS ` +
            `UPDATE t SET [touched] = N'by-trigger' FROM [${schema}].[${T}] t JOIN inserted i ON i.[id] = t.[id]`,
        );
        await knex.raw(`ALTER TABLE [${schema}].[${T}] ADD CONSTRAINT [df_${T}_qty] DEFAULT 7 FOR [qty]`);
      });
      it('create answers the stored row, a server-side default included, through a trigger', async () => {
        const row = await driver.create(T, { id: 'w1', title: 'first' }, BYPASS);
        expect(row).toMatchObject({ id: 'w1', title: 'first', qty: 7 });
      });
      it('bulkCreate answers every stored row', async () => {
        const rows = await driver.bulkCreate(T, [{ id: 'w2', title: 'b' }, { id: 'w3', title: 'c', qty: 1 }], BYPASS);
        expect(rows.map((r: any) => [r.id, r.qty])).toEqual([['w2', 7], ['w3', 1]]);
      });
      it('update and delete land, and the trigger ran', async () => {
        await driver.update(T, 'w2', { title: 'bb' }, BYPASS);
        await driver.delete(T, 'w3', BYPASS);
        const rows = await driver.find(T, { orderBy: [{ field: 'id', order: 'asc' }] }, BYPASS);
        expect(rows.map((r: any) => [r.id, r.title, r.touched])).toEqual([
          ['w1', 'first', 'by-trigger'],
          ['w2', 'bb', 'by-trigger'],
        ]);
      });
    });

    // ── uniqueidentifier: the `uuid` type-compat row, held to its word ───────
    //
    // `DIALECT_ALIASES.mssql` maps `uniqueidentifier` to `uuid`, which a lookup
    // or a text field reads exactly. That is only true if a GUID written as a
    // string reads back as THAT string and filters by it: SQL Server compares
    // GUIDs regardless of case, but returns them upper-case unless the
    // connection asks for the canonical lower-case form.
    describe('uniqueidentifier: a GUID string round-trips and filters by itself', () => {
      const T = 'fed_guid';
      const ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
      const REF = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
      beforeAll(async () => {
        await knex.raw(`IF OBJECT_ID(N'[${schema}].[${T}]') IS NOT NULL DROP TABLE [${schema}].[${T}]`);
        await knex.raw(
          `CREATE TABLE [${schema}].[${T}] ([id] uniqueidentifier NOT NULL PRIMARY KEY, [ref] uniqueidentifier NULL, [name] nvarchar(50) NULL)`,
        );
        tables.push(T);
        driver.registerExternalObject({
          name: T,
          fields: { ref: { type: 'text' }, name: { type: 'text' } },
          external: { remoteName: T, remoteSchema: schema },
        });
      });
      it('create answers the GUIDs exactly as written', async () => {
        const row = await driver.create(T, { id: ID, ref: REF, name: 'g' }, BYPASS);
        expect(row).toMatchObject({ id: ID, ref: REF });
      });
      it('a read answers the canonical lower-case form, and filters by either case', async () => {
        expect((await driver.findOne(T, { where: { id: ID } }, BYPASS))?.ref).toBe(REF);
        expect(sortedIds(await driver.find(T, { where: { ref: REF } }, BYPASS))).toEqual([ID]);
        expect(sortedIds(await driver.find(T, { where: { ref: REF.toUpperCase() } }, BYPASS))).toEqual([ID]);
        expect(sortedIds(await driver.find(T, { where: { ref: { $in: [REF] } } }, BYPASS))).toEqual([ID]);
      });
      it('update by a GUID id lands', async () => {
        await driver.update(T, ID, { name: 'h' }, BYPASS);
        expect((await driver.findOne(T, { where: { id: ID } }, BYPASS))?.name).toBe('h');
      });
    });

    // ── CROSS_FIELD (#5222): refused on a federated object, on every dialect ──
    //
    // Cross-field push-down validates both column names against the object's
    // DECLARED column set, which a federated object does not give this driver
    // (`declaredFieldsFor` is the managed-table registry). That refusal is the
    // standing ADR-0015 contract on Postgres and MySQL federation too — not a
    // SQL Server gap — so the case-set is run here as what it is on this cell:
    // every case REFUSED as INVALID_FILTER, none answered with wrong rows.
    describe('CROSS_FIELD_CASES', () => {
      const T = 'fed_cross_field';
      beforeAll(async () => {
        await federate(T, CROSS_FIELD_OBJECT_FIELDS as Record<string, FieldSpec>);
        await writeRows(T, CROSS_FIELD_ROWS);
      });
      it('the fixture round-tripped with its NULLs intact', async () => {
        const byId = new Map((await driver.find(T, {}, BYPASS)).map((r) => [String(r.id), r]));
        expect(byId.size).toBe(CROSS_FIELD_ROWS.length);
        expect(byId.get('6')!.amount).toBeNull();
        expect(byId.get('4')!.budget).toBe(5);
        expect(byId.get('1')!.starts_on).toBe('2026-03-05');
      });
      for (const c of [...CROSS_FIELD_CASES, ...CROSS_FIELD_AUTHORED_CASES.map((a) => ({ name: a.name, filter: parseFilterAST(a.authored) }))]) {
        it(`${c.name} — refused on a federated object, never answered`, async () => {
          const err = await driver.find(T, { fields: ['id'], where: c.filter as FilterCondition }, BYPASS).then(() => null, (e: any) => e);
          expect(err, 'a federated object has no declared column set to validate a $field reference against').toBeInstanceOf(Error);
          expect(err.code).toBe('INVALID_FILTER');
        });
      }
    });
  });
}
