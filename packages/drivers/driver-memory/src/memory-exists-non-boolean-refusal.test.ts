// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20897] `$exists` takes a boolean. A non-boolean is refused on EVERY entry
 * of this package, in `driver-sql`'s words — the `$null` twin's disposition
 * (#5347-A), applied to `$exists` by the ruling on #5298 (#5369).
 *
 * # What was measured
 *
 * `FieldOperatorsSchema` declares `$exists: z.boolean()`, and nothing between an
 * authored `where` and this driver validated it: `driver-sql`, `driver-sqlite-wasm`
 * and both Turso transports refused a non-boolean, and this package did not.
 * Measured on `origin/main` `f6ccca4a`, one row with `stage: 'won'` (id 1) and
 * one with `stage: null` (id 2):
 *
 * | entry | `'yes'` | `1` | `'false'` | `0` / `null` |
 * |---|---|---|---|---|
 * | `find` / `findOne` / `count` / `aggregate` / `updateMany` / `deleteMany` | id 2 | id 2 | id 2 | id 2 |
 * | the analytics (cube) face, `query()` | id 1 | id 1 | id 1 | id 2 |
 *
 * Two answers inside one package, and neither is a refusal. The query path's
 * `val === true` test sent every third value to the NO-value side — `'yes'`
 * asked for the rows without one, the author's intent inverted. The cube face's
 * `set` arm read the same flag by truthiness, so it answered the opposite rows
 * for `'yes'` and `1` — and for the string `'false'`, which is truthy.
 *
 * # Why every entry is asserted, and against `find()`
 *
 * The refusal lives in ONE function (`assertFilterConditionShape`), which every
 * entry runs before it lowers anything. What would let a future change re-fork
 * the answers is an entry reaching its lowering WITHOUT that walk — the cube
 * face's truthiness arm is still there behind it. So each entry is asserted to
 * refuse, and, for the two booleans the spec declares, to answer exactly the
 * rows `find()` answers: the same row set as `find()`, or refused with
 * `INVALID_FILTER` — never a third, quieter answer.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';

import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const ROWS = [
  { id: '1', stage: 'won', score: 10 },
  // The null-valued row that separates "has a value" from "has none".
  { id: '2', stage: null, score: 20 },
];

/**
 * The exact leading sentence `driver-sql` produces for this condition, copied
 * from `sql-driver.ts`'s `nonBooleanExistsComparandError`. A literal rather
 * than an import: this package does not depend on driver-sql (and must not),
 * so one condition, one wording (#5240) is held by pinning the other side's
 * text here.
 */
const DRIVER_SQL_LEADING_SENTENCE = (field: string) =>
  `Operator "$exists" on field "${field}" requires a boolean comparand (true or false).`;

/**
 * The triage pins (`'yes'`, `1`, the string `'false'`), then the rest of the
 * battery `driver-sql`'s own `$exists` pins run — so the two backends are held
 * to the same inputs.
 */
const NON_BOOLEAN: Array<[label: string, value: unknown]> = [
  ["the string 'yes'", 'yes'],
  ['the number 1', 1],
  ["the STRING 'false'", 'false'],
  ['the number 0', 0],
  ['null', null],
  ['undefined', undefined],
  ['an object', {}],
];

const CUBE = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { total: { label: 'Total', type: 'count', sql: 'id' } },
  dimensions: {
    id: { label: 'Id', type: 'string', sql: 'id' },
    stage: { label: 'Stage', type: 'string', sql: 'stage' },
  },
  public: true,
} as never;

