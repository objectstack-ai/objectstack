// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20874] `$contains` / `$notContains` on a DECLARED JSON-stored field ask
 * MEMBERSHIP on every face of `driver-memory` — the rows `driver-sql` answers.
 *
 * ## The defect, measured on `origin/main` `f6ccca4a` before the diff
 *
 * The query path lowered `$contains` to an escaped `$regex`, and mingo applies
 * a `$regex` to EACH ELEMENT of an array value, so a stored array answered by
 * per-element substring. The analytics face borrowed the same pattern
 * (`filterSubstringPattern`) and wrapped it in a `$regex` of its own:
 *
 * | `where` | memory, before | SQLite (`driver-sql`) | memory, now |
 * |:--|:--|:--|:--|
 * | `{ owners: { $contains: 'u1' } }` over `['u1','u2']`, `['u10']`, `['u3','u1']`, `[]` | 1, **2**, 3 | 1, 3 | 1, 3 |
 * | `{ owners: { $notContains: 'u1' } }` | 4 — **2 dropped** | 2, 4 | 2, 4 |
 * | `{ tags_: { $contains: 'red' } }` over `['red','blue']`, `['redwood']` | 1, **2** | 1 | 1 |
 * | `{ nums: { $contains: '1' } }` over `[1, 2]` (a number member) | **none** | 1 | 1 |
 * | the analytics face, the same three | the query path's answer | — | the query path's answer |
 *
 * Measured through `engine.find` too, with the nested-relation filter
 * `{ owners: { region: 'NA' } }` on a multi-valued lookup (owner `u1` is NA,
 * `u10` is EU): `d1`, `d3`, **`d5`** before; `d1`, `d3` now, and its `$not`
 * admits `d5` again. That engine run was a one-off: this package may not
 * import the engine and the engine's packages may not import this driver
 * (`check:driver-memory-census`), so what is pinned here is the driver input
 * the engine sends — an `$or` of one `$contains` per related id, asserted by
 * `@objectstack/objectql`'s `engine-nested-relation-lowering.test.ts`.
 *
 * ## The fork is the DECLARED field, never the row
 *
 * The contract (`FILTER_OPERATORS`' `$contains` docblock in `@objectstack/spec`)
 * selects the question by the COLUMN: a `multiple: true` field or a
 * JSON-stored type asks membership, a scalar string column asks substring.
 * `driver-sql` forks on its JSON-column registry, filled from the declaration;
 * this driver forks on the declaration `syncSchema` recorded. The two readings
 * part on exactly one kind of row, and SQLite decides it: a declared `json`
 * field holding the SCALAR string `'u1'` answers no member there (its
 * constructs are array-only), where a fork read off the row would have
 * answered it by substring. Fixture two holds that row.
 *
 * ## Why the rows are literal, and mirror `driver-sql`'s
 *
 * Fixture one is `driver-sql`'s `sql-driver-17590-json-column-membership.test.ts`
 * fixture row for row, and the expected ids are that file's, which run on
 * SQLite and on live PostgreSQL and MySQL. Fixture two's ids were measured on
 * `driver-sql`/SQLite over the same rows before this file was written. The two
 * packages cannot import one fixture (neither depends on the other), so the
 * shared answer is the literal row set — the same way that file holds its three
 * dialect cells to one another. `FILTER_TEXT_CASES` is not the carrier: it has
 * no array column, and `driver-mongodb`, which imports every row of it, lowers
 * `$contains` to a native `$regex` that MongoDB also applies per element.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

const byId = (a: string, b: string) => a.localeCompare(b);

/** `driver-sql`'s commit e04a0aff2 fixture, plus its #20874 `owners` column. */
const MEMBERSHIP = {
  object: 'mem20874_membership',
  fields: {
    label: { type: 'text' },
    tags_: { type: 'tags' },
    picks: { type: 'multiselect' },
    nums: { type: 'select', multiple: true },
    owners: { type: 'lookup', reference: 'mem20874_owner', multiple: true },
  },
  rows: [
    { id: '1', label: 'redwood', tags_: ['red', 'blue'], picks: ['a', 'b'], nums: [1, 2], owners: ['u1', 'u2'] },
    { id: '2', label: 'red', tags_: ['redwood'], picks: ['ab'], nums: [10, 21], owners: ['u10'] },
    { id: '3', label: 'blue', tags_: ['blue'], picks: ['b'], nums: [2], owners: ['u3', 'u1'] },
    { id: '4', label: 'none', tags_: [], picks: [], nums: [], owners: [] },
  ],
} as const;

/**
 * Stored SHAPES the membership reading has to get right, each answered by
 * `driver-sql`/SQLite as recorded in {@link SHAPE_CASES}: a declared `json`
 * field holding an array, a scalar, an object, a NESTED array, a `null` member,
 * a boolean and a fractional number, and a NULL row.
 */
const SHAPES = {
  object: 'mem20874_shapes',
  fields: {
    label: { type: 'text' },
    blob: { type: 'json' },
    picks: { type: 'multiselect' },
  },
  rows: [
    { id: 'e1', label: 'x', blob: ['u1'], picks: ['a'] },
    { id: 'e2', label: 'x', blob: 'u1', picks: ['true'] },
    { id: 'e3', label: 'x', blob: { k: 'u1' }, picks: [] },
    { id: 'e4', label: 'x', blob: [['u1']], picks: ['null'] },
    { id: 'e5', label: 'x', blob: [null], picks: [] },
    { id: 'e6', label: 'x', blob: [true, 1.5], picks: [] },
    { id: 'e7', label: 'x', blob: null, picks: null },
    { id: 'e8', label: 'x', blob: [[null]], picks: [] },
    { id: 'e9', label: 'x', blob: [''], picks: [''] },
  ],
} as const;

type Fixture = typeof MEMBERSHIP | typeof SHAPES;
type Case = readonly [name: string, where: FilterCondition, expected: readonly string[]];

/** Fixture one — `driver-sql`'s commit e04a0aff2 assertions, verbatim, and #20874's. */
const MEMBERSHIP_CASES: readonly Case[] = [
  ['tags: the member row, never the substring row', { tags_: { $contains: 'red' } }, ['1']],
  ['tags: a whole member', { tags_: { $contains: 'redwood' } }, ['2']],
  ['tags: two member rows', { tags_: { $contains: 'blue' } }, ['1', '3']],
  ['tags: a substring of a member is no member', { tags_: { $contains: 'wood' } }, []],
  ['multiselect: the member row', { picks: { $contains: 'a' } }, ['1']],
  ['multiselect: a whole member', { picks: { $contains: 'ab' } }, ['2']],
  ['multiselect: two member rows', { picks: { $contains: 'b' } }, ['1', '3']],
  ['number members are named by their text', { nums: { $contains: '1' } }, ['1']],
  ['number members, two rows', { nums: { $contains: '2' } }, ['1', '3']],
  ['number members: 10 is not 1', { nums: { $contains: '10' } }, ['2']],
  ['number members: a digit of a member is no member', { nums: { $contains: '0' } }, []],
  ['lookup: u1 is not a member of [u10] (the card)', { owners: { $contains: 'u1' } }, ['1', '3']],
  ['lookup: u10 is its own member', { owners: { $contains: 'u10' } }, ['2']],
  ['lookup: $notContains admits [u10] and []', { owners: { $notContains: 'u1' } }, ['2', '4']],
  ['a SCALAR text column keeps the substring test (the control)', { label: { $contains: 'red' } }, ['1', '2']],
  ['a SCALAR text column, the other control', { label: { $contains: 'wood' } }, ['1']],
];

/** Fixture two — each answer measured on `driver-sql`/SQLite over the same rows. */
const SHAPE_CASES: readonly Case[] = [
  ['json: only a TOP-LEVEL element is a member — not a scalar, an object or a nested array', { blob: { $contains: 'u1' } }, ['e1']],
  ['json: $notContains is the exact complement, the NULL row included', { blob: { $notContains: 'u1' } }, ['e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9']],
  ["json: 'null' names a null member, never one inside a nested array", { blob: { $contains: 'null' } }, ['e5']],
  ["json: 'true' names a boolean member", { blob: { $contains: 'true' } }, ['e6']],
  ["json: '1.50' names the number 1.5", { blob: { $contains: '1.50' } }, ['e6']],
  ['json: the empty string names an empty-string member only', { blob: { $contains: '' } }, ['e9']],
  ["multiselect: 'true' names the STRING member too", { picks: { $contains: 'true' } }, ['e2']],
  ["multiselect: 'null' names the STRING member too", { picks: { $contains: 'null' } }, ['e4']],
  ['multiselect: the empty string', { picks: { $contains: '' } }, ['e9']],
  ['multiselect: $notContains, the NULL and empty rows included', { picks: { $notContains: 'a' } }, ['e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9']],
];

const FIXTURES: ReadonlyArray<readonly [Fixture, readonly Case[]]> = [
  [MEMBERSHIP, MEMBERSHIP_CASES],
  [SHAPES, SHAPE_CASES],
];

async function seed(fixture: Fixture, { declare = true } = {}): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver();
  if (declare) await driver.syncSchema(fixture.object, { name: fixture.object, fields: fixture.fields });
  for (const row of fixture.rows) await driver.create(fixture.object, structuredClone({ ...row }));
  return driver;
}

