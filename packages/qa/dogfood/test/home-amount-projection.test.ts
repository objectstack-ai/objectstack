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
// after. One pin runs under the `isolated` posture with two organizations: a
// rate row is read in the written row's organization only. The in-memory face of the same pins (and the strips, defaults,
// preview and predicate-update cells) is packages/objectql's
// `engine-home-amount-projection.test.ts`.
//
// The second half drives the explicit recompute (`recomputeHomeAmounts`,
// `os migrate recompute-home-amounts`) over the same cells: a corrected rate,
// a missing one, a blank code, the same currency, a datetime document date
// across the organization's timezone boundary, and two organizations with
// different home currencies.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL, recomputeHomeAmounts, homeAmountRecomputeComplete } from '@objectstack/objectql';
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

/** The same amount, dated by a `datetime`: its calendar day is taken in the organization's timezone. */
const FX_ORDER = {
  ...FX_INVOICE,
  name: 'fx_order',
  label: 'FX order',
  fields: { ...FX_INVOICE.fields, invoice_date: { name: 'invoice_date', type: 'datetime' } },
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
      let timezone: string | undefined;

      beforeAll(async () => {
        driver = await cell.make();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registerApp(appWith([SysExchangeRate, FX_INVOICE, FX_ORDER]));
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        engine.setHomeLocalizationResolver(async () => ({ currency: home, timezone }));
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
        // 1.005 is 1.00499999… as a double: a float rounding stores 1.00, the decimal one 1.01.
        expect(await written({ currency_code: 'CNY', amount: 1.005 })).toMatchObject({ home: 1.01, rate: 1 });
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

      it('rates are per organization: one organization\'s rate row never converts another\'s write', async () => {
        home = 'CNY';
        // Organizations are walled from each other under the `isolated` posture;
        // `single` is one organization by definition and reads install-wide.
        engine.setTenancyPostureProvider(() => 'isolated');
        try {
          const driverOf = engine.getDriverForObject('sys_organization')!;
          for (const id of ['org_fx_a', 'org_fx_b']) {
            if (!(await driverOf.findOne('sys_organization', { where: { id } } as never))) await driverOf.create('sys_organization', { id, name: id });
          }
          const as = (org: string) => ({ context: { isSystem: true, tenantId: org } });
          // SEK has a rate in organization A only; NOK in both, at different rates.
          await engine.insert('sys_exchange_rate', { currency: 'SEK', effective_date: '2026-01-01', rate: 1.5, source: 'manual' }, as('org_fx_a'));
          await engine.insert('sys_exchange_rate', { currency: 'NOK', effective_date: '2026-01-01', rate: 1.6, source: 'manual' }, as('org_fx_a'));
          await engine.insert('sys_exchange_rate', { currency: 'NOK', effective_date: '2026-01-01', rate: 2, source: 'manual' }, as('org_fx_b'));

          const inA = await engine.insert('fx_invoice', { name: 'a', currency_code: 'SEK', invoice_date: '2026-03-15', amount: 300 }, as('org_fx_a'));
          expect(await read(inA.id)).toEqual({ home: 200, rate: 1.5, org: 'org_fx_a' });
          const nokA = await engine.insert('fx_invoice', { name: 'a2', currency_code: 'NOK', invoice_date: '2026-03-15', amount: 320 }, as('org_fx_a'));
          expect(await read(nokA.id)).toEqual({ home: 200, rate: 1.6, org: 'org_fx_a' });
          const nokB = await engine.insert('fx_invoice', { name: 'b', currency_code: 'NOK', invoice_date: '2026-03-15', amount: 320 }, as('org_fx_b'));
          expect(await read(nokB.id)).toEqual({ home: 160, rate: 2, org: 'org_fx_b' });

          // Organization B has no SEK rate: A's row is not read for it, so the write is refused.
          const err = await engine.insert('fx_invoice', { name: 'b2', currency_code: 'SEK', invoice_date: '2026-03-15', amount: 300 }, as('org_fx_b'))
            .then(() => null, (e: { code?: string }) => e);
          expect(err?.code).toBe('ERR_EXCHANGE_RATE_MISSING');
        } finally {
          engine.setTenancyPostureProvider(() => undefined);
        }
      });

      it('a datetime document date is dated in localization.timezone, through the column and back', async () => {
        home = 'CNY';
        // 2026-03-31T17:00Z is 01:00 on 2026-04-01 in Shanghai; USD has a new rate from April 1.
        const at0100Shanghai = '2026-03-31T17:00:00Z';
        const readOrder = async (id: unknown) => {
          const back = await engine.findOne('fx_order', { where: { id }, context: SYS.context } as never) as Record<string, unknown>;
          return { home: Number(back.amount_home), rate: Number(back.amount_rate) };
        };
        try {
          timezone = 'Asia/Shanghai';
          const sh = await engine.insert('fx_order', { name: 'sh', currency_code: 'USD', invoice_date: at0100Shanghai, amount: 1500 }, SYS);
          expect(await readOrder(sh.id)).toEqual({ home: 10000, rate: 0.15 });
          // An amount edit reads the stored datetime back from the column and dates it alike.
          await engine.update('fx_order', { id: sh.id, amount: 3000 }, SYS);
          expect(await readOrder(sh.id)).toEqual({ home: 20000, rate: 0.15 });
          timezone = undefined;
          const utc = await engine.insert('fx_order', { name: 'utc', currency_code: 'USD', invoice_date: at0100Shanghai, amount: 1389 }, SYS);
          expect(await readOrder(utc.id)).toEqual({ home: 10000, rate: 0.1389 });
        } finally {
          timezone = undefined;
        }
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

// ── The explicit recompute on the real drivers ────────────────────────────
//
// [ADR-0144 D5, D7 parameter 1, Open item 8] `recomputeHomeAmounts` (behind
// `os migrate recompute-home-amounts`) over rows stored through each dialect:
// the stored value it compares is read back from the column, the rate row is
// each dialect's pick, and the value an apply stores is the write's own. One
// object per pin, so each pin's counts are its own. The in-memory face (the
// audit entry, the refusals, the report text) is packages/objectql's
// `engine-home-amount-projection.test.ts`.

const recomputeObject = (name: string, dateType: 'date' | 'datetime' = 'date') => ({
  ...FX_INVOICE,
  name,
  label: name,
  fields: { ...FX_INVOICE.fields, invoice_date: { name: 'invoice_date', type: dateType } },
});
const RC = {
  corrected: 'rc_corrected',
  missing: 'rc_missing',
  codeless: 'rc_codeless',
  same: 'rc_same',
  zone: 'rc_zone',
  orgs: 'rc_orgs',
} as const;
const quiet = { info: () => {}, warn: () => {} };

for (const cell of CELLS) {
  describe.skipIf(!cell.url)(
    `the explicit recompute of stored home amounts — ${cell.id}${cell.url ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: SqlDriver;
      let engine: ObjectQL;
      let homes: Record<string, string> = {};
      let timezone: string | undefined;

      beforeAll(async () => {
        driver = await cell.make();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registerApp(appWith([
          SysExchangeRate,
          ...Object.values(RC).map((name) => recomputeObject(name, name === RC.zone ? 'datetime' : 'date')),
        ]));
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        engine.setHomeLocalizationResolver(async (org) => ({ currency: homes[org ?? ''] ?? 'CNY', timezone }));
        for (const [currency, effective_date, rate] of [['USD', '2026-01-01', 0.1389], ['USD', '2026-04-01', 0.15]] as const) {
          await engine.insert('sys_exchange_rate', { currency, effective_date, rate, source: 'manual' }, SYS);
        }
      });

      afterAll(async () => {
        await engine?.destroy();
        await cell.teardown();
      });

      const run = (object: string, options: { apply?: boolean; since?: string } = {}) =>
        recomputeHomeAmounts(engine as never, quiet, { object, ...options });
      async function stored(object: string, id: unknown) {
        const back = await engine.findOne(object, { where: { id }, context: SYS.context } as never) as Record<string, unknown>;
        return { home: back.amount_home == null ? null : Number(back.amount_home), rate: back.amount_rate == null ? null : Number(back.amount_rate) };
      }
      /** A row stored before its home field was declared (or its code backfilled): written at the driver. */
      async function legacy(object: string, id: string, row: Record<string, unknown>) {
        await engine.getDriverForObject(object)!.create(object, { id, name: id, organization_id: DEFAULT_ORGANIZATION_ID, ...row } as never);
      }

      it('a corrected rate: the dry run reports and writes nothing, the apply stores what a fresh write stores, a re-run is clean', async () => {
        const { id } = await engine.insert(RC.corrected, { name: 'c', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 }, SYS);
        expect(await stored(RC.corrected, id)).toEqual({ home: 71994.24, rate: 0.1389 });
        const [rateRow] = await engine.find('sys_exchange_rate', { where: { currency: 'USD', effective_date: '2026-01-01' }, context: SYS.context } as never) as Array<{ id: string }>;
        await engine.update('sys_exchange_rate', { id: rateRow!.id, rate: 0.125 }, SYS);
        try {
          const dry = await run(RC.corrected);
          expect(dry).toMatchObject({ amounts: 1, changed: 1, written: 0, skippedTotal: 0 });
          expect(dry.changes[0]!.to).toEqual({ home: 80000, rate: 0.125 });
          expect(await stored(RC.corrected, id)).toEqual({ home: 71994.24, rate: 0.1389 });

          const applied = await run(RC.corrected, { apply: true });
          expect(applied).toMatchObject({ changed: 1, written: 1, failures: [] });
          const fresh = await engine.insert(RC.corrected, { name: 'fresh', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 }, SYS);
          expect(await stored(RC.corrected, id)).toEqual(await stored(RC.corrected, fresh.id));
          expect(await stored(RC.corrected, id)).toEqual({ home: 80000, rate: 0.125 });

          const again = await run(RC.corrected, { apply: true });
          expect(again).toMatchObject({ amounts: 2, unchanged: 2, changed: 0, written: 0 });
          expect(homeAmountRecomputeComplete(again)).toBe(true);
        } finally {
          await engine.update('sys_exchange_rate', { id: rateRow!.id, rate: 0.1389 }, SYS);
        }
      });

      it('a missing rate is listed with its currency and date and skipped; the rest are filled; nothing else is written', async () => {
        await legacy(RC.missing, 'old_usd', { currency_code: 'USD', invoice_date: '2026-03-15', amount: 1389 });
        await legacy(RC.missing, 'old_sek', { currency_code: 'SEK', invoice_date: '2026-03-15', amount: 500 });
        const report = await run(RC.missing, { apply: true });
        expect(report).toMatchObject({ amounts: 2, changed: 1, written: 1, skippedTotal: 1 });
        expect(report.skipped).toEqual([
          { recordId: 'old_sek', organizationId: DEFAULT_ORGANIZATION_ID, field: 'amount', reason: 'rate_missing', currency: 'SEK', date: '2026-03-15' },
        ]);
        expect(await stored(RC.missing, 'old_usd')).toEqual({ home: 10000, rate: 0.1389 });
        expect(await stored(RC.missing, 'old_sek')).toEqual({ home: null, rate: null });
        expect(homeAmountRecomputeComplete(report)).toBe(false);
      });

      it('a blank code is its own class, apart from a missing rate, and is never written', async () => {
        await legacy(RC.codeless, 'codeless', { invoice_date: '2026-03-15', amount: 50 });
        const report = await run(RC.codeless, { apply: true });
        expect(report.skipped.map((s) => s.reason)).toEqual(['code_blank']);
        expect(report.skippedByReason).toMatchObject({ code_blank: 1, rate_missing: 0 });
        expect(report.written).toBe(0);
        expect(await stored(RC.codeless, 'codeless')).toEqual({ home: null, rate: null });
      });

      it('the same currency as home converts at 1, rounded once in decimal', async () => {
        await legacy(RC.same, 'same', { currency_code: 'CNY', amount: 1.005, amount_home: 1, amount_rate: 1 });
        const report = await run(RC.same, { apply: true });
        expect(report).toMatchObject({ changed: 1, written: 1 });
        expect(await stored(RC.same, 'same')).toEqual({ home: 1.01, rate: 1 });
      });

      it('a datetime document date is dated in the organization\'s timezone, through the column, for the rate and for since', async () => {
        // 2026-03-31T17:00Z is 01:00 on 2026-04-01 in Shanghai; USD has a new rate from April 1.
        const { id } = await engine.insert(RC.zone, { name: 'z', currency_code: 'USD', invoice_date: '2026-03-31T17:00:00Z', amount: 1500 }, SYS);
        expect(await stored(RC.zone, id)).toMatchObject({ rate: 0.1389 });
        try {
          expect(await run(RC.zone, { since: '2026-04-01' })).toMatchObject({ amounts: 0, outsideSince: 1 });
          timezone = 'Asia/Shanghai';
          expect(await run(RC.zone, { since: '2026-04-01', apply: true })).toMatchObject({ amounts: 1, written: 1 });
          expect(await stored(RC.zone, id)).toEqual({ home: 10000, rate: 0.15 });
        } finally {
          timezone = undefined;
        }
      });

      it('two organizations: each converts into its own home currency at its own rates, counted apart', async () => {
        engine.setTenancyPostureProvider(() => 'isolated');
        try {
          const orgDriver = engine.getDriverForObject('sys_organization')!;
          for (const id of ['org_rc_a', 'org_rc_b']) {
            if (!(await orgDriver.findOne('sys_organization', { where: { id } } as never))) await orgDriver.create('sys_organization', { id, name: id });
          }
          homes = { org_rc_a: 'CNY', org_rc_b: 'USD' };
          const as = (org: string) => ({ context: { isSystem: true, tenantId: org } });
          await engine.insert('sys_exchange_rate', { currency: 'EUR', effective_date: '2026-01-01', rate: 0.128, source: 'manual' }, as('org_rc_a'));
          const eurB = await engine.insert('sys_exchange_rate', { currency: 'EUR', effective_date: '2026-01-01', rate: 0.9, source: 'manual' }, as('org_rc_b'));
          const a = await engine.insert(RC.orgs, { name: 'a', currency_code: 'EUR', invoice_date: '2026-03-15', amount: 64 }, as('org_rc_a'));
          const b = await engine.insert(RC.orgs, { name: 'b', currency_code: 'EUR', invoice_date: '2026-03-15', amount: 90 }, as('org_rc_b'));
          expect(await stored(RC.orgs, a.id)).toEqual({ home: 500, rate: 0.128 });
          expect(await stored(RC.orgs, b.id)).toEqual({ home: 100, rate: 0.9 });
          // Organization B corrects its EUR rate; A's row reads A's rate and stays.
          await engine.update('sys_exchange_rate', { id: eurB.id, rate: 0.8 }, as('org_rc_b'));
          const report = await run(RC.orgs, { apply: true });
          expect(report.organizations).toEqual([
            expect.objectContaining({ organizationId: 'org_rc_a', homeCurrency: 'CNY', amounts: 1, unchanged: 1, changed: 0 }),
            expect.objectContaining({ organizationId: 'org_rc_b', homeCurrency: 'USD', amounts: 1, unchanged: 0, changed: 1, written: 1 }),
          ]);
          expect(await stored(RC.orgs, a.id)).toEqual({ home: 500, rate: 0.128 });
          expect(await stored(RC.orgs, b.id)).toEqual({ home: 112.5, rate: 0.8 });
        } finally {
          homes = {};
          engine.setTenancyPostureProvider(() => undefined);
        }
      });
    },
  );
}
