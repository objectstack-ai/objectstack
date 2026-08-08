// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import type { QueryAST } from '@objectstack/spec/data';

/**
 * Regression: `$null` takes a BOOLEAN, and a non-boolean is refused (#1116).
 *
 * # What was measured
 *
 * `@objectstack/spec`'s `FieldOperatorsSchema` declares `$null: z.boolean()`,
 * and nothing between an authored `where` and this transport validates against
 * it — so a non-boolean really does arrive at `buildWhereSQL`. Its `$null` arm
 * was a BISECTION:
 *
 *     clauses.push(`${column} IS ${opValue === false ? 'NOT NULL' : 'NULL'}`);
 *
 * `false` on one side, EVERYTHING ELSE on the other. Measured on real SQLite
 * (`makeLibsqlSqliteStub`, i.e. better-sqlite3 wearing the libsql interface)
 * with the two-row fixture below — `('1','won',10)` and `('2',NULL,20)`:
 *
 * | filter | compiled to | rows |
 * |---|---|---|
 * | `{ stage: { $null: true } }`      | `IS NULL`     | `["2"]` ✅ |
 * | `{ stage: { $null: false } }`     | `IS NOT NULL` | `["1"]` ✅ |
 * | `{ stage: { $null: 'yes' } }`     | `IS NULL`     | `["2"]` ← out of contract |
 * | `{ stage: { $null: 1 } }`         | `IS NULL`     | `["2"]` |
 * | `{ stage: { $null: 0 } }`         | `IS NULL`     | `["2"]` |
 * | `{ stage: { $null: null } }`      | `IS NULL`     | `["2"]` |
 * | `{ stage: { $null: undefined } }` | `IS NULL`     | `["2"]` |
 * | `{ stage: { $null: {} } }`        | `IS NULL`     | `["2"]` |
 * | `{ stage: { $null: 'false' } }`   | `IS NULL`     | `["2"]` ← the STRING is truthy |
 *
 * Every third value answered as though `true` had been written. The last row is
 * the trap and gets its own named case below: `'false'` is a truthy string, so
 * the spelling most likely to arrive from a JSON round-trip or a template
 * concatenation compiled to the exact OPPOSITE of what its author meant.
 *
 * # Why refused rather than coerced
 *
 * Ruled by the maintainer on the identical shape in objectstack#5347 and landed
 * across framework's four backends in objectstack#5368 (`9c5abf4e9`). The
 * reasoning is not "this transport picked the wrong side" — there is no side to
 * pick. The backends read a non-boolean in OPPOSITE directions: `IS NULL` here,
 * on `driver-sql`, on `driver-sqlite-wasm` and on Turso LOCAL; `IS NOT NULL` on
 * `driver-memory`'s query path and on `driver-mongodb`; and `driver-memory`'s
 * reference matcher dropped the constraint entirely and matched BOTH rows — a
 * WIDENING, which on an RLS read scope is a permission bypass rather than a
 * degraded filter. Three answers to one declared operator, none of them a rule
 * anyone wrote down; all three are just what a two-branch conditional does with
 * a third value.
 *
 * Until this fix, the SAME `TursoDriver` answered one filter two ways depending
 * only on whether `url` sent it down the local or the remote path.
 *
 * # Why the assertions check `code` / `status` and not only "it throws"
 *
 * Half of #1116 is the ENVELOPE. Every filter refusal in this transport threw a
 * bare `Error` — `code` and `status` `undefined` — so the wire identity of the
 * rejection was carried by English prose alone, while the framework twins that
 * refuse the very same shapes all speak `INVALID_FILTER` / 400 (ADR-0112). A
 * refusal only a human reading a log can classify is not much better than a
 * wrong answer to a caller, so section (e) pins the whole family, not just the
 * new arm.
 */

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

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

/** The refusal a filter produces, or a failure saying it did not refuse. */
async function refusalOf(where: unknown): Promise<WireBearingError> {
  const { t, calls } = transportWithCapturingClient();
  try {
    await t.find('deal', { where } as unknown as QueryAST);
  } catch (e) {
    // A refused filter must not have run a statement on the way to throwing.
    expect(calls).toEqual([]);
    return e as WireBearingError;
  }
  throw new Error(
    `expected ${JSON.stringify(where)} to be refused, but it compiled to ${JSON.stringify(calls[0])}`,
  );
}

