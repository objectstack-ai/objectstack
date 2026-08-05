// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { RemoteTransport } from './remote-transport.js';
import { TursoDriver } from './turso-driver.js';
import { makeLibsqlSqliteStub, type LibsqlSqliteStub } from './libsql-sqlite-stub.testkit.js';
import type { QueryAST } from '@objectstack/spec/data';

/**
 * Regression: `$and`/`$or` sub-filters that compile to nothing must get the
 * branch's BOOLEAN IDENTITY ELEMENT, not be skipped (#1073).
 *
 * `buildWhereSQL` collected sub-clauses with `if (sc) { … }` and emitted the
 * group only `if (subClauses.length > 0)`. "Compiled to nothing" therefore meant
 * "was never written" — and since AND's identity is TRUE while OR's is FALSE,
 * one rule cannot be right for both. Measured before the fix:
 *
 *   { $or: [] }              → SELECT * FROM "deal"                    ← every row
 *   { $and: [] }             → SELECT * FROM "deal"                    ← every row
 *   { $or: [{a:1}, {}] }     → SELECT * FROM "deal" WHERE (("a" = ?))  ← narrowed
 *
 * Row two is right by accident (dropping a conjunct happens to equal TRUE); the
 * other two are wrong in OPPOSITE directions from the same line of code. `$or:
 * []` is the empty disjunction — FALSE, zero rows — and compiling it away turned
 * "select nothing" into a full table scan, which on `deleteMany`/`updateMany` is
 * a whole-table write. `{}` inside a `$or` is a TRUE disjunct and absorbs the
 * disjunction, so the correct answer is EVERY row; dropping it returned a strict
 * subset instead, the #1004/#1058 silent-narrowing failure worn as a widening
 * one.
 *
 * Contract evidence (spec `data/filter.zod.ts`, origin/main):
 *
 *   $and: z.array(FilterConditionSchema).optional(),
 *   $or:  z.array(FilterConditionSchema).optional(),
 *
 * — plain `z.array`, no `.nonempty()` / `.min(1)`, and `FilterConditionSchema`
 * is `z.record(z.string(), z.unknown()).and(z.object({…optional}))`, which `{}`
 * satisfies. All three shapes are DECLARED LEGAL, so the transport must compile
 * them correctly rather than refuse them. Framework's `matchesFilterCondition`
 * (`packages/formula/src/matches-filter.ts`) already evaluates them this way and
 * pins it — `expect(m(rec, { $or: [] })).toBe(false) // empty OR matches
 * nothing` — as does `driver-memory`'s matcher (`.some()` over an empty array).
 * These tests hold the remote transport to the same table.
 *
 * The other half of the fix is that "compiles to nothing" now has exactly ONE
 * cause. An element that is not a filter NODE (null, a scalar, an array, a
 * `Date`) is refused by form, so `''` can only ever mean "vacuously TRUE" —
 * never "this transport dropped something". Reading a compilation failure as
 * TRUE would be a wider bug than the one being fixed.
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
 * The mutation this catches: pushing a dropped branch's args anyway. A bind list
 * that outruns its placeholders is not a compile error in libsql — the extra
 * args are simply unused, or worse, shift the whole list by one and every
 * predicate silently compares against its neighbour's value.
 */
function expectBindsBalanced(call: { sql: string; args: any[] }) {
  expect(call.args.length).toBe((call.sql.match(/\?/g) ?? []).length);
}

const BARE_SCAN = 'SELECT * FROM "deal"';

