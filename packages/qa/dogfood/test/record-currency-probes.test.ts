// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D6, D8 rule 4] The measurement round's probes (epic #8345, comment
// 6041378776) as fixtures, on the real SQLite drivers, with the record currency
// DECLARED (`currencyMode: 'record'`, the code in `currency_code`):
//
//  - PROBE-A: `sum` over a USD row of 100 and an EUR row of 100 answered `200`
//    under one label. Now refused `INVALID_FIELD` / 400 unless grouped by the
//    code field; grouped (PROBE-C), each currency's total comes back on its own.
//  - PROBE-R: a `summary` roll-up over child rows of USD 100 and JPY 15000
//    stored `15100`. Now the roll-up is refused `INVALID_METADATA` / 422 when
//    the app registers.
//  - The write side: an amount with no code is refused
//    `ERR_CURRENCY_CODE_REQUIRED` / 400, and the table stays empty.
//  - [ADR-0144 D2 and D6, amended 2026-11-09 by #31743] A line whose amount
//    follows its bill's currency (`currencyField: 'bill.currency_code'`): a
//    `summary` through that `master_detail` registers and totals each bill's
//    own lines (PROBE-R's 15100 becomes USD 100 and JPY 15000), a raw
//    aggregate over the line amount is refused whatever it groups by, a line
//    under a bill with no code is refused, and the bill's code locks while a
//    line follows it.
//
// The engine-door cells over the in-memory aggregation face live beside the
// guards in `packages/objectql/src/record-currency-guards.test.ts`. ⛔ No
// driver-memory arm: its test consumers are a closed census
// (`check:driver-memory-census`), and the project's test backends are sqlite
// `:memory:`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { resolveThrownHttpError } from '@objectstack/types';
import { installDefaultOrganization } from './default-organization.testkit.js';

const DRIVERS = [
  {
    name: 'driver-sql (better-sqlite3 :memory:)',
    make: (): SqlDriver =>
      new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
  },
  {
    name: 'driver-sqlite-wasm (:memory:)',
    make: (): SqlDriver => new SqliteWasmDriver({ filename: ':memory:' }),
  },
];

/** Typed at the call, never asserted (`check:query-options-erasure`). */
const aggregateQuery = (query: EngineAggregateOptions): EngineAggregateOptions => query;

const SYS = { context: { isSystem: true, userId: 'usr_system' } };

