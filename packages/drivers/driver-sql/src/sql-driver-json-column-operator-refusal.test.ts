// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7398] A DECLARED operator against a column type it cannot apply to is
 * refused, loudly, instead of compiling to a silently wrong answer.
 *
 * `driver-sql` stores a `multiple: true` field — and every other
 * `JSON_COLUMN_TYPES` field — as a JSON TEXT column. The equality family lowered
 * straight to SQL against that text with no column-type consultation, so on the
 * issue's fixture (ONE row whose `members` holds `["U1","U2"]`):
 *
 * | filter                    | before        | direction   |
 * |---------------------------|---------------|-------------|
 * | `{members:{$in:[U1]}}`    | 0 rows, `200` | fail-CLOSED |
 * | `{members:{$eq:U1}}`      | 0 rows, `200` | fail-CLOSED |
 * | `{members: U1}` (bare)    | 0 rows, `200` | fail-CLOSED |
 * | `{members:{$nin:[U1]}}`   | **1 row**     | fail-OPEN ⚠️ |
 * | `{members:{$ne:U1}}`      | **1 row**     | fail-OPEN ⚠️ |
 * | `{members:{$lte:U1}}`     | **1 row**     | just WRONG  |
 * | `{members:{$contains:U1}}`| 1 row         | ✅ correct  |
 *
 * The `$nin` line is why this is a defect and not a footgun. `members not in
 * ('U1')` is TRUE — the stored text genuinely is not equal to that id — so
 * "exclude these" compiled to "return everything". An exclusion that silently
 * stops excluding WIDENS a result set, which is the direction #3948 / #4209 /
 * #5347 all ruled outranks a narrowing one; the issue's downstream delete-guard
 * (`{ assignees: { $in: memberIds } }`) never fired once since it shipped, and
 * a `200` with `[]` is byte-identical to a query that legitimately matched
 * nothing, so nothing existed for a caller to key on.
 *
 * `$lte` is worth its own row: the answers were never merely empty. `["usr_…"`
 * sorts below `usr_…` on the leading `[`, so the ordering comparisons return a
 * lexicographic verdict over a *serialization*.
 *
 * ## What these tests pin
 *
 * 1. **The refusal**, per operator and per FACE. #6203's one-query-two-answers
 *    rule: a filter refused by `find` and compiled by `count` is two answers to
 *    one question, so every face that lowers a filter is swept —
 *    `find`/`findOne`/`count`/`aggregate`/`distinct` and the where-clauses of
 *    `updateMany`/`deleteMany`.
 * 2. **`$contains` unchanged**, on the same fixture and the same faces. It is
 *    the only working membership spelling and downstream code depends on it, so
 *    it is pinned on both sides of the change.
 * 3. **Both lowering families.** A managed `multiple: true` lookup is served by
 *    the plain-column arms (`whereIn` / `orWhereNotIn` / `where(f, op, v)`);
 *    a `multiple: true` DATETIME column on an EXTERNAL object (ADR-0015) is
 *    served by `applyNormalizedComparison`'s normalised `whereRaw` arms
 *    instead, because `registerExternalObject` never marks its datetime columns
 *    canonical and `needsLegacyDatetimeRepair` therefore stays true. Both were
 *    measured wrong the same way before this gate; a gate in only one of them
 *    leaves the other silently wrong, which is what makes the external cell a
 *    POSITIVE CONTROL on the site enumeration rather than a second example.
 * 4. **A closed-world sweep over `FILTER_OPERATORS`**, so a newly declared
 *    operator or a newly added lowering site cannot join the silent set without
 *    turning this file red.
 *
 * Out of scope by the dispatch's ruling: the issue's ask 2 (`$overlaps` /
 * `$containsAny`), which would open the closed `FILTER_OPERATORS` set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqlDriver } from '../src/index.js';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import type { FilterCondition } from '@objectstack/spec/data';

const U1 = 'usr_1111';
const U2 = 'usr_2222';

