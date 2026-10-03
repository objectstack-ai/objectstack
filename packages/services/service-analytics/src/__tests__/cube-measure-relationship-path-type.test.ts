// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21129] A cube measure whose `sql` is a RELATIONSHIP PATH (`account.name`)
 * is judged by the aggregate × field-type table, described in `fields[]`, and
 * presented on the native face by the declaration on the object the path's
 * last hop reaches — located through the one hop resolver (`hop-object.ts`),
 * as a base-object measure is by the base object's declaration (#21044).
 *
 * ## The shape this closes
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route
 * at `c6b6889193`, SQLite and PostgreSQL 16.14, a configured cube over `deal`
 * with a declared join `account`:
 *
 * | measure `sql` | native-SQL face | ObjectQL face |
 * |:--|:--|:--|
 * | `max` / `min` over `account.name` (`text`), `max` over `account.tier` (`select`) | 200, the text, `fields[]` `number` | 400 `INVALID_FIELD`, its cross-object refusal |
 * | `sum` over `account.name` | 200 `0` on SQLite, 500 on PostgreSQL | the same 400 |
 * | `max` / `min` over `account.revenue` (`number`) | 200; on PostgreSQL the string `"250.000000000000000000000000000000"` | the same 400 |
 * | `max` over `account.opened_at` (`datetime`) | 200, the instant, `fields[]` `number` | the same 400 |
 *
 * The cube door refused the base-object column of the same type
 * (`max_note`, the control) on both faces.
 *
 * ## What these pins hold
 *
 * - A relationship-path pair the table refuses is refused by the cube door's
 *   `INVALID_FIELD` / 400 BEFORE either strategy reads anything, with the
 *   same envelope on both faces: the member, the request key, the cube, the
 *   path as the measure spells it and the object that declares the column.
 *   The ObjectQL face's own cross-object refusal carries no `field` / `object`,
 *   so equal envelopes are the door's, not two refusals that happen to agree.
 * - The hop's object is the one resolver's: the cube's declared join (tier 1),
 *   and — for a relationship the cube declares no join for — the relationship
 *   field's declared `reference` (tier 2), never an object named after the
 *   relationship (`owner` reaches `os21129_person`).
 * - On the native face, a relationship-path `min` / `max` over a numeric
 *   column is a JS number typed `number` — on PostgreSQL too — and over a
 *   temporal column is typed `time`, as a base-object one is.
 * - The base-object measures are the control.
 *
 * ⚠️ Not pinned here: the ObjectQL face still refuses an ACCEPTED
 * relationship-path pair (`max` over `account.revenue`) as a cross-object
 * measure, a capability the engine's aggregate does not have. Whether the two
 * faces converge on that pair is not this card's ruling.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; CI provisions
 * that variable for this package in the Temporal Conformance job's step
 * "Run the non-SQL temporal backends under the skewed process zone"
 * (`.github/workflows/ci.yml`), so the live cell is red-capable and runs in
 * CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its tables, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const ACCOUNT = 'os21129_account';
const PERSON = 'os21129_person';
const DEAL = 'os21129_deal';

const ACCOUNT_OBJECT = {
  name: ACCOUNT,
  label: 'Relationship-path account',
  fields: {
    name: { name: 'name', type: 'text' as const },
    revenue: { name: 'revenue', type: 'number' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    tier: {
      name: 'tier',
      type: 'select' as const,
      options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
    },
  },
};

const PERSON_OBJECT = {
  name: PERSON,
  label: 'Relationship-path person',
  fields: {
    email: { name: 'email', type: 'text' as const },
    score: { name: 'score', type: 'number' as const },
  },
};

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Relationship-path deal',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    account: { name: 'account', type: 'lookup' as const, reference: ACCOUNT },
    // Named after neither its target nor anything the cube joins: only the
    // field's declared `reference` reaches `os21129_person`.
    owner: { name: 'owner', type: 'lookup' as const, reference: PERSON },
  },
};

const ACCOUNTS = [
  { id: 'a1', name: 'alpha', revenue: 100, opened_at: '2026-01-02T03:04:05.000Z', tier: 'a' },
  { id: 'a2', name: 'zeta', revenue: 250, opened_at: '2026-03-04T05:06:07.000Z', tier: 'b' },
] as const;
const PEOPLE = [
  { id: 'p1', email: 'p1@example.com', score: 7 },
  { id: 'p2', email: 'p2@example.com', score: 41 },
] as const;
const DEALS = [
  { id: 'd1', note: 'x', amount: 10, account: 'a1', owner: 'p1' },
  { id: 'd2', note: 'y', amount: 32, account: 'a2', owner: 'p2' },
] as const;