describe('[#20897] a non-boolean $exists is refused on every entry of driver-memory', () => {
  let driver: InMemoryDriver;
  let analytics: MemoryAnalyticsService;

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.syncSchema('deal', {
      fields: {
        id: { type: 'text', name: 'id' },
        stage: { type: 'text', name: 'stage' },
        score: { type: 'number', name: 'score' },
      },
    } as any);
    for (const row of ROWS) await driver.create('deal', { ...row });
    analytics = new MemoryAnalyticsService({ driver, cubes: [CUBE] } as never);
  });

  const sorted = (rows: unknown): string[] => (rows as Array<Record<string, unknown>>).map((r) => String(r.id)).sort();
  const q = (where: unknown) => ({ where: where as FilterCondition });
  const cubeQuery = (where: unknown) =>
    ({ cube: 'deals', measures: ['total'], dimensions: ['id'], where }) as never;

  /**
   * Every entry of this package that takes a `where`, by name, with the root its
   * refusal names and whether the shared comparand-TYPE face runs ahead of the
   * gate there. The analytics face runs it first (its door, ADR-0053 D-D1), so
   * a flag that face refuses on TYPE — `undefined`, a plain object — keeps that
   * face's own sentence, the precedence the analytics `where` door and the
   * engine seam give it too; the envelope and the position are the same.
   */
  const ENTRIES: Array<[name: string, run: (where: unknown) => Promise<unknown>, path: string, typeFaceFirst: boolean]> = [
    ['find', (w) => driver.find('deal', q(w)), 'filter', false],
    ['findOne', (w) => driver.findOne('deal', q(w)), 'filter', false],
    ['count', (w) => driver.count('deal', q(w)), 'filter', false],
    ['aggregate', (w) => driver.aggregate('deal', { ...q(w), aggregations: [{ function: 'count', alias: 'n' }] } as never), 'filter', false],
    ['updateMany', (w) => driver.updateMany('deal', q(w), { score: 99 }), 'filter', false],
    ['deleteMany', (w) => driver.deleteMany('deal', q(w)), 'filter', false],
    ['the analytics face, query()', (w) => analytics.query(cubeQuery(w)), 'where', true],
    ['the analytics face, generateSql()', (w) => analytics.generateSql(cubeQuery(w)), 'where', true],
  ];

  /** The comparands the comparand-TYPE face refuses before any flag rule is asked. */
  const TYPE_FACE_REFUSED: ReadonlySet<unknown> = new Set<unknown>([undefined]);
  const isTypeFaceRefused = (value: unknown): boolean =>
    TYPE_FACE_REFUSED.has(value) || (typeof value === 'object' && value !== null);

  const refusalOf = async (run: () => Promise<unknown>): Promise<WireBearingError> => {
    try {
      await run();
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected this entry to refuse the filter, but it resolved');
  };

  for (const [entry, run, root, typeFaceFirst] of ENTRIES) {
    for (const [label, value] of NON_BOOLEAN) {
      const words = typeFaceFirst && isTypeFaceRefused(value) ? 'the type face\'s words' : 'driver-sql\'s words';
      it(`${entry} refuses ${label} with INVALID_FILTER / 400, in ${words}`, async () => {
        const err = await refusalOf(() => run({ stage: { $exists: value } }));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`${root}.stage.$exists`);
        // The type face's sentence is its own contract, pinned in its own
        // suite; here only the flag rule's first sentence is load-bearing.
        if (!(typeFaceFirst && isTypeFaceRefused(value))) {
          expect(err.message).toContain(DRIVER_SQL_LEADING_SENTENCE('stage'));
        }
      });
    }
  }

  it('refuses it at every depth, and a satisfiable sibling does not let it through', async () => {
    // The gate is a WALK, not an evaluation: `{ stage: 'won' }` matches and
    // `{}` is the TRUE identity, yet neither short-circuits the refusal.
    for (const [where, at] of [
      [{ $and: [{ stage: { $exists: 'yes' } }] }, 'filter.$and[0].stage.$exists'],
      [{ $or: [{ stage: 'won' }, { stage: { $exists: 1 } }] }, 'filter.$or[1].stage.$exists'],
      [{ $or: [{}, { stage: { $exists: 'false' } }] }, 'filter.$or[1].stage.$exists'],
      [{ $not: { stage: { $exists: 'yes' } } }, 'filter.$not.stage.$exists'],
    ] as Array<[unknown, string]>) {
      const err = await refusalOf(() => driver.find('deal', q(where)));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain(at);
    }
  });

  it('a refused write leaves the store untouched', async () => {
    await refusalOf(() => driver.updateMany('deal', q({ stage: { $exists: 'yes' } }), { score: 99 }));
    await refusalOf(() => driver.deleteMany('deal', q({ stage: { $exists: 1 } })));
    const rows = (await driver.find('deal', {} as never)) as Array<Record<string, unknown>>;
    expect(rows.map((r) => [String(r.id), r.score]).sort()).toEqual([['1', 10], ['2', 20]]);
  });

  describe('the control: true and false answer find()\'s rows on every read entry', () => {
    for (const [flag, expected] of [[true, ['1']], [false, ['2']]] as Array<[boolean, string[]]>) {
      it(`$exists: ${flag} selects ${JSON.stringify(expected)}, and every read entry agrees with find()`, async () => {
        const where = { stage: { $exists: flag } };
        const found = sorted(await driver.find('deal', q(where)));
        expect(found).toEqual(expected);
        expect(await driver.count('deal', q(where))).toBe(expected.length);
        expect(String((await driver.findOne('deal', q(where)) as Record<string, unknown>).id)).toBe(expected[0]);
        const cube = (await analytics.query(cubeQuery(where))).rows as Array<Record<string, unknown>>;
        expect(cube.map((r) => String(r.id)).sort()).toEqual(found);
      });
    }
  });
});