const RECORD = { currencyMode: 'record', currencyField: 'currency_code' } as const;
const CODE = { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' };

const FX_INVOICE = {
  name: 'fx_invoice',
  label: 'FX invoice',
  fields: {
    name: { name: 'name', type: 'text' },
    currency_code: CODE,
    amount: { name: 'amount', type: 'currency', currencyConfig: RECORD },
  },
};

const appWith = (objects: unknown[]) => ({
  id: 'com.objectstack.dogfood.record-currency-probes',
  name: 'Record currency probes',
  version: '1.0.0',
  type: 'plugin',
  scope: 'system',
  objects,
});

interface Refusal { code?: unknown; status?: unknown; field?: unknown; name?: unknown; message?: unknown }
const envelope = (e: Refusal) => ({ code: e.code, status: e.status, field: e.field });

async function refusalOf(run: () => unknown): Promise<Refusal> {
  try {
    await run();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error('expected the engine to refuse, and it answered');
}

describe.each(DRIVERS)('record-currency probes: $name', ({ make }) => {
  let driver: SqlDriver;
  let engine: ObjectQL;

  beforeEach(async () => {
    driver = make();
    engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
  });

  afterEach(async () => {
    await engine.destroy();
  });

  async function boot(objects: unknown[]) {
    engine.registerApp(appWith(objects));
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
  }

  it('PROBE-A: an ungrouped sum over USD 100 + EUR 100 is refused; grouped by the code, each currency totals alone', async () => {
    await boot([FX_INVOICE]);
    await engine.insert('fx_invoice', { name: 'i1', currency_code: 'USD', amount: 100 }, SYS);
    await engine.insert('fx_invoice', { name: 'i2', currency_code: 'EUR', amount: 100 }, SYS);

    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      const err = await refusalOf(() => engine.aggregate('fx_invoice', aggregateQuery({
        aggregations: [{ function: fn, field: 'amount', alias: 'v' }],
      }), SYS));
      expect(envelope(err), fn).toEqual({ code: 'INVALID_FIELD', status: 400, field: 'amount' });
    }

    const rows = await engine.aggregate('fx_invoice', aggregateQuery({
      groupBy: ['currency_code'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    }), SYS);
    const byCode = Object.fromEntries((rows as Array<Record<string, unknown>>).map((r) => [r.currency_code, Number(r.total)]));
    expect(byCode).toEqual({ USD: 100, EUR: 100 });
  });

  it('the write side: an amount with no code is refused and nothing is stored', async () => {
    await boot([FX_INVOICE]);
    const err = await refusalOf(() => engine.insert('fx_invoice', { name: 'i1', amount: 100 }, SYS));
    expect(envelope(err)).toEqual({ code: 'ERR_CURRENCY_CODE_REQUIRED', status: 400, field: 'currency_code' });
    expect(await engine.find('fx_invoice', {}, SYS)).toEqual([]);
  });

  it('PROBE-R: a summary roll-up over the record-mode amount is refused when the app registers', async () => {
    const parent = {
      name: 'fx_bill',
      label: 'FX bill',
      fields: {
        name: { name: 'name', type: 'text' },
        billed_total: { name: 'billed_total', type: 'summary', summaryOperations: { object: 'fx_bill_line', field: 'amount', function: 'sum' } },
      },
    };
    const line = {
      name: 'fx_bill_line',
      label: 'FX bill line',
      fields: {
        currency_code: CODE,
        amount: { name: 'amount', type: 'currency', currencyConfig: RECORD },
        bill: { name: 'bill', type: 'master_detail', reference: 'fx_bill' },
      },
    };
    const err = await refusalOf(() => engine.registerApp(appWith([parent, line])));
    expect({ code: err.code, status: err.status, name: err.name }).toEqual({
      code: 'INVALID_METADATA', status: 422, name: 'RecordCurrencySummaryRefusedError',
    });
    expect(String(err.message)).toContain('rolls up sum(fx_bill_line.amount)');
  });

  it('[ADR-0144 D2, D6 amended] a line following its bill\'s currency rolls up per bill; raw aggregates refuse; the bill\'s code locks', async () => {
    const bill = {
      name: 'fx_pbill',
      label: 'FX path bill',
      fields: {
        name: { name: 'name', type: 'text' },
        currency_code: CODE,
        subtotal: {
          name: 'subtotal',
          type: 'summary',
          currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
          summaryOperations: { object: 'fx_pbill_line', field: 'amount', function: 'sum' },
        },
      },
    };
    const line = {
      name: 'fx_pbill_line',
      label: 'FX path bill line',
      fields: {
        name: { name: 'name', type: 'text' },
        bill: { name: 'bill', type: 'master_detail', reference: 'fx_pbill' },
        amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'bill.currency_code' } },
      },
    };
    await boot([bill, line]);
    const usd = await engine.insert('fx_pbill', { name: 'b1', currency_code: 'USD' }, SYS);
    const jpy = await engine.insert('fx_pbill', { name: 'b2', currency_code: 'JPY' }, SYS);
    const blank = await engine.insert('fx_pbill', { name: 'b3' }, SYS);
    await engine.insert('fx_pbill_line', { name: 'l1', bill: usd.id, amount: 100 }, SYS);
    await engine.insert('fx_pbill_line', { name: 'l2', bill: jpy.id, amount: 15000 }, SYS);

    // PROBE-R stored 15100 under one label; each bill now totals its own lines, in its own currency.
    const bills = await engine.find('fx_pbill', { fields: ['id', 'currency_code', 'subtotal'] }, SYS) as Array<Record<string, unknown>>;
    expect(Object.fromEntries(bills.filter((b) => b.currency_code).map((b) => [b.currency_code, Number(b.subtotal)]))).toEqual({ USD: 100, JPY: 15000 });

    const blankLine = await refusalOf(() => engine.insert('fx_pbill_line', { name: 'l3', bill: blank.id, amount: 5 }, SYS));
    expect(envelope(blankLine)).toEqual({ code: 'ERR_CURRENCY_CODE_REQUIRED', status: 400, field: 'bill.currency_code' });

    for (const groupBy of [undefined, ['bill.currency_code'], ['bill']]) {
      const err = await refusalOf(() => engine.aggregate('fx_pbill_line', aggregateQuery({
        ...(groupBy ? { groupBy } : {}),
        aggregations: [{ function: 'sum', field: 'amount', alias: 'v' }],
      }), SYS));
      expect(envelope(err), JSON.stringify(groupBy)).toEqual({ code: 'INVALID_FIELD', status: 400, field: 'amount' });
    }

    const locked = await refusalOf(() => engine.update('fx_pbill', { id: usd.id, currency_code: 'EUR' }, SYS));
    expect({ code: resolveThrownHttpError(locked).code, status: resolveThrownHttpError(locked).status }).toEqual({ code: 'VALIDATION_FAILED', status: 400 });
    expect((locked as { fields?: Array<{ field: string; code: string }> }).fields?.map((f) => [f.field, f.code])).toEqual([['currency_code', 'invalid_value']]);
    const [stillUsd] = await engine.find('fx_pbill', { where: { id: usd.id }, fields: ['currency_code'] }, SYS) as Array<Record<string, unknown>>;
    expect(stillUsd?.currency_code).toBe('USD');
    // The control: a bill no line follows changes its code.
    await engine.update('fx_pbill', { id: blank.id, currency_code: 'EUR' }, SYS);
  });
});