const findIds = async (driver: InMemoryDriver, object: string, where: unknown): Promise<string[]> =>
  ((await driver.find(object, { where: where as any })) as any[]).map((r) => String(r.id)).sort(byId);

/** The single-field, single-operator case as the AST node the other spelling takes. */
function astOf(where: FilterCondition): unknown {
  const [field, ops] = Object.entries(where)[0] as [string, Record<string, unknown>];
  const [op, value] = Object.entries(ops)[0] as [string, unknown];
  const operator = op === '$contains' ? 'contains' : op === '$notContains' ? 'not_contains' : null;
  if (!operator) throw new Error(`no AST spelling for ${op} in this file`);
  return { type: 'comparison', field, operator, value };
}

function cubeOf(fixture: Fixture): Cube {
  const dimensions: Record<string, unknown> = { id: { label: 'Id', type: 'string', sql: 'id' } };
  for (const field of Object.keys(fixture.fields)) dimensions[field] = { label: field, type: 'string', sql: field };
  return {
    name: 'members',
    title: 'Members',
    sql: fixture.object,
    measures: { count: { label: 'Count', type: 'count', sql: 'id' } },
    dimensions,
  } as unknown as Cube;
}

const analyticsQuery = (where: unknown) =>
  ({ cube: 'members', measures: ['members.count'], dimensions: ['members.id'], where }) as any;

