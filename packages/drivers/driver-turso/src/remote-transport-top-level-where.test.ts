// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import { markFilterSubtreeProvenance } from '@objectstack/spec/data';
import type { QueryAST } from '@objectstack/spec/data';

/**
 * Regression: a TOP-LEVEL `where` this transport cannot compile must THROW,
 * never compile to "no WHERE clause at all" (#1075).
 *
 * `buildWhereSQL` entered its compile loop only when `filters` was a non-array
 * object:
 *
 *   if (typeof filters === 'object' && !Array.isArray(filters)) { … }
 *   return { whereClauses: clauses.join(' AND '), args };
 *
 * Everything else walked past the loop to that `return` and came back with an
 * empty clause string, so the caller emitted no WHERE. Measured on the shipped
 * build with a capturing client:
 *
 *   where: [["stage","=","won"]]   {"sql":"SELECT * FROM \"deal\"","args":[]}
 *   where: "stage"                 {"sql":"SELECT * FROM \"deal\"","args":[]}
 *   where: 42                      {"sql":"SELECT * FROM \"deal\"","args":[]}
 *   where: []                      {"sql":"SELECT * FROM \"deal\"","args":[]}
 *
 * The caller asked to filter and silently received the UNFILTERED set — the
 * outward-failing branch of the family #1004 (unknown operator), #1058
 * (unbindable comparand), #1066/#1071 (operator map compiling to nothing) and
 * #1073 (a dropped logical branch) closed one level at a time. Outward is the
 * expensive direction: on a read it hands back exactly the rows the filter was
 * written to exclude, and on `deleteMany`/`updateMany` it is a whole-table
 * write.
 *
 * The bare AST array is not a hypothetical. `parseFilterAST()` converts an AST
 * to the object form only when `isFilterAST()` accepts it; an operator outside
 * `VALID_AST_OPERATORS` makes it refuse and the RAW array is assigned to
 * `where` (framework#3948 / `sql-driver-filter-no-silent-drop.test.ts`, whose
 * fix made `driver-sql` and `driver-memory` throw rather than drop). Until this
 * fix the same filter answered two ways depending on transport: loud locally,
 * whole-table remotely.
 *
 * Contract evidence (framework `origin/main`, `packages/spec/src/data`):
 *
 *   query.zod.ts:  where: FilterConditionSchema.optional()
 *   filter.zod.ts: FilterConditionSchema = z.lazy(() =>
 *                    z.record(z.string(), z.unknown()).and(z.object({ … })))
 *
 * — a RECORD, optional. So exactly two things are legal at this position: a
 * plain object (`{}` included — the vacuous-TRUE control of #1073/#1074), or
 * nothing at all. Everything else is refused by FORM, before compilation.
 */

function transportWithCapturingClient() {
  const calls: Array<{ sql: string; args: any[] }> = [];
  const client = {
    execute: vi.fn(async (stmt: any) => {
      calls.push({ sql: stmt.sql ?? String(stmt), args: stmt.args ?? [] });
      return { rows: [], columns: [] };
    }),
    close: vi.fn(),
  };
  const t = new RemoteTransport();
  t.setClient(client as any);
  return { t, calls };
}

/** The SQL a `find` compiled to, plus its bind list. */
async function compile(where: unknown): Promise<{ sql: string; args: any[] }> {
  const { t, calls } = transportWithCapturingClient();
  await t.find('deal', { where } as unknown as QueryAST);
  return calls[0];
}

const BARE_SCAN = 'SELECT * FROM "deal"';

/**
 * The four shapes measured in #1075, in the spelling the issue measured them.
 * Each produced `SELECT * FROM "deal"` with no args before this fix.
 */
const MEASURED: Array<[label: string, where: unknown, message: RegExp]> = [
  ['a bare filter AST array', [['stage', '=', 'won']], /is an array, not a filter condition/],
  ['a string', 'stage', /is a string, not a filter condition/],
  ['a number', 42, /is a number, not a filter condition/],
  ['an empty array', [], /is an array, not a filter condition/],
];

