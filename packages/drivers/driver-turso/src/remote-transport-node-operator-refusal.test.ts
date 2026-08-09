// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5769] A `$`-key in a NODE position that is not a declared combinator is
 * refused, on every path that builds a WHERE.
 *
 * `FilterConditionSchema` declares exactly three combinators (`$and`, `$or`,
 * `$not`); every other key of a filter node is a FIELD NAME. `buildWhereSQL`
 * recognised the three and let everything else fall into the field arms, where
 * it was quoted into SQL as a COLUMN of that name. Measured on `origin/main`
 * (`5c94f833c`) with a capturing client, three rows seeded:
 *
 * ```
 * { $eq: 'won' }                 → SELECT * FROM "deal" WHERE "$eq" = ?         → []
 * { $gt: 5 }                     → SELECT * FROM "deal" WHERE "$gt" = ?         → []
 * { $where: 'return true' }      → SELECT * FROM "deal" WHERE "$where" = ?      → []
 * { $and: 'x' }                  → SELECT * FROM "deal" WHERE "$and" = ?        → []
 * { $or: [{}, { $where: 'x' }] } → SELECT * FROM "deal"                         → ALL THREE ROWS
 * ```
 *
 * ## The two endings, and why the second is the expensive one
 *
 * The first four are the **silent empty set**. SQLite's backwards-compatibility
 * rule degrades a double-quoted name that resolves to no column into a string
 * literal, so `"$eq" = 'won'` is `'$eq' = 'won'` — false for every row. The
 * statement compiles, runs, and answers "nothing matched", which is exactly
 * what a genuinely-empty result looks like. (A build with `SQLITE_DQS=0` — the
 * one this suite's `better-sqlite3`-backed stub is — raises `no such column`
 * instead, and `RemoteTransport.find`'s own unknown-column backstop swallows
 * that into `[]`. Two roads, one answer.)
 *
 * The fifth needs no dialect quirk at all and is the one that costs rows. A
 * `{}` disjunct is `$or`'s TRUE identity and absorbs the whole group; the
 * clauses compiled from its malformed sibling are discarded with it, and the
 * statement loses its WHERE **entirely**. On a read that hands back every row
 * the filter was written to exclude; on `deleteMany` / `updateMany` it is a
 * whole-table write — measured, all three rows rewritten by a filter that named
 * none of them. That is the direction #1075 / #1073 spent two fixes closing,
 * reopened one key at a time by an undeclared combinator.
 *
 * ## Why remote was the last face
 *
 * `objectstack#5348` ruled the shape REFUSED and PR #5368 landed the gate on
 * `SqlDriver`'s validation walk (`reduceFilterKey`), which `driver-sqlite-wasm`
 * and Turso's **local** transport inherit. `RemoteTransport` inherits nothing —
 * it is an independent filter compiler — so one `TursoDriver` gave two answers
 * to one filter depending only on the `url` it was constructed with, and the
 * fork ran the wrong way: strict locally, silent remotely. The parity block at
 * the bottom of this file is that fork, pinned closed.
 *
 * ## Where the gate sits, and why HERE rather than on a separate walk
 *
 * `SqlDriver` puts its gate on a validation walk because its emitter is skipped
 * wholesale by a boolean identity, so an emitter-side gate there would be
 * conditional on a node's SIBLINGS. This compiler has no such gap: its `$and`
 * and `$or` branches compile EVERY element before applying their identity rule
 * — the fifth measurement above is that fact, since `{ $where: 'x' }` was
 * compiled and only then thrown away — so the entry loop already visits every
 * node of the tree. The two cases under "(c) placement" are the ones that would
 * fail if that were not so.
 *
 * @see sql-driver-out-of-contract-filter-input.test.ts — the twin, one driver up
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import type { QueryAST } from '@objectstack/spec/data';

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

/** The SQL a `find` compiled to, plus its bind list. */
async function compile(where: unknown): Promise<{ sql: string; args: any[] }> {
  const { t, calls } = transportWithCapturingClient();
  await t.find('deal', { where } as unknown as QueryAST);
  return calls[0];
}

/** The error a `find` refused with — and proof that nothing reached the database. */
async function refusalOf(where: unknown): Promise<WireBearingError> {
  const { t, calls } = transportWithCapturingClient();
  try {
    await t.find('deal', { where } as unknown as QueryAST);
  } catch (e) {
    expect(calls, 'a refused filter must not execute a statement').toEqual([]);
    return e as WireBearingError;
  }
  throw new Error(`expected the transport to refuse ${JSON.stringify(where)}, but it compiled`);
}