/** The SQL a `find` compiled to, plus its bind list. */
async function compile(where: unknown): Promise<{ sql: string; args: any[] }> {
  const { t, calls } = transportWithCapturingClient();
  await t.find('deal', { where } as unknown as QueryAST);
  return calls[0];
}

/**
 * The exact leading sentence framework's twins produce for this condition,
 * copied from `driver-sql`'s `nonBooleanNullComparandError` (word-for-word
 * identical in `driver-memory` and `driver-mongodb`, objectstack#5368).
 *
 * A literal rather than an import: cloud must not take a source dependency on
 * framework's driver internals, so the twin invariant is held by pinning the
 * other side's wording here. A caller who hits this on Turso must read the same
 * sentence they would read on Postgres.
 */
const FRAMEWORK_LEADING_SENTENCE = (field: string) =>
  `Operator "$null" on field "${field}" requires a boolean comparand (true or false).`;

/** Every non-boolean comparand from #1116's measured table, in its order. */
const NON_BOOLEAN: Array<[label: string, value: unknown]> = [
  ["the string 'yes'", 'yes'],
  ['the number 1', 1],
  ['the number 0', 0],
  ['null', null],
  ['undefined', undefined],
  ['an object', {}],
  // Called out separately below too — it is the likeliest real-world path.
  ["the STRING 'false'", 'false'],
];

const BARE_SCAN = 'SELECT * FROM "deal"';

