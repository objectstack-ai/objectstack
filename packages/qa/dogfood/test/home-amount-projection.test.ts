// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D5, D7 parameters 3 and 4, Open items 2, 3 and 6] The write-time
// home projection's rounding pins on the real SQL drivers, with the platform's
// own `sys_exchange_rate` object: the rate row is chosen by each dialect's
// `effective_date <= ? ORDER BY effective_date DESC LIMIT 1`, read back
// through each dialect's exact-decimal column, and the home amount is stored
// and read back through each dialect's currency column.
//
// Cells: better-sqlite3 and sqlite-wasm always run; PostgreSQL runs where
// `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. The Postgres
// cell owns one schema, named from this file, created before and dropped
// after. The in-memory face of the same pins (and the strips, defaults,
// preview and predicate-update cells) is packages/objectql's
// `engine-home-amount-projection.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysExchangeRate } from '@objectstack/platform-objects/system';
import { installDefaultOrganization, DEFAULT_ORGANIZATION_ID } from './default-organization.testkit.js';

const LIVE_NAMESPACE = `os_lv_${basename(fileURLToPath(import.meta.url)).replace(/\.test\.ts$/, '').replace(/[^a-z0-9]+/gi, '_')}`;
const PG_URL = process.env.OS_TEST_POSTGRES_URL;

async function adminRaw(config: Record<string, unknown>, statements: string[]): Promise<void> {
  const admin = new SqlDriver(config as never);
  try {
    for (const statement of statements) await admin.execute(statement);
  } finally {
    await admin.disconnect();
  }
}

interface Cell {
  readonly id: string;
  readonly env: string | null;
  readonly url: string | undefined;
  readonly make: () => Promise<SqlDriver>;
  readonly teardown: () => Promise<void>;
}

const CELLS: readonly Cell[] = [
  {
    id: 'driver-sql (better-sqlite3 :memory:)',
    env: null,
    url: 'sqlite',
    make: async () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    teardown: async () => {},
  },
  {
    id: 'driver-sqlite-wasm (:memory:)',
    env: null,
    url: 'sqlite-wasm',
    make: async () => new SqliteWasmDriver({ filename: ':memory:' }),
    teardown: async () => {},
  },
  {
    id: 'driver-sql (pg)',
    env: 'OS_TEST_POSTGRES_URL',
    url: PG_URL,
    make: async () => {
      await adminRaw({ client: 'pg', connection: PG_URL }, [
        `drop schema if exists ${LIVE_NAMESPACE} cascade`,
        `create schema ${LIVE_NAMESPACE}`,
      ]);
      return new SqlDriver({ client: 'pg', connection: PG_URL, searchPath: [LIVE_NAMESPACE] } as never);
    },
    teardown: async () => {
      await adminRaw({ client: 'pg', connection: PG_URL }, [`drop schema if exists ${LIVE_NAMESPACE} cascade`]);
    },
  },
];

const SYS = { context: { isSystem: true } };