const BARE_SCAN = 'SELECT * FROM "deal"';

/**
 * Undeclared `$`-keys, at the top level and at each depth a node can occur.
 *
 * `$where` / `$expr` are named rather than invented: `driver-mongodb`'s refusal
 * calls them P0 because a backend that EVALUATES them bypasses query intent.
 * `$nor` and `$elemMatch` are what a Mongo-fluent author reaches for. The last
 * three prove the gate is reached through every combinator, including the two
 * whose identity rules can resolve a node before its siblings are read.
 */
const UNDECLARED: Array<[label: string, where: unknown, key: string, path: string]> = [
  ['$where at the top level', { $where: 'return true' }, '$where', 'where.$where'],
  ['$nor at the top level', { $nor: [{ stage: 'won' }] }, '$nor', 'where.$nor'],
  ['$expr at the top level', { $expr: { $eq: ['$stage', 'won'] } }, '$expr', 'where.$expr'],
  ['$elemMatch at the top level', { $elemMatch: { stage: 'won' } }, '$elemMatch', 'where.$elemMatch'],
  // [#5702] `$regex` MOVED here from the misplaced-field-operator table below.
  // It sat there because it was a field operator this transport compiled ("and
  // `$regex` because better-auth's adapter really emits it"); #4706 retired it,
  // so at the node position it is no longer one level too high — it names
  // nothing this protocol declares at any level, which is the tail this table
  // asserts. Re-spelling the row rather than deleting it keeps the shape's
  // answer pinned; only which of the two tails it takes has changed.
  ['$regex at the top level', { $regex: 'wo' }, '$regex', 'where.$regex'],
  ['$where inside $or', { $or: [{ $where: 'x' }] }, '$where', 'where.$or[0].$where'],
  ['$nor inside $and', { $and: [{ $nor: [{ stage: 'won' }] }] }, '$nor', 'where.$and[0].$nor'],
  ['$expr inside $not', { $not: { $expr: 1 } }, '$expr', 'where.$not.$expr'],
  [
    '$where two combinators deep',
    { $and: [{ $or: [{ stage: 'won' }, { $where: 'x' }] }] },
    '$where',
    'where.$and[0].$or[1].$where',
  ],
];

/**
 * Field operators in the node position — one level too high.
 *
 * This is the likelier arrival route of the two: `{ $eq: 'won' }` is what a
 * hand-written or AI-authored filter produces when the field name is dropped,
 * and every one of them compiled to a predicate on a column named after the
 * operator. `$between` is included even though this transport never compiles it
 * (TursoDriver lowers it first) — misplaced is misplaced — and `$icontains`
 * because this transport compiles it (#5702). [#6520] `FILTER_OPERATORS` lists
 * `$icontains` now too, so that clause's "even though" is history: the word
 * list and every evaluator agree.
 *
 * [#5702] `$regex` LEFT this table for the undeclared one above: it is retired,
 * so it is not a field operator at any level and its author must not be told to
 * write `{ field: { $regex: … } }`.
 */
const MISPLACED: Array<[label: string, where: unknown, key: string]> = [
  ['$eq', { $eq: 'won' }, '$eq'],
  ['$ne', { $ne: 'won' }, '$ne'],
  ['$gt', { $gt: 5 }, '$gt'],
  ['$gte', { $gte: 5 }, '$gte'],
  ['$lt', { $lt: 5 }, '$lt'],
  ['$lte', { $lte: 5 }, '$lte'],
  ['$in', { $in: ['won'] }, '$in'],
  ['$nin', { $nin: ['won'] }, '$nin'],
  ['$between', { $between: [1, 2] }, '$between'],
  ['$contains', { $contains: 'wo' }, '$contains'],
  ['$notContains', { $notContains: 'wo' }, '$notContains'],
  ['$startsWith', { $startsWith: 'w' }, '$startsWith'],
  ['$endsWith', { $endsWith: 'n' }, '$endsWith'],
  ['$icontains', { $icontains: 'wo' }, '$icontains'],
  ['$null', { $null: true }, '$null'],
  ['$exists', { $exists: true }, '$exists'],
];

