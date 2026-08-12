// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import type { QueryAST } from '@objectstack/spec/data';

/**
 * Regression: the remote transport must compile the spec's THIRD logical
 * operator, `$not` (#1076).
 *
 * `buildWhereSQL` handled `$and` and `$or` and had no `$not` branch at all (the
 * only match in the file was `$notContains`), so `$not` fell through to the
 * FIELD path and was read as a column literally named `$not`. Measured on
 * `origin/main` before the fix, with the capturing client below:
 *
 *   { $not: { $eq: 'won' } }     → SELECT * FROM "deal" WHERE "$not" = ?   ['won']
 *   { $not: null }               → SELECT * FROM "deal" WHERE "$not" IS NULL
 *   { $not: { stage: 'won' } }   → THREW: Filter on 'deal.$not' has an object
 *                                  comparand whose key "stage" is not an operator
 *   { $not: { $not: {…} } }      → THREW: Unsupported filter operator "$not" on
 *                                  'deal.$not'
 *
 * Rows one and two are valid SQL against a column that cannot exist (SQLite:
 * `no such column: $not`); rows three and four report `$not` as a FIELD of
 * `deal`, sending the reader to `describe_object` to look for it — the #1051
 * diagnostic detour worn by a different key.
 *
 * Contract evidence (spec `data/filter.zod.ts`, framework origin/main):
 *
 *   $and: z.array(FilterConditionSchema).optional(),
 *   $or:  z.array(FilterConditionSchema).optional(),
 *   $not: FilterConditionSchema.optional(),
 *
 * — declared in the same object literal as the two that WERE implemented. And
 * it is a shape real rules produce: `SqlDriver.applyFilterCondition` compiles it
 * with `whereNot`/`orWhereNot` (framework#2704, added to close this same
 * silent-filter-bypass family), `driver-memory`'s matcher and
 * `matchesFilterCondition` both evaluate it, and CEL `!expr` in a permission /
 * RLS read scope lowers to `{ $not: {…} }` (`formula/src/cel-to-filter.ts`). So
 * one RLS scope answered correctly on a local SqlDriver and broke on Turso
 * remote — a local/remote divergence on a declared spec construct.
 *
 * Two semantics are deliberate and pinned below. One of them has since been
 * RULED and reversed; both are recorded here because the reversal is the point.
 *
 * - **NULL rows are RETURNED (#5146, landed on this face by #5903).** This
 *   bullet used to say the opposite — "NULL rows follow the SQL family:
 *   `NOT ("stage" = ?)` is UNKNOWN when `stage` is NULL, so that row is not
 *   returned, exactly what Knex's `whereNot` emits for local mode;
 *   `driver-memory`/`matchesFilterCondition` return it; remote mode is pinned to
 *   the family it belongs to, so local and remote SQL agree." Every clause of
 *   that was true when it was written and the CONCLUSION expired eleven months
 *   later: objectstack#5146 ruled the two-valued answer canonical and PR #5296
 *   landed it on `SqlDriver.applyFilterCondition`, so local mode — which
 *   inherits it — started returning the NULL row while this independent
 *   compiler did not. The sentence that justified the pin ("local and remote SQL
 *   agree") became the reason to flip it. Measured on `origin/main` on
 *   2026-08-06 against the shared conformance fixture: LOCAL `['2','3','4']`,
 *   REMOTE `['2']`.
 *
 *   The predicate is made TOTAL leaf by leaf before the negation, so
 *   `NOT (…)` is TRUE or FALSE for every row and never UNKNOWN. That is why the
 *   compiled SQL below carries an `IS NOT NULL` conjunct that was not there
 *   before, and why the polarity is per operator rather than a blanket
 *   `OR col IS NULL`: `{ $not: { a: { $ne: 5 } } }` means "a is 5", which a
 *   no-value row must NOT satisfy (pinned in section (g) below).
 * - **`$not: {}` is FALSE.** UNCHANGED. The inner filter compiles to no SQL,
 *   which under the #1073 invariant can only mean "vacuously TRUE", and
 *   `NOT TRUE` is FALSE. `driver-memory` and `matchesFilterCondition` agree;
 *   driver-sql returns every row there, but only because Knex drops an empty
 *   group — the widening direction of the very bug family #2704 closed.
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

/**
 * Every emitted statement must bind exactly as many args as it has `?`s.
 *
 * The mutation this catches: pushing the negated sub-filter's args while
 * emitting `1 = 0` instead of its clause (or the reverse). A bind list that
 * outruns its placeholders is not a compile error in libsql — the extra args
 * are unused, or shift the list and every predicate compares against its
 * neighbour's value.
 */