/** The shape `mapDataError` / `sendError` read off a thrown driver error. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

async function refusalOf(run: () => Promise<unknown>): Promise<WireBearingError> {
  try {
    await run();
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the driver to refuse this filter, but it resolved');
}

/**
 * Every assertion this file makes about a refusal, in one place: the ADR-0112
 * wire identity AND the actionable content. Never a bare `toThrow` (#6144) —
 * a refusal with no `code` is the #4436 defect, and one that does not name the
 * working spelling sends its author back for another round-trip.
 */
function expectJsonColumnRefusal(err: WireBearingError, op: string, field: string): void {
  expect(err.code).toBe('INVALID_FILTER');
  expect(err.status).toBe(400);
  expect(err.message).not.toContain('[sql-driver]');
  expect(err.message).toContain(op);
  expect(err.message).toContain(field);
  // The three things the message owes a caller: that the filter did NOT run,
  // why (the column is JSON text), and what to write instead.
  expect(err.message).toContain('WAS NOT APPLIED');
  expect(err.message).toContain('JSON TEXT column');
  expect(err.message).toContain('$contains');
}

/**
 * The refused operators, each with a comparand of the shape its own schema
 * declares — so a failure here is always the column-type gate, never a
 * comparand-shape refusal wearing its message.
 */
const REFUSED: ReadonlyArray<readonly [op: string, comparand: unknown]> = [
  ['$eq', U1],
  ['$ne', U1],
  ['$gt', U1],
  ['$gte', U1],
  ['$lt', U1],
  ['$lte', U1],
  ['$in', [U1]],
  ['$nin', [U1]],
  // Not in the card's stated minimum set, refused deliberately: `$between` IS
  // `>= AND <=`, and this driver decomposes a calendar-day `$between` into
  // `$gte`/`$lt` a few lines above the emitter. Refusing the halves while
  // compiling the compound would leave the same wrong answer alive at one more
  // spelling — the reasoning #5234 already applied in this file.
  ['$between', [U1, U2]],
];

/**
 * The operators that MUST keep working on a JSON column. The `LIKE` family
 * matches the serialization as text (which is how `$contains` works at all),
 * and the null predicates ask about the column's presence — a well-formed
 * question whatever the column holds.
 */
const KEPT: ReadonlyArray<readonly [op: string, comparand: unknown]> = [
  ['$contains', U1],
  ['$notContains', 'nobody'],
  ['$startsWith', '['],
  ['$endsWith', ']'],
  ['$icontains', U1],
  ['$null', false],
  ['$exists', true],
];

