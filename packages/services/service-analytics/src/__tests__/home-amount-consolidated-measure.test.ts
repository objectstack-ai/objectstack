// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D6, multi-currency M3-1] A consolidated total over a record-mode
 * amount is a plain `sum` over its stored home field, through the dataset
 * compile + query path, with no code of its own.
 *
 * ## What these pins hold
 *
 * - **The proof.** Rows in three record currencies (USD, EUR and the home
 *   CNY) are written through the engine, whose write-time projection (D5,
 *   `home-amount-projection.ts` in `@objectstack/objectql`) stores each
 *   amount converted into the home currency in the declared home field. A
 *   dataset measure `sum` over that field answers the home-currency total,
 *   ungrouped (a KPI), grouped by the code field, and as a `totals` grand
 *   total; the column carries the home currency (the tenant's, because the
 *   home field is `dynamic`) and no per-row `currencyField`. The raw `sum`
 *   over the record amount of the same rows is a different number (it adds
 *   dollars to euros), which the controls show.
 * - **The door's words.** The ungrouped `sum` over the record amount is
 *   still refused `INVALID_FIELD` / 400 before anything is read, and its
 *   message now names both remedies: the declared home field by name, or the
 *   grouping over the code field. An amount that declares no `homeAmount`
 *   reads the declaration to add instead.
 *
 * ## The axes
 *
 * Three stores: the draft-preview evaluator (in memory, over the very rows
 * the projection wrote, read back from the store), SQLite, and PostgreSQL.
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; CI provisions
 * that variable for this package in the Temporal Conformance job
 * (`.github/workflows/ci.yml`). The live cell owns a schema of its own,
 * dropped before and after. Both SQL cells run both strategies
 * (`NativeSQLStrategy`, the plugin's own capabilities; `ObjectQLStrategy`,
 * narrowed to the engine aggregate).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { AnalyticsResult } from '@objectstack/spec/contracts';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'os27195_fx_invoice';
const BARE = 'os27195_fx_bare';
const PG_SCHEMA = 'os27195_home_measure';

/** The rate table's shape (`sys_exchange_rate`, owned by platform-objects; a stand-in here, as in objectql's own pins). */
const RATE_OBJECT = {
  name: 'sys_exchange_rate',
  label: 'Exchange rate',
  fields: {
    currency: { name: 'currency', type: 'text' as const, valueDomain: 'iso_4217_currency' },
    rate: { name: 'rate', type: 'number' as const, scale: 12, precision: 24 },
    effective_date: { name: 'effective_date', type: 'date' as const },
  },
};

const INVOICE = {
  name: OBJECT,
  label: 'FX invoice',
  fields: {
    currency_code: { name: 'currency_code', type: 'text' as const, valueDomain: 'iso_4217_currency' },
    invoice_date: { name: 'invoice_date', type: 'date' as const },
    amount: {
      name: 'amount',
      type: 'currency' as const,
      currencyConfig: {
        currencyMode: 'record' as const,
        currencyField: 'currency_code',
        homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
      },
    },
    amount_home: { name: 'amount_home', type: 'currency' as const, readonly: true },
    amount_rate: { name: 'amount_rate', type: 'number' as const, readonly: true },
  },
};

/** The same record amount with no `homeAmount`: the refusal has no home field to name. */
const BARE_INVOICE = {
  name: BARE,
  label: 'FX invoice without a home field',
  fields: {
    currency_code: { name: 'currency_code', type: 'text' as const, valueDomain: 'iso_4217_currency' },
    amount: {
      name: 'amount',
      type: 'currency' as const,
      currencyConfig: { currencyMode: 'record' as const, currencyField: 'currency_code' },
    },
  },
};

const HOME = 'CNY';

/** "1 home unit = rate units of the foreign currency" (ADR-0144 D7 parameter 3), so home = amount ÷ rate. */
const RATES: ReadonlyArray<[currency: string, effective_date: string, rate: number]> = [
  ['USD', '2026-01-01', 0.125],
  ['EUR', '2026-01-01', 0.1],
];

/** Three record currencies; the home amount each row's projection stores is in the comment. */
const ROWS = [
  { id: 'h1', currency_code: 'USD', invoice_date: '2026-03-01', amount: 100 }, // 800
  { id: 'h2', currency_code: 'USD', invoice_date: '2026-03-02', amount: 20 }, //  160
  { id: 'h3', currency_code: 'EUR', invoice_date: '2026-03-03', amount: 100 }, // 1000
  { id: 'h4', currency_code: 'CNY', invoice_date: '2026-03-04', amount: 50 }, //    50 (rate 1)
] as const;

const HOME_TOTAL = 2010;
const HOME_BY_CODE = { USD: 960, EUR: 1000, CNY: 50 };
/** What the raw amounts add to: dollars, euros and yuan as one number — the shape the door refuses. */
const RAW_SUM = 270;

const DATASET = DatasetSchema.parse({
  name: 'os27195_consolidated',
  label: 'Invoices, consolidated',
  object: OBJECT,
  dimensions: [{ name: 'currency', field: 'currency_code', type: 'string' }],
  measures: [
    { name: 'home_total', aggregate: 'sum', field: 'amount_home' },
    { name: 'raw_total', aggregate: 'sum', field: 'amount' },
    { name: 'invoices', aggregate: 'count' },
  ],
});