describe('[#5769] RemoteTransport refuses a $-key in a node position', () => {
  describe('(a) undeclared combinators', () => {
    for (const [label, where, key, path] of UNDECLARED) {
      it(`refuses ${label} with INVALID_FILTER / 400`, async () => {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        // The caller must be able to see WHICH key, and WHERE.
        expect(err.message).toContain(`"${key}"`);
        expect(err.message).toContain(path);
        expect(err.message).toContain('$and, $or and $not');
        // Named as a combinator, never as a field of the object.
        expect(err.message).not.toContain(`'deal.${key}'`);
      });
    }

    it('says the protocol has no such key at any level, and names the write cost', async () => {
      const err = await refusalOf({ $where: 'return true' });
      expect(err.message).toMatch(/declares no "\$where" at any level/);
      expect(err.message).toMatch(/deleteMany\/updateMany/);
    });
  });

  describe('(b) field operators one level too high', () => {
    for (const [label, where, key] of MISPLACED) {
      it(`refuses a node-position ${label} and points at the field spelling`, async () => {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`"${key}"`);
        expect(err.message).toContain(`where.${key}`);
        // The repair, not merely the diagnosis: an author who wrote `{ $eq: … }`
        // needs to be told to name the field, not that `$eq` is "not a
        // combinator" — which is true and useless.
        expect(err.message).toContain('IS a field operator, one level down');
        expect(err.message).toContain(`{ <field>: { "${key}": <value> } }`);
      });
    }

    it('the same key one level DOWN still compiles, byte for byte', async () => {
      // The distinction the two messages rest on has to be real: the identical
      // operator in the position it is declared for is untouched.
      expect((await compile({ stage: { $eq: 'won' } })).sql).toBe(`${BARE_SCAN} WHERE "stage" = ?`);
      expect((await compile({ amount: { $gt: 5 } })).sql).toBe(`${BARE_SCAN} WHERE "amount" > ?`);
      expect((await compile({ stage: { $null: true } })).sql).toBe(`${BARE_SCAN} WHERE "stage" IS NULL`);
    });
  });

  describe('(c) placement — the gate is reached whatever the siblings say', () => {
    /**
     * `{ stage: 'won' }` is a satisfiable disjunct, so a gate that ran only on
     * emitted clauses could compile the `$or` from that branch and never look
     * at the malformed sibling. Pre-fix this compiled BOTH and answered `[]`.
     */
    it('refuses a malformed disjunct beside a satisfiable one', async () => {
      const err = await refusalOf({ $or: [{ stage: 'won' }, { $where: 'x' }] });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('where.$or[1].$where');
    });

    /**
     * The half that used to cost the whole table: `{}` is `$or`'s TRUE identity,
     * so the group was absorbed and the compiled clauses of its malformed
     * sibling were discarded with it — leaving `SELECT * FROM "deal"` with no
     * WHERE at all.
     */
    it('refuses a malformed disjunct beside the TRUE identity `{}`', async () => {
      const err = await refusalOf({ $or: [{}, { $nor: [{ stage: 'won' }] }] });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('where.$or[1].$nor');
    });

    /** `$and: []` / `$and: [{}]` resolve to TRUE the same way. */
    it('refuses a malformed conjunct beside a vacuous one', async () => {
      const err = await refusalOf({ $and: [{}, { $expr: 1 }] });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('where.$and[1].$expr');
    });
  });

  describe('(d) the declared combinators still have to carry a list', () => {
    // Not a typo in the KEY but a wrong VALUE, and told apart from (a) on
    // purpose: `$and` is spelled correctly. Pre-fix both fell through the
    // `Array.isArray` tests into the very same field arm.
    const NON_LIST: Array<[label: string, where: unknown, key: string, shown: string]> = [
      ['$and: a string', { $and: 'x' }, '$and', 'a string'],
      ['$and: an object', { $and: { stage: 'won' } }, '$and', 'an object'],
      ['$or: an object', { $or: { stage: 'won' } }, '$or', 'an object'],
      ['$or: null', { $or: null }, '$or', 'null'],
      ['$and: a number', { $and: 42 }, '$and', 'a number'],
    ];

    for (const [label, where, key, shown] of NON_LIST) {
      it(`refuses ${label} by name, not as a column`, async () => {
        const err = await refusalOf(where);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`"${key}" at where.${key}`);
        expect(err.message).toContain('requires an array of filter conditions');
        expect(err.message).toContain(shown);
        expect(err.message).toContain('FilterCondition[]');
      });
    }

    it('`$not` keeps its own single-operand refusal (#1076), not this one', async () => {
      // `$not` takes ONE condition rather than a list, so it is shaped one level
      // down in `buildSubFilterSQL`. Two spellings for one condition is what
      // this file exists to prevent, so the boundary is pinned.
      const err = await refusalOf({ $not: 'won' });
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toMatch(/\$not on 'deal' is a string/);
      expect(err.message).not.toContain('requires an array of filter conditions');
    });
  });

  describe('(e) every WHERE-building entry point refuses, and executes nothing', () => {
    const PROBE = { $where: 'return true' };

    it('find / findOne / count / aggregate', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: PROBE } as unknown as QueryAST)).rejects.toThrow(
        /Unsupported filter combinator "\$where"/,
      );
      await expect(t.findOne('deal', { where: PROBE } as unknown as QueryAST)).rejects.toThrow(
        /Unsupported filter combinator "\$where"/,
      );
      await expect(t.count('deal', { where: PROBE } as unknown as QueryAST)).rejects.toThrow(
        /Unsupported filter combinator "\$where"/,
      );
      await expect(
        t.aggregate('deal', { where: PROBE, aggregations: [{ function: 'count' }] } as unknown as QueryAST),
      ).rejects.toThrow(/Unsupported filter combinator "\$where"/);
      expect(calls).toEqual([]);
    });

    it('deleteMany / updateMany — the paths where the old answer WROTE', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.deleteMany('deal', { where: PROBE } as any)).rejects.toThrow(
        /Unsupported filter combinator "\$where"/,
      );
      await expect(t.updateMany('deal', { where: PROBE } as any, { stage: 'lost' })).rejects.toThrow(
        /Unsupported filter combinator "\$where"/,
      );
      expect(calls).toEqual([]);
    });

    it('and on the identity-absorbed shape, whose old compile had NO where clause', async () => {
      const { t, calls } = transportWithCapturingClient();
      const where = { $or: [{}, { $where: 'x' }] };
      await expect(t.deleteMany('deal', { where } as any)).rejects.toThrow(/INVALID_FILTER|combinator/);
      await expect(t.updateMany('deal', { where } as any, { stage: 'lost' })).rejects.toThrow(
        /INVALID_FILTER|combinator/,
      );
      expect(calls).toEqual([]);
    });
  });

  describe('(f) nothing that compiled before changes', () => {
    it('keeps the three declared combinators byte-identical', async () => {
      expect((await compile({ stage: 'won' })).sql).toBe(`${BARE_SCAN} WHERE "stage" = ?`);
      expect((await compile({ $or: [{ a: 1 }, { b: 2 }] })).sql).toBe(
        `${BARE_SCAN} WHERE (("a" = ?) OR ("b" = ?))`,
      );
      expect((await compile({ $and: [{ a: 1 }, { b: 2 }] })).sql).toBe(
        `${BARE_SCAN} WHERE (("a" = ?) AND ("b" = ?))`,
      );
      // [#5903] The `$not` operand is NULL-safe since #5146 landed on this
      // face, so the negated predicate now carries the `IS NOT NULL` guard that
      // makes it TOTAL. That is a change THIS suite must not read as a #5769
      // regression: what #5769 pins is that the node gate compiles the three
      // declared combinators rather than refusing them, and it still does.
      expect((await compile({ $not: { stage: 'won' } })).sql).toBe(
        `${BARE_SCAN} WHERE NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))`,
      );
      expect(
        (await compile({ $and: [{ $or: [{ stage: 'won' }] }, { $not: { stage: 'lost' } }] })).sql,
      ).toBe(
        `${BARE_SCAN} WHERE (((("stage" = ?))) AND (NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))))`,
      );
    });

    it('keeps the boolean identities of #1073 / #1076 exactly where they were', async () => {
      expect((await compile({})).sql).toBe(BARE_SCAN);
      expect((await compile({ $and: [] })).sql).toBe(BARE_SCAN);
      expect((await compile({ $and: [{}] })).sql).toBe(BARE_SCAN);
      expect((await compile({ $or: [] })).sql).toBe(`${BARE_SCAN} WHERE 1 = 0`);
      expect((await compile({ $or: [{}, { a: 1 }] })).sql).toBe(BARE_SCAN);
      expect((await compile({ $not: {} })).sql).toBe(`${BARE_SCAN} WHERE 1 = 0`);
      expect((await compile(undefined)).sql).toBe(BARE_SCAN);
      expect((await compile(null)).sql).toBe(BARE_SCAN);
    });

    it('leaves an ordinary field named without a $ alone', async () => {
      // The gate keys on the `$` prefix only, so every real column is untouched
      // — including one whose name merely CONTAINS a dollar-free operator word.
      expect((await compile({ eq: 'won', not_stage: 'lost' })).sql).toBe(
        `${BARE_SCAN} WHERE "eq" = ? AND "not_stage" = ?`,
      );
    });
  });

  describe('(g) the neighbouring refusals keep their own wording', () => {
    // Each of these was already refused, by a gate that names a different
    // condition. The new gate must not swallow them into one message — that is
    // the #1051 diagnostic detour re-created, just from the other side.
    it('an unknown FIELD operator is still #1004`s message', async () => {
      const err = await refusalOf({ stage: { $sounds_like: 'won' } });
      expect(err.message).toMatch(/Unsupported filter operator "\$sounds_like" on 'deal\.stage'/);
      expect(err.message).not.toMatch(/combinator/);
    });

    it('an unbindable comparand is still #1058`s message', async () => {
      const err = await refusalOf({ amount: { $gt: { $field: 'budget' } } });
      expect(err.message).toMatch(/Cross-field comparison is not supported/);
    });

    it('a non-node sub-filter is still #1073 / #1076`s message', async () => {
      expect((await refusalOf({ $or: [null] })).message).toMatch(/\$or\[0\] on 'deal' is null/);
      expect((await refusalOf({ $not: 'won' })).message).toMatch(/\$not on 'deal' is a string/);
    });

    it('a non-node top-level where is still #1075`s message', async () => {
      expect((await refusalOf([['stage', '=', 'won']])).message).toMatch(/not a filter condition/);
    });

    it('an empty operator map is still #1071`s message', async () => {
      expect((await refusalOf({ stage: {} })).message).toMatch(/compiles to NO predicate/);
    });

    it('a non-boolean $null comparand is still #1116`s message', async () => {
      expect((await refusalOf({ stage: { $null: 'yes' } })).message).toMatch(
        /requires a boolean comparand/,
      );
    });
  });
});

