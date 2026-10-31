// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144, multi-currency M0-3] Analytics over a `currencyMode: 'record'`
 * amount, through the plugin's own composition over a real engine.
 *
 * ## What these pins hold
 *
 * - A grouped answer carries the PER-ROW currency: the measure column names,
 *   by `currencyField`, the dimension column that groups by the amount's code
 *   field, and carries no `currency` (`AnalyticsResult.fields`,
 *   `@objectstack/spec/contracts`). Before, probe C of the #8345 measurement
 *   round saw every group of a correct breakdown labelled with ONE currency.
 * - The cube door refuses a `sum` / `avg` / `min` / `max` over the amount that
 *   does not group by the code field — `INVALID_FIELD` / 400 with the member,
 *   the column and its object — before anything is read. A `totals` grand
 *   total is such an aggregate too. `count` reads no amount and is served.
 * - Both of the above on both strategies (`NativeSQLStrategy`, the plugin's
 *   own capabilities; `ObjectQLStrategy`, narrowed to the engine aggregate),
 *   and the column on the draft-preview path, which shares the one
 *   column-description seam.
 * - The two compile-time guards (`measure-currency-coherence.ts`):
 *   `DATASET_INVALID` / 400 for a measure `currency` over a record-mode amount
 *   or contradicting a `fixed` field's code or a derived measure's operands'
 *   one `fixed` code, and for a derived measure
 *   combining a record-mode amount with another currency or two different
 *   `fixed` codes. The `fixed` arms reach boot registration, `queryDataset`
 *   and the draft preview alike (ruling 6486427200 on #8345).
 *
 * The SQLite cell runs everywhere; the strategies are the axis here, not the
 * dialect (the door stands ahead of both and reads nothing).
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

const OBJECT = 'os27187_fx_invoice';

const INVOICE = {
  name: OBJECT,
  label: 'FX invoice',
  fields: {
    currency_code: { name: 'currency_code', type: 'text' as const, valueDomain: 'iso_4217_currency' },
    region: { name: 'region', type: 'text' as const },
    amount: {
      name: 'amount',
      type: 'currency' as const,
      currencyConfig: { currencyMode: 'record' as const, currencyField: 'currency_code' },
    },
    amt_usd: { name: 'amt_usd', type: 'currency' as const, currencyConfig: { currencyMode: 'fixed' as const, defaultCurrency: 'USD' } },
    amt_eur: { name: 'amt_eur', type: 'currency' as const, currencyConfig: { currencyMode: 'fixed' as const, defaultCurrency: 'EUR' } },
    amt_tenant: { name: 'amt_tenant', type: 'currency' as const },
  },
};

const ROWS = [
  { id: 'i1', currency_code: 'USD', region: 'amer', amount: 100, amt_usd: 100, amt_eur: 10, amt_tenant: 1 },
  { id: 'i2', currency_code: 'EUR', region: 'amer', amount: 100, amt_usd: 0, amt_eur: 90, amt_tenant: 1 },
  { id: 'i3', currency_code: 'USD', region: 'emea', amount: 50, amt_usd: 50, amt_eur: 0, amt_tenant: 1 },
] as const;

const DATASET = DatasetSchema.parse({
  name: 'os27187_fx_by_currency',
  label: 'Invoices by currency',
  object: OBJECT,
  dimensions: [
    { name: 'currency', field: 'currency_code', type: 'string' },
    { name: 'region', field: 'region', type: 'string' },
  ],
  measures: [
    { name: 'total', aggregate: 'sum', field: 'amount' },
    { name: 'largest', aggregate: 'max', field: 'amount' },
    { name: 'invoices', aggregate: 'count' },
    { name: 'priced_invoices', aggregate: 'count', field: 'amount' },
    { name: 'usd_total', aggregate: 'sum', field: 'amt_usd' },
  ],
});

const CTX = { currency: 'CNY' } as ExecutionContext;

type Face = 'native' | 'objectql';
const FACES: readonly Face[] = ['native', 'objectql'];

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

/** A `'protocol'` service answering one pending seed draft, which routes `previewDrafts` onto the preview path. */
const pendingSeedProtocol = {
  getMetaItems: async () => [{ name: 'os27187_seed', object: OBJECT }],
  getMetaItem: async () => ({ item: { records: ROWS } }),
};

describe('[ADR-0144 M0-3] analytics over a record-currency amount', () => {
  let engine: ObjectQL;
  /** Raw-SQL statements and engine aggregates that read THIS object. */
  const reads = { rawSql: 0, aggregate: 0 };
  const services: Partial<Record<Face, AnalyticsService>> = {};

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject(INVOICE as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never);

    const realExecute = (engine as any).execute.bind(engine);
    (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
      if (opts?.object === OBJECT) reads.rawSql += 1;
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
  });

  for (const face of FACES) {
    describe(`${face} strategy`, () => {
      it('grouped by the code field: per-group totals are right, and the column names the per-row currency', async () => {
        const result = await services[face]!.queryDataset(
          DATASET,
          { dimensions: ['currency'], measures: ['total', 'largest', 'invoices', 'priced_invoices', 'usd_total'] },
          CTX,
        );
        const byCode = Object.fromEntries(
          (result.rows as Array<Record<string, unknown>>).map((r) => [r.currency, Number(r.total)]),
        );
        expect(byCode).toEqual({ USD: 150, EUR: 100 });
        expect(column(result, 'total')).toMatchObject({ currencyField: 'currency' });
        expect(column(result, 'total')?.currency).toBeUndefined();
        expect(column(result, 'largest')).toMatchObject({ currencyField: 'currency' });
        expect(column(result, 'largest')?.currency).toBeUndefined();
        // Controls: a fixed field keeps its one code, and a count is no amount.
        expect(column(result, 'usd_total')?.currency).toBe('USD');
        expect(column(result, 'usd_total')?.currencyField).toBeUndefined();
        expect(column(result, 'invoices')?.currency).toBeUndefined();
        expect(column(result, 'invoices')?.currencyField).toBeUndefined();
        // …a count whose `field` is the amount reads no amount either.
        expect(column(result, 'priced_invoices')?.currency).toBeUndefined();
        expect(column(result, 'priced_invoices')?.currencyField).toBeUndefined();
      });

      it('grouped by the code field and another dimension, with a totals grouping that keeps the code: served', async () => {
        const result = await services[face]!.queryDataset(
          DATASET,
          { dimensions: ['currency', 'region'], measures: ['total'], totals: { groupings: [['currency']] } },
          CTX,
        );
        expect(column(result, 'total')?.currencyField).toBe('currency');
        const totals = Object.fromEntries(
          (result.totals?.[0]?.rows as Array<Record<string, unknown>>).map((r) => [r.currency, Number(r.total)]),
        );
        expect(totals).toEqual({ USD: 150, EUR: 100 });
      });

      for (const [label, selection] of [
        ['grouped by another dimension only', { dimensions: ['region'], measures: ['total'] }],
        ['not grouped at all (a KPI)', { measures: ['largest'] }],
        ['a totals grand total over the amount', { dimensions: ['currency'], measures: ['total'], totals: { groupings: [[]] } }],
      ] as const) {
        it(`${label}: refused INVALID_FIELD / 400 before anything is read`, async () => {
          const before = { ...reads };
          const err = await refusalOf(services[face]!.queryDataset(DATASET, selection as never, CTX));
          expect(err.code, err.message).toBe('INVALID_FIELD');
          expect(err.status).toBe(400);
          expect(['total', 'largest']).toContain(err.member);
          expect(err.param).toBe('measures');
          expect(err.field).toBe('amount');
          expect(err.object).toBe(OBJECT);
          if (label !== 'a totals grand total over the amount') {
            expect(reads.rawSql - before.rawSql).toBe(0);
            expect(reads.aggregate - before.aggregate).toBe(0);
          }
        });
      }

      it('a count over the record-currency object is served ungrouped, with neither currency key', async () => {
        const result = await services[face]!.queryDataset(DATASET, { measures: ['invoices'] }, CTX);
        expect(Number((result.rows[0] as Record<string, unknown>).invoices)).toBe(3);
        expect(column(result, 'invoices')?.currency).toBeUndefined();
        expect(column(result, 'invoices')?.currencyField).toBeUndefined();
      });

      it('the cube face refuses the same ungrouped aggregate', async () => {
        services[face]!.registerDataset(DATASET);
        const err = await refusalOf(services[face]!.query({ cube: DATASET.name, measures: ['total'] } as never, CTX));
        expect(err.code).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.member).toBe('total');
      });

      it('the inferred cube (no registered dataset, the `${field}_${fn}` members) refuses the ungrouped amount and serves it grouped', async () => {
        const before = { ...reads };
        const err = await refusalOf(services[face]!.query({ cube: OBJECT, measures: ['amount_sum'] } as never, CTX));
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.member).toBe('amount_sum');
        expect(err.field).toBe('amount');
        expect(err.object).toBe(OBJECT);
        expect(reads.rawSql - before.rawSql).toBe(0);
        expect(reads.aggregate - before.aggregate).toBe(0);

        const grouped = await services[face]!.query(
          { cube: OBJECT, measures: ['amount_sum'], dimensions: ['currency_code'] } as never,
          CTX,
        );
        const byCode = Object.fromEntries(
          (grouped.rows as Array<Record<string, unknown>>).map((r) => [r.currency_code, Number(r.amount_sum)]),
        );
        expect(byCode).toEqual({ USD: 150, EUR: 100 });
      });
    });
  }

  it('the draft-preview path carries the same per-row currency column', async () => {
    const result = await services.objectql!.queryDataset(
      DATASET,
      { dimensions: ['currency'], measures: ['total'] },
      CTX,
      { previewDrafts: true },
    );
    expect(column(result, 'total')?.currencyField).toBe('currency');
    expect(column(result, 'total')?.currency).toBeUndefined();
  });

  it('the draft-preview path refuses the ungrouped amount aggregate the published path refuses', async () => {
    const err = await refusalOf(
      services.objectql!.queryDataset(DATASET, { measures: ['largest'] }, CTX, { previewDrafts: true }),
    );
    expect(err.code, err.message).toBe('INVALID_FIELD');
    expect(err.status).toBe(400);
    expect(err.member).toBe('largest');
    expect(err.field).toBe('amount');
    expect(err.object).toBe(OBJECT);
  });

  // The column's currency for a derived measure is the compile guard's own
  // resolved reading: a `sum` / `difference` whose operands all resolve to one
  // `fixed` code carries it, as `content/docs/data-modeling/currency.mdx` says.
  describe('a derived measure column takes the currency its operands resolve to', () => {
    const DERIVED = DatasetSchema.parse({
      name: 'os28049_derived_currency',
      label: 'Derived currency',
      object: OBJECT,
      dimensions: [{ name: 'currency', field: 'currency_code', type: 'string' }],
      measures: [
        { name: 'eur', aggregate: 'sum', field: 'amt_eur' },
        { name: 'eur_restated', aggregate: 'sum', field: 'amt_eur', currency: 'EUR' },
        { name: 'usd', aggregate: 'sum', field: 'amt_usd' },
        { name: 'tenant', aggregate: 'sum', field: 'amt_tenant' },
        { name: 'tenant_as_jpy', aggregate: 'sum', field: 'amt_tenant', currency: 'JPY' },
        { name: 'total', aggregate: 'sum', field: 'amount' },
        { name: 'invoices', aggregate: 'count' },
        { name: 'eur_twice', derived: { op: 'sum', of: ['eur', 'eur_restated'] } },
        { name: 'eur_net', derived: { op: 'difference', of: ['eur', 'eur'] } },
        { name: 'eur_twice_restated', derived: { op: 'sum', of: ['eur', 'eur'] }, currency: 'EUR' },
        // Controls: no one `fixed` code, so today's answer stands.
        { name: 'usd_and_tenant', derived: { op: 'sum', of: ['usd', 'tenant'] } },
        { name: 'tenant_twice', derived: { op: 'sum', of: ['tenant', 'tenant'] } },
        { name: 'jpy_twice', derived: { op: 'sum', of: ['tenant_as_jpy', 'tenant_as_jpy'] } },
        { name: 'eur_per_invoice', derived: { op: 'ratio', of: ['eur', 'invoices'] } },
        { name: 'eur_product', derived: { op: 'product', of: ['eur', 'eur'] } },
        { name: 'total_twice', derived: { op: 'sum', of: ['total', 'total'] } },
      ],
    });
    const LABELLED = { eur_twice: 'EUR', eur_net: 'EUR', eur_twice_restated: 'EUR' } as const;
    const UNLABELLED = ['usd_and_tenant', 'tenant_twice', 'jpy_twice', 'eur_per_invoice', 'eur_product', 'total_twice'] as const;
    const expectColumns = (result: AnalyticsResult) => {
      for (const [name, code] of Object.entries(LABELLED)) {
        expect(column(result, name)?.currency, name).toBe(code);
        expect(column(result, name)?.currencyField, name).toBeUndefined();
      }
      for (const name of UNLABELLED) {
        expect(column(result, name)?.currency, name).toBeUndefined();
        expect(column(result, name)?.currencyField, name).toBeUndefined();
      }
    };

    for (const face of FACES) {
      it(`${face} strategy: a sum or difference over one fixed code carries it; no other derived column gains one`, async () => {
        const result = await services[face]!.queryDataset(
          DERIVED,
          { dimensions: ['currency'], measures: [...Object.keys(LABELLED), ...UNLABELLED] },
          CTX,
        );
        expectColumns(result);
        const eurByCode = Object.fromEntries(
          (result.rows as Array<Record<string, unknown>>).map((r) => [r.currency, Number(r.eur_twice)]),
        );
        expect(eurByCode).toEqual({ USD: 20, EUR: 180 });
      });
    }

    it('the draft-preview path labels the same columns', async () => {
      const result = await services.objectql!.queryDataset(
        DERIVED,
        { dimensions: ['currency'], measures: [...Object.keys(LABELLED), ...UNLABELLED] },
        CTX,
        { previewDrafts: true },
      );
      expectColumns(result);
    });
  });

  describe('compile-time guards on measure currencies', () => {
    const datasetWith = (measures: unknown[]) =>
      DatasetSchema.parse({
        name: 'os27187_guard',
        label: 'Guard',
        object: OBJECT,
        dimensions: [{ name: 'currency', field: 'currency_code', type: 'string' }],
        measures,
      });
    const compileRefusal = (measures: unknown[]): Refusal | undefined => {
      try {
        services.objectql!.registerDataset(datasetWith(measures));
        return undefined;
      } catch (e) {
        return e as Refusal;
      }
    };
    const expectRefused = (measures: unknown[], named: string) => {
      const err = compileRefusal(measures);
      expect(err?.code, err?.message).toBe('DATASET_INVALID');
      expect(err?.status).toBe(400);
      expect(err?.message).toContain(`"${named}"`);
    };

    it('a measure currency over a record-currency amount is refused', () => {
      expectRefused([{ name: 'total_usd', aggregate: 'sum', field: 'amount', currency: 'USD' }], 'total_usd');
    });

    it('a measure currency on a derived measure whose currency is the record mode is refused', () => {
      expectRefused(
        [
          { name: 'total', aggregate: 'sum', field: 'amount' },
          { name: 'total_twice_usd', derived: { op: 'sum', of: ['total', 'total'] }, currency: 'USD' },
        ],
        'total_twice_usd',
      );
    });

    it("a measure currency contradicting a fixed field's code is refused, naming the fix", () => {
      expectRefused([{ name: 'eur_as_jpy', aggregate: 'sum', field: 'amt_eur', currency: 'JPY' }], 'eur_as_jpy');
      expect(compileRefusal([{ name: 'eur_as_jpy', aggregate: 'sum', field: 'amt_eur', currency: 'JPY' }])?.message)
        .toContain("delete the measure's `currency`");
    });

    it("CONTROL: a measure currency restating a fixed field's code is accepted", () => {
      expect(compileRefusal([{ name: 'eur', aggregate: 'sum', field: 'amt_eur', currency: 'EUR' }])).toBeUndefined();
    });

    it('CONTROL: a measure currency over a dynamic field is not judged (the tenant currency is unknown at compile)', () => {
      expect(compileRefusal([{ name: 'tenant_as_usd', aggregate: 'sum', field: 'amt_tenant', currency: 'USD' }])).toBeUndefined();
    });

    const base = [
      { name: 'usd', aggregate: 'sum', field: 'amt_usd' },
      { name: 'eur', aggregate: 'sum', field: 'amt_eur' },
      { name: 'tenant', aggregate: 'sum', field: 'amt_tenant' },
      { name: 'total', aggregate: 'sum', field: 'amount' },
      { name: 'invoices', aggregate: 'count' },
    ];

    for (const op of ['sum', 'difference', 'ratio', 'product'] as const) {
      it(`a derived ${op} of a record-currency amount and a fixed one is refused`, () => {
        expectRefused([...base, { name: 'mixed', derived: { op, of: ['total', 'usd'] } }], 'mixed');
      });
    }

    it('a derived measure of a record-currency amount and a tenant-currency one is refused', () => {
      expectRefused([...base, { name: 'mixed', derived: { op: 'sum', of: ['tenant', 'total'] } }], 'mixed');
    });

    it('a derived measure built on a record-currency derived sum is judged at the next level', () => {
      expectRefused(
        [...base, { name: 'total_twice', derived: { op: 'sum', of: ['total', 'total'] } }, { name: 'mixed', derived: { op: 'sum', of: ['total_twice', 'eur'] } }],
        'mixed',
      );
    });

    for (const op of ['sum', 'difference', 'ratio', 'product'] as const) {
      it(`a derived ${op} across two different fixed codes is refused, naming the fix`, () => {
        expectRefused([...base, { name: 'mixed', derived: { op, of: ['usd', 'eur'] } }], 'mixed');
        expect(compileRefusal([...base, { name: 'mixed', derived: { op, of: ['usd', 'eur'] } }])?.message)
          .toContain('derive it from measures in one currency, or drop the operand in the other');
      });
    }

    it('a derived measure built on a fixed-code derived sum is judged at the next level', () => {
      expectRefused(
        [...base, { name: 'usd_twice', derived: { op: 'sum', of: ['usd', 'usd'] } }, { name: 'mixed', derived: { op: 'sum', of: ['usd_twice', 'eur'] } }],
        'mixed',
      );
    });

    for (const op of ['sum', 'difference'] as const) {
      it(`a derived ${op} declaring a currency other than its operands' one fixed code is refused, naming the fix`, () => {
        const measures = [
          ...base,
          { name: 'eur_restated', aggregate: 'sum', field: 'amt_eur', currency: 'EUR' },
          { name: 'eur_as_usd', derived: { op, of: ['eur', 'eur_restated'] }, currency: 'USD' },
        ];
        expectRefused(measures, 'eur_as_usd');
        expect(compileRefusal(measures)?.message).toContain(
          `[dataset-compiler] dataset "os27187_guard" derived measure "eur_as_usd" declares currency "USD" over `
          + 'measures "eur", "eur_restated", whose amounts are fixed to EUR.',
        );
        expect(compileRefusal(measures)?.message)
          .toContain("delete the measure's `currency` (the column takes the operands' EUR), or restate EUR.");
      });
    }

    it('a derived measure declaring a currency over a fixed-code derived sum is judged too', () => {
      expectRefused(
        [...base, { name: 'eur_twice', derived: { op: 'sum', of: ['eur', 'eur'] } }, { name: 'eur_as_jpy', derived: { op: 'sum', of: ['eur_twice', 'eur'] }, currency: 'JPY' }],
        'eur_as_jpy',
      );
    });

    it("CONTROL: a derived measure restating its operands' one fixed code is accepted", () => {
      expect(
        compileRefusal([...base, { name: 'eur_twice', derived: { op: 'sum', of: ['eur', 'eur'] }, currency: 'EUR' }]),
      ).toBeUndefined();
    });

    it('CONTROL: a derived measure currency is not judged where its operands resolve to no one fixed code', () => {
      expect(
        compileRefusal([
          ...base,
          // a fixed amount with the tenant currency: one currency, but not a `fixed` one
          { name: 'usd_and_tenant_as_jpy', derived: { op: 'sum', of: ['usd', 'tenant'] }, currency: 'JPY' },
          // a ratio resolves to no currency
          { name: 'eur_per_invoice_as_usd', derived: { op: 'ratio', of: ['eur', 'invoices'] }, currency: 'USD' },
        ]),
      ).toBeUndefined();
    });

    it('CONTROL: a fixed operand restated by its measure currency compares by that one code', () => {
      expect(
        compileRefusal([...base, { name: 'usd_restated', aggregate: 'sum', field: 'amt_usd', currency: 'USD' }, { name: 'both', derived: { op: 'sum', of: ['usd', 'usd_restated'] } }]),
      ).toBeUndefined();
    });

    it('CONTROL: an explicit measure currency over a dynamic field is not a fixed code, so a derived measure over it and a fixed one is not judged', () => {
      expect(
        compileRefusal([...base, { name: 'tenant_as_jpy', aggregate: 'sum', field: 'amt_tenant', currency: 'JPY' }, { name: 'mixed', derived: { op: 'sum', of: ['tenant_as_jpy', 'usd'] } }]),
      ).toBeUndefined();
    });

    it('accepted: an amount per invoice, an amount with itself, a fixed amount with the tenant currency', () => {
      expect(
        compileRefusal([
          ...base,
          { name: 'per_invoice', derived: { op: 'ratio', of: ['total', 'invoices'] } },
          { name: 'usd_per_invoice', derived: { op: 'ratio', of: ['usd', 'invoices'] } },
          { name: 'eur_per_invoice', derived: { op: 'ratio', of: ['eur', 'invoices'] } },
          { name: 'usd_and_tenant', derived: { op: 'sum', of: ['usd', 'tenant'] } },
          { name: 'total_share', derived: { op: 'ratio', of: ['total', 'total'] } },
        ]),
      ).toBeUndefined();
    });

    // The request door and the draft preview compile through the same
    // `compileDataset` call as registration, so both fixed shapes refuse there too.
    const fixedShapes = [
      ['a measure currency contradicting a fixed field', [{ name: 'eur_as_jpy', aggregate: 'sum', field: 'amt_eur', currency: 'JPY' }], 'eur_as_jpy'],
      ['a derived measure across two different fixed codes', [...base, { name: 'mixed', derived: { op: 'difference', of: ['usd', 'eur'] } }], 'mixed'],
      ["a derived measure currency contradicting its operands' fixed code", [...base, { name: 'eur_as_usd', derived: { op: 'sum', of: ['eur', 'eur'] }, currency: 'USD' }], 'eur_as_usd'],
    ] as const;
    for (const [label, measures, named] of fixedShapes) {
      for (const [door, options] of [['queryDataset', undefined], ['the draft preview', { previewDrafts: true }]] as const) {
        it(`${door} refuses ${label}`, async () => {
          const err = await refusalOf(
            services.objectql!.queryDataset(datasetWith([...measures]), { measures: [named] }, CTX, options as never),
          );
          expect(err.code, err.message).toBe('DATASET_INVALID');
          expect(err.status).toBe(400);
          expect(err.message).toContain(`"${named}"`);
        });
      }
    }

    it(`CONTROL: queryDataset and the draft preview serve a measure currency restating a fixed field's code`, async () => {
      for (const options of [undefined, { previewDrafts: true }]) {
        const result = await services.objectql!.queryDataset(
          datasetWith([{ name: 'eur', aggregate: 'sum', field: 'amt_eur', currency: 'EUR' }]),
          { measures: ['eur'] },
          CTX,
          options as never,
        );
        expect(column(result, 'eur')?.currency).toBe('EUR');
      }
    });
  });
});