describe('RemoteTransport $null comparand refusal (#1116)', () => {
  describe('(a) every non-boolean in the measured table is refused, in the ADR-0112 envelope', () => {
    for (const [label, value] of NON_BOOLEAN) {
      it(`refuses ${label} with INVALID_FILTER / 400`, async () => {
        const err = await refusalOf({ stage: { $null: value } });
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
      });

      it(`names the operator, the field and the offending value for ${label}`, async () => {
        const err = await refusalOf({ stage: { $null: value } });
        expect(err.message).toContain(FRAMEWORK_LEADING_SENTENCE('stage'));
        expect(err.message).toContain(`'deal.stage'.$null`);
      });
    }

    it("gives the STRING 'false' its own reckoning — it is truthy, so it meant IS NULL", async () => {
      // The likeliest real-world path into this bug: `"false"` survives a JSON
      // round trip or a template concatenation looking exactly like the `false`
      // it was written to mean, and then compiles to the opposite predicate.
      // Pre-fix this returned the NULL row — the rows `$null: false` excludes.
      const err = await refusalOf({ stage: { $null: 'false' } });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('Note "false" the STRING is truthy');
      expect(err.message).toContain('the side opposite the false it was written to mean');
    });

    it('cites the ruling and the framework landing so both repos are findable', async () => {
      const err = await refusalOf({ stage: { $null: 'yes' } });
      expect(err.message).toContain('objectstack#5347');
      expect(err.message).toContain('objectstack#5368');
      expect(err.message).toContain('#1116');
    });

    it('names the spec declaration rather than only complaining', async () => {
      const err = await refusalOf({ stage: { $null: 1 } });
      expect(err.message).toContain('FieldOperatorsSchema declares $null as a boolean');
    });

    it('truncates a large comparand rather than pasting it into the log', async () => {
      const err = await refusalOf({ stage: { $null: { blob: 'x'.repeat(5_000) } } });
      expect(err.message).toContain('…');
      expect(err.message.length).toBeLessThan(1_000);
    });
  });

  describe('(b) `$null: true` / `$null: false` are byte-identical to before', () => {
    it('compiles `$null: true` to IS NULL', async () => {
      const call = await compile({ stage: { $null: true } });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" IS NULL`);
      expect(call.args).toEqual([]);
    });

    it('compiles `$null: false` to IS NOT NULL', async () => {
      const call = await compile({ stage: { $null: false } });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" IS NOT NULL`);
      expect(call.args).toEqual([]);
    });

    it('keeps compiling them alongside other predicates and inside combinators', async () => {
      expect((await compile({ stage: { $null: true }, amount: { $gt: 10 } })).sql).toBe(
        `${BARE_SCAN} WHERE "stage" IS NULL AND "amount" > ?`,
      );
      expect((await compile({ $or: [{ stage: { $null: true } }, { stage: 'won' }] })).sql).toBe(
        `${BARE_SCAN} WHERE (("stage" IS NULL) OR ("stage" = ?))`,
      );
      expect((await compile({ $not: { stage: { $null: false } } })).sql).toBe(
        `${BARE_SCAN} WHERE NOT ("stage" IS NOT NULL)`,
      );
    });
  });

  describe('(c) the refusal reaches every position and every entry point', () => {
    it('refuses inside `$and` / `$or` / `$not`, even beside a satisfiable sibling', async () => {
      // The malformed arm is compiled wherever it sits: a sibling that would
      // have matched does not buy it a pass, and neither does `$or`'s vacuous
      // TRUE disjunct.
      for (const where of [
        { $and: [{ stage: { $null: 'yes' } }] },
        { $or: [{ stage: 'won' }, { stage: { $null: 1 } }] },
        { $not: { stage: { $null: 'yes' } } },
        { $or: [{}, { stage: { $null: 'false' } }] },
      ]) {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.message).toContain(FRAMEWORK_LEADING_SENTENCE('stage'));
      }
    });

    it('refuses on find / findOne / count / aggregate with NO statement executed', async () => {
      const { t, calls } = transportWithCapturingClient();
      const where = { stage: { $null: 'yes' } };
      await expect(t.find('deal', { where } as unknown as QueryAST)).rejects.toThrow(/requires a boolean comparand/);
      await expect(t.findOne('deal', { where } as unknown as QueryAST)).rejects.toThrow(/requires a boolean comparand/);
      await expect(t.count('deal', { where } as unknown as QueryAST)).rejects.toThrow(/requires a boolean comparand/);
      await expect(
        t.aggregate('deal', { where, aggregations: [{ function: 'count' }] } as unknown as QueryAST),
      ).rejects.toThrow(/requires a boolean comparand/);
      expect(calls).toEqual([]);
    });

    it('refuses on deleteMany / updateMany — the direction that costs the most', async () => {
      // Pre-fix these ran against `WHERE "stage" IS NULL`: rows the caller
      // never named, deleted or overwritten without a word.
      const { t, calls } = transportWithCapturingClient();
      const where = { stage: { $null: 'false' } };
      await expect(t.deleteMany('deal', { where } as any)).rejects.toThrow(
        /requires a boolean comparand/,
      );
      await expect(t.updateMany('deal', { where } as any, { stage: 'archived' })).rejects.toThrow(
        /requires a boolean comparand/,
      );
      expect(calls).toEqual([]);
    });
  });

  describe('(d) the fence #1116 drew around `$exists`, now TAKEN DOWN (#5369 / #5903)', () => {
    // The block this replaces asserted the opposite, and named the condition
    // for its own reversal: "`$exists` carries the identical `=== false`
    // bisection one arm below, and is deliberately NOT tightened: its
    // divergence is on another axis (whether 'exists' means key-present or
    // has-value — objectstack#5299, reopened as #5369), so tightening it HERE
    // alone would manufacture a local/remote fork rather than close one. When
    // #5299 is ruled on, this test is the one to change — deliberately, not
    // incidentally."
    //
    // Both conditions have now been met, so this is that deliberate change:
    //
    //  - #5298's four-point ruling (2026-08-06) settled `$exists` on **has a
    //    value**, the reading this transport already compiled — so the "another
    //    axis" the fence was protecting is closed, and `$exists` / `$null` are
    //    strict mirrors.
    //  - PR #5962 landed the refusal on `driver-sql`, which Turso LOCAL
    //    inherits. Keeping the fence up stopped preventing a local/remote fork
    //    and started BEING one: measured on `origin/main` against the shared
    //    conformance fixture, `{ d: { $exists: 'yes' } }` threw `INVALID_FILTER`
    //    locally and returned the valued rows remotely.
    it('refuses a non-boolean `$exists` comparand, as `$null` does', async () => {
      for (const value of ['yes', 1, 0, null, undefined, {}, 'false', [], 'true']) {
        const err = await refusalOf({ stage: { $exists: value } });
        expect(err.code, JSON.stringify(value) ?? 'undefined').toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(
          'Operator "$exists" on field "stage" requires a boolean comparand (true or false).',
        );
        // The location convention every other refusal in this file uses.
        expect(err.message).toContain(`'deal.stage'.$exists`);
      }
    });

    it('names the STRING `"false"` as the trap it is', async () => {
      // The same trap the `$null` twin calls out: `'false'` is truthy, so the
      // spelling most likely to arrive from a JSON round-trip or a template
      // concatenation compiled to `IS NOT NULL` — the exact opposite of what
      // its author meant.
      const err = await refusalOf({ stage: { $exists: 'false' } });
      expect(err.message).toContain('"false" the STRING is truthy');
    });

    it('still compiles the two booleans, unchanged', async () => {
      // The guard adds no third answer: `$exists` keeps the mirror of `$null`
      // it has always had.
      expect((await compile({ stage: { $exists: true } })).sql).toBe(
        `${BARE_SCAN} WHERE "stage" IS NOT NULL`,
      );
      expect((await compile({ stage: { $exists: false } })).sql).toBe(
        `${BARE_SCAN} WHERE "stage" IS NULL`,
      );
    });

    it('refuses at every depth, and executes no statement', async () => {
      // Same depths the `$null` gate is pinned at — the arm runs inside the
      // operator loop, so a nested spelling must not slip past it.
      const { t, calls } = transportWithCapturingClient();
      for (const where of [
        { $and: [{ stage: { $exists: 'yes' } }] },
        { $or: [{ stage: 'won' }, { stage: { $exists: 1 } }] },
        { $not: { stage: { $exists: 'yes' } } },
        { $or: [{}, { stage: { $exists: 'false' } }] },
      ]) {
        await expect(t.find('deal', { where } as unknown as QueryAST)).rejects.toThrow(
          /Operator "\$exists" .* requires a boolean comparand/,
        );
      }
      expect(calls).toEqual([]);
    });

    it('refuses on the writing entry points too — the direction that costs the most', async () => {
      const { t, calls } = transportWithCapturingClient();
      const where = { stage: { $exists: 'false' } };
      await expect(t.deleteMany('deal', { where } as any)).rejects.toThrow(
        /requires a boolean comparand/,
      );
      await expect(t.updateMany('deal', { where } as any, { stage: 'archived' })).rejects.toThrow(
        /requires a boolean comparand/,
      );
      expect(calls).toEqual([]);
    });

    it('leaves the regex family taking a non-string comparand', async () => {
      // Measured consistent and fail-closed across backends; `driver-sql`'s
      // #5041 comment excludes the family from its guard by name.
      // [#6518] The wildcard is `*`, not `%` — this transport emits `GLOB` now,
      // because the family is case-SENSITIVE by contract and SQLite's `LIKE`
      // is not. The claim under test is still that a NUMBER and a BOOLEAN keep
      // rendering to text rather than being refused.
      expect((await compile({ name: { $startsWith: 42 } })).args).toEqual(['42*']);
      expect((await compile({ name: { $contains: true } })).args).toEqual(['*true*']);
    });
  });

  describe('(e) the envelope: every filter refusal in this transport now carries a wire code', () => {
    // The other half of #1116. These all threw bare `Error`s — `code` and
    // `status` `undefined` — so `mapDataError` served them with no `code` at
    // all, outside the ADR-0112 contract that every sibling rejection on the
    // same route already speaks. One condition, one wire code.
    const FILTER_REFUSALS: Array<[label: string, where: unknown]> = [
      ['an unknown operator (#1004)', { stage: { $bogus: 1 } }],
      ['a non-operator key in an operator map (#1004)', { stage: { nope: 1 } }],
      ['$between reaching the transport unlowered (#1003)', { amount: { $between: [1, 2] } }],
      ['an unbindable comparand (#1058)', { amount: { $gt: { $field: 'budget' } } }],
      ['a cross-field marker (#1051/#1058)', { amount: { $eq: { $field: 'budget' } } }],
      ['an operator map that compiles to nothing (#1066/#1071)', { stage: {} }],
      ['a non-node `$or` element (#1073)', { $or: [null] }],
      ['a non-node `$not` operand (#1076)', { $not: 'won' }],
      ['a non-node top-level `where` (#1075)', [['stage', '=', 'won']]],
      ['a non-boolean `$null` comparand (#1116)', { stage: { $null: 'yes' } }],
      ['a non-boolean `$exists` comparand (#5369/#5903)', { stage: { $exists: 'yes' } }],
    ];

    for (const [label, where] of FILTER_REFUSALS) {
      it(`${label} is INVALID_FILTER / 400`, async () => {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        // The prose is unchanged — this half of #1116 adds identity, it does
        // not reword six shipped refusals.
        expect(err.message).toContain('[RemoteTransport]');
      });
    }

    it('leaves NON-filter failures as bare errors — they are not client filter mistakes', async () => {
      // A transport that is not connected, or an identifier that is unsafe, is
      // not a malformed filter and must not borrow its 400.
      const t = new RemoteTransport();
      const err = (await t.find('deal', {}).catch((e) => e)) as WireBearingError;
      expect(err.message).toMatch(/is not initialized/);
      expect(err.code).toBeUndefined();
      expect(err.status).toBeUndefined();
    });
  });
});