for (const [fixture, cases] of FIXTURES) {
  describe(`[#20874] ${fixture.object} — $contains on a declared JSON-stored field is membership, on every face`, () => {
    let driver: InMemoryDriver;
    let service: MemoryAnalyticsService;
    beforeAll(async () => {
      driver = await seed(fixture);
      service = new MemoryAnalyticsService({ driver, cubes: [cubeOf(fixture)] });
    });

    it('stored every row — the premise of every answer below', async () => {
      expect(await findIds(driver, fixture.object, {})).toEqual(fixture.rows.map((r) => r.id).sort(byId));
    });

    for (const [name, where, expected] of cases) {
      it(`query path: ${name}`, async () => {
        expect(await findIds(driver, fixture.object, where)).toEqual([...expected]);
      });

      it(`query path, AST spelling: ${name}`, async () => {
        expect(await findIds(driver, fixture.object, astOf(where))).toEqual([...expected]);
      });

      it(`count(): ${name}`, async () => {
        expect(await driver.count(fixture.object, { where: where as any })).toBe(expected.length);
      });

      // The invariant across this package's faces: the same row set as
      // `find()`, never a third, quieter answer (#5374).
      it(`analytics face: ${name}`, async () => {
        const result = await service.query(analyticsQuery(where));
        expect(result.rows.map((r: any) => String(r['members.id'])).sort(byId)).toEqual([...expected]);
      });
    }
  });
}

/**
 * The analytics face's SQL ECHO, EXECUTED — on a real SQLite engine (sql.js)
 * over the same rows in `driver-sql`'s stored form (a JSON-stored field holds
 * its JSON text). The echo's job is reproducing execution
 * (`memory-analytics-echo-operator-coverage.test.ts`), so once the `$match` it
 * describes asks membership, a `GLOB '*u1*'` echo over the text `["u10"]` would
 * return the row the chart excludes.
 */