const CUBE: Cube = {
  name: 'os21129_cube',
  title: 'Relationship-path measure cube',
  sql: DEAL,
  public: true,
  // `account` is joined (tier 1); `owner` is not (tier 2, its `reference`).
  joins: { account: { name: ACCOUNT } },
  measures: {
    max_acct_name: { type: 'max', sql: 'account.name', label: 'Largest account name (text)' },
    min_acct_name: { type: 'min', sql: 'account.name', label: 'Smallest account name (text)' },
    max_acct_tier: { type: 'max', sql: 'account.tier', label: 'Largest account tier (select)' },
    sum_acct_name: { type: 'sum', sql: 'account.name', label: 'Sum of account names (text)' },
    max_owner_email: { type: 'max', sql: 'owner.email', label: 'Largest owner email (text)' },
    max_acct_revenue: { type: 'max', sql: 'account.revenue', label: 'Largest account revenue (number)' },
    min_acct_revenue: { type: 'min', sql: 'account.revenue', label: 'Smallest account revenue (number)' },
    max_owner_score: { type: 'max', sql: 'owner.score', label: 'Largest owner score (number)' },
    max_acct_opened: { type: 'max', sql: 'account.opened_at', label: 'Latest account opening (datetime)' },
    max_note: { type: 'max', sql: 'note', label: 'Largest note (text)' },
    max_amount: { type: 'max', sql: 'amount', label: 'Largest amount (number)' },
  },
  dimensions: {},
} as Cube;

/** Pairs the table refuses: the member, the path its `sql` spells, and the object that declares the column. */
const REFUSED: ReadonlyArray<readonly [member: string, path: string, object: string]> = [
  ['max_acct_name', 'account.name', ACCOUNT],
  ['min_acct_name', 'account.name', ACCOUNT],
  ['max_acct_tier', 'account.tier', ACCOUNT],
  ['sum_acct_name', 'account.name', ACCOUNT],
  ['max_owner_email', 'owner.email', PERSON],
];

/** Accepted relationship-path `min` / `max` over a numeric column, and the value the rows hold. */
const NUMERIC: ReadonlyArray<readonly [member: string, value: number]> = [
  ['max_acct_revenue', 250],
  ['min_acct_revenue', 100],
  ['max_owner_score', 41],
];

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

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; member?: string; param?: string; cube?: string; field?: string; object?: string };