/**
 * Rows, not SQL strings.
 *
 * A predicate compiled against a column that cannot exist leaves the statement
 * valid — it just answers a different question — and the shape that loses its
 * WHERE entirely leaves a statement that is valid and MUCH wider. Neither is
 * visible to a string assertion. These run against a real SQLite database
 * wearing the libsql interface: the reads must not answer, and the refused
 * mutations must leave every row exactly as it was.
 */
describe('[#5769] a refused node-position $-key touches no rows', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://node-operator.turso.io', client: stub as never });
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
    stub.raw.prepare('SELECT id, stage FROM "deal" ORDER BY id').all() as Array<{
      id: string;
      stage: string;
    }>;

  const ids = async (where: unknown) =>
    ((await driver.find('deal', { where } as unknown as QueryAST)) as any[]).map((r) => r.id).sort();

  it('a read that used to come back empty now says why', async () => {
    // Pre-fix: `RESOLVED []` — a filter that never compiled, reported as
    // "no rows matched".
    for (const where of [{ $eq: 'won' }, { $gt: 5 }, { $where: 'return true' }, { $and: 'x' }]) {
      const err = (await driver
        .find('deal', { where } as unknown as QueryAST)
        .catch((e) => e)) as WireBearingError;
      expect(err, JSON.stringify(where)).toBeInstanceOf(Error);
      expect(err.code, JSON.stringify(where)).toBe('INVALID_FILTER');
      expect(err.status, JSON.stringify(where)).toBe(400);
    }
  });

  it('a refused `deleteMany` deletes NOTHING', async () => {
    await expect(driver.deleteMany('deal', { where: { $eq: 'won' } } as any)).rejects.toThrow(
      /combinator/,
    );
    expect(allRows().map((r) => r.id)).toEqual(['d_lost', 'd_open', 'd_won']);
  });

  it('a refused `updateMany` writes NOTHING', async () => {
    await expect(
      driver.updateMany('deal', { where: { $where: 'x' } } as any, { stage: 'archived' }),
    ).rejects.toThrow(/combinator/);
    expect(allRows().map((r) => r.stage).sort()).toEqual(['lost', 'open', 'won']);
  });

  /**
   * The measurement that made this a P0 rather than a diagnostics complaint.
   * Pre-fix on this exact fixture: `UPDATE "deal" SET "stage" = ?` with no
   * WHERE, and all three rows came back `ARCHIVED`.
   */
  it('the identity-absorbed `$or` no longer rewrites the whole table', async () => {
    await expect(
      driver.updateMany('deal', { where: { $or: [{}, { $where: 'x' }] } } as any, { stage: 'ARCHIVED' }),
    ).rejects.toThrow(/combinator/);
    expect(allRows().map((r) => r.stage).sort()).toEqual(['lost', 'open', 'won']);
    await expect(
      driver.deleteMany('deal', { where: { $or: [{}, { $where: 'x' }] } } as any),
    ).rejects.toThrow(/combinator/);
    expect(allRows()).toHaveLength(3);
  });

  it('well-formed filters still answer exactly as before', async () => {
    expect(await ids({ stage: 'won' })).toEqual(['d_won']);
    expect(await ids({ stage: { $eq: 'won' } })).toEqual(['d_won']);
    expect(await ids({ $or: [{ stage: 'won' }, { stage: 'lost' }] })).toEqual(['d_lost', 'd_won']);
    expect(await ids({ $and: [{ stage: 'won' }, { amount: { $gte: 10 } }] })).toEqual(['d_won']);
    expect(await ids({ $not: { stage: 'won' } })).toEqual(['d_lost', 'd_open']);
    expect(await ids({})).toEqual(['d_lost', 'd_open', 'd_won']);
    expect(await ids({ $and: [] })).toEqual(['d_lost', 'd_open', 'd_won']);
    expect(await ids({ $or: [] })).toEqual([]);
    expect(await driver.count('deal', { where: { stage: 'won' } })).toBe(1);
  });
});