function expectBindsBalanced(call: { sql: string; args: any[] }) {
  expect(call.args.length).toBe((call.sql.match(/\?/g) ?? []).length);
}

const BARE_SCAN = 'SELECT * FROM "deal"';

describe('RemoteTransport $not (#1076)', () => {
  describe('(a) the two spellings from the issue', () => {
    it('compiles `$not: { stage: "won" }` to a negation, not to a field named $not', async () => {
      // Pre-fix: THREW `Filter on 'deal.$not' has an object comparand whose key
      // "stage" is not an operator`.
      const call = await compile({ $not: { stage: 'won' } });
      // [#5903] The `IS NOT NULL` conjunct is #5146's leaf-totalising guard: a
      // row with no `stage` does not satisfy `stage = 'won'`, so it must satisfy
      // the negation. Without it `NOT (NULL = ?)` is UNKNOWN and the row
      // vanishes.
      expect(call.sql).toBe(`${BARE_SCAN} WHERE NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))`);
      expect(call.args).toEqual(['won']);
      expectBindsBalanced(call);
    });

    it('never emits a column named `$not` again', async () => {
      // The one assertion that fails if the `$not` branch is removed or is
      // guarded so tightly that some spelling slips back onto the field path.
      const shapes: unknown[] = [
        { $not: { stage: 'won' } },
        { $not: { $or: [{ stage: 'won' }, { stage: 'lost' }] } },
        { $not: { $not: { stage: 'won' } } },
        { $not: {} },
        { owner_id: 'u1', $not: { stage: 'lost' } },
      ];
      for (const where of shapes) {
        const call = await compile(where);
        expect(call.sql).not.toMatch(/"\$not"/);
      }
    });

    it('negates a multi-key inner condition as ONE group, like `whereNot` does', async () => {
      // `NOT (a AND b)`, never `NOT (a) AND b` — the inner object is one
      // condition and De Morgan is not the caller's intent.
      const call = await compile({ $not: { stage: 'won', amount: 10 } });
      // Each leaf is guarded independently and the four conjuncts stay inside
      // the ONE negated group — `NOT (a AND b)`, never `NOT (a) AND b`.
      expect(call.sql).toBe(
        `${BARE_SCAN} WHERE NOT ((("stage" IS NOT NULL) AND ("stage" = ?) AND ("amount" IS NOT NULL) AND ("amount" = ?)))`,
      );
      expect(call.args).toEqual(['won', 10]);
    });

    it('refuses the issue\'s `$not: { $eq: "won" }` at the INNER key, not as a field named $not', async () => {
      // Two fixes, read in order.
      //
      // #1076 (this file): `$not` stopped being a column. Pre-#1076 this whole
      // filter compiled to `WHERE "$not" = ?`.
      //
      // #5769 (the successor this case was written to anticipate): the residual
      // `"$eq"` column — the CALLER's malformed inner condition, a field
      // operator written one level too high — is refused rather than compiled.
      // This assertion USED to pin `WHERE NOT ("$eq" = ?)`, on the reasoning
      // that the local `SqlDriver` handed a condition-level `$eq` to Knex as a
      // column name too, so tightening it here alone would fork remote from
      // local. That reasoning expired: objectstack#5348 / PR #5368 put the gate
      // on `SqlDriver`'s validation walk, local went strict, and remote became
      // the last face — which is what objectstack#5769 closed.
      //
      // What the case still proves is what it always proved: the key named in
      // the refusal is the INNER `$eq`, at `where.$not.$eq`. `$not` is the
      // operator it is declared to be, all the way down.
      const err = (await compile({ $not: { $eq: 'won' } }).catch((e) => e)) as Error & {
        code?: string;
        status?: number;
      };
      expect(err).toBeInstanceOf(Error);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('"$eq"');
      expect(err.message).toContain('where.$not.$eq');
      expect(err.message).not.toContain(`'deal.$not'`);
    });
  });

  describe('(b) `$not` of a vacuously TRUE condition is FALSE', () => {
    it('compiles `$not: {}` to a predicate that matches zero rows', async () => {
      const call = await compile({ $not: {} });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE 1 = 0`);
      expect(call.args).toEqual([]);
    });

    it('never compiles `$not: {}` to a bare table scan', async () => {
      // The mutation: emit nothing when the sub-filter compiled to nothing.
      // That says TRUE — the exact inversion of the answer, and on
      // deleteMany/updateMany a whole-table write.
      const call = await compile({ $not: {} });
      expect(call.sql).not.toBe(BARE_SCAN);
      expect(call.sql).toMatch(/WHERE/i);
    });

    it('recognises TRUE by RECURSION, not just a syntactically empty object', async () => {
      // `{ $and: [] }` is TRUE only after #1073's branch has compiled it. A fix
      // that special-cased `Object.keys(value).length === 0` passes the two
      // tests above and fails this one.
      const call = await compile({ $not: { $and: [] } });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE 1 = 0`);
      expect(call.args).toEqual([]);
    });

    it('inverts #1073\'s FALSE back to TRUE — `$not: { $or: [] }` matches every row', async () => {
      const call = await compile({ $not: { $or: [] } });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE NOT (1 = 0)`);
      expect(call.args).toEqual([]);
    });

    it('ANDs the FALSE with its sibling keys rather than replacing them', async () => {
      const call = await compile({ stage: 'won', $not: {} });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" = ? AND 1 = 0`);
      expect(call.args).toEqual(['won']);
      expectBindsBalanced(call);
    });
  });

  describe('(c) nesting and double negation compile by recursion', () => {
    it('compiles `$not: { $not: {…} }` as two nested negations', async () => {
      // Pre-fix: THREW `Unsupported filter operator "$not" on 'deal.$not'`.
      const call = await compile({ $not: { $not: { stage: 'won' } } });
      // The INNER `$not` is left un-rewritten by the outer one on purpose: its
      // own branch totalises its operand, and `NOT <total>` is itself total, so
      // recursing would stack a redundant guard on the same column. The guard
      // therefore appears exactly once, innermost.
      expect(call.sql).toBe(`${BARE_SCAN} WHERE NOT (NOT ((("stage" IS NOT NULL) AND ("stage" = ?))))`);
      expect(call.args).toEqual(['won']);
      expectBindsBalanced(call);
    });

    it('compiles `$not` over a nested `$or`', async () => {
      const call = await compile({ $not: { $or: [{ stage: 'won' }, { stage: 'lost' }] } });
      // De Morgan is sound over two-valued leaves, which is the whole reason the
      // guard rides each LEAF rather than the `NOT`: hoisting it above this
      // `$or` would let a NULL `stage` satisfy the negation even when the other
      // disjunct is satisfied.
      expect(call.sql).toBe(
        `${BARE_SCAN} WHERE NOT ((((("stage" IS NOT NULL) AND ("stage" = ?))) OR ((("stage" IS NOT NULL) AND ("stage" = ?)))))`,
      );
      expect(call.args).toEqual(['won', 'lost']);
      expectBindsBalanced(call);
    });

    it('compiles `$not` over a nested `$and`', async () => {
      const call = await compile({ $not: { $and: [{ stage: 'won' }, { amount: 10 }] } });
      expect(call.sql).toBe(
        `${BARE_SCAN} WHERE NOT ((((("stage" IS NOT NULL) AND ("stage" = ?))) AND ((("amount" IS NOT NULL) AND ("amount" = ?)))))`,
      );
      expect(call.args).toEqual(['won', 10]);
    });

    it('carries operator maps through the negation with their binds in order', async () => {
      const call = await compile({ $not: { amount: { $gte: 10, $lt: 100 } } });
      // ONE guard for the whole field constraint, not one per operator: the
      // constraint is the AND of its operators, so a NULL column satisfies it
      // only if it satisfies all of them — and it satisfies neither bound.
      expect(call.sql).toBe(
        `${BARE_SCAN} WHERE NOT ((("amount" IS NOT NULL) AND ("amount" >= ? AND "amount" < ?)))`,
      );
      expect(call.args).toEqual([10, 100]);
      expectBindsBalanced(call);
    });

    it('keeps the null-equality rule inside a negation (`IS NULL`, never `= NULL`)', async () => {
      // `NOT ("organization_id" = NULL)` is UNKNOWN for every row, so the
      // env-wide negation would match nothing at all — the #937 failure with a
      // NOT in front of it.
      const call = await compile({ $not: { organization_id: null } });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE NOT ("organization_id" IS NULL)`);
      expect(call.args).toEqual([]);
    });
  });

  describe('(d) the RLS shape: a `$not` sitting inside `$and` with siblings', () => {
    it('compiles a scope of the shape CEL `!expr` produces', async () => {
      // What `cel-to-filter.ts` emits for `owner_id == user.id && !(stage ==
      // 'lost')`. Pre-fix the whole read THREW, so the scope was unusable on
      // Turso remote while working locally.
      const call = await compile({ $and: [{ owner_id: 'u1' }, { $not: { stage: 'lost' } }] });
      expect(call.sql).toBe(
        `${BARE_SCAN} WHERE (("owner_id" = ?) AND (NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))))`,
      );
      expect(call.args).toEqual(['u1', 'lost']);
      expectBindsBalanced(call);
    });

    it('compiles a `$not` inside an `$or` branch', async () => {
      const call = await compile({ $or: [{ $not: { stage: 'lost' } }, { owner_id: 'u1' }] });
      expect(call.sql).toBe(
        `${BARE_SCAN} WHERE ((NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))) OR ("owner_id" = ?))`,
      );
      expect(call.args).toEqual(['lost', 'u1']);
    });

    it('keeps a `$not` sibling of plain field keys at the same level', async () => {
      const call = await compile({ owner_id: 'u1', $not: { stage: 'lost' } });
      // The guard stays INSIDE the negated group. This is the assertion that
      // fails if it were ever spliced into the node's bare ` AND ` join, where
      // a stray `OR` would bind looser than the AND and widen the whole filter.
      expect(call.sql).toBe(
        `${BARE_SCAN} WHERE "owner_id" = ? AND NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))`,
      );
      expect(call.args).toEqual(['u1', 'lost']);
    });

    it('lets #1073\'s identity elements survive under a negation', async () => {
      // `$not` of a group that absorbed a TRUE disjunct is `NOT TRUE` = FALSE.
      const call = await compile({ $not: { $or: [{ stage: 'won' }, {}] } });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE 1 = 0`);
      expect(call.args).toEqual([]);
    });
  });

  describe('(e) a `$not` operand that is not a filter node is refused, never read as a column', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['null', null, /is null, not a filter condition/],
      ['undefined', undefined, /is undefined, not a filter condition/],
      ['a string', 'won', /is a string, not a filter condition/],
      ['a number', 7, /is a number, not a filter condition/],
      ['a boolean', true, /is a boolean, not a filter condition/],
      ['an array', [{ stage: 'won' }], /is an array, not a filter condition/],
      ['a Date', new Date('2026-04-29T08:30:00.000Z'), /not a filter condition/],
      ['a typed array', new Uint8Array([]), /not a filter condition/],
    ];

    for (const [label, operand, message] of cases) {
      it(`refuses ${label} as the $not operand`, async () => {
        const { t } = transportWithCapturingClient();
        await expect(t.find('deal', { where: { $not: operand } as any })).rejects.toThrow(message);
      });
    }

    it('names `$not` without an index — it takes one operand, not a list', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { $not: null } as any })).rejects.toThrow(
        /\$not on 'deal'/,
      );
    });

    it('refuses `$not: null` instead of compiling `"$not" IS NULL`', async () => {
      // The pre-fix output verbatim: a valid, silently-narrowing predicate on a
      // column that cannot exist. This is why the branch has no
      // `&& isFilterNode(value)` guard — a guard sends this shape straight back
      // to the field path it came from.
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { $not: null } as any })).rejects.toThrow();
      expect(calls).toEqual([]);
    });

    it('says what a negation of "no condition" is written as', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { $not: 'won' } as any })).rejects.toThrow(
        /\$not takes exactly ONE condition/,
      );
    });

    it('keeps refusing what the INNER filter refuses — the negation swallows nothing', async () => {
      const { t } = transportWithCapturingClient();
      // #1071: an empty operator map on a field.
      await expect(t.find('deal', { where: { $not: { closed_at: {} } } } as unknown as QueryAST)).rejects.toThrow(
        /compiles to NO predicate/,
      );
      // #1004: an unknown operator.
      //
      // [#7536] The exemplar used to be `$like`, and that stopped being a valid
      // choice: `$like` is now a DECLARED operator this transport compiles, so
      // the assertion was pinning a refusal that must no longer happen.
      // `$sounds_like` is this repo's standing stand-in for a spelling the
      // protocol does not have and will not grow — the same name `sql-driver.ts`
      // reaches for when it needs one.
      await expect(
        t.find('deal', { where: { $not: { stage: { $sounds_like: 'w%' } } } } as unknown as QueryAST),
      ).rejects.toThrow(/Unsupported filter operator "\$sounds_like"/);
      // #1058: an unbindable comparand.
      await expect(
        t.find('deal', { where: { $not: { amount: { $gt: { $field: 'budget' } } } } } as unknown as QueryAST),
      ).rejects.toThrow(/Cross-field comparison is not supported/);
      // #1073: a non-node element of a nested logical array.
      await expect(t.find('deal', { where: { $not: { $or: [null] } } } as unknown as QueryAST)).rejects.toThrow(
        /\$or\[0\] on 'deal'/,
      );
    });

    it('executes no statement when it refuses', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { $not: [{ stage: 'won' }] } as any })).rejects.toThrow();
      expect(calls).toEqual([]);
    });

    it('does NOT refuse the shapes that are legal', async () => {
      await expect(compile({ $not: {} })).resolves.toBeDefined();
      await expect(compile({ $not: Object.create(null) })).resolves.toBeDefined();
      await expect(compile({ $not: { stage: 'won' } })).resolves.toBeDefined();
    });
  });

  describe('(f) the same answers through every WHERE-building entry point', () => {
    it('negates on count / deleteMany / updateMany', async () => {
      const { t, calls } = transportWithCapturingClient();
      const where = { $not: { stage: 'won' } };
      await t.count('deal', { where } as unknown as QueryAST);
      await t.deleteMany('deal', { where } as any);
      await t.updateMany('deal', { where } as any, { stage: 'lost' });
      // The one negated predicate all three statements must carry, verbatim —
      // a WHERE that is right for `find` and wrong for `deleteMany` is how a
      // filter fix becomes a data-loss bug.
      const NEGATION = 'WHERE NOT ((("stage" IS NOT NULL) AND ("stage" = ?)))';
      expect(calls[0].sql).toMatch(/COUNT\(\*\)/i);
      expect(calls[0].sql).toContain(NEGATION);
      expect(calls[1].sql).toBe(`DELETE FROM "deal" ${NEGATION}`);
      expect(calls[2].sql).toMatch(
        /^UPDATE "deal" SET .* WHERE NOT \(\(\("stage" IS NOT NULL\) AND \("stage" = \?\)\)\)$/,
      );
      for (const call of calls) expectBindsBalanced(call);
    });

    it('compiles `$not: {}` to FALSE on the writing entry points', async () => {
      // Pre-fix these threw; the mutation to guard against now is the opposite
      // one — dropping the clause, which empties the table.
      const { t, calls } = transportWithCapturingClient();
      await t.deleteMany('deal', { where: { $not: {} } } as any);
      await t.updateMany('deal', { where: { $not: {} } } as any, { stage: 'lost' });
      expect(calls[0].sql).toBe('DELETE FROM "deal" WHERE 1 = 0');
      expect(calls[1].sql).toMatch(/^UPDATE "deal" SET .* WHERE 1 = 0$/);
      expect(calls[1].args).toEqual(['lost']);
      for (const call of calls) expectBindsBalanced(call);
    });

    it('refuses a non-node `$not` operand on the writing entry points too', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.deleteMany('deal', { where: { $not: null } } as any)).rejects.toThrow(
        /not a filter condition/,
      );
      await expect(
        t.updateMany('deal', { where: { $not: 'won' } } as any, { stage: 'lost' }),
      ).rejects.toThrow(/not a filter condition/);
    });
  });
});

/**
 * (g) Rows, not SQL strings.
 *
 * A negation that compiles to valid-but-wrong SQL reads the same as a correct
 * one in a string assertion — the difference only shows up in what comes back.
 * These run the compiled statements against a real SQLite database wearing the
 * libsql interface, the instrument #1066/#1073 used.
 */
describe('TursoDriver remote — $not on real rows (#1076)', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://not-operator.turso.io', client: stub as never });
    await driver.connect();
    expect(driver.transportMode).toBe('remote');
    await driver.syncSchema('deal', {
      name: 'deal',
      fields: {
        stage: { type: 'string' },
        owner_id: { type: 'string' },
        amount: { type: 'number' },
        closed_at: { type: 'datetime' },
      },
    });
    await driver.create('deal', { id: 'd_won', stage: 'won', owner_id: 'u1', amount: 10 });
    await driver.create('deal', { id: 'd_lost', stage: 'lost', owner_id: 'u1', amount: 20 });
    await driver.create('deal', { id: 'd_open', stage: 'open', owner_id: 'u2', amount: 30 });
    // No `stage` at all — the row the SQL family and the JS family disagree
    // about, pinned in its own test below.
    await driver.create('deal', { id: 'd_null', owner_id: 'u2', amount: 40 });
  });

  afterAll(async () => {
    await driver.disconnect();
    stub.close();
  });

  const ids = async (where: unknown) =>
    ((await driver.find('deal', { where } as unknown as QueryAST)) as any[]).map((r) => r.id).sort();

  it('`$not: { stage: "won" }` returns the other rows, not a `no such column` error', async () => {
    // Pre-fix: threw before reaching SQLite; had it compiled, SQLite would have
    // answered `no such column: $not`. `d_null` joins the answer at #5903 — see
    // the next case.
    expect(await ids({ $not: { stage: 'won' } })).toEqual(['d_lost', 'd_null', 'd_open']);
  });

  it('RETURNS the NULL-`stage` row — the #5146 ruling, on this face since #5903', async () => {
    // The direction of this case is REVERSED, deliberately. It read: "drops the
    // NULL-`stage` row — SQL three-valued logic, as `whereNot` does locally.
    // `d_null` is absent above and here. This is the SQL family's answer:
    // `NOT (NULL = 'won')` is UNKNOWN, not TRUE. `driver-memory` and
    // `matchesFilterCondition` would return it. Remote mode is pinned to local
    // SqlDriver so the two SQL transports cannot disagree; the cross-family
    // divergence is objectstack#5146."
    //
    // #5146 ruled that cross-family divergence — the JS answer is canonical, a
    // column with no value does not satisfy the negated condition — and PR
    // #5296 landed it on `SqlDriver`. The last clause of the old comment is
    // what makes this a flip rather than a regression: "the two SQL transports
    // cannot disagree" stopped being true the moment local inherited the fix,
    // and it is true again only with `d_null` on this side of the answer.
    const rows = await ids({ $not: { stage: 'won' } });
    expect(rows).toContain('d_null');
    // …and the row is still identifiable as the no-value row, so this is not
    // passing because the seed lost its NULL.
    expect(await ids({ stage: null })).toEqual(['d_null']);
    // The complement still excludes it: negation is not a licence to return
    // everything.
    expect(await ids({ $not: { stage: { $ne: 'won' } } })).toEqual(['d_won']);
  });

  it('`$not: {}` returns ZERO rows', async () => {
    expect(await ids({ $not: {} })).toEqual([]);
  });

  it('`$not: { $or: [] }` returns EVERY row', async () => {
    expect(await ids({ $not: { $or: [] } })).toEqual(['d_lost', 'd_null', 'd_open', 'd_won']);
  });

  it('double negation returns what the un-negated filter does', async () => {
    expect(await ids({ $not: { $not: { stage: 'won' } } })).toEqual(await ids({ stage: 'won' }));
  });

  it('negates a nested `$or` (De Morgan on real rows)', async () => {
    // `d_null` is in the answer for the same reason it is above: it satisfies
    // neither disjunct, so it satisfies the negation.
    expect(await ids({ $not: { $or: [{ stage: 'won' }, { stage: 'lost' }] } })).toEqual([
      'd_null',
      'd_open',
    ]);
  });

  it('answers the RLS shape — owner AND NOT lost', async () => {
    expect(await ids({ $and: [{ owner_id: 'u1' }, { $not: { stage: 'lost' } }] })).toEqual([
      'd_won',
    ]);
  });

  it('negates a range without leaking binds', async () => {
    // Executed, not string-matched: a stray bind makes better-sqlite3 reject
    // the statement outright.
    expect(await ids({ $not: { amount: { $gte: 20 } } })).toEqual(['d_won']);
  });

  it('applies the calendar-day upper-bound rule INSIDE `$not`', async () => {
    // `toRemoteFilter` recursed into `$and`/`$or` only, so conditions inside a
    // `$not` reached the transport on the raw path, skipping the ADR-0053 D-E3
    // seam — which applies at every depth a condition can appear at.
    //
    // A bare `YYYY-MM-DD` upper bound on a `datetime` column compiles half-open
    // (`$lt` next-midnight, framework#3777) so the whole DAY is inside the
    // bound. Un-lowered it compares an instant against a bare day string and
    // no timestamp in that day is `<=` it — so the negation, which is the
    // complement, hands BACK the very rows the day was meant to cover.
    await driver.updateMany('deal', { where: { id: 'd_won' } } as any, {
      closed_at: new Date('2026-04-29T08:30:00.000Z'),
    });
    await driver.updateMany('deal', { where: { id: 'd_lost' } } as any, {
      closed_at: new Date('2025-01-15T08:30:00.000Z'),
    });
    // `d_lost` closed WITHIN 2025-01-15, so the negation excludes it; `d_won`
    // closed later, so the negation keeps it. Un-lowered, both come back.
    //
    // [#5903] `d_open` and `d_null` never got a `closed_at`, and a row with no
    // value does not satisfy `closed_at <= …`, so the negation now returns
    // them. That is the SAME ruling as the case above applied to a range
    // operator — the guard is `requireValue` for every positive comparison —
    // and it is what LOCAL mode has answered since PR #5296. The lowering
    // assertion is unaffected: `d_lost` is still excluded, which is the only
    // way to tell a lowered upper bound from an un-lowered one.
    expect(await ids({ $not: { closed_at: { $lte: '2025-01-15' } } })).toEqual([
      'd_null',
      'd_open',
      'd_won',
    ]);
  });

  it('lowers `$between` inside `$not` instead of refusing it', async () => {
    // Un-lowered, the transport (correctly) refuses `$between` and names a
    // lowering step that had been skipped for this depth.
    await expect(
      driver.find('deal', { where: { $not: { amount: { $between: [15, 35] } } } }),
    ).resolves.toBeDefined();
    expect(await ids({ $not: { amount: { $between: [15, 35] } } })).toEqual(['d_null', 'd_won']);
  });

  it('`count` agrees with `find`', async () => {
    // Three since #5903 — `d_null` is inside the negation now, and a count that
    // disagreed with the list under it is exactly the local/remote split this
    // issue closed, wearing a total instead of a row set.
    expect(await driver.count('deal', { where: { $not: { stage: 'won' } } })).toBe(3);
    expect((await ids({ $not: { stage: 'won' } })).length).toBe(3);
    expect(await driver.count('deal', { where: { $not: {} } })).toBe(0);
  });

  it('`deleteMany` with `$not: {}` deletes NOTHING', async () => {
    // The arm that makes this more than a wrong count: a dropped clause here
    // empties the table.
    const before = await ids({});
    await driver.deleteMany('deal', { where: { $not: {} } } as any);
    expect(await ids({})).toEqual(before);
  });

  it('`updateMany` with a negation touches only the negated rows', async () => {
    await driver.updateMany('deal', { where: { $not: { owner_id: 'u1' } } } as any, {
      stage: 'zzz',
    });
    expect(await ids({ stage: 'zzz' })).toEqual(['d_null', 'd_open']);
    // The `u1` rows kept their stages.
    expect(await ids({ owner_id: 'u1' })).toEqual(['d_lost', 'd_won']);
  });

  it('a non-node `$not` operand is refused through the driver too', async () => {
    await expect(driver.find('deal', { where: { $not: null } } as unknown as QueryAST)).rejects.toThrow(
      /not a filter condition/,
    );
  });
});