const BARE_DATASET = DatasetSchema.parse({
  name: 'os27195_bare',
  label: 'Invoices without a home field',
  object: BARE,
  dimensions: [{ name: 'currency', field: 'currency_code', type: 'string' }],
  measures: [{ name: 'raw_total', aggregate: 'sum', field: 'amount' }],
});

const CTX = { currency: HOME } as ExecutionContext;
const SYS = { context: { isSystem: true } } as const;

type Face = 'native' | 'objectql';
const FACES: readonly Face[] = ['native', 'objectql'];

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
    config: () => (process.env.OS_TEST_POSTGRES_URL
      ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL, searchPath: [PG_SCHEMA] }
      : null),
  },
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; member?: string; param?: string; field?: string; object?: string };

const refusalOf = (p: Promise<unknown>): Promise<Refusal> =>
  p.then<never, Refusal>(
    () => {
      throw new Error('expected a refusal, but the query resolved');
    },
    (e) => e as Refusal,
  );

const column = (result: AnalyticsResult, name: string) =>
  (result.fields ?? []).find((f) => f.name === name) as
    | { name: string; currency?: string; currencyField?: string }
    | undefined;

const byCode = (rows: unknown[], measure: string) =>
  Object.fromEntries((rows as Array<Record<string, unknown>>).map((r) => [r.currency, Number(r[measure])]));