const FX_INVOICE = {
  name: 'fx_invoice',
  label: 'FX invoice',
  fields: {
    name: { name: 'name', type: 'text' },
    currency_code: { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { name: 'invoice_date', type: 'date' },
    amount: {
      name: 'amount',
      type: 'currency',
      currencyConfig: {
        currencyMode: 'record',
        currencyField: 'currency_code',
        homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
      },
    },
    amount_home: { name: 'amount_home', type: 'currency', readonly: true },
    amount_rate: { name: 'amount_rate', type: 'number', readonly: true },
  },
};

const appWith = (objects: unknown[]) => ({
  id: 'com.objectstack.dogfood.home-amount-projection',
  name: 'Home amount projection',
  version: '1.0.0',
  type: 'plugin',
  scope: 'system',
  objects,
});

/** Each rate as `[currency, effective_date, rate]`; every currency's rate against the home currency of the test. */
const RATES: ReadonlyArray<[string, string, number]> = [
  ['USD', '2026-01-01', 0.1389],
  ['USD', '2026-04-01', 0.15],
  ['USD', '2026-05-01', 7.123456789012], // twelve decimals, the column's scale
  ['EUR', '2026-01-01', 0.0065], // read as JPY-home in the minor-unit cell
  ['GBP', '2026-01-01', 1.0857],
  ['CHF', '2026-01-01', 3.2468],
];

for (const cell of CELLS) {
  describe.skipIf(!cell.url)(
    `the write-time home projection — ${cell.id}${cell.url ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: SqlDriver;
      let engine: ObjectQL;
      let home = 'CNY';

      beforeAll(async () => {
        driver = await cell.make();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registerApp(appWith([SysExchangeRate, FX_INVOICE]));
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        engine.setHomeCurrencyResolver(async () => home);
        for (const [currency, effective_date, rate] of RATES) {
          await engine.insert('sys_exchange_rate', { currency, effective_date, rate, source: 'manual' }, SYS);
        }
      });

      afterAll(async () => {
        await engine?.destroy();
        await cell.teardown();
      });

      /** Insert one invoice and read it back from the store. */
      async function written(row: Record<string, unknown>) {
        const created = await engine.insert('fx_invoice', { name: 'inv', ...row }, SYS);
        return read(created.id);
      }
      async function read(id: unknown) {
        const back = await engine.findOne('fx_invoice', { where: { id }, context: SYS.context } as never) as Record<string, unknown>;
        return { home: Number(back.amount_home), rate: Number(back.amount_rate), org: back.organization_id };
      }

      it('the card\'s check: USD 10,000 at 0.1389 into CNY stores 71994.24 with the rate 0.1389', async () => {
        home = 'CNY';
        expect(await written({ currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 }))
          .toEqual({ home: 71994.24, rate: 0.1389, org: DEFAULT_ORGANIZATION_ID });
      });

      it('three minor-unit classes round half away from zero: JPY 0, USD 2, KWD 3', async () => {
        home = 'JPY';
        expect(await written({ currency_code: 'EUR', invoice_date: '2026-03-15', amount: 100 })).toMatchObject({ home: 15385, rate: 0.0065 }); // 15384.615…
        home = 'USD';
        expect(await written({ currency_code: 'GBP', invoice_date: '2026-03-15', amount: 100 })).toMatchObject({ home: 92.11, rate: 1.0857 }); // 92.1064…
        home = 'KWD';
        expect(await written({ currency_code: 'CHF', invoice_date: '2026-03-15', amount: 100 })).toMatchObject({ home: 30.8, rate: 3.2468 }); // 30.79955…
        home = 'CNY';
      });

      it('a twelve-decimal rate survives the column and divides exactly', async () => {
        // 1000 ÷ 7.123456789012 = 140.381282…
        expect(await written({ currency_code: 'USD', invoice_date: '2026-05-02', amount: 1000 })).toMatchObject({ home: 140.38, rate: 7.123456789012 });
      });

      it('the same currency as home is rate 1, rounded to the home minor units', async () => {
        home = 'CNY';
        expect(await written({ currency_code: 'CNY', amount: 12.345 })).toMatchObject({ home: 12.35, rate: 1 });
      });

      it('the rate row is the latest on or before the document date; none ⇒ refused, nothing stored', async () => {
        home = 'CNY';
        expect(await written({ currency_code: 'USD', invoice_date: '2026-03-31', amount: 150 })).toMatchObject({ home: 1079.91, rate: 0.1389 });
        expect(await written({ currency_code: 'USD', invoice_date: '2026-04-01', amount: 150 })).toMatchObject({ home: 1000, rate: 0.15 });
        const before = (await engine.find('fx_invoice', { context: SYS.context } as never)).length;
        const err = await engine.insert('fx_invoice', { name: 'early', currency_code: 'USD', invoice_date: '2025-12-31', amount: 1 }, SYS)
          .then(() => null, (e: { code?: string; status?: number; currency?: string; date?: string }) => e);
        expect({ code: err?.code, status: err?.status, currency: err?.currency, date: err?.date })
          .toEqual({ code: 'ERR_EXCHANGE_RATE_MISSING', status: 400, currency: 'USD', date: '2025-12-31' });
        expect((await engine.find('fx_invoice', { context: SYS.context } as never)).length).toBe(before);
      });

      it('an update of the amount, the code or the date converts again; another edit does not', async () => {
        home = 'CNY';
        const { id } = await engine.insert('fx_invoice', { name: 'u', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 }, SYS);
        await engine.update('fx_invoice', { id, amount: 1389 }, SYS);
        expect(await read(id)).toMatchObject({ home: 10000, rate: 0.1389 });
        await engine.update('fx_invoice', { id, invoice_date: '2026-04-15' }, SYS);
        expect(await read(id)).toMatchObject({ home: 9260, rate: 0.15 });
        await engine.update('fx_invoice', { id, currency_code: 'CNY' }, SYS);
        expect(await read(id)).toMatchObject({ home: 1389, rate: 1 });
        await engine.update('fx_invoice', { id, currency_code: 'USD', invoice_date: '2026-03-15' }, SYS);
        expect(await read(id)).toMatchObject({ home: 10000, rate: 0.1389 });
        await engine.update('fx_invoice', { id, name: 'renamed' }, SYS);
        expect(await read(id)).toMatchObject({ home: 10000, rate: 0.1389 });
      });
    },
  );
}