describe('RemoteTransport $and/$or identity elements (#1073)', () => {
  describe('(a) the empty disjunction is FALSE, not "no filter"', () => {
    it('compiles `$or: []` to a predicate that matches zero rows', async () => {
      const call = await compile({ $or: [] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE 1 = 0`);
      expect(call.args).toEqual([]);
    });

    it('never compiles `$or: []` to a bare table scan', async () => {
      // The pre-fix output verbatim. This is the assertion that fails if the
      // group is emitted only `if (subClauses.length > 0)` again.
      const call = await compile({ $or: [] });
      expect(call.sql).not.toBe(BARE_SCAN);
      expect(call.sql).toMatch(/WHERE/i);
    });

    it('ANDs the FALSE with its sibling keys rather than replacing them', async () => {
      const call = await compile({ stage: 'won', $or: [] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" = ? AND 1 = 0`);
      expect(call.args).toEqual(['won']);
      expectBindsBalanced(call);
    });

    it('carries the FALSE up through a nesting `$and`', async () => {
      const call = await compile({ $and: [{ $or: [] }] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE ((1 = 0))`);
      expect(call.args).toEqual([]);
    });

    it('keeps a FALSE disjunct as a disjunct — it does not poison its siblings', async () => {
      const call = await compile({ $or: [{ $or: [] }, { stage: 'won' }] });
      // FALSE OR x ≡ x, so this could be simplified — but it must never be
      // simplified in the OTHER direction. Both rows of `stage = 'won'` must
      // still be reachable.
      expect(call.sql).toMatch(/1 = 0/);
      expect(call.sql).toMatch(/OR/i);
      expect(call.sql).toMatch(/"stage"\s*=\s*\?/);
      expect(call.args).toEqual(['won']);
      expectBindsBalanced(call);
    });
  });

  describe('(b) the empty conjunction is TRUE — now on purpose', () => {
    it('compiles `$and: []` to no clause at all', async () => {
      const call = await compile({ $and: [] });
      expect(call.sql).toBe(BARE_SCAN);
      expect(call.args).toEqual([]);
    });

    it('leaves sibling keys standing alone', async () => {
      const call = await compile({ stage: 'won', $and: [] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" = ?`);
      expect(call.args).toEqual(['won']);
    });

    it('drops a TRUE conjunct without touching the others', async () => {
      const call = await compile({ $and: [{ stage: 'won' }, {}] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE (("stage" = ?))`);
      expect(call.args).toEqual(['won']);
      expectBindsBalanced(call);
    });

    it('answers `$and: [{x}, {}]` identically to `$and: [{x}]`', async () => {
      const withVacuous = await compile({ $and: [{ stage: 'won' }, {}] });
      const without = await compile({ $and: [{ stage: 'won' }] });
      expect(withVacuous).toEqual(without);
    });
  });

  describe('(c) a TRUE disjunct absorbs the whole disjunction', () => {
    it('compiles `$or: [{a}, {}]` to every row, not to `a` alone', async () => {
      const call = await compile({ $or: [{ stage: 'won' }, {}] });
      // Pre-fix: `SELECT * FROM "deal" WHERE (("stage" = ?))` with args ['won'].
      expect(call.sql).toBe(BARE_SCAN);
      expect(call.args).toEqual([]);
    });

    it('does not leak the dropped disjunct\'s binds', async () => {
      // The mutation: keep pushing `sa` into `args` while skipping the clause.
      // Nothing in the SQL would look wrong; the statement would just carry a
      // stray bind.
      const call = await compile({ $or: [{ stage: 'won' }, {}] });
      expectBindsBalanced(call);
      expect(call.args).toHaveLength(0);
    });

    it('does not leak them on the entry points that bind unconditionally either', async () => {
      // `find` happens to guard (`if (whereClauses) args.push(...)`), so a leak
      // there is invisible. `count` / `deleteMany` / `updateMany` hand the WHERE
      // args to libsql whether or not a WHERE was emitted — there a stray bind
      // is a real "too many parameter values" failure, not a cosmetic one.
      const { t, calls } = transportWithCapturingClient();
      const where = { $or: [{ stage: 'won' }, {}] };
      await t.count('deal', { where } as unknown as QueryAST);
      await t.deleteMany('deal', { where } as any);
      await t.updateMany('deal', { where } as any, { stage: 'lost' });
      expect(calls[0].args).toEqual([]);
      expect(calls[1].args).toEqual([]);
      // Only the SET value, no WHERE args appended behind it.
      expect(calls[2].args).toEqual(['lost']);
      for (const call of calls) expectBindsBalanced(call);
    });

    it('absorbs regardless of where the vacuous branch sits', async () => {
      const first = await compile({ $or: [{}, { stage: 'won' }] });
      const last = await compile({ $or: [{ stage: 'won' }, {}] });
      const middle = await compile({ $or: [{ stage: 'won' }, {}, { stage: 'lost' }] });
      expect(first.sql).toBe(BARE_SCAN);
      expect(last.sql).toBe(BARE_SCAN);
      expect(middle.sql).toBe(BARE_SCAN);
      expect(middle.args).toEqual([]);
    });

    it('recognises a disjunct that is TRUE by RECURSION, not just syntactically empty', async () => {
      // `{ $and: [] }` is not `{}` — it only becomes TRUE after the branch above
      // has been compiled. A fix that special-cased `Object.keys(sub).length ===
      // 0` at the call site would pass every test above and fail this one.
      const call = await compile({ $or: [{ $and: [] }, { stage: 'won' }] });
      expect(call.sql).toBe(BARE_SCAN);
      expect(call.args).toEqual([]);
    });

    it('still ANDs the absorbed `$or` away against its sibling keys', async () => {
      const call = await compile({ stage: 'won', $or: [{}] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE "stage" = ?`);
      expect(call.args).toEqual(['won']);
    });
  });

  describe('(d) every non-vacuous shape compiles exactly as before', () => {
    it('keeps a two-branch `$or` byte-identical', async () => {
      const call = await compile({ $or: [{ a: 1 }, { b: 2 }] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE (("a" = ?) OR ("b" = ?))`);
      expect(call.args).toEqual([1, 2]);
    });

    it('keeps a two-branch `$and` byte-identical', async () => {
      const call = await compile({ $and: [{ a: 1 }, { b: 2 }] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE (("a" = ?) AND ("b" = ?))`);
      expect(call.args).toEqual([1, 2]);
    });

    it('keeps each branch ANDing its OWN keys (the #3774 invariant)', async () => {
      const call = await compile({ $or: [{ a: 'x', b: 'y' }, { a: 'qq' }] });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE (("a" = ? AND "b" = ?) OR ("a" = ?))`);
      expect(call.args).toEqual(['x', 'y', 'qq']);
    });

    it('keeps nested combinators and their bind order', async () => {
      const call = await compile({
        $or: [{ $and: [{ a: 1 }, { b: 2 }] }, { c: 3 }],
      });
      expect(call.sql).toBe(`${BARE_SCAN} WHERE (((("a" = ?) AND ("b" = ?))) OR ("c" = ?))`);
      expect(call.args).toEqual([1, 2, 3]);
    });

    it('keeps a top-level empty/absent filter meaning "no WHERE"', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.find('deal', {});
      await t.find('deal', { where: {} });
      expect(calls[0].sql).toBe(BARE_SCAN);
      expect(calls[1].sql).toBe(BARE_SCAN);
    });

    it('keeps #1071 tight — an empty operator map on a FIELD still throws', async () => {
      // A field's `{}` has no identity element to fall back on: there is no
      // "TRUE constraint" on a column, only a missing one. The two empties are
      // deliberately answered differently, and this pins the pair.
      const { t } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { closed_at: {} } })).rejects.toThrow(
        /compiles to NO predicate/,
      );
      await expect(
        t.find('deal', { where: { $or: [{ stage: 'won' }, { closed_at: {} }] } }),
      ).rejects.toThrow(/compiles to NO predicate/);
    });

    it('keeps #1066 tight — a bare Date inside a branch is still an equality', async () => {
      const at = '2026-04-29T08:30:00.000Z';
      const call = await compile({ $or: [{ closed_at: new Date(at) }, { stage: 'lost' }] });
      expect(call.args).toEqual([at, 'lost']);
      expectBindsBalanced(call);
    });
  });

  describe('(e) a branch element that is NOT a filter node is refused, never read as TRUE', () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ['null', null, /is null, not a filter condition/],
      ['undefined', undefined, /is undefined, not a filter condition/],
      ['a string', 'stage', /is a string, not a filter condition/],
      ['a number', 7, /is a number, not a filter condition/],
      ['a boolean', true, /is a boolean, not a filter condition/],
      ['a nested AST array', [['stage', '=', 'won']], /is an array, not a filter condition/],
      ['a Date', new Date('2026-04-29T08:30:00.000Z'), /not a filter condition/],
      ['an empty typed array', new Uint8Array([]), /not a filter condition/],
    ];

    for (const [label, sub, message] of cases) {
      it(`refuses ${label} in a $or branch`, async () => {
        const { t } = transportWithCapturingClient();
        await expect(t.find('deal', { where: { $or: [{ stage: 'won' }, sub] } as any })).rejects.toThrow(
          message,
        );
      });

      it(`refuses ${label} in a $and branch`, async () => {
        const { t } = transportWithCapturingClient();
        await expect(t.find('deal', { where: { $and: [sub] } as any })).rejects.toThrow(message);
      });
    }

    it('names the branch and the INDEX so the offending element is findable', async () => {
      const { t } = transportWithCapturingClient();
      await expect(
        t.find('deal', { where: { $or: [{ stage: 'won' }, { stage: 'lost' }, null] } as any }),
      ).rejects.toThrow(/\$or\[2\] on 'deal'/);
    });

    it('refuses a non-node nested one level down too', async () => {
      const { t } = transportWithCapturingClient();
      await expect(
        t.find('deal', { where: { $and: [{ $or: [null] }] } as any }),
      ).rejects.toThrow(/\$or\[0\] on 'deal'/);
    });

    it('executes no statement when it refuses', async () => {
      const { t, calls } = transportWithCapturingClient();
      await expect(t.find('deal', { where: { $or: [null] } as any })).rejects.toThrow();
      expect(calls).toEqual([]);
    });

    it('does NOT refuse the shapes that are legal — `{}` and `[]` still compile', async () => {
      // The refusal must not swallow the identity cases it sits next to.
      await expect(compile({ $or: [{}] })).resolves.toBeDefined();
      await expect(compile({ $or: [] })).resolves.toBeDefined();
      await expect(compile({ $and: [{}] })).resolves.toBeDefined();
      await expect(compile({ $or: [Object.create(null)] })).resolves.toBeDefined();
    });
  });

  describe('(f) the same answers through every WHERE-building entry point', () => {
    it('compiles `$or: []` to FALSE on count / deleteMany / updateMany', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.count('deal', { object: 'deal', where: { $or: [] } });
      await t.deleteMany('deal', { where: { $or: [] } } as any);
      await t.updateMany('deal', { where: { $or: [] } } as any, { stage: 'lost' });
      // Pre-fix these were an unfiltered COUNT, a DELETE of the whole table and
      // an UPDATE of every row. The write paths are why this is not cosmetic.
      expect(calls[0].sql).toMatch(/COUNT\(\*\).+WHERE 1 = 0/i);
      expect(calls[1].sql).toBe('DELETE FROM "deal" WHERE 1 = 0');
      expect(calls[2].sql).toMatch(/^UPDATE "deal" SET .* WHERE 1 = 0$/);
    });

    it('refuses a non-node branch element on the writing entry points too', async () => {
      const { t } = transportWithCapturingClient();
      await expect(t.deleteMany('deal', { where: { $or: [null] } } as any)).rejects.toThrow(
        /not a filter condition/,
      );
      await expect(
        t.updateMany('deal', { where: { $and: ['stage'] } } as any, { stage: 'lost' }),
      ).rejects.toThrow(/not a filter condition/);
    });
  });
});

