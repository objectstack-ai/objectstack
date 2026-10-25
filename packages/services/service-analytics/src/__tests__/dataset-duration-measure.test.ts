// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25778] A dataset DURATION measure — `duration: { from, to, unit }` — answers
 * the aggregated time between two `datetime` columns of the same record, the
 * same number on SQLite and on PostgreSQL.
 *
 * The fixture's durations are chosen to be exact in a double at every unit the
 * assertions read: 90 minutes, a whole day, three quarters of a second (a
 * millisecond-precision instant), and a NEGATIVE hour (a `to` before its
 * `from`, aggregated as stored). Two rows miss one instant each and a whole
 * group misses them all, so the null exclusion is measured, not assumed. Every
 * expected value is computed from the rows with JS arithmetic, in the order the
 * statement computes it (`duration-measure-sql.ts`), and asserted with `toBe`,
 * so each cell equals the one expectation and the two cells equal each other.
 *
 * Driven through the plugin's own composition over a real engine
 * (`AnalyticsServicePlugin` + `ObjectQL` + `SqlDriver`), the dataset door
 * (`queryDataset`) and the cube door (`query` on a registered dataset), with
 * the raw statements and the engine aggregates that read the object counted:
 * the native strategy answers, one statement per pass, and no engine
 * aggregate runs.
 *
 * ## The dialect axis
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise (CI provisions
 * it for this package, see `native-sql-measure-number-presentation.test.ts`).
 * MySQL has no live cell in this package; its statement is pinned as text in
 * `native-sql-duration-measure.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os25778_ticket';

const TICKET = {
  name: OBJECT,
  label: 'Duration measure ticket',
  fields: {
    category: { name: 'category', type: 'text' as const },
    priority: { name: 'priority', type: 'text' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    resolved_at: { name: 'resolved_at', type: 'datetime' as const },
    due_on: { name: 'due_on', type: 'date' as const },
    effort: { name: 'effort', type: 'number' as const },
  },
};

interface Row {
  id: string;
  category: string;
  priority: string;
  opened_at: string | null;
  resolved_at: string | null;
  due_on: string;
  effort: number;
}

const ROWS: readonly Row[] = [
  // a: 90 minutes, a whole day, and one row never resolved (excluded).
  { id: 't1', category: 'a', priority: 'high', opened_at: '2026-03-01T08:00:00.000Z', resolved_at: '2026-03-01T09:30:00.000Z', due_on: '2026-03-02', effort: 1 },
  { id: 't2', category: 'a', priority: 'low', opened_at: '2026-03-02T10:00:00.000Z', resolved_at: '2026-03-03T10:00:00.000Z', due_on: '2026-03-04', effort: 2 },
  { id: 't3', category: 'a', priority: 'high', opened_at: '2026-03-04T00:00:00.000Z', resolved_at: null, due_on: '2026-03-05', effort: 3 },
  // b: three quarters of a second (millisecond instants), and a negative hour.
  { id: 't4', category: 'b', priority: 'high', opened_at: '2026-03-05T12:00:00.250Z', resolved_at: '2026-03-05T12:00:01.000Z', due_on: '2026-03-06', effort: 4 },
  { id: 't5', category: 'b', priority: 'low', opened_at: '2026-03-06T00:00:00.000Z', resolved_at: '2026-03-05T23:00:00.000Z', due_on: '2026-03-07', effort: 5 },
  // c: no row carries both instants.
  { id: 't6', category: 'c', priority: 'high', opened_at: null, resolved_at: '2026-03-07T00:00:00.000Z', due_on: '2026-03-08', effort: 6 },
  { id: 't7', category: 'c', priority: 'low', opened_at: '2026-03-08T00:00:00.000Z', resolved_at: null, due_on: '2026-03-09', effort: 7 },
];

const GROUPS = ['a', 'b', 'c'] as const;
const UNIT_SECONDS = { seconds: 1, minutes: 60, hours: 3600, days: 86400 } as const;
type Unit = keyof typeof UNIT_SECONDS;

/** One row's duration in `unit`, as the statement computes it; `null` without both instants. */
function durationOf(r: Row, unit: Unit): number | null {
  if (r.opened_at === null || r.resolved_at === null) return null;
  return Math.round(Date.parse(r.resolved_at) - Date.parse(r.opened_at)) / 1000 / UNIT_SECONDS[unit];
}

function aggregate(rows: readonly Row[], agg: 'avg' | 'min' | 'max' | 'sum', unit: Unit): number | null {
  const values = rows.map((r) => durationOf(r, unit)).filter((v): v is number => v !== null);
  if (agg === 'sum') return values.reduce((a, v) => a + v, 0);
  if (values.length === 0) return null;
  if (agg === 'avg') return values.reduce((a, v) => a + v, 0) / values.length;
  return agg === 'min' ? Math.min(...values) : Math.max(...values);
}

const byGroup = (g: string, rows: readonly Row[] = ROWS) => rows.filter((r) => r.category === g);

const DURATION = { from: 'opened_at', to: 'resolved_at' } as const;

const DATASET: Dataset = DatasetSchema.parse({
  name: 'os25778_resolution',
  label: 'Resolution times',
  object: OBJECT,
  dimensions: [
    { name: 'category', field: 'category', type: 'string' },
    { name: 'opened', field: 'opened_at', type: 'date' },
  ],
  measures: [
    { name: 'tickets', aggregate: 'count' },
    { name: 'avg_hours', aggregate: 'avg', duration: { ...DURATION, unit: 'hours' } },
    { name: 'total_seconds', aggregate: 'sum', duration: { ...DURATION, unit: 'seconds' } },
    { name: 'fastest_minutes', aggregate: 'min', duration: { ...DURATION, unit: 'minutes' } },
    { name: 'slowest_days', aggregate: 'max', duration: { ...DURATION, unit: 'days' } },
    { name: 'high_avg_hours', aggregate: 'avg', duration: { ...DURATION, unit: 'hours' }, filter: { priority: 'high' } },
    { name: 'seconds_per_ticket', derived: { op: 'ratio', of: ['total_seconds', 'tickets'] } },
  ],
});

const DURATION_MEASURES = ['avg_hours', 'total_seconds', 'fastest_minutes', 'slowest_days'] as const;

function expected(g: string): Record<(typeof DURATION_MEASURES)[number] | 'high_avg_hours', number | null> {
  const rows = byGroup(g);
  return {
    avg_hours: aggregate(rows, 'avg', 'hours'),
    total_seconds: aggregate(rows, 'sum', 'seconds'),
    fastest_minutes: aggregate(rows, 'min', 'minutes'),
    slowest_days: aggregate(rows, 'max', 'days'),
    high_avg_hours: aggregate(rows.filter((r) => r.priority === 'high'), 'avg', 'hours'),
  };
}

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Answer = Record<string, unknown>;
type Refusal = Error & { code?: string; status?: number; member?: string };
const byCategory = (rows: readonly Answer[]) => new Map(rows.map((r) => [String(r.category), r]));

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#25778] dataset duration measure — the aggregated time between two datetime columns (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      const reads = { rawSql: 0, aggregate: 0, statements: [] as string[] };
      const services: Partial<Record<'native' | 'objectql', AnalyticsService>> = {};

      const dropTable = async () => {
        if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      const counted = async <T>(run: () => Promise<T>) => {
        const before = { rawSql: reads.rawSql, aggregate: reads.aggregate };
        const settled = await run().then((value) => ({ value, error: undefined }), (error: Refusal) => ({ value: undefined, error }));
        return { ...settled, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTable();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(TICKET as any);
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
          if (opts?.object === OBJECT) {
            reads.rawSql += 1;
            reads.statements.push(String((sql as { sql?: string })?.sql ?? sql));
          }
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
          if (object === OBJECT) reads.aggregate += 1;
          return (realAggregate as any)(object, ...rest);
        };

        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
            getService: (name: string) => (name === 'data' ? engine : registered[name]),
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          services[face] = registered.analytics as AnalyticsService;
          // The configuration door, so the cube door can name the dataset.
          services[face]!.registerDataset(DATASET);
        }
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('avg / sum / min / max in each unit equal the rows, nulls excluded, on the native strategy', async () => {
        const run = await counted(() => services.native!.queryDataset(DATASET, { measures: [...DURATION_MEASURES], dimensions: ['category'] } as any));
        expect(run.error, run.error?.message).toBeUndefined();
        expect(run.rawSql, 'one raw statement: NativeSQLStrategy answered').toBe(1);
        expect(run.aggregate, 'no engine aggregate').toBe(0);
        const answers = byCategory(run.value!.rows as Answer[]);
        expect([...answers.keys()].sort()).toEqual([...GROUPS]);
        for (const g of GROUPS) {
          const want = expected(g);
          for (const m of DURATION_MEASURES) {
            expect(answers.get(g)![m], `${g} ${m}`).toBe(want[m]);
          }
        }
        // The values the fixture was built to produce, stated once by hand.
        expect(answers.get('a')!.avg_hours).toBe(12.75);
        expect(answers.get('a')!.fastest_minutes).toBe(90);
        expect(answers.get('b')!.total_seconds).toBe(-3599.25);
        expect(answers.get('c')!.total_seconds, 'sum over no duration is 0').toBe(0);
        expect(answers.get('c')!.avg_hours, 'avg over no duration has no answer').toBeNull();
        for (const m of DURATION_MEASURES) {
          expect(run.value!.fields.find((f) => f.name === m)?.type, `${m} is declared a number`).toBe('number');
        }
      });

      it('a measure filter narrows only its own measure, and a derived measure reads a duration', async () => {
        const run = await counted(() =>
          services.native!.queryDataset(DATASET, { measures: ['avg_hours', 'high_avg_hours', 'seconds_per_ticket'], dimensions: ['category'] } as any),
        );
        expect(run.error, run.error?.message).toBeUndefined();
        expect(run.aggregate, 'no engine aggregate').toBe(0);
        const answers = byCategory(run.value!.rows as Answer[]);
        for (const g of GROUPS) {
          const want = expected(g);
          expect(answers.get(g)!.avg_hours, `${g} avg_hours`).toBe(want.avg_hours);
          expect(answers.get(g)!.high_avg_hours, `${g} high_avg_hours`).toBe(want.high_avg_hours);
          expect(answers.get(g)!.seconds_per_ticket, `${g} seconds_per_ticket`).toBe((want.total_seconds ?? 0) / byGroup(g).length);
        }
      });

      it('the ungrouped total, and a page ordered and windowed by a duration measure', async () => {
        const total = await services.native!.queryDataset(DATASET, { measures: ['avg_hours', 'total_seconds'] } as any);
        expect(total.rows).toEqual([{ avg_hours: aggregate(ROWS, 'avg', 'hours'), total_seconds: aggregate(ROWS, 'sum', 'seconds') }]);

        // Group `c` is left out: its sum is SQL NULL until the strategy folds it
        // to 0, and the dialects order a NULL at opposite ends.
        const run = await counted(() =>
          services.native!.queryDataset(DATASET, {
            measures: ['total_seconds'],
            dimensions: ['category'],
            runtimeFilter: { category: { $ne: 'c' } },
            order: { total_seconds: 'asc' },
            limit: 1,
          } as any),
        );
        expect(run.error, run.error?.message).toBeUndefined();
        expect(run.rawSql).toBe(1);
        expect(reads.statements.at(-1)).toContain('ORDER BY "total_seconds" ASC');
        expect(run.value!.rows).toEqual([{ category: 'b', total_seconds: -3599.25 }]);
      });

      it('the cube door serves the registered dataset by name, with the same numbers', async () => {
        const run = await counted(() =>
          services.native!.query({ cube: DATASET.name, measures: [...DURATION_MEASURES], dimensions: ['category'] } as any),
        );
        expect(run.error, run.error?.message).toBeUndefined();
        expect(run.rawSql).toBe(1);
        const answers = byCategory(run.value!.rows as Answer[]);
        for (const g of GROUPS) {
          for (const m of DURATION_MEASURES) expect(answers.get(g)![m], `${g} ${m}`).toBe(expected(g)[m]);
        }
      });

      it('a granularity-bucketed trend routes off the native strategy: INVALID_FIELD / 400 naming the measure, nothing runs', async () => {
        const run = await counted(() =>
          services.native!.queryDataset(DATASET, {
            measures: ['avg_hours'],
            dimensions: ['opened'],
            timeDimensions: [{ dimension: 'opened', granularity: 'month' }],
          } as any),
        );
        expect(run.error?.code, run.error?.message).toBe('INVALID_FIELD');
        expect(run.error?.status).toBe(400);
        expect(run.error?.message).toContain('Measure "avg_hours"');
        expect(run.error?.message).toContain('granularity');
        expect(run.rawSql + run.aggregate, 'no statement and no engine aggregate ran').toBe(0);
      });

      it('a deployment without native SQL refuses a duration measure the same way, and still serves the others', async () => {
        const refused = await counted(() => services.objectql!.queryDataset(DATASET, { measures: ['tickets', 'avg_hours'], dimensions: ['category'] } as any));
        expect(refused.error?.code, refused.error?.message).toBe('INVALID_FIELD');
        expect(refused.error?.status).toBe(400);
        expect(refused.error?.message).toContain('Measure "avg_hours"');
        expect(refused.rawSql + refused.aggregate).toBe(0);

        const served = await services.objectql!.queryDataset(DATASET, { measures: ['tickets'], dimensions: ['category'] } as any);
        expect(Object.fromEntries((served.rows as Answer[]).map((r) => [r.category, r.tickets]))).toEqual({ a: 3, b: 2, c: 2 });
      });

      it('a duration over a field that is not datetime is refused at compile: DATASET_INVALID / 400, naming the column and its type', async () => {
        for (const [column, type] of [['due_on', 'date'], ['effort', 'number'], ['category', 'text']] as const) {
          const dataset = DatasetSchema.parse({
            ...DATASET,
            name: `os25778_bad_${column}`,
            measures: [{ name: 'bad', aggregate: 'avg', duration: { from: column, to: 'resolved_at', unit: 'hours' } }],
          });
          const run = await counted(() => services.native!.queryDataset(dataset, { measures: ['bad'], dimensions: ['category'] } as any));
          expect(run.error?.code, run.error?.message).toBe('DATASET_INVALID');
          expect(run.error?.status).toBe(400);
          expect(run.error?.message).toContain(`\`duration.from\` "${column}"`);
          expect(run.error?.message).toContain(`declares as \`${type}\``);
          expect(run.rawSql + run.aggregate).toBe(0);
        }
      });
    },
  );
}