/**
 * (f) Rows, not SQL strings.
 *
 * The string assertions above cannot show what the old behaviour COST: a
 * bisected `$null` leaves the statement perfectly valid, it just answers a
 * different question. This is the issue's own harness and its own fixture — a
 * real SQLite database behind the libsql interface, one row with a value and
 * one with NULL — so the rows are the evidence.
 */
describe('TursoDriver remote — `$null` on rows (#1116)', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://null-comparand.turso.io', client: stub as never });
    await driver.connect();
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema('deal', {
      name: 'deal',
      fields: { stage: { type: 'string' }, amount: { type: 'number' } },
    });
    // The issue's fixture, verbatim: ('1','won',10) and ('2',NULL,20).
    await driver.create('deal', { id: '1', stage: 'won', amount: 10 });
    await driver.create('deal', { id: '2', stage: null, amount: 20 });
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  const ids = async (where: unknown): Promise<string[]> =>
    ((await driver.find('deal', { where } as unknown as QueryAST)) as any[]).map((r) => String(r.id)).sort();

  const allRows = () =>
    stub.raw.prepare('SELECT id, stage FROM "deal" ORDER BY id').all() as Array<{
      id: string;
      stage: string | null;
    }>;

  it('`$null: true` still returns the NULL row', async () => {
    expect(await ids({ stage: { $null: true } })).toEqual(['2']);
  });

  it('`$null: false` still returns the valued row', async () => {
    expect(await ids({ stage: { $null: false } })).toEqual(['1']);
  });

  for (const [label, value] of NON_BOOLEAN) {
    it(`${label} returns no rows at all — it is refused, not answered`, async () => {
      // Pre-fix every one of these came back as `["2"]`, i.e. the answer
      // `$null: true` gives, for a filter that never said `true`.
      const err = (await driver
        .find('deal', { where: { stage: { $null: value } } } as unknown as QueryAST)
        .catch((e) => e)) as WireBearingError;
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });
  }

  it('a refused `deleteMany` deletes NOTHING', async () => {
    // Pre-fix: `DELETE FROM "deal" WHERE "stage" IS NULL` — row 2 gone, for a
    // filter whose author wrote a string.
    await expect(
      driver.deleteMany('deal', { where: { stage: { $null: 'false' } } } as any),
    ).rejects.toThrow(/requires a boolean comparand/);
    expect(allRows().map((r) => r.id)).toEqual(['1', '2']);
  });

  it('a refused `updateMany` writes NOTHING', async () => {
    await expect(
      driver.updateMany('deal', { where: { stage: { $null: 1 } } } as any, { stage: 'archived' }),
    ).rejects.toThrow(/requires a boolean comparand/);
    expect(allRows().map((r) => r.stage)).toEqual(['won', null]);
  });

  it('the surrounding vocabulary still answers on rows', async () => {
    expect(await ids({ stage: 'won' })).toEqual(['1']);
    expect(await ids({ $or: [{ stage: { $null: true } }, { stage: 'won' }] })).toEqual(['1', '2']);
    expect(await ids({ $not: { stage: { $null: true } } })).toEqual(['1']);
    expect(await ids({})).toEqual(['1', '2']);
  });

  it('`$exists` still answers on rows, unchanged (the scope fence, on rows)', async () => {
    expect(await ids({ stage: { $exists: true } })).toEqual(['1']);
    expect(await ids({ stage: { $exists: false } })).toEqual(['2']);
  });
});