describe('[#20874] the analytics echo renders the membership that ran', () => {
  const echoes: Array<{ fixture: Fixture; cases: readonly Case[]; db: any; service: MemoryAnalyticsService }> = [];

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    // sql.js locates its own `.wasm` under Node; the explicit path is the
    // echo-coverage file's belt-and-braces, taken when it resolves.
    let locateFile: ((file: string) => string) | undefined;
    try {
      const { createRequire } = await import('node:module');
      const { dirname, join } = await import('node:path');
      const dir = dirname(createRequire(import.meta.url).resolve('sql.js/package.json'));
      locateFile = (file: string) => join(dir, 'dist', file);
    } catch {
      locateFile = undefined;
    }
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);
    for (const [fixture, cases] of FIXTURES) {
      const columns = ['id', ...Object.keys(fixture.fields)];
      const db = new SQL.Database();
      db.run(`CREATE TABLE ${fixture.object} (${columns.map((c) => `${c} TEXT`).join(', ')});`);
      const insert = db.prepare(`INSERT INTO ${fixture.object} VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of fixture.rows as ReadonlyArray<Record<string, unknown>>) {
        insert.run(columns.map((c) => {
          const v = row[c];
          if (c === 'id' || c === 'label') return v;
          return v == null ? null : JSON.stringify(v);
        }));
      }
      insert.free();
      const driver = await seed(fixture);
      echoes.push({ fixture, cases, db, service: new MemoryAnalyticsService({ driver, cubes: [cubeOf(fixture)] }) });
    }
  });

  const echoIds = async (db: any, service: MemoryAnalyticsService, where: unknown): Promise<string[]> => {
    const { sql } = await service.generateSql(analyticsQuery(where));
    const stmt = db.prepare(sql);
    const out: string[] = [];
    while (stmt.step()) out.push(String(Object.values(stmt.getAsObject())[0]));
    stmt.free();
    return out.sort(byId);
  };

  it('the SQLite engine has json_each and both tables hold every row (the premise)', async () => {
    for (const { fixture, db, service } of echoes) {
      expect(db.exec(`SELECT count(*) FROM json_each('[1,2]')`)[0].values[0][0]).toBe(2);
      expect(await echoIds(db, service, {})).toEqual(fixture.rows.map((r) => r.id).sort(byId));
    }
  });

  it('every case: the echoed statement returns the rows the face executed', async () => {
    for (const { cases, db, service } of echoes) {
      for (const [name, where, expected] of cases) {
        expect(await echoIds(db, service, where), name).toEqual([...expected]);
      }
    }
  });

  it('a JSON-stored column echoes the membership construct, a scalar column the GLOB it always did', async () => {
    const { service } = echoes[0]!;
    const member = (await service.generateSql(analyticsQuery({ owners: { $contains: 'u1' } }))).sql;
    expect(member).toContain('json_each(CASE WHEN json_valid(owners)');
    expect(member).toContain(`IN ('"u1"')`);
    expect(member).not.toContain('GLOB');
    const negated = (await service.generateSql(analyticsQuery({ owners: { $notContains: 'u1' } }))).sql;
    expect(negated).toContain('(owners IS NULL OR NOT EXISTS (');
    const scalar = (await service.generateSql(analyticsQuery({ label: { $contains: 'red' } }))).sql;
    expect(scalar).toContain("label GLOB '*red*'");
  });
});

/**
 * The nested-relation filter on a multi-valued relation, as the engine hands it
 * to a driver: an `$or` of one `$contains` per related id, and its `$not`.
 * With owner `u1` the only NA owner, `{ owners: { region: 'NA' } }` becomes the
 * first `where` below — and the row holding `['u10']` must not answer it.
 */
describe('[#20874] the nested-relation lowering, as a driver receives it', () => {
  let driver: InMemoryDriver;
  beforeAll(async () => { driver = await seed(MEMBERSHIP); });

  it('an $or of $contains per related id answers the member rows only', async () => {
    expect(await findIds(driver, MEMBERSHIP.object, { $or: [{ owners: { $contains: 'u1' } }] })).toEqual(['1', '3']);
    expect(await findIds(driver, MEMBERSHIP.object, { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u2' } }] }))
      .toEqual(['1', '3']);
  });

  it('its $not admits the row whose id only PREFIXES a member, and the empty row', async () => {
    expect(await findIds(driver, MEMBERSHIP.object, { $not: { $or: [{ owners: { $contains: 'u1' } }] } })).toEqual(['2', '4']);
  });
});

/**
 * The population is the DECLARATION. A field with none keeps the substring
 * reading it always had — `driver-sql` answers a table it was never told about
 * the same way — so the scalar control holds on an undeclared object too.
 */
describe('[#20874] the fork is the declared field', () => {
  it('a scalar text column keeps substring whether or not the object was declared', async () => {
    for (const declare of [true, false]) {
      const driver = await seed(MEMBERSHIP, { declare });
      expect(await findIds(driver, MEMBERSHIP.object, { label: { $contains: 'red' } }), `declare=${declare}`).toEqual(['1', '2']);
    }
  });

  it('a declared json field holding a SCALAR string has no member — the row a value-shape fork would answer', async () => {
    const driver = await seed(SHAPES);
    expect(await findIds(driver, SHAPES.object, { blob: { $contains: 'u1' } })).not.toContain('e2');
    expect(await findIds(driver, SHAPES.object, { blob: { $notContains: 'u1' } })).toContain('e2');
  });
});