/**
 * Local and remote answer this filter the SAME way.
 *
 * The whole of #5769 is that they did not. `TursoDriver` picks its transport
 * from `url`: a local/replica url inherits `SqlDriver`'s compiler and its
 * #5348 gate, a `libsql://` url gets `RemoteTransport`, which had none. So one
 * driver, one filter, two answers — and the strict one was the local one, which
 * is the direction that lets a bug reach production untested.
 *
 * The wording legitimately differs (this transport keeps its `[RemoteTransport]`
 * prefix, noted as deliberate in `invalidFilterError`); what must not differ is
 * the VERDICT and the envelope a caller branches on.
 */
describe('[#5769] local and remote give the same verdict', () => {
  let local: TursoDriver;
  let remote: TursoDriver;
  let stub: LibsqlSqliteStub;

  const OBJECT = {
    name: 'deal',
    fields: { stage: { type: 'string' }, amount: { type: 'number' } },
  };

  beforeAll(async () => {
    local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    await local.initObjects([OBJECT as any]);
    await local.create('deal', { id: 'd_won', stage: 'won', amount: 10 }, { bypassTenantAudit: true });

    stub = makeLibsqlSqliteStub();
    remote = new TursoDriver({ url: 'libsql://parity.turso.io', client: stub as never });
    await remote.connect();
    expect(remote.transportMode).toBe('remote');
    await remote.syncSchema('deal', OBJECT);
    await remote.create('deal', { id: 'd_won', stage: 'won', amount: 10 });
  });

  afterAll(async () => {
    await local.disconnect();
    await remote.disconnect();
    stub.close();
  });

  const PARITY: Array<[label: string, where: unknown]> = [
    ['$where at the top level', { $where: 'return true' }],
    ['$nor at the top level', { $nor: [{ stage: 'won' }] }],
    ['$expr inside $not', { $not: { $expr: 1 } }],
    ['$where beside the TRUE identity', { $or: [{}, { $where: 'x' }] }],
    ['a misplaced $eq', { $eq: 'won' }],
    ['a non-list $and', { $and: 'x' }],
  ];

  for (const [label, where] of PARITY) {
    it(`${label}: both transports refuse with INVALID_FILTER / 400`, async () => {
      const l = (await local
        .find('deal', { where } as unknown as QueryAST)
        .catch((e) => e)) as WireBearingError;
      const r = (await remote
        .find('deal', { where } as unknown as QueryAST)
        .catch((e) => e)) as WireBearingError;
      expect(l, `local resolved ${label}`).toBeInstanceOf(Error);
      expect(r, `remote resolved ${label}`).toBeInstanceOf(Error);
      expect(l.code).toBe('INVALID_FILTER');
      expect(r.code).toBe('INVALID_FILTER');
      expect(l.status).toBe(400);
      expect(r.status).toBe(400);
    });
  }

  it('and both still answer a well-formed filter identically', async () => {
    const l = (await local.find('deal', { where: { stage: 'won' } })) as any[];
    const r = (await remote.find('deal', { where: { stage: 'won' } })) as any[];
    expect(l.map((x) => x.id)).toEqual(['d_won']);
    expect(r.map((x) => x.id)).toEqual(['d_won']);
  });
});
