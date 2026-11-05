// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D5, D7 parameter 1, D8 rule 2] The upgrade path from a `record`
// mode amount with no home field to one that declares `homeAmount`, proven
// with nothing new in the product:
//
//   1. An object already holds rows, written while its amount was `record`
//      mode and declared no home field (the shape before the home projection
//      shipped).
//   2. The amount gains its `currencyConfig.homeAmount` pointer and the two
//      author-declared fields it names. The next boot migrates them through
//      the ordinary add-column path: the deferred schema sync `os migrate
//      plan` / `os migrate apply` run (`setDeferredDdl`,
//      `previewDeferredSchemaWork`, `detectManagedDrift`,
//      `flushDeferredSchemaDdl`). The plan lists the two columns as
//      `add_columns`, which is additive work, and nothing else; no drift; no
//      existing row is touched.
//   3. The explicit recompute (`recomputeHomeAmounts`, behind `os migrate
//      recompute-home-amounts`) fills the new home field on every pre-existing
//      row with what a fresh write of the same row stores, and lists and skips
//      the row whose rate is missing, leaving its home field blank.
//
// Each boot is its own engine and its own driver over the same database, as
// two processes are: a file for the SQLite cells, one schema for PostgreSQL.
// Cells: better-sqlite3 and sqlite-wasm always run; PostgreSQL runs where
// `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. The in-memory
// driver has no columns to add, so it has no add-column path to prove.
//
// The recompute's own cells (a corrected rate, the skip classes, the
// timezone, two organizations) are `home-amount-projection.test.ts`; this
// file reuses its object and rates.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL, recomputeHomeAmounts, homeAmountRecomputeComplete } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysExchangeRate } from '@objectstack/platform-objects/system';
import { installDefaultOrganization, DEFAULT_ORGANIZATION_ID } from './default-organization.testkit.js';

const LIVE_NAMESPACE = `os_lv_${basename(fileURLToPath(import.meta.url)).replace(/\.test\.ts$/, '').replace(/[^a-z0-9]+/gi, '_')}`;
const PG_URL = process.env.OS_TEST_POSTGRES_URL;

async function adminRaw(statements: string[]): Promise<void> {
  const admin = new SqlDriver({ client: 'pg', connection: PG_URL } as never);
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
  /** Create the empty database, before the first boot. */
  readonly setup: () => Promise<void>;
  /** A new driver over the same database: one per boot. */
  readonly open: () => SqlDriver;
  readonly teardown: () => Promise<void>;
}

let dir = '';
const fileIn = (name: string) => join(dir, name);

const CELLS: readonly Cell[] = [
  {
    id: 'driver-sql (better-sqlite3 file)',
    env: null,
    url: 'sqlite',
    setup: async () => { dir = mkdtempSync(join(tmpdir(), 'os-home-upgrade-')); },
    open: () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: fileIn('upgrade.db') }, useNullAsDefault: true }),
    teardown: async () => { rmSync(dir, { recursive: true, force: true }); },
  },
  {
    id: 'driver-sqlite-wasm (file)',
    env: null,
    url: 'sqlite-wasm',
    setup: async () => { dir = mkdtempSync(join(tmpdir(), 'os-home-upgrade-')); },
    open: () => new SqliteWasmDriver({ filename: fileIn('upgrade-wasm.db') }),
    teardown: async () => { rmSync(dir, { recursive: true, force: true }); },
  },
  {
    id: 'driver-sql (pg)',
    env: 'OS_TEST_POSTGRES_URL',
    url: PG_URL,
    setup: async () => {
      await adminRaw([`drop schema if exists ${LIVE_NAMESPACE} cascade`, `create schema ${LIVE_NAMESPACE}`]);
    },
    open: () => new SqlDriver({ client: 'pg', connection: PG_URL, searchPath: [LIVE_NAMESPACE] } as never),
    teardown: async () => { await adminRaw([`drop schema if exists ${LIVE_NAMESPACE} cascade`]); },
  },
];

const SYS = { context: { isSystem: true } };
const OBJECT = 'fx_upgrade';