describe('[#7398] SqlDriver refuses scalar-comparison operators on JSON/multi-value columns', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'team',
        fields: {
          id: { type: 'text', name: 'id' },
          name: { type: 'text', name: 'name' },
          // The issue's own fixture column: a multi-value lookup.
          members: { type: 'lookup', name: 'members', multiple: true },
          // The single-value control from the issue's second table.
          owner: { type: 'lookup', name: 'owner' },
          // A STRUCTURED-JSON column (not `multiple`), for the predicate
          // decision pinned in its own block below.
          address: { type: 'address', name: 'address' },
        },
      } as any,
    ]);
    await driver.create('team', {
      id: 't1',
      name: 'Alpha',
      members: [U1, U2],
      owner: U1,
      address: { city: 'Beijing' },
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const find = (where: unknown) => driver.find('team', { where: where as FilterCondition });

  // ── The card's table, flipped ─────────────────────────────────────────────

  describe('the issue\'s measured table', () => {
    it('the fixture really is stored as JSON text — the premise the rest rests on', async () => {
      const raw = await (driver as any).knex('team').select('members').first();
      expect(raw.members).toBe(JSON.stringify([U1, U2]));
    });

    for (const [op, comparand] of REFUSED) {
      it(`{ members: { "${op}": … } } → 400 INVALID_FILTER`, async () => {
        const err = await refusalOf(() => find({ members: { [op]: comparand } }));
        expectJsonColumnRefusal(err, op, 'members');
      });
    }

    it('bare equality { members: value } → 400 INVALID_FILTER', async () => {
      const err = await refusalOf(() => find({ members: U1 }));
      expectJsonColumnRefusal(err, '=', 'members');
      expect(err.message).toContain('bare equality');
    });

    it('bare equality reached through the OPERATOR walk is refused identically', async () => {
      // A sibling key carrying an operator routes the whole node to
      // `applyFilterCondition`, whose bare-value branch is a SECOND compilation
      // of `{ field: value }`. One condition, one verdict — whatever the
      // siblings look like.
      const err = await refusalOf(() => find({ members: U1, name: { $eq: 'Alpha' } }));
      expectJsonColumnRefusal(err, '=', 'members');
    });

    it('$nin — the fail-OPEN half — no longer returns the row it was asked to exclude', async () => {
      const err = await refusalOf(() => find({ members: { $nin: [U1] } }));
      expectJsonColumnRefusal(err, '$nin', 'members');
      // The regression this refusal replaces, stated so the intent survives a
      // future reading of the file: this filter used to answer `['t1']` — the
      // one row whose `members` CONTAINS U1.
      const contained = await find({ members: { $contains: U1 } });
      expect(contained.map((r: any) => r.id)).toEqual(['t1']);
    });
  });

  // ── The spelling that must NOT change ─────────────────────────────────────

  describe('$contains and friends keep working, unchanged', () => {
    it('$contains matches each member', async () => {
      expect((await find({ members: { $contains: U1 } })).map((r: any) => r.id)).toEqual(['t1']);
      expect((await find({ members: { $contains: U2 } })).map((r: any) => r.id)).toEqual(['t1']);
    });

    it('$contains for a member that is not there matches nothing', async () => {
      expect(await find({ members: { $contains: 'usr_9999' } })).toEqual([]);
    });

    it('an $or of $contains is the any-of spelling, and it still compiles', async () => {
      const rows = await find({
        $or: [{ members: { $contains: U1 } }, { members: { $contains: 'usr_9999' } }],
      });
      expect(rows.map((r: any) => r.id)).toEqual(['t1']);
    });

    it('$notContains excludes on the serialization', async () => {
      expect(await find({ members: { $notContains: U1 } })).toEqual([]);
      expect((await find({ members: { $notContains: 'usr_9999' } })).map((r: any) => r.id)).toEqual(['t1']);
    });

    for (const [op, comparand] of KEPT) {
      it(`"${op}" is not refused on a JSON column`, async () => {
        await expect(find({ members: { [op]: comparand } })).resolves.toBeInstanceOf(Array);
      });
    }
  });

  // ── The control: the same operators on ordinary columns ───────────────────

  describe('scalar columns are untouched', () => {
    it('$in on the single-value lookup still matches — the issue\'s own control row', async () => {
      expect((await find({ owner: { $in: [U1] } })).map((r: any) => r.id)).toEqual(['t1']);
    });

    for (const [op, comparand] of REFUSED) {
      it(`"${op}" still compiles against a text column`, async () => {
        await expect(find({ name: { [op]: comparand } })).resolves.toBeInstanceOf(Array);
      });
    }

    it('bare equality on a text column still compiles', async () => {
      expect((await find({ name: 'Alpha' })).map((r: any) => r.id)).toEqual(['t1']);
    });
  });

  // ── The predicate decision ────────────────────────────────────────────────

  describe('the gate keys on JSON STORAGE, not on `multiple` alone', () => {
    it('a structured-JSON column shows the identical defect, so it is refused too', async () => {
      // Measured on `main` before this change, on this very fixture:
      // `{address:{$eq:'Beijing'}}` → 0 rows, and `{address:{$nin:['Beijing']}}`
      // → the row — the same fail-open inversion as the array case, because the
      // mechanism is the JSON-text storage and not the array-ness.
      const eqErr = await refusalOf(() => find({ address: { $eq: 'Beijing' } }));
      expectJsonColumnRefusal(eqErr, '$eq', 'address');
      const ninErr = await refusalOf(() => find({ address: { $nin: ['Beijing'] } }));
      expectJsonColumnRefusal(ninErr, '$nin', 'address');
    });

    it('$null / $exists still answer on a JSON column — presence is a fair question', async () => {
      expect((await find({ address: { $exists: true } })).map((r: any) => r.id)).toEqual(['t1']);
      expect(await find({ address: { $null: true } })).toEqual([]);
    });
  });

  // ── Combinator depth ──────────────────────────────────────────────────────

  describe('the refusal holds at every depth', () => {
    it('inside $or', async () => {
      const err = await refusalOf(() => find({ $or: [{ name: 'Alpha' }, { members: { $in: [U1] } }] }));
      expectJsonColumnRefusal(err, '$in', 'members');
    });

    it('inside $and', async () => {
      const err = await refusalOf(() => find({ $and: [{ name: 'Alpha' }, { members: { $nin: [U1] } }] }));
      expectJsonColumnRefusal(err, '$nin', 'members');
    });

    it('inside $not', async () => {
      const err = await refusalOf(() => find({ $not: { members: { $eq: U1 } } }));
      expectJsonColumnRefusal(err, '$eq', 'members');
    });
  });

  // ── #6203: every face that lowers a filter ────────────────────────────────

  describe('every face that lowers a filter refuses alike', () => {
    const faces: ReadonlyArray<readonly [string, (where: FilterCondition) => Promise<unknown>]> = [
      ['find', (where) => driver.find('team', { where })],
      ['findOne', (where) => driver.findOne('team', { where })],
      ['count', (where) => driver.count('team', { where })],
      [
        'aggregate',
        (where) =>
          driver.aggregate('team', {
            where,
            aggregations: [{ function: 'count', field: '*', alias: 'n' }],
          }),
      ],
      ['distinct', (where) => driver.distinct('team', 'name', where)],
      ['updateMany', (where) => driver.updateMany('team', { where }, { name: 'Beta' })],
      ['deleteMany', (where) => driver.deleteMany('team', { where })],
    ];

    for (const [faceName, run] of faces) {
      describe(faceName, () => {
        for (const [op, comparand] of REFUSED) {
          it(`refuses "${op}"`, async () => {
            const err = await refusalOf(() => run({ members: { [op]: comparand } } as FilterCondition));
            expectJsonColumnRefusal(err, op, 'members');
          });
        }

        it('refuses bare equality', async () => {
          const err = await refusalOf(() => run({ members: U1 } as FilterCondition));
          expectJsonColumnRefusal(err, '=', 'members');
        });

        it('still serves $contains', async () => {
          if (faceName !== 'updateMany' && faceName !== 'deleteMany') {
            await expect(run({ members: { $contains: U1 } } as FilterCondition)).resolves.toBeDefined();
            return;
          }
          // The write faces are asserted on a scratch row rather than the
          // fixture, and on the ROW COUNT rather than on "it resolved": a
          // where-clause that reached no row would satisfy a bare resolve while
          // proving nothing about whether `$contains` still compiles there.
          await driver.create('team', {
            id: 'scratch',
            name: 'Scratch',
            members: ['usr_scratch'],
            owner: U1,
          });
          const affected = await run({ members: { $contains: 'usr_scratch' } } as FilterCondition);
          expect(affected).toBe(1);
          await driver.deleteMany('team', { where: { id: 'scratch' } });
        });
      });
    }

    it('the write faces really did not write — a refusal is not a half-applied mutation', async () => {
      const row = await driver.findOne('team', { where: { id: 't1' } });
      expect(row.name).toBe('Alpha');
      expect(await driver.count('team', {})).toBe(1);
    });
  });

  // ── The closed-world control on the site enumeration ──────────────────────

  describe('closed-world sweep over the declared vocabulary', () => {
    /** A comparand of the shape each declared operator's own schema wants. */
    const comparandFor: Record<string, unknown> = {
      ...Object.fromEntries(REFUSED),
      ...Object.fromEntries(KEPT),
    };

    it('every declared FILTER_OPERATOR is either refused here or on the keep-working list', async () => {
      const refused: string[] = [];
      const compiled: string[] = [];
      for (const op of FILTER_OPERATORS) {
        expect(
          Object.prototype.hasOwnProperty.call(comparandFor, op),
          `FILTER_OPERATORS gained "${op}" and this sweep has no comparand for it — decide ` +
            `whether it is meaningful against a JSON TEXT column and add it to REFUSED or KEPT.`,
        ).toBe(true);
        try {
          await find({ members: { [op]: comparandFor[op] } });
          compiled.push(op);
        } catch (e) {
          const err = e as WireBearingError;
          expectJsonColumnRefusal(err, op, 'members');
          refused.push(op);
        }
      }
      // The partition is asserted whole, so an operator quietly moving from one
      // side to the other cannot pass as "still 16 operators".
      expect(refused).toEqual(REFUSED.map(([op]) => op));
      expect(compiled).toEqual(KEPT.map(([op]) => op));
    });

    it('an UNDECLARED operator still gets the unknown-operator refusal, not this one', async () => {
      // The issue's `$overlaps` row: already 400 before this change, and this
      // gate must not annex it — ask 2 (giving array columns a real membership
      // operator) is a spec question, deliberately not answered here.
      const err = await refusalOf(() => find({ members: { $overlaps: [U1] } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('Unsupported filter operator');
      expect(err.message).toContain('$overlaps');
      expect(err.message).not.toContain('WAS NOT APPLIED');
    });
  });
});

/**
 * [#7398] The POSITIVE CONTROL on the site enumeration.
 *
 * The issue named `applyNormalizedComparison` as the lowering site; the plain
 * `whereIn` / `where(field, op, v)` arms of `applyFilterCondition` are a second,
 * separate family. Which one serves a JSON column depends on whether
 * `filterColumnExpr` returns an expression — and for a MANAGED table it never
 * does, so the fixture above exercises only the plain family.
 *
 * An EXTERNAL object (ADR-0015) with a `multiple: true` DATETIME field reaches
 * the other one: `registerExternalObject` populates `datetimeFields` but never
 * runs `backfillCanonicalDatetimes`, so `canonicalDatetimeFields` stays empty,
 * `needsLegacyDatetimeRepair` is true, and every comparison on that column is
 * compiled by `applyNormalizedComparison`'s `whereRaw` arms instead.
 *
 * Measured on `main` before this change, on the row below: `$in` → 0 rows,
 * `$nin` → the excluded row, `$eq` and bare equality → 0 rows. Identical
 * defect, different emitter. A gate installed in only one family leaves this
 * cell green while the bug is still live, which is exactly what this block
 * exists to detect.
 */
describe('[#7398] the second lowering family — normalised columns', () => {
  let driver: SqlDriver;
  const WHEN = '2026-01-01T00:00:00.000Z';

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    const knex = (driver as any).knex;
    await knex.schema.createTable('ext_sprint', (t: any) => {
      t.string('id').primary();
      t.string('milestones');
    });
    await knex('ext_sprint').insert([{ id: 's1', milestones: JSON.stringify([WHEN]) }]);
    (driver as any).registerExternalObject({
      name: 'ext_sprint',
      fields: {
        id: { type: 'text', name: 'id' },
        milestones: { type: 'datetime', name: 'milestones', multiple: true },
      },
    });
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  it('this column really is served by the normalised family — the control\'s own premise', () => {
    // If this ever returns `null`, the cell has silently become a copy of the
    // block above and stops controlling anything.
    expect((driver as any).filterColumnExpr('ext_sprint', 'milestones', 'milestones')).not.toBeNull();
    expect((driver as any).isJsonColumn('ext_sprint', 'milestones')).toBe(true);
  });

  for (const [op, comparand] of [
    ['$in', [WHEN]],
    ['$nin', [WHEN]],
    ['$eq', WHEN],
    ['$ne', WHEN],
    ['$gt', WHEN],
    ['$between', [WHEN, WHEN]],
  ] as ReadonlyArray<readonly [string, unknown]>) {
    it(`refuses "${op}" on the normalised JSON column`, async () => {
      const err = await refusalOf(() =>
        driver.find('ext_sprint', { where: { milestones: { [op]: comparand } } as FilterCondition }),
      );
      expectJsonColumnRefusal(err, op, 'milestones');
    });
  }

  it('refuses bare equality on the normalised JSON column', async () => {
    const err = await refusalOf(() => driver.find('ext_sprint', { where: { milestones: WHEN } as FilterCondition }));
    expectJsonColumnRefusal(err, '=', 'milestones');
  });

  it('$contains still works there too', async () => {
    const rows = await driver.find('ext_sprint', { where: { milestones: { $contains: WHEN } } as FilterCondition });
    expect(rows.map((r: any) => r.id)).toEqual(['s1']);
  });
});