/**
 * (g) Rows, not SQL strings.
 *
 * A mis-applied identity element leaves the SQL valid — just answering a
 * different question — so the string assertions above cannot tell "matches zero
 * rows" from "matches every row" on their own. These run the compiled statements
 * against a real SQLite database wearing the libsql interface and count what
 * comes back, the same instrument #1066 used.
 */
describe('TursoDriver remote — identity elements on real rows (#1073)', () => {
  let driver: TursoDriver;
  let stub: LibsqlSqliteStub;

  beforeAll(async () => {
    stub = makeLibsqlSqliteStub();
    driver = new TursoDriver({ url: 'libsql://identity.turso.io', client: stub as never });
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

  const ids = async (where: unknown) =>
    ((await driver.find('deal', { where } as unknown as QueryAST)) as any[]).map((r) => r.id).sort();

  it('`$or: []` returns ZERO rows', async () => {
    // Pre-fix: all three.
    expect(await ids({ $or: [] })).toEqual([]);
  });

  it('`$and: []` returns every row', async () => {
    expect(await ids({ $and: [] })).toEqual(['d_lost', 'd_open', 'd_won']);
  });

  it('`$or: [{stage:won}, {}]` returns every row', async () => {
    // Pre-fix: only `d_won` — the vacuous disjunct, which admits everything,
    // was dropped and the answer silently narrowed to a strict subset.
    expect(await ids({ $or: [{ stage: 'won' }, {}] })).toEqual(['d_lost', 'd_open', 'd_won']);
  });

  it('`$and: [{stage:won}, {}]` still returns only the matching row', async () => {
    expect(await ids({ $and: [{ stage: 'won' }, {}] })).toEqual(['d_won']);
  });

  it('`count` with an absorbed `$or` counts every row and binds nothing', async () => {
    // Executed, not string-matched: a stray bind left over from the absorbed
    // disjunct makes better-sqlite3 reject the statement outright.
    expect(await driver.count('deal', { object: 'deal', where: { $or: [{ stage: 'won' }, {}] } })).toBe(3);
    expect(await driver.count('deal', { object: 'deal', where: { $or: [] } })).toBe(0);
  });

  it('a real two-branch `$or` is unchanged', async () => {
    expect(await ids({ $or: [{ stage: 'won' }, { stage: 'lost' }] })).toEqual(['d_lost', 'd_won']);
  });

  it('`{ stage: won, $or: [] }` returns zero rows — the FALSE wins the AND', async () => {
    expect(await ids({ stage: 'won', $or: [] })).toEqual([]);
  });

  it('`deleteMany` with `$or: []` deletes NOTHING', async () => {
    // The arm that made this a P0 rather than a wrong count: pre-fix the WHERE
    // vanished and the statement emptied the table.
    await driver.deleteMany('deal', { where: { $or: [] } } as any);
    expect(await ids({})).toEqual(['d_lost', 'd_open', 'd_won']);
  });

  it('`updateMany` with `$or: []` updates NOTHING', async () => {
    await driver.updateMany('deal', { where: { $or: [] } } as any, { stage: 'zzz' });
    expect(await ids({ stage: 'zzz' })).toEqual([]);
  });

  it('a non-node branch element is refused through the driver too', async () => {
    await expect(driver.find('deal', { where: { $or: [null] } } as unknown as QueryAST)).rejects.toThrow(
      /not a filter condition/,
    );
  });
});