/** Before: a `record`-mode amount with no home field. */
const BEFORE = {
  name: OBJECT,
  label: 'FX upgrade',
  fields: {
    name: { name: 'name', type: 'text' },
    currency_code: { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { name: 'invoice_date', type: 'date' },
    amount: {
      name: 'amount',
      type: 'currency',
      currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' },
    },
  },
};

/** After: the one pointer line, and the two fields it names (D8 rule 2: declared by the author, never injected). */
const AFTER = {
  ...BEFORE,
  fields: {
    ...BEFORE.fields,
    amount: {
      ...BEFORE.fields.amount,
      currencyConfig: {
        ...BEFORE.fields.amount.currencyConfig,
        homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
      },
    },
    amount_home: { name: 'amount_home', type: 'currency', readonly: true },
    amount_rate: { name: 'amount_rate', type: 'number', readonly: true },
  },
};

const appWith = (object: unknown) => ({
  id: 'com.objectstack.dogfood.home-amount-added-to-existing-object',
  name: 'Home amount added to an existing object',
  version: '1.0.0',
  type: 'plugin',
  scope: 'system',
  objects: [SysExchangeRate, object],
});

const RATES: ReadonlyArray<[string, string, number]> = [
  ['USD', '2026-01-01', 0.1389],
  ['USD', '2026-04-01', 0.15],
];

/** The rows stored before the upgrade; SEK has no rate row. */
const ROWS: ReadonlyArray<Record<string, unknown>> = [
  { id: 'up_usd_march', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 },
  { id: 'up_usd_april', currency_code: 'USD', invoice_date: '2026-04-15', amount: 1500 },
  { id: 'up_cny', currency_code: 'CNY', invoice_date: '2026-03-15', amount: 12.345 },
  { id: 'up_sek', currency_code: 'SEK', invoice_date: '2026-03-15', amount: 500 },
];

const quiet = { info: () => {}, warn: () => {} };

async function boot(driver: SqlDriver, object: unknown, options: { deferDdl?: boolean } = {}): Promise<ObjectQL> {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  // `os migrate plan` / `apply` boot with the deferral armed: the sync
  // registers the metadata and records the physical work instead of doing it.
  if (options.deferDdl) driver.setDeferredDdl(true);
  engine.registerApp(appWith(object));
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  engine.setHomeLocalizationResolver(async () => ({ currency: 'CNY' }));
  return engine;
}

for (const cell of CELLS) {
  describe.skipIf(!cell.url)(
    `a home field added to an object that already holds rows — ${cell.id}${cell.url ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: SqlDriver;
      let engine: ObjectQL;

      beforeAll(async () => {
        await cell.setup();
        // ── The first boot: the object with no home field, and its rows. ──
        const first = await boot(cell.open(), BEFORE);
        for (const [currency, effective_date, rate] of RATES) {
          await first.insert('sys_exchange_rate', { currency, effective_date, rate, source: 'manual' }, SYS);
        }
        for (const row of ROWS) await first.insert(OBJECT, { name: row.id, ...row }, SYS);
        await first.destroy();
      });

      afterAll(async () => {
        await engine?.destroy();
        await cell.teardown();
      });

      async function stored(id: unknown) {
        const back = await engine.findOne(OBJECT, { where: { id }, context: SYS.context } as never) as Record<string, unknown>;
        return {
          amount: Number(back.amount),
          currency: back.currency_code,
          home: back.amount_home == null ? null : Number(back.amount_home),
          rate: back.amount_rate == null ? null : Number(back.amount_rate),
        };
      }

      it('the declared home field migrates through the ordinary add-column path, and no stored row moves', async () => {
        // ── The upgrade boot, as `os migrate apply` runs it. ──
        driver = cell.open();
        engine = await boot(driver, AFTER, { deferDdl: true });

        // The plan: the two declared columns, as additive work; nothing rewrites a row.
        const table = (await driver.previewDeferredSchemaWork()).filter((w) => w.table === OBJECT);
        expect(table).toEqual([{ table: OBJECT, kind: 'add_columns', columns: ['amount_home', 'amount_rate'] }]);
        expect((await driver.previewDeferredSchemaWork()).filter((w) => w.table !== OBJECT)).toEqual([]);
        expect((await driver.detectManagedDrift()).filter((d) => d.table === OBJECT)).toEqual([]);

        // The confirmed apply.
        const performed = await driver.flushDeferredSchemaDdl();
        expect(performed.filter((w) => w.table === OBJECT)).toEqual(table);
        expect(await driver.previewDeferredSchemaWork()).toEqual([]);

        // Every stored row is still there, as it was, with an empty home field.
        expect(await engine.count(OBJECT, { context: SYS.context } as never)).toBe(ROWS.length);
        for (const row of ROWS) {
          expect(await stored(row.id)).toEqual({ amount: row.amount, currency: row.currency_code, home: null, rate: null });
        }
      });

      it('the recompute fills every pre-existing row with what a fresh write stores; the row with no rate is listed and skipped', async () => {
        const run = (apply = false) => recomputeHomeAmounts(engine as never, quiet, { object: OBJECT, apply });

        const dry = await run();
        expect(dry).toMatchObject({ amounts: 4, unchanged: 0, changed: 3, written: 0, skippedTotal: 1, failures: [] });
        for (const row of ROWS) expect((await stored(row.id)).home).toBeNull();

        const applied = await run(true);
        expect(applied).toMatchObject({ amounts: 4, changed: 3, written: 3, skippedTotal: 1, failures: [] });
        expect(applied.skipped).toEqual([
          { recordId: 'up_sek', organizationId: DEFAULT_ORGANIZATION_ID, field: 'amount', reason: 'rate_missing', currency: 'SEK', date: '2026-03-15' },
        ]);
        expect(homeAmountRecomputeComplete(applied)).toBe(false);

        // The ADR's own figures: USD 10,000 at 0.1389 is ¥71,994.24; the same currency is rate 1, rounded once.
        expect(await stored('up_usd_march')).toMatchObject({ home: 71994.24, rate: 0.1389 });
        expect(await stored('up_usd_april')).toMatchObject({ home: 10000, rate: 0.15 });
        expect(await stored('up_cny')).toMatchObject({ home: 12.35, rate: 1 });
        // The skipped row keeps a blank home field, never a fallback.
        expect(await stored('up_sek')).toMatchObject({ home: null, rate: null });

        // Equal to a fresh write of the same row, after the upgrade.
        for (const row of ROWS.filter((r) => r.id !== 'up_sek')) {
          const { id: _old, ...values } = row;
          const fresh = await engine.insert(OBJECT, { name: `fresh_${String(row.id)}`, ...values }, SYS);
          expect(await stored(row.id)).toEqual(await stored(fresh.id));
        }
        // A fresh write of the skipped row is refused for the same missing rate.
        const refused = await engine.insert(OBJECT, { name: 'fresh_sek', currency_code: 'SEK', invoice_date: '2026-03-15', amount: 500 }, SYS)
          .then(() => null, (e: { code?: string }) => e);
        expect(refused?.code).toBe('ERR_EXCHANGE_RATE_MISSING');

        // A re-run changes nothing and still lists the one row.
        const again = await run(true);
        expect(again).toMatchObject({ amounts: 7, unchanged: 6, changed: 0, written: 0, skippedTotal: 1 });
      });
    },
  );
}