/** The envelope a refusal carries, without its words. */
const envelopeOf = (err: Refusal | undefined) => ({
  code: err?.code,
  status: err?.status,
  member: err?.member,
  param: err?.param,
  cube: err?.cube,
  field: err?.field,
  object: err?.object,
});

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21129] a relationship-path cube measure is judged and presented by its column's declaration (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates, on any object. */
      const reads = { rawSql: 0, aggregate: 0 };
      /** `native`: the plugin's own capabilities. `objectql`: narrowed to the engine-aggregate path. */
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        for (const table of [DEAL, ACCOUNT, PERSON]) await driver?.execute(`drop table if exists ${table}`).catch(() => {});
      };

      /** One query on one face, with the reads it caused counted. */
      const read = async (face: Face, measures: readonly string[]) => {
        const before = { ...reads };
        const outcome = await services[face]!.query({ cube: CUBE.name, measures: [...measures] } as any).then(
          (res) => ({ res, err: undefined as Refusal | undefined }),
          (err) => ({ res: undefined, err: err as Refusal }),
        );
        return { ...outcome, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        for (const object of [ACCOUNT_OBJECT, PERSON_OBJECT, DEAL_OBJECT]) engine.registry.registerObject(object as any);
        await engine.syncSchemas();
        for (const row of ACCOUNTS) await engine.insert(ACCOUNT, { ...row } as any);
        for (const row of PEOPLE) await engine.insert(PERSON, { ...row } as any);
        for (const row of DEALS) await engine.insert(DEAL, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: unknown) => {
          reads.rawSql += 1;
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (...args: unknown[]) => {
          reads.aggregate += 1;
          return (realAggregate as any)(...args);
        };

        // The plugin's own composition over the real engine — `sourceFieldMeta`
        // and the relationship resolver wired from the engine's registry.
        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
            getService: (name: string) => (name === 'data' ? engine : registered[name]),
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          services[face] = registered.analytics as AnalyticsService;
        }
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('a relationship-path pair the table refuses is refused INVALID_FIELD / 400 before anything is read, with one envelope on both faces', async () => {
        for (const [member, path, object] of REFUSED) {
          const envelopes: Record<string, unknown> = {};
          for (const face of FACES) {
            const { res, err, rawSql, aggregate } = await read(face, [member]);
            expect(res, `${face} ${member} must not be served`).toBeUndefined();
            expect(err?.code, `${face} ${member}: ${err?.message}`).toBe('INVALID_FIELD');
            expect(err?.status, `${face} ${member}`).toBe(400);
            expect(err?.member, `${face} ${member}`).toBe(member);
            expect(err?.param, `${face} ${member}`).toBe('measures');
            expect(err?.cube, `${face} ${member}`).toBe(CUBE.name);
            expect(err?.field, `${face} ${member}: the path as the measure spells it`).toBe(path);
            expect(err?.object, `${face} ${member}: the object that declares the column`).toBe(object);
            expect(rawSql, `${face} ${member}: no raw statement ran`).toBe(0);
            expect(aggregate, `${face} ${member}: no engine aggregate ran`).toBe(0);
            envelopes[face] = envelopeOf(err);
          }
          expect(envelopes.objectql, `${member}: one door, one envelope`).toEqual(envelopes.native);
        }
      });

      it('the control — a base-object pair the table refuses is refused the same way', async () => {
        for (const face of FACES) {
          const { res, err, rawSql, aggregate } = await read(face, ['max_note']);
          expect(res, `${face} max_note must not be served`).toBeUndefined();
          expect(err?.code, `${face}: ${err?.message}`).toBe('INVALID_FIELD');
          expect(err?.status).toBe(400);
          expect(err?.field).toBe('note');
          expect(err?.object).toBe(DEAL);
          expect(rawSql + aggregate, `${face}: nothing was read`).toBe(0);
        }
      });

      it('native: a relationship-path min / max over a numeric column is a number, typed number', async () => {
        for (const [member, value] of NUMERIC) {
          const { res, err } = await read('native', [member]);
          expect(err, `${member}: ${err?.message}`).toBeUndefined();
          expect(res!.rows[0]![member], `${member} answers the number`).toBe(value);
          expect(res!.fields.find((f) => f.name === member)?.type, member).toBe('number');
        }
      });

      it('native: a relationship-path max over a temporal column is served and typed time', async () => {
        const { res, err } = await read('native', ['max_acct_opened']);
        expect(err, err?.message).toBeUndefined();
        expect(res!.rows[0]!.max_acct_opened, 'max_acct_opened answers a value').not.toBeNull();
        expect(res!.fields.find((f) => f.name === 'max_acct_opened')?.type).toBe('time');
      });

      it('the control — a base-object max over a number column is served, a number, typed number, on both faces', async () => {
        for (const face of FACES) {
          const { res, err } = await read(face, ['max_amount']);
          expect(err, `${face}: ${err?.message}`).toBeUndefined();
          expect(res!.rows[0]!.max_amount).toBe(32);
          expect(res!.fields.find((f) => f.name === 'max_amount')?.type).toBe('number');
        }
      });

      it('the dry-run door refuses a relationship-path pair the query door refuses', async () => {
        const err = await services.native!.generateSql({ cube: CUBE.name, measures: ['max_acct_name'] } as any).then(
          () => undefined,
          (e) => e as Refusal,
        );
        expect(err?.code, err?.message).toBe('INVALID_FIELD');
        expect(err?.status).toBe(400);
        expect(err?.field).toBe('account.name');
        expect(err?.object).toBe(ACCOUNT);
        const control = await services.native!.generateSql({ cube: CUBE.name, measures: ['max_acct_revenue'] } as any);
        expect(control.sql).toMatch(/max\(/i);
      });
    },
  );
}

describe('[#21129] cannot answer, do not block', () => {
  it('a relationship path whose object the host does not describe gets no verdict: the pair reaches its strategy', async () => {
    let statements = 0;
    const service = new AnalyticsService({
      logger: quiet as any,
      cubes: [CUBE],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      // Describes the base object only.
      sourceFieldMeta: (object: string, field: string) =>
        object === DEAL ? (DEAL_OBJECT.fields as Record<string, { type: string }>)[field] : undefined,
      executeRawSql: async () => {
        statements += 1;
        return [{ max_acct_name: 'zeta' }];
      },
    });
    const res = await service.query({ cube: CUBE.name, measures: ['max_acct_name'] } as any);
    expect(statements).toBe(1);
    expect(res.rows).toEqual([{ max_acct_name: 'zeta' }]);
  });
});