describe('RemoteTransport top-level `where` refusal (#1075)', () => {
  describe('(a) the four measured shapes each throw instead of scanning the table', () => {
    for (const [label, where, message] of MEASURED) {
      it(`refuses ${label}`, async () => {
        const { t } = transportWithCapturingClient();
        await expect(t.find('deal', { where } as unknown as QueryAST)).rejects.toThrow(message);
      });

      it(`executes no statement for ${label}`, async () => {
        // The regression itself: before the fix this resolved, having run
        // `SELECT * FROM "deal"` — every row in the table.
        const { t, calls } = transportWithCapturingClient();
        await expect(t.find('deal', { where } as unknown as QueryAST)).rejects.toThrow();
        expect(calls).toEqual([]);
      });
    }

    it('names the object and echoes the filter so the caller is findable', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: [['stage', '=', 'won']] } as unknown as QueryAST)).rejects.toThrow(
        /where on 'deal' is an array, not a filter condition: \[\["stage","=","won"\]\]/,
      );
    });

    it('tells an AST-array caller what to write instead', async () => {
      // The array is the shape that actually arrives (an operator outside
      // `VALID_AST_OPERATORS` leaves `parseFilterAST()` unconverted), so its
      // message carries the repair rather than only the complaint.
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: [['stage', 'before', 'x']] } as unknown as QueryAST)).rejects.toThrow(
        /parseFilterAST/,
      );
    });

    it('says which failure it is refusing, in the family\'s words', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: 42 } as unknown as QueryAST)).rejects.toThrow(
        /Refusing rather than compiling it to NO WHERE clause/,
      );
    });
  });

  describe('(b) the shapes that reached the same scan by ACCIDENT', () => {
    // `Object.keys()` is `[]` for all of these, so each took the "empty filter"
    // early return — the #1066 mistake one level up, where a form that is not a
    // filter node was read as one because it happened to enumerate to nothing.
    const accidental: Array<[string, unknown]> = [
      ['a Date', new Date('2026-04-29T08:30:00.000Z')],
      ['an empty typed array', new Uint8Array([])],
      ['a class instance', new (class Filter { stage = 'won' })()],
      ['an empty string', ''],
      ['zero', 0],
      ['false', false],
    ];

    for (const [label, where] of accidental) {
      it(`refuses ${label} rather than reading it as "no filter"`, async () => {
        const { t, calls } = transportWithCapturingClient();
        await expect(t.find('deal', { where } as unknown as QueryAST)).rejects.toThrow(
          /not a filter condition/,
        );
        expect(calls).toEqual([]);
      });
    }

    it('refuses a class instance even though it carries filter-looking keys', async () => {
      // It enumerates `{ stage: 'won' }` but is not a plain record, so it is
      // refused by form rather than compiled — the same line `isFilterNode`
      // draws for `$and`/`$or` elements (#1073). Compiling it would make the
      // node test mean two different things at two levels.
      const { t } = transportWithCapturingClient();
      await expect(
        t.find('deal', { where: new (class Filter { stage = 'won' })() } as unknown as QueryAST),
      ).rejects.toThrow(/is an object, not a filter condition/);
    });
  });

  describe('(c) every legitimate spelling of "no filter" still works', () => {
    it('keeps `where: {}` meaning "no filter" — the vacuous-TRUE control (#1073/#1074)', async () => {
      const call = await compile({});
      expect(call.sql).toBe(BARE_SCAN);
      expect(call.args).toEqual([]);
    });

    it('keeps an ABSENT where meaning "no filter"', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', {});
      expect(calls[0].sql).toBe(BARE_SCAN);
    });

    it('keeps `where: undefined` and `where: null` meaning "no filter"', async () => {
      // What the five call sites actually produce: they all read `query?.where`,
      // so "the caller supplied none" arrives as `undefined`, and a JSON round
      // trip of an absent key can make it `null`.
      expect((await compile(undefined)).sql).toBe(BARE_SCAN);
      expect((await compile(null)).sql).toBe(BARE_SCAN);
    });

    it('keeps a null-prototype record compiling', async () => {
      const where = Object.create(null) as Record<string, unknown>;
      where.stage = 'won';
      const call = await compile(where);
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" = ?`);
      expect(call.args).toEqual(['won']);
    });

    it('keeps `count` / `deleteMany` / `updateMany` unfiltered when no where is given', async () => {
      // The refusal must not turn "no filter" into an error on the paths whose
      // whole-table form is legitimate (`deleteMany` with no filter truncates
      // on purpose).
      const { t, calls } = transportWithCapturingClient();
      await t.count('deal', {});
      await t.deleteMany('deal', {});
      await t.updateMany('deal', {}, { stage: 'lost' });
      expect(calls[0].sql).toMatch(/^SELECT COUNT\(\*\)/i);
      expect(calls[1].sql).toBe('DELETE FROM "deal"');
      expect(calls[2].sql).toBe('UPDATE "deal" SET "stage" = ?');
      expect(calls[2].args).toEqual(['lost']);
    });
  });

  describe('(d) the same refusal through every WHERE-building entry point', () => {
    for (const [label, where] of MEASURED.map(([l, w]) => [l, w] as const)) {
      it(`refuses ${label} on find / findOne / count / aggregate`, async () => {
        const { t, calls } = transportWithCapturingClient();
        await expect(t.find('deal', { where } as unknown as QueryAST)).rejects.toThrow(/not a filter condition/);
        await expect(t.findOne('deal', { where } as unknown as QueryAST)).rejects.toThrow(/not a filter condition/);
        await expect(t.count('deal', { where } as unknown as QueryAST)).rejects.toThrow(/not a filter condition/);
        await expect(
          t.aggregate('deal', { where, aggregations: [{ function: 'count' }] } as unknown as QueryAST),
        ).rejects.toThrow(/not a filter condition/);
        expect(calls).toEqual([]);
      });

      it(`refuses ${label} on deleteMany / updateMany, with NO statement executed`, async () => {
        // The direction that costs the most: pre-fix these compiled to
        // `DELETE FROM "deal"` and `UPDATE "deal" SET …` — the whole table.
        const { t, calls } = transportWithCapturingClient();
        await expect(t.deleteMany('deal', { where } as any)).rejects.toThrow(
          /not a filter condition/,
        );
        await expect(t.updateMany('deal', { where } as any, { stage: 'lost' })).rejects.toThrow(
          /not a filter condition/,
        );
        expect(calls).toEqual([]);
      });
    }
  });

  describe('(e) nothing that already compiled changes', () => {
    it('keeps a plain equality byte-identical', async () => {
      const call = await compile({ stage: 'won' });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" = ?`);
      expect(call.args).toEqual(['won']);
    });

    it('keeps operator maps, logical groups and `$not` byte-identical', async () => {
      expect((await compile({ amount: { $gt: 10 } })).sql).toBe(`${BARE_SCAN} WHERE "amount" > ?`);
      expect((await compile({ $or: [{ a: 1 }, { b: 2 }] })).sql).toBe(
        `${BARE_SCAN} WHERE (("a" = ?) OR ("b" = ?))`,
      );
      expect((await compile({ $and: [] })).sql).toBe(BARE_SCAN);
      expect((await compile({ $or: [] })).sql).toBe(`${BARE_SCAN} WHERE 1 = 0`);
      // [#5903] The `$not` operand carries the #5146 NULL guard on this face
      // now. What #1075 pins is that a well-formed top-level `where` still
      // COMPILES rather than being refused by the node gate — which it does.
      expect((await compile({ $not: { stage: 'won' } })).sql).toBe(
        `${BARE_SCAN} WHERE NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))`,
      );
      expect((await compile({ closed_at: null })).sql).toBe(`${BARE_SCAN} WHERE "closed_at" IS NULL`);
    });

    it('leaves an ARRAY in a field-comparand position with its own message (#1058)', async () => {
      // `{ stage: [...] }` is a comparand, not a top-level filter: the array is
      // refused by the comparand gate, which names the field. The new gate must
      // not swallow that distinction.
      const { t } = transportWithCapturingClient();
      // [#8197] Marked author-written: the comparand refusal's naming half is
      // withheld from a predicate no merge boundary vouched, and it is exactly
      // the NAMING this case is about.
      await expect(
        t.find('deal', {
          where: markFilterSubtreeProvenance({ stage: ['won'] }, 'author'),
        } as unknown as QueryAST),
      ).rejects.toThrow(/Filter comparand 'deal\.stage'/);
    });

    it('leaves a non-node SUB-filter with its own message (#1073/#1076)', async () => {
      // The sub-filter gate names the branch and index; the top-level gate says
      // `where`. Two levels, two messages, so a log tells you which one it was.
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { $or: [null] } } as unknown as QueryAST)).rejects.toThrow(
        /\$or\[0\] on 'deal'/,
      );
      await expect(t.find('deal', { where: { $not: 'won' } } as unknown as QueryAST)).rejects.toThrow(
        /\$not on 'deal'/,
      );
    });

    it('keeps refusing a nested AST array inside a logical branch as a BRANCH error', async () => {
      const { t } = transportWithCapturingClient();
      await expect(
        t.find('deal', { where: { $and: [[['stage', '=', 'won']]] } } as unknown as QueryAST),
      ).rejects.toThrow(/\$and\[0\] on 'deal' is an array/);
    });
  });
});

