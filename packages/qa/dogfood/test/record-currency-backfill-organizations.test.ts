// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 Open item 13, ruling 6670707546 item A] The explicit code backfill
// (`backfillRecordCurrencyCodes`, behind `os migrate record-currency-codes`)
// one organization at a time, on the real SQL drivers: each organization has
// its own home currency, so an unscoped run over the rows of more than one
// organization is refused before any write, `organizationId` fills one
// organization's rows, `allOrganizations` fills every one's, and rows of one
// organization run exactly as before the scope existed.
//
// The rows are written STRAIGHT INTO THE DRIVER, as the database holds them
// after an amount was switched to record mode: an amount with no code, which
// the engine's insert would now refuse. Every pin runs under the posture a CLI
// shell boots with when nothing names one (`single`, no wall), where the
// system context alone does not narrow the driver: the scope holds because the
// walk filters on each row's own `organization_id`.
//
// Cells: better-sqlite3 and sqlite-wasm always run; PostgreSQL runs where
// `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. The Postgres
// cell owns one schema, named from this file. The in-memory face (the walled
// posture's driver predicate, the refusals before any read, the report text)
// is packages/objectql's `record-currency-backfill.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL, backfillRecordCurrencyCodes } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
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
const ORG_A = 'org_bf_a';
const ORG_B = 'org_bf_b';

/** One object per pin, so each pin's counts are its own. */
const OBJECTS = {
  refused: 'bf_refused',
  scoped: 'bf_scoped',
  every: 'bf_every',
  single: 'bf_single',
} as const;

const dealObject = (name: string) => ({
  name,
  label: name,
  fields: {
    name: { name: 'name', type: 'text' },
    currency_code: { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' },
    amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
  },
});

const appWith = (objects: unknown[]) => ({
  id: 'com.objectstack.dogfood.record-currency-backfill-organizations',
  name: 'Record currency backfill per organization',
  version: '1.0.0',
  type: 'plugin',
  scope: 'system',
  objects,
});

const quiet = { info: () => {}, warn: () => {} };

for (const cell of CELLS) {
  describe.skipIf(!cell.url)(
    `the record-currency code backfill, one organization at a time — ${cell.id}${cell.url ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: SqlDriver;
      let engine: ObjectQL;

      beforeAll(async () => {
        driver = await cell.make();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registerApp(appWith(Object.values(OBJECTS).map(dealObject)));
        await engine.syncSchemas();
        await installDefaultOrganization(engine);
        const orgDriver = engine.getDriverForObject('sys_organization')!;
        for (const id of [ORG_A, ORG_B]) {
          if (!(await orgDriver.findOne('sys_organization', { where: { id } } as never))) await orgDriver.create('sys_organization', { id, name: id });
        }
      });

      afterAll(async () => {
        await engine?.destroy();
        await cell.teardown();
      });

      /** A row as stored before the switch: an amount, no code, written at the driver. */
      async function legacy(object: string, id: string, organization: string, row: Record<string, unknown> = {}) {
        await engine.getDriverForObject(object)!.create(object, { id, name: id, organization_id: organization, amount: 100, ...row } as never);
      }
      /** Seeds two organizations' rows: two codeless in A (beside one coded), one codeless in B. */
      async function twoOrganizations(object: string) {
        await legacy(object, `${object}_a1`, ORG_A);
        await legacy(object, `${object}_a2`, ORG_A, { amount: 0 });
        await legacy(object, `${object}_a3`, ORG_A, { currency_code: 'CNY' });
        await legacy(object, `${object}_b1`, ORG_B);
      }
      async function codes(object: string): Promise<Record<string, unknown>> {
        const rows = await engine.find(object, { fields: ['id', 'currency_code'], orderBy: [{ field: 'id', order: 'asc' }], context: SYS.context } as never) as Array<Record<string, unknown>>;
        return Object.fromEntries(rows.map((r) => [String(r.id).slice(object.length + 1), r.currency_code ?? null]));
      }
      const run = (object: string, options: Record<string, unknown> = {}) =>
        backfillRecordCurrencyCodes(engine as never, quiet, { object, field: 'amount', code: 'USD', ...options });

      it('two organizations and no scope: refused before any write, a dry run as an apply run, carrying both counts', async () => {
        await twoOrganizations(OBJECTS.refused);
        for (const apply of [false, true]) {
          const err = await run(OBJECTS.refused, { apply }).then(() => null, (e: Record<string, any>) => e);
          expect({ code: err?.code, status: err?.status, field: err?.field }, `apply: ${apply}`)
            .toEqual({ code: 'VALIDATION_ERROR', status: 400, field: 'organizationId' });
          expect(err?.organizations.map((o: Record<string, unknown>) => [o.organizationId, o.codeless, o.skippedCodePresent]))
            .toEqual([[ORG_A, 2, 1], [ORG_B, 1, 0]]);
        }
        expect(await codes(OBJECTS.refused)).toEqual({ a1: null, a2: null, a3: 'CNY', b1: null });
      });

      it('an organization scope fills that organization\'s codeless rows only', async () => {
        await twoOrganizations(OBJECTS.scoped);
        const report = await run(OBJECTS.scoped, { organizationId: ORG_A, apply: true });
        expect(report).toMatchObject({ organizationId: ORG_A, scannedRecords: 3, codeless: 2, written: 2, failures: [] });
        expect(report.organizations.map((o) => o.organizationId)).toEqual([ORG_A]);
        expect(await codes(OBJECTS.scoped)).toEqual({ a1: 'USD', a2: 'USD', a3: 'CNY', b1: null });
        // Organization B's rows are B's own run, with B's code.
        expect(await run(OBJECTS.scoped, { organizationId: ORG_B, code: 'EUR', apply: true })).toMatchObject({ written: 1 });
        expect(await codes(OBJECTS.scoped)).toEqual({ a1: 'USD', a2: 'USD', a3: 'CNY', b1: 'EUR' });
      });

      it('allOrganizations writes the one code into every organization\'s codeless rows, counted apart', async () => {
        await twoOrganizations(OBJECTS.every);
        const report = await run(OBJECTS.every, { allOrganizations: true, apply: true });
        expect(report).toMatchObject({ allOrganizations: true, codeless: 3, written: 3 });
        expect(report.organizations.map((o) => [o.organizationId, o.written])).toEqual([[ORG_A, 2], [ORG_B, 1]]);
        expect(await codes(OBJECTS.every)).toEqual({ a1: 'USD', a2: 'USD', a3: 'CNY', b1: 'USD' });
      });

      it('rows of one organization: the unscoped run writes as it always did', async () => {
        await legacy(OBJECTS.single, `${OBJECTS.single}_d1`, DEFAULT_ORGANIZATION_ID);
        await legacy(OBJECTS.single, `${OBJECTS.single}_d2`, DEFAULT_ORGANIZATION_ID, { currency_code: 'JPY' });
        const report = await run(OBJECTS.single, { apply: true });
        expect(report).toMatchObject({ organizationId: null, allOrganizations: false, codeless: 1, written: 1, skippedCodePresent: 1 });
        expect(await codes(OBJECTS.single)).toEqual({ d1: 'USD', d2: 'JPY' });
      });
    },
  );
}
