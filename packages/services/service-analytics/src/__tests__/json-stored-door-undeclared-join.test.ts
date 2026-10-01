// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21232] A grouped dimension and a `count_distinct` measure over a
 * JSON-stored column reached through a relationship path the cube declares
 * NO join for are refused by the structured-JSON door
 * (`structured-json-dimension-door.ts`) — `INVALID_FIELD` / 400, the family's
 * one refusal — on both strategy faces and both dialects, exactly as the same
 * members over a declared join already were.
 *
 * ## The shape this closes
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route
 * at `3a7b6eb0`, SQLite and PostgreSQL 16.14, a configured cube over `deal`
 * whose lookup `owner` (`reference` the person object) has no declared join,
 * beside `account` (declared join):
 *
 * | member | face | SQLite | PostgreSQL |
 * |:--|:--|:--|:--|
 * | dimension over `owner.prefs` (json) / `owner.labels` (tags) | native | 200, one group per serialized value | 500 `DATABASE_ERROR` |
 * | the same | ObjectQL | 400, the engine's `groupBy[1]` | same |
 * | `count_distinct` over `owner.prefs` / `owner.labels` | native | 200 | 500 |
 * | the same | ObjectQL | 400, its cross-object refusal | same |
 * | control — the same members over `account.hq` | both | 400 `INVALID_FIELD`, the door | same |
 *
 * The door located a dotted path's object through `cube.joins` alone and
 * stood down where the cube declares no join; the strategies joined the
 * lookup's declared `reference` through the one hop resolver (`hop-object.ts`)
 * and grouped by its column.
 *
 * ## What these pins hold
 *
 * - Every undeclared-join member is refused BEFORE either strategy reads
 *   anything, with the same envelope on both faces: `code`, `status`, the
 *   member, the request key, the cube, the path as the member spells it and
 *   the object the lookup's `reference` declares. Neither face's own refusal
 *   carries that envelope (the engine's names `groupBy[1]`, the cross-object
 *   one carries no `field` / `object`), so equal envelopes are the door's.
 * - An ad-hoc query's inferred cube declares no join at all: a dotted
 *   dimension on it is refused the same way.
 * - The declared-join members are the control: the same refusal, `object` the
 *   joined object.
 * - The scalar column over the same undeclared-join path is served.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI step
 * provisions that variable for this package, so the live cell is red-capable
 * and un-run in CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its tables, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const PERSON = 'os21232_person';
const ACCOUNT = 'os21232_account';
const DEAL = 'os21232_deal';

const PERSON_OBJECT = {
  name: PERSON,
  label: 'Undeclared-join person',
  fields: {
    email: { name: 'email', type: 'text' as const },
    prefs: { name: 'prefs', type: 'json' as const },
    labels: { name: 'labels', type: 'tags' as const },
  },
};

const ACCOUNT_OBJECT = {
  name: ACCOUNT,
  label: 'Undeclared-join account',
  fields: {
    name: { name: 'name', type: 'text' as const },
    hq: { name: 'hq', type: 'json' as const },
  },
};

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Undeclared-join deal',
  fields: {
    note: { name: 'note', type: 'text' as const },
    account: { name: 'account', type: 'lookup' as const, reference: ACCOUNT },
    // Named after neither its target nor anything the cube joins: only the
    // field's declared `reference` reaches `os21232_person`.
    owner: { name: 'owner', type: 'lookup' as const, reference: PERSON },
  },
};

const PEOPLE = [
  { id: 'p1', email: 'p1@example.com', prefs: { a: 1 }, labels: ['a', 'b'] },
  { id: 'p2', email: 'p2@example.com', prefs: { b: 1 }, labels: ['b'] },
  { id: 'p3', email: 'p3@example.com', prefs: { a: 1 }, labels: ['a', 'b'] },
] as const;
const ACCOUNTS = [
  { id: 'a1', name: 'alpha', hq: { x: 1 } },
  { id: 'a2', name: 'zeta', hq: { y: 1 } },
] as const;
const DEALS = [
  { id: 'd1', note: 'x', account: 'a1', owner: 'p1' },
  { id: 'd2', note: 'y', account: 'a2', owner: 'p2' },
  { id: 'd3', note: 'z', account: 'a1', owner: 'p3' },
] as const;

const CUBE: Cube = {
  name: 'os21232_cube',
  title: 'Undeclared-join JSON-stored door cube',
  sql: DEAL,
  public: true,
  // `account` is joined (tier 1); `owner` is not (tier 2, its `reference`).
  joins: { account: { name: ACCOUNT } },
  measures: {
    count: { type: 'count', sql: '*', label: 'Rows' },
    owner_prefs_distinct: { type: 'count_distinct', sql: 'owner.prefs', label: 'Distinct owner prefs (json)' },
    owner_labels_distinct: { type: 'count_distinct', sql: 'owner.labels', label: 'Distinct owner labels (tags)' },
    owner_email_distinct: { type: 'count_distinct', sql: 'owner.email', label: 'Distinct owner emails (text)' },
    acct_hq_distinct: { type: 'count_distinct', sql: 'account.hq', label: 'Distinct account HQs (json)' },
  },
  dimensions: {
    owner_prefs: { type: 'string', sql: 'owner.prefs', label: 'Owner prefs (json)' },
    owner_labels: { type: 'string', sql: 'owner.labels', label: 'Owner labels (tags)' },
    owner_email: { type: 'string', sql: 'owner.email', label: 'Owner email (text)' },
    acct_hq: { type: 'string', sql: 'account.hq', label: 'Account HQ (json)' },
  },
} as Cube;

