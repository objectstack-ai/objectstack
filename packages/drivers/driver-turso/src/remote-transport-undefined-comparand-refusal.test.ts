// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6050] `undefined` in a comparand position is REFUSED — and this transport's
 * half of the defect was the silent one.
 *
 * # What was measured
 *
 * On `origin/main` at `cba7454df`, one `TursoDriver` over the shared conformance
 * fixture (`d` valued on rows 1-2, NULL on 3-4). The `url` it was constructed
 * with chose the answer:
 *
 * | filter | LOCAL (`SqlDriver`) | REMOTE (here) |
 * |---|---|---|
 * | `{ d: undefined }`                    | knex `Undefined binding(s)` | `['3','4']` |
 * | `{ d: { $eq: undefined } }`           | knex `Undefined binding(s)` | `['3','4']` |
 * | `{ $not: { d: undefined } }`          | knex `Undefined binding(s)` | `['1','2']` |
 * | `{ $not: { d: { $ne: undefined } } }` | `[]`                        | `['3','4']` |
 * | `{ d: { $in: [undefined] } }`         | knex `Undefined binding(s)` | `[]` |
 * | `{ d: { $gt: undefined } }`           | knex `Undefined binding(s)` | `[]` |
 *
 * A crash is loud and gets fixed. `['3','4']` is not: this transport compiled
 * `{ d: undefined }` to `"d" IS NULL` and answered. `undefined` cannot survive a
 * JSON round trip, so it only ever arrives from in-process code — which is
 * exactly where `{ owner_id: ctx.user?.id }` lives. With the id missing, a
 * per-owner read scope became `owner_id IS NULL` and returned every env-wide
 * row: not a degraded filter, an over-read.
 *
 * The `$gt` / `$in` rows are the same cause wearing the other polarity, through
 * `serializeComparand`'s `undefined → null` bind: `col > NULL` is UNKNOWN for
 * every row, so the filter answered an empty page and reported nothing.
 *
 * # The ruling
 *
 * REFUSED (`INVALID_FILTER` / 400), adjudicated 2026-08-07 on #6050 — the
 * disposition #5347-A gave a non-boolean `$null`, applied to the one value
 * JavaScript cannot tell apart from an absent key. `{ f: undefined }` and `{}`
 * are the same object to every reader while meaning opposite things, so any
 * compilation of it is a guess about intent.
 *
 * # Reverse verification — direction predicted before it was run, then measured
 *
 * Prediction: unlike `driver-sql`'s twin of this file — where the un-fixed
 * driver threw on most positions and answered on the rest — every refusal case
 * here should go red by RESOLVING, because this transport never threw on any of
 * them. It compiled all of them into valid SQL and returned rows.
 *
 * Measured, with the `assertDefinedComparands` call deleted from
 * `buildWhereSQL` and nothing else changed: **20 failed / 9 passed** of 29, and
 * every one of the 20 failed inside `refusalOf`'s "expected … to be refused, but
 * it compiled to …" branch — i.e. by answering, exactly as predicted. What each
 * one answers is the matrix above.
 *
 * The 9 that stayed green are the controls, and they are the other direction:
 * the `null` block, the node-position refusals, the absent-`where` case, the
 * `$null`/`$exists` boolean-domain case and the ordinary vocabulary. They pin
 * that this change moved nothing it was not ruled to move.
 */

import { describe, it, expect, vi } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
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

async function refusalOf(where: unknown): Promise<WireBearingError> {
  const { t, calls } = transportWithCapturingClient();
  try {
    await t.find('deal', { where } as unknown as QueryAST);
  } catch (e) {
    // A refused filter must not have reached the database on its way to
    // throwing — a statement that ran is a statement whose rows were read.
    expect(calls).toEqual([]);
    return e as WireBearingError;
  }
  throw new Error(
    `expected ${JSON.stringify(where)} to be refused, but it compiled to ${JSON.stringify(calls[0])}`,
  );
}

async function compile(where: unknown): Promise<{ sql: string; args: any[] }> {
  const { t, calls } = transportWithCapturingClient();
  await t.find('deal', { where } as unknown as QueryAST);
  return calls[0];
}