/** The live cell's own schema, created or dropped on a connection outside it. */
async function pgSchema(statement: 'create' | 'drop'): Promise<void> {
  const admin = new SqlDriver({ client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } as never);
  try {
    await admin.execute(`drop schema if exists ${PG_SCHEMA} cascade`);
    if (statement === 'create') await admin.execute(`create schema ${PG_SCHEMA}`);
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[ADR-0144 D6 · M3-1] a consolidated measure over the stored home field (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read the invoice objects. */
      const reads = { rawSql: 0, aggregate: 0 };
      const services: Partial<Record<Face, AnalyticsService>> = {};
      /** The rows as the projection stored them, read back — the draft preview's seed. */
      let stored: Array<Record<string, unknown>> = [];

      beforeAll(async () => {
        if (cell.id === 'pg') await pgSchema('create');
        const driver = new SqlDriver(config as never);
        engine = new ObjectQL({ logger: quiet } as never);
        engine.registerDriver(driver as never, true);
        await engine.init();
        for (const object of [RATE_OBJECT, INVOICE, BARE_INVOICE]) engine.registry.registerObject(object as never);
        await engine.syncSchemas();
        await installDefaultOrganization(engine as never);
        engine.setHomeLocalizationResolver(async () => ({ currency: HOME }));
        for (const [currency, effective_date, rate] of RATES) {
          await engine.insert('sys_exchange_rate', { currency, effective_date, rate }, SYS as never);
        }
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never, SYS as never);
        for (const row of ROWS) {
          await engine.insert(BARE, { id: row.id, currency_code: row.currency_code, amount: row.amount } as never, SYS as never);
        }
        stored = (await engine.find(OBJECT, { context: SYS.context } as never)) as Array<Record<string, unknown>>;

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
          if (opts?.object === OBJECT || opts?.object === BARE) reads.rawSql += 1;
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
          if (object === OBJECT || object === BARE) reads.aggregate += 1;
          return (realAggregate as any)(object, ...rest);
        };

        // A `'protocol'` service answering one pending seed draft of the STORED
        // rows, which routes `previewDrafts` onto the in-memory evaluator.
        const pendingSeedProtocol = {
          getMetaItems: async () => [{ name: 'os27195_seed', object: OBJECT }],
          getMetaItem: async () => ({ item: { records: stored } }),
        };
        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          const provided: Record<string, unknown> = { data: engine, protocol: pendingSeedProtocol };
          await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
            getService: (name: string) => provided[name] ?? registered[name],
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          services[face] = registered.analytics as AnalyticsService;
        }
      });

      afterAll(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        if (cell.id === 'pg') await pgSchema('drop');
      });

      it('the projection stored each row in the home currency (the fixture the proof reads)', () => {
        const home = Object.fromEntries(stored.map((r) => [r.id, [Number(r.amount_home), Number(r.amount_rate)]]));
        expect(home).toEqual({ h1: [800, 0.125], h2: [160, 0.125], h3: [1000, 0.1], h4: [50, 1] });
      });

      for (const face of FACES) {
        describe(`${face} strategy`, () => {
          it('a sum over the home field, ungrouped, answers the home-currency total, labelled with the home currency', async () => {
            const result = await services[face]!.queryDataset(DATASET, { measures: ['home_total', 'invoices'] }, CTX);
            const [row] = result.rows as Array<Record<string, unknown>>;
            expect(Number(row!.home_total)).toBe(HOME_TOTAL);
            expect(Number(row!.invoices)).toBe(ROWS.length);
            expect(column(result, 'home_total')?.currency).toBe(HOME);
            expect(column(result, 'home_total')?.currencyField).toBeUndefined();
          });

          it('grouped by the code field: each currency\'s home subtotal, and a grand total equal to the KPI', async () => {
            const result = await services[face]!.queryDataset(
              DATASET,
              { dimensions: ['currency'], measures: ['home_total', 'raw_total'], totals: { groupings: [[]] } },
              CTX,
            ).catch((e: Refusal) => e);
            // The grand total over `raw_total` drops the code, so the door refuses
            // it; the home field alone is served under the same grand total.
            expect((result as Refusal).code).toBe('INVALID_FIELD');
            expect((result as Refusal).member).toBe('raw_total');

            const served = await services[face]!.queryDataset(
              DATASET,
              { dimensions: ['currency'], measures: ['home_total'], totals: { groupings: [[]] } },
              CTX,
            );
            expect(byCode(served.rows, 'home_total')).toEqual(HOME_BY_CODE);
            expect(Number((served.totals?.[0]?.rows[0] as Record<string, unknown>).home_total)).toBe(HOME_TOTAL);
            expect(column(served, 'home_total')?.currency).toBe(HOME);
            expect(column(served, 'home_total')?.currencyField).toBeUndefined();
          });

          it('the control: grouped by the code, the raw amount is served per currency and does not add to the home total', async () => {
            const result = await services[face]!.queryDataset(DATASET, { dimensions: ['currency'], measures: ['raw_total'] }, CTX);
            expect(byCode(result.rows, 'raw_total')).toEqual({ USD: 120, EUR: 100, CNY: 50 });
            expect(Object.values(byCode(result.rows, 'raw_total')).reduce((a, b) => a + b, 0)).toBe(RAW_SUM);
            expect(column(result, 'raw_total')?.currencyField).toBe('currency');
          });

          it('the ungrouped sum over the record amount is refused before anything is read, and the words name the home field and the grouping', async () => {
            const before = { ...reads };
            const err = await refusalOf(services[face]!.queryDataset(DATASET, { measures: ['raw_total'] }, CTX));
            expect(err.code, err.message).toBe('INVALID_FIELD');
            expect(err.status).toBe(400);
            expect(err.member).toBe('raw_total');
            expect(err.field).toBe('amount');
            expect(err.object).toBe(OBJECT);
            expect(err.message).toContain(`point the measure at 'amount_home', the home-currency amount object '${OBJECT}' declares for 'amount'`);
            expect(err.message).toContain("add the dimension over 'currency_code' to the query");
            expect(reads.rawSql - before.rawSql).toBe(0);
            expect(reads.aggregate - before.aggregate).toBe(0);
          });

          it('an amount declaring no homeAmount reads the declaration to add, and the grouping', async () => {
            const err = await refusalOf(services[face]!.queryDataset(BARE_DATASET, { measures: ['raw_total'] }, CTX));
            expect(err.code, err.message).toBe('INVALID_FIELD');
            expect(err.object).toBe(BARE);
            expect(err.message).toContain(
              `declare \`currencyConfig.homeAmount\` on 'amount' of object '${BARE}' and point the measure at its home field`,
            );
            expect(err.message).toContain("add the dimension over 'currency_code' to the query");
          });

          it('the inferred cube (no registered dataset): `amount_home_sum` is served, `amount_sum` is refused naming amount_home', async () => {
            const served = await services[face]!.query({ cube: OBJECT, measures: ['amount_home_sum'] } as never, CTX);
            expect(Number((served.rows[0] as Record<string, unknown>).amount_home_sum)).toBe(HOME_TOTAL);
            const err = await refusalOf(services[face]!.query({ cube: OBJECT, measures: ['amount_sum'] } as never, CTX));
            expect(err.code, err.message).toBe('INVALID_FIELD');
            expect(err.message).toContain("point the measure at 'amount_home'");
          });
        });
      }

      describe('the draft preview (the in-memory evaluator, over the stored rows)', () => {
        it('a sum over the home field answers the home-currency total, ungrouped and grouped by the code', async () => {
          const kpi = await services.native!.queryDataset(DATASET, { measures: ['home_total'] }, CTX, { previewDrafts: true });
          expect(Number((kpi.rows[0] as Record<string, unknown>).home_total)).toBe(HOME_TOTAL);
          expect(column(kpi, 'home_total')?.currency).toBe(HOME);
          const grouped = await services.native!.queryDataset(
            DATASET,
            { dimensions: ['currency'], measures: ['home_total'] },
            CTX,
            { previewDrafts: true },
          );
          expect(byCode(grouped.rows, 'home_total')).toEqual(HOME_BY_CODE);
        });

        it('the ungrouped raw amount is refused with the same words', async () => {
          const err = await refusalOf(
            services.native!.queryDataset(DATASET, { measures: ['raw_total'] }, CTX, { previewDrafts: true }),
          );
          expect(err.code, err.message).toBe('INVALID_FIELD');
          expect(err.member).toBe('raw_total');
          expect(err.message).toContain("point the measure at 'amount_home'");
        });
      });
    },
  );
}