/**
 * (f) Rows, not SQL strings.
 *
 * A silently-dropped WHERE leaves the statement perfectly valid — it just
 * answers a different question — so the string assertions above cannot show
 * what the old behaviour COST. These run against a real SQLite database wearing
 * the libsql interface: the reads must not hand back excluded rows, and the
 * refused mutations must leave every row exactly as it was.
 */
describe('TursoDriver remote — a refused top-level where touches no rows (#1075)', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://top-level-where.turso.io', client: stub as never });
    await driver.connect();
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema('deal', {
      name: 'deal',
      fields: { stage: { type: 'string' }, amount: { type: 'number' } },
    });
    await driver.create('deal', { id: 'd_won', stage: 'won', amount: 10 });
    await driver.create('deal', { id: 'd_lost', stage: 'lost', amount: 20 });
    await driver.create('deal', { id: 'd_open', stage: 'open', amount: 30 });
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  const allRows = () =>
    (stub.raw.prepare('SELECT id, stage FROM "deal" ORDER BY id').all() as Array<{
      id: string;
      stage: string;
    }>);

  const ids = async (where: unknown) =>
    ((await driver.find('deal', { where } as unknown as QueryAST)) as any[]).map((r) => r.id).sort();

  it('a bare AST array no longer returns the whole table from a read', async () => {
    // Pre-fix: all three rows came back for a filter naming exactly one.
    await expect(driver.find('deal', { where: [['stage', '=', 'won']] } as unknown as QueryAST)).rejects.toThrow(
      /not a filter condition/,
    );
  });

  it('a refused `deleteMany` deletes NOTHING', async () => {
    // Pre-fix: `DELETE FROM "deal"` — the entire table, for a filter that named
    // one row.
    await expect(driver.deleteMany('deal', { where: [['stage', '=', 'won']] } as any)).rejects.toThrow(
      /not a filter condition/,
    );
    expect(allRows().map((r) => r.id)).toEqual(['d_lost', 'd_open', 'd_won']);
  });

  it('a refused `updateMany` writes NOTHING', async () => {
    // Pre-fix: every row's stage became 'archived'.
    await expect(
      driver.updateMany('deal', { where: 'stage' } as any, { stage: 'archived' }),
    ).rejects.toThrow(/not a filter condition/);
    expect(allRows().map((r) => r.stage).sort()).toEqual(['lost', 'open', 'won']);
  });

  it('a refused `deleteMany` with an EMPTY array deletes nothing either', async () => {
    // `[]` is the shape most likely to be built by a loop that never ran, and
    // the one whose old answer ("no filter") was the whole table.
    await expect(driver.deleteMany('deal', { where: [] } as any)).rejects.toThrow(
      /not a filter condition/,
    );
    expect(allRows()).toHaveLength(3);
  });

  it('the legitimate whole-table spellings still work on rows', async () => {
    expect(await ids({})).toEqual(['d_lost', 'd_open', 'd_won']);
    expect(await ids(undefined)).toEqual(['d_lost', 'd_open', 'd_won']);
    expect(await driver.count('deal', { where: {} })).toBe(3);
  });

  it('a well-formed filter still narrows to its rows', async () => {
    expect(await ids({ stage: 'won' })).toEqual(['d_won']);
    expect(await ids({ $or: [{ stage: 'won' }, { stage: 'lost' }] })).toEqual(['d_lost', 'd_won']);
  });
});