/**
 * `driver-sql`'s leading sentence, pinned as a LITERAL rather than imported.
 *
 * #5240's rule is that one condition speaks one wording wherever the author
 * reached it, and a caller who hits this on a Turso remote url must read the
 * same sentence they would read on Postgres. A literal is what makes the two
 * copies fail apart when one is edited alone — an import would make them agree
 * by construction and prove nothing.
 */
const FRAMEWORK_LEADING_SENTENCE =
  '@objectstack/spec FieldOperatorsSchema declares no undefined comparand';

const BARE_SCAN = 'SELECT * FROM "deal"';

describe('[#6050] RemoteTransport refuses an undefined comparand', () => {
  /** Every position a comparand can occupy, with the path the refusal names. */
  const UNDEFINED_POSITIONS: Array<[label: string, where: unknown, path: string]> = [
    ['a direct comparand', { stage: undefined }, 'where.stage'],
    ['$eq', { stage: { $eq: undefined } }, 'where.stage.$eq'],
    ['$ne', { stage: { $ne: undefined } }, 'where.stage.$ne'],
    ['$gt', { score: { $gt: undefined } }, 'where.score.$gt'],
    ['$gte', { score: { $gte: undefined } }, 'where.score.$gte'],
    ['$lt', { score: { $lt: undefined } }, 'where.score.$lt'],
    ['$lte', { score: { $lte: undefined } }, 'where.score.$lte'],
    ['$contains', { stage: { $contains: undefined } }, 'where.stage.$contains'],
    ['$notContains', { stage: { $notContains: undefined } }, 'where.stage.$notContains'],
    ['$startsWith', { stage: { $startsWith: undefined } }, 'where.stage.$startsWith'],
    ['$endsWith', { stage: { $endsWith: undefined } }, 'where.stage.$endsWith'],
    ['an $in member', { stage: { $in: [undefined] } }, 'where.stage.$in[0]'],
    ['an $in member beside a good one', { stage: { $in: ['won', undefined] } }, 'where.stage.$in[1]'],
    ['a $nin member', { stage: { $nin: [undefined] } }, 'where.stage.$nin[0]'],
    ['inside $and', { $and: [{ stage: undefined }] }, 'where.$and[0].stage'],
    ['inside $or', { $or: [{ stage: { $eq: undefined } }] }, 'where.$or[0].stage.$eq'],
    ['inside $not', { $not: { stage: undefined } }, 'where.$not.stage'],
    ['inside $not, one operator down', { $not: { stage: { $ne: undefined } } }, 'where.$not.stage.$ne'],
  ];

  for (const [label, where, path] of UNDEFINED_POSITIONS) {
    it(`refuses ${label} with INVALID_FILTER / 400`, async () => {
      const err = await refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('is undefined');
      expect(err.message).toContain(path);
      expect(err.message).toContain(FRAMEWORK_LEADING_SENTENCE);
      expect(err.message).toContain('Write null if you meant the null predicate');
      // This transport's messages keep their prefix (#1116 left the prefix pass
      // to #1077); the SENTENCE is what must match framework's.
      expect(err.message).toContain('[RemoteTransport]');
      expect(err.message).toContain(`on 'deal'`);
    });
  }

  /**
   * The pre-walk placement, proved from the outside.
   *
   * `{ $not: { d: undefined } }` is the case that decides where the gate goes:
   * compiling key by key would hand the operand to `nullSafeNegationOperand` —
   * a GUARD reading the polarity tables — with the `undefined` still in it, and
   * #6050 is precisely about guard and emitter disagreeing over this value. The
   * walk runs over the whole subtree first, so the guard never sees it.
   */
  it('refuses inside $not before the NULL-safe rewrite reads the operand', async () => {
    const err = await refusalOf({ $not: { stage: { $ne: undefined } } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('where.$not.stage.$ne');
  });

  it('refuses beside a satisfiable disjunct, and beside the TRUE identity', async () => {
    // An emitter-side gate would resolve the `$or` from the good branch and
    // never look at the offending one — a refusal conditional on siblings.
    const withSibling = await refusalOf({ $or: [{ stage: 'won' }, { stage: undefined }] });
    expect(withSibling.message).toContain('where.$or[1].stage');
    const withIdentity = await refusalOf({ $or: [{}, { stage: { $eq: undefined } }] });
    expect(withIdentity.message).toContain('where.$or[1].stage.$eq');
  });

  /**
   * ⛔ `null` is untouched, clause for clause.
   *
   * These are SQL-text assertions rather than row counts on purpose: the risk a
   * gate like this carries is deleting the null predicate along with the
   * undefined one, and the compiled clause is where that would show.
   */
  describe('null comparands compile byte-identically to before', () => {
    it('`{ field: null }` is still IS NULL', async () => {
      const call = await compile({ stage: null });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" IS NULL`);
      expect(call.args).toEqual([]);
    });

    it('`$eq: null` is still IS NULL and `$ne: null` still IS NOT NULL', async () => {
      expect((await compile({ stage: { $eq: null } })).sql).toBe(`${BARE_SCAN} WHERE "stage" IS NULL`);
      expect((await compile({ stage: { $ne: null } })).sql).toBe(`${BARE_SCAN} WHERE "stage" IS NOT NULL`);
    });

    it('`$null` keeps both booleans', async () => {
      expect((await compile({ stage: { $null: true } })).sql).toBe(`${BARE_SCAN} WHERE "stage" IS NULL`);
      expect((await compile({ stage: { $null: false } })).sql).toBe(`${BARE_SCAN} WHERE "stage" IS NOT NULL`);
    });

    it('a null $in member is still bound, not refused', async () => {
      const call = await compile({ stage: { $in: ['won', null] } });
      expect(call.sql).toContain('IN (?, ?)');
      expect(call.args).toEqual(['won', null]);
    });

    it('`$not` of a null predicate is unchanged', async () => {
      const call = await compile({ $not: { stage: null } });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE NOT ("stage" IS NULL)`);
    });
  });

  /**
   * `$null` / `$exists` keep their OWN refusal for `undefined` — their comparand
   * is a declared BOOLEAN, and the boolean-domain message is the better one for
   * that mistake. One condition, one wording (#5240) cuts both ways.
   */
  it('$null / $exists undefined keeps the boolean-domain wording', async () => {
    for (const where of [{ stage: { $null: undefined } }, { stage: { $exists: undefined } }]) {
      const err = await refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('requires a boolean comparand (true or false)');
      expect(err.message).not.toContain('Write null if you meant the null predicate');
    }
  });

  /**
   * A node-position `undefined` is NOT a comparand and must keep its own
   * refusal, which names the SHAPE the caller sent rather than a comparand
   * position that does not exist there.
   */
  it('leaves the node-position refusals alone', async () => {
    const notOperand = await refusalOf({ $not: undefined });
    expect(notOperand.code).toBe('INVALID_FILTER');
    expect(notOperand.message).toContain('$not');
    expect(notOperand.message).toContain('undefined');
    expect(notOperand.message).not.toContain('Write null if you meant the null predicate');

    const andElement = await refusalOf({ $and: [undefined] });
    expect(andElement.code).toBe('INVALID_FILTER');
    expect(andElement.message).not.toContain('Write null if you meant the null predicate');
  });

  it('an absent `where` is still "no filter", not a refusal', async () => {
    // The ONE `undefined` that is legal, and it is not in a comparand position:
    // all five call sites hand `buildWhereSQL` a `query?.where`, so "no filter"
    // arrives as `undefined` by design.
    const { t, calls } = transportWithCapturingClient();
    await t.find('deal', {} as unknown as QueryAST);
    expect(calls[0].sql).toBe(BARE_SCAN);
    await t.find('deal', { where: undefined } as unknown as QueryAST);
    expect(calls[1].sql).toBe(BARE_SCAN);
    await t.find('deal', { where: null } as unknown as QueryAST);
    expect(calls[2].sql).toBe(BARE_SCAN);
  });

  it('the ordinary vocabulary compiles exactly as before', async () => {
    expect((await compile({ stage: 'won' })).args).toEqual(['won']);
    expect((await compile({ stage: { $in: ['won', 'lost'] } })).args).toEqual(['won', 'lost']);
    expect((await compile({ score: { $gt: 5 } })).args).toEqual([5]);
    // [#6518] `*w*`, not `%w%`: the text family compiles to `GLOB` now, whose
    // wildcard is `*`. The claim is unchanged — a defined comparand still
    // compiles instead of tripping this file's undefined-comparand refusal.
    expect((await compile({ stage: { $contains: 'w' } })).args).toEqual(['*w*']);
    expect((await compile({})).sql).toBe(BARE_SCAN);
  });
});