/** A refused member: the request key, the path its `sql` spells, and the object that declares the column. */
type Refused = readonly [member: string, param: 'dimensions' | 'measures', path: string, object: string];

/** Over the lookup the cube declares NO join for — the card's rows. */
const UNDECLARED: readonly Refused[] = [
  ['owner_prefs', 'dimensions', 'owner.prefs', PERSON],
  ['owner_labels', 'dimensions', 'owner.labels', PERSON],
  ['owner_prefs_distinct', 'measures', 'owner.prefs', PERSON],
  ['owner_labels_distinct', 'measures', 'owner.labels', PERSON],
];

/** Over the declared join — the control: the family's existing refusal. */
const DECLARED: readonly Refused[] = [
  ['acct_hq', 'dimensions', 'account.hq', ACCOUNT],
  ['acct_hq_distinct', 'measures', 'account.hq', ACCOUNT],
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

/** The query that asks for one member under its request key. */
const queryFor = (member: string, param: 'dimensions' | 'measures') =>
  (param === 'dimensions'
    ? { cube: CUBE.name, measures: ['count'], dimensions: [member] }
    : { cube: CUBE.name, measures: [member] }) as any;

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21232] a JSON-stored member over a relationship path the cube declares no join for (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
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
      const read = async (face: Face, query: unknown) => {
        const before = { ...reads };
        const outcome = await services[face]!.query(query as any).then(
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
        for (const object of [PERSON_OBJECT, ACCOUNT_OBJECT, DEAL_OBJECT]) engine.registry.registerObject(object as any);
        await engine.syncSchemas();
        for (const row of PEOPLE) await engine.insert(PERSON, { ...row } as any);
        for (const row of ACCOUNTS) await engine.insert(ACCOUNT, { ...row } as any);
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

      const refusedOnBothFaces = async (rows: readonly Refused[]) => {
        for (const [member, param, path, object] of rows) {
          const envelopes: Record<string, unknown> = {};
          for (const face of FACES) {
            const { res, err, rawSql, aggregate } = await read(face, queryFor(member, param));
            expect(res, `${face} ${member} must not be served`).toBeUndefined();
            expect(err?.code, `${face} ${member}: ${err?.message}`).toBe('INVALID_FIELD');
            expect(err?.status, `${face} ${member}`).toBe(400);
            expect(err?.member, `${face} ${member}`).toBe(member);
            expect(err?.param, `${face} ${member}`).toBe(param);
            expect(err?.cube, `${face} ${member}`).toBe(CUBE.name);
            expect(err?.field, `${face} ${member}: the path as the member spells it`).toBe(path);
            expect(err?.object, `${face} ${member}: the object that declares the column`).toBe(object);
            expect(rawSql, `${face} ${member}: no raw statement ran`).toBe(0);
            expect(aggregate, `${face} ${member}: no engine aggregate ran`).toBe(0);
            envelopes[face] = envelopeOf(err);
          }
          expect(envelopes.objectql, `${member}: one door, one envelope`).toEqual(envelopes.native);
        }
      };

      it('a dimension and a count_distinct over the undeclared-join path answer INVALID_FIELD / 400 before anything is read, one envelope on both faces', async () => {
        await refusedOnBothFaces(UNDECLARED);
      });

      it('the control — the same members over the declared join answer the same refusal', async () => {
        await refusedOnBothFaces(DECLARED);
      });

      it('an ad-hoc query over the object — an inferred cube, which declares no join at all — is refused the same way', async () => {
        for (const face of FACES) {
          const { res, err, rawSql, aggregate } = await read(face, { cube: DEAL, measures: ['count'], dimensions: ['owner.prefs'] });
          expect(res, `${face} must not be served`).toBeUndefined();
          expect(envelopeOf(err), `${face}: ${err?.message}`).toEqual({
            code: 'INVALID_FIELD', status: 400, member: 'owner.prefs', param: 'dimensions', cube: DEAL, field: 'owner.prefs', object: PERSON,
          });
          expect(rawSql + aggregate, `${face}: nothing was read`).toBe(0);
        }
      });

      it('the dry-run door refuses what the query door refuses', async () => {
        for (const [member, param, path, object] of UNDECLARED) {
          const err = await services.native!.generateSql(queryFor(member, param)).then(
            () => undefined,
            (e) => e as Refusal,
          );
          expect(err?.code, `${member}: ${err?.message}`).toBe('INVALID_FIELD');
          expect(err?.status, member).toBe(400);
          expect(err?.field, member).toBe(path);
          expect(err?.object, member).toBe(object);
        }
      });

      it('the scalar column over the same undeclared-join path is served: one group per owner, and its distinct count', async () => {
        for (const face of FACES) {
          const { res, err } = await read(face, queryFor('owner_email', 'dimensions'));
          expect(err, `${face}: ${err?.message}`).toBeUndefined();
          const groups = (res!.rows as Array<Record<string, unknown>>)
            .map((r) => [String(r.owner_email), Number(r.count)] as const)
            .sort(([a], [b]) => a.localeCompare(b));
          expect(groups, face).toEqual([['p1@example.com', 1], ['p2@example.com', 1], ['p3@example.com', 1]]);
        }
        const { res, err } = await read('native', queryFor('owner_email_distinct', 'measures'));
        expect(err, err?.message).toBeUndefined();
        expect(Number(res!.rows[0]!.owner_email_distinct)).toBe(3);
      });
    },
  );
}
