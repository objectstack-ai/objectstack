// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5907] An aggregate function this transport cannot compile is refused with a
 * WIRE IDENTITY — the same one, in the same words, that the LOCAL driver gives.
 *
 * # Why both faces, in one issue
 *
 * `TursoDriver` picks its transport from `url`: a local/replica URL inherits
 * `SqlDriver`, a remote one delegates here. Both faces threw a bare `Error` for
 * this condition, so fixing only this one would have created the divergence
 * #5769 spent a whole issue closing — one condition, two wire identities,
 * decided by a connection string. Measured on `origin/main` @ `80f7dc6a3`:
 *
 * ```
 * REMOTE median          -> THREW code=undefined status=undefined msg="Unsupported aggregate function: median"
 * LOCAL  median          -> THREW code=undefined status=undefined msg="Unsupported aggregate function: median"
 * REMOTE count_distinct  -> THREW code=undefined status=undefined msg="Unsupported aggregate function: count_distinct"
 * LOCAL  count_distinct  -> THREW code=undefined status=undefined msg="Unsupported aggregate function: count_distinct"
 * ```
 *
 * `code`/`status` absent on both, so `mapDataError` served an opaque 500 for
 * what is a 400-class caller mistake (`median`) or a 501-class capability gap
 * (`count_distinct` — declared by `AggregationFunction`, compiled by
 * `driver-mongodb`). The parity test at the bottom is the half of this file that
 * cannot be satisfied by editing one package.
 *
 * # ⚠️ Every case asserts `code` AND `status`
 *
 * The un-fixed transport already threw on every input below. `rejects.toThrow()`
 * would have been green before and after — blind to the whole defect (#6144).
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * Prediction: unlike the `undefined`-comparand twin (#6050), where the un-fixed
 * transport ANSWERED and the reverted tests went red by resolving, this one
 * refused all along. So with the bare `throw new Error(...)` restored, every
 * refusal case must fail on its FIRST assertion (`err.code` → `undefined`) and
 * none through `refusalOf`'s "it resolved" branch; the parity cases must fail on
 * the comparison; the controls (SQL text, computed vocabulary) stay green.
 *
 * Measured — and the prediction was HALF WRONG, in the way that matters most
 * here, so it is recorded rather than tidied:
 *
 * 1. **Both faces reverted**: 8 failed / 8 passed of 16. All 8 failures on
 *    `expected undefined to be 'INVALID_QUERY' / 'NOT_IMPLEMENTED'`, none on
 *    "it resolved" — as predicted. But the four PARITY cases stayed **green**:
 *    with both faces anonymous they agree on `undefined`/`undefined` and (for a
 *    lowercase name) on the same message text. A parity test measures
 *    AGREEMENT, not correctness; reverting both halves keeps them agreeing.
 * 2. **ONE face reverted** — measured by accident first, from a stale
 *    `@objectstack/driver-sql` `dist/` while this package's source was fixed:
 *    the four parity cases fail with `expected 'NOT_IMPLEMENTED' to be
 *    undefined` and `expected 'INVALID_QUERY' to be undefined`.
 *
 * (2) is the direction this file exists for. The defect these tests guard is not
 * "the transport is silent" — it is "the two faces answer one query
 * differently", so the case that must go red is the SINGLE-face change, which is
 * exactly what a future PR touching only one package would produce.
 *
 * ---
 *
 * # [#6203] The other half of the same fork: which names COMPILE
 *
 * #5907 made the two faces agree on how a refusal is SPELLED. It deliberately
 * did not touch which names each face compiles, and recorded the residue here as
 * a `[filed, not fixed]` control: this transport lowercased the function name
 * before its lookup and the local driver did not, so `COUNT` compiled here and
 * was refused there. Measured on `origin/main` @ `d367f03d6`:
 *
 * ```
 * COUNT   REMOTE -> RESOLVED "SELECT count(\"stage\") AS \"n\" FROM \"deal\""
 *         LOCAL  -> THREW INVALID_QUERY/400 "…\"COUNT\" is not a declared aggregate function"
 * Count   REMOTE -> RESOLVED (same)          LOCAL -> THREW INVALID_QUERY/400
 * ```
 *
 * #6203 closes it by DELETING the `toLowerCase()` — the contract-first
 * direction of the two available. `AggregationFunction` is a case-sensitive
 * `z.enum`, so `COUNT` is a spelling the Query Protocol never declared and what
 * this transport accepted was a private dialect; teaching the local driver the
 * same dialect instead would have fossilised it into a second de-facto contract
 * (PD#12). The control is flipped into the `[#6203]` block at the bottom, whose
 * own docblock carries the per-case reverse-verification prediction.
 *
 * ---
 *
 * # [#6409] Class 2 emptied: `count_distinct` COMPILES on both faces
 *
 * Two rows of the measurement at the top are now history. `REMOTE
 * count_distinct` and `LOCAL count_distinct` no longer throw — the ENFORCE leg
 * of #6188's split ruling landed the `COUNT(DISTINCT x)` lowering on both faces
 * in one change, which is the only way it could land: `TursoDriver` picks its
 * face from `url`, so a lowering on one of them alone would be #6203's shape
 * again.
 *
 * The class-2 block is flipped, not deleted, and what replaced its 501
 * assertions is the NEW substance — the declared-minus-compiled set asserted
 * EMPTY (positively, so a future spec addition goes red here), the emitted
 * `count(distinct "stage")`, and the refusal wording asserted to have gained
 * `count_distinct` as a COMPILED function rather than an unsupported one. The
 * parity block gains the two cases that follow from it: `count_distinct` is
 * ANSWERED identically by both faces, and its one new refusal — a field-less
 * `count_distinct`, since `COUNT(DISTINCT *)` is not valid SQL — is REFUSED
 * identically by both, `INVALID_QUERY`/400, one wording.
 *
 * Class 1 is untouched. `median`, `array_agg`, `string_agg` and every miscased
 * spelling are still names the Query Protocol does not declare; those refusals
 * stay verbatim. A pin is flipped only where the fact under it moved.
 */

import { describe, it, expect, vi } from 'vitest';
import { SqlDriver } from '@objectstack/driver-sql';
import { RemoteTransport } from './remote-transport.js';
import { AggregationFunction } from '@objectstack/spec/data';
import type { AggregationNode, QueryAST } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** See the twin's note: the sentences are spelled out, not imported. */
const UNDECLARED_SENTENCE = (f: string) =>
  `Aggregate function "${f}" is not a declared aggregate function.`;
const UNCOMPILABLE_SENTENCE = (f: string) =>
  `Aggregate function "${f}" is declared but not implemented by this backend.`;

/**
 * [#4918] The twins of the query builders in
 * `driver-sql`'s `sql-driver-out-of-contract-aggregate-function.test.ts`, and
 * for the same reason: class 2's fixtures are typed against the declared enum so
 * `tsc` proves they ARE declared, while class 1's are off-contract by
 * construction and say so with `as unknown as QueryAST` — the contract being
 * bypassed is named, every other key stays checked.
 */
const declaredAst = (fn: AggregationNode['function']): QueryAST => ({
  object: 'deal',
  aggregations: [{ function: fn, field: 'stage', alias: 'n' }],
});

const undeclaredAst = (fn: string): QueryAST => ({
  object: 'deal',
  aggregations: [{ function: fn, field: 'stage', alias: 'n' }],
}) as unknown as QueryAST;

/**
 * The control fixture for the default alias: off-contract on the one axis it
 * needs (no `alias`, which `AggregationNodeSchema` requires), because what it
 * pins is precisely how this transport names a result column when the caller
 * gave it nothing to work with. Same `as unknown as QueryAST` discipline.
 *
 * [#6203] It used to be off-contract on a SECOND axis — the name was miscased —
 * which stopped being expressible the moment a miscased name became a refusal.
 */
const aliaslessAst = (fn: string): QueryAST => ({
  object: 'deal',
  aggregations: [{ function: fn, field: 'stage' }],
}) as unknown as QueryAST;

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

async function refusalOfAst(fn: string, ast: QueryAST): Promise<WireBearingError> {
  const { t, calls } = transportWithCapturingClient();
  try {
    await t.aggregate('deal', ast);
  } catch (e) {
    // A refused aggregation must not have reached the database on its way to
    // throwing — a statement that ran is a statement that cost a round trip and
    // may have scanned the table.
    expect(calls).toEqual([]);
    return e as WireBearingError;
  }
  throw new Error(`expected the transport to refuse "${fn}", but it compiled to ${JSON.stringify(calls)}`);
}

/** Class 1's inputs: off-contract by construction — see {@link undeclaredAst}. */
const refusalOfUndeclared = (fn: string) => refusalOfAst(fn, undeclaredAst(fn));

// [#6409] `refusalOfDeclared` — the class-2 helper — is gone with the class. It
// took an `AggregationNode['function']` and there is no longer a member of that
// type either face refuses, so keeping it would have been a helper with no
// callable input rather than a helper with no caller. `declaredAst` stays: the
// parity block builds `count_distinct`'s ANSWER with it.

/**
 * The same query put to the OTHER face of `TursoDriver` — the local/replica one,
 * which inherits `SqlDriver`. Module-scoped because two blocks below need it:
 * #5240's wording parity and #6203's case parity.
 */
async function localRefusalOf(fn: string, ast: QueryAST): Promise<WireBearingError> {
  const d = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  await d.initObjects([
    { name: 'deal', fields: { id: { type: 'text', name: 'id' }, stage: { type: 'text', name: 'stage' } } } as any,
  ]);
  try {
    await d.aggregate('deal', ast);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error(`expected the local driver to refuse "${fn}", but it resolved`);
}

describe('[#5907] RemoteTransport refuses an aggregate function it cannot compile', () => {
  describe('a function name the Query Protocol never declared', () => {
    // `array_agg` / `string_agg` moved here from the class below at #6188, which
    // retired both from `AggregationFunction` — they are now undeclared names
    // (400), not declared-but-uncompiled ones (501). Mirrors the twin in
    // `driver-sql`; the parity block further down compares the two faces on the
    // reclassified pair as well.
    const UNDECLARED = [
      'median', 'stddev', 'percentile_cont', 'group_concat', 'array_agg', 'string_agg',
    ];

    for (const fn of UNDECLARED) {
      it(`refuses "${fn}" with INVALID_QUERY / 400`, async () => {
        const err = await refusalOfUndeclared(fn);
        expect(err.code).toBe('INVALID_QUERY');
        expect(err.status).toBe(400);
        expect(err.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(true);
        for (const declared of AggregationFunction.options) {
          expect(err.message).toContain(declared);
        }
        expect(err.message).not.toContain('capability gap');
        // #1116's note: this transport's refusals no longer wear a
        // `[RemoteTransport]` prefix — driver-internal wording is not the
        // caller's business.
        expect(err.message).not.toContain('[RemoteTransport]');
      });
    }

    it('quotes the spelling the CALLER wrote, not a normalised one', async () => {
      // The refusal is judged and worded on the caller's own bytes, so
      // `COUNT_DISTINCT` is undeclared here exactly as it is on the local driver
      // — the two faces agree on the class instead of splitting 400/501 over a
      // normalisation difference. #5907 established this while this transport
      // still lowercased for its LOOKUP; #6203 removed that lookup
      // normalisation, so the guard is now double-locked rather than moot: it
      // still fails on a `toLowerCase()` reintroduced anywhere between the
      // caller's value and the message.
      const err = await refusalOfUndeclared('COUNT_DISTINCT');
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      expect(err.message).toContain('"COUNT_DISTINCT"');
      expect(err.message).not.toContain('"count_distinct"');
    });
  });

  describe('[#6409] class 2 is empty — every declared function compiles here', () => {
    // `count_distinct` was this class's last member on this face too; #6409
    // lowered it to `count(distinct "x")` here and on the local driver in ONE
    // change, so there is no 501-bearing input left to construct. The TYPE
    // annotation is kept on the empty array — it is what makes re-adding a name
    // a `tsc`-checked claim that the name really is declared (#4918).
    const UNCOMPILABLE: Array<AggregationNode['function']> = [];

    it('the declared-but-uncompiled set is EMPTY', () => {
      const compiled = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
      expect([...AggregationFunction.options].filter((f) => !compiled.includes(f)).sort())
        .toEqual([...UNCOMPILABLE].sort());
      expect(UNCOMPILABLE).toEqual([]);
    });

    // The substance that replaced the 501 assertion: the name goes through the
    // COMPILE door. Asserted on the emitted statement, which is this file's
    // instrument; the VALUES, on both faces at once, are `AGGREGATION_CASES`'
    // job (`turso-remote-aggregation-conformance.test.ts`).
    it('`count_distinct` compiles instead of being refused', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', declaredAst('count_distinct'));
      expect(calls.map((c) => c.sql))
        .toEqual(['SELECT count(distinct "stage") AS "n" FROM "deal"']);
    });

    // The wording half of the acceptance: the refusal no longer names
    // `count_distinct` as unsupported. Read off a REAL refusal, since the
    // message builds its list from the lowering table.
    it('the refusal message names `count_distinct` among the functions it COMPILES', async () => {
      const err = await refusalOfUndeclared('median');
      expect(err.message).toContain('count, sum, avg, min, max, count_distinct');
      expect(err.message).not.toContain('count_distinct" is declared but not implemented');
    });

    // The class-2 producer is deliberately kept in `remote-transport.ts` with
    // nothing to produce — see its docblock. This states the consequence, so an
    // unreachable branch is not read as an oversight.
    it('the two refusal sentences remain distinguishable', () => {
      expect(UNCOMPILABLE_SENTENCE('x')).not.toBe(UNDECLARED_SENTENCE('x'));
      expect(UNCOMPILABLE_SENTENCE('x')).toContain('declared but not implemented');
    });
  });

  // ── The cross-package half: one condition, one wording ─────────────────────

  describe('local/remote parity (#5240 — one condition, one wording)', () => {
    // Compared as RUNTIME messages from the two packages, not as two copies of a
    // literal — a shared constant would agree with itself no matter how far the
    // two faces drifted. This is what makes "首句逐字一致" checkable.
    // One entry per class, each carrying the query value its class is entitled
    // to: `median` cannot be a `QueryAST` (that is what class 1 means), the
    // declared name can and is.
    //
    // `array_agg` / `string_agg` stay in this list across #6188 and change
    // SIDES: they were class-2 fixtures built with `declaredAst`, and now that
    // the enum no longer has them they are class-1 fixtures built with
    // `undeclaredAst`. Parity is the property that must survive the
    // reclassification — the two faces have to agree on the NEW answer as
    // exactly as they agreed on the old one, which is what would break if only
    // one of them read the narrowed enum.
    //
    // [#6409] `count_distinct` LEAVES this list, and it is the first entry to
    // leave by being ANSWERED rather than by being reclassified. Its parity is
    // now a parity of VALUES, and it moved to the block below rather than being
    // dropped: a name that stops being refused stops having a refusal to
    // compare, but the property #5240 asks for — the two faces cannot be told
    // apart by a caller — is exactly as load-bearing for an answer as for a
    // refusal, and #6203 is what happens when only one face gains a spelling.
    const PARITY: Array<[fn: string, ast: QueryAST]> = [
      ['median', undeclaredAst('median')],
      ['array_agg', undeclaredAst('array_agg')],
      ['string_agg', undeclaredAst('string_agg')],
    ];
    for (const [fn, ast] of PARITY) {
      it(`"${fn}" is answered identically by the local driver and this transport`, async () => {
        const remote = await refusalOfAst(fn, ast);
        const local = await localRefusalOf(fn, ast);
        expect(remote.code).toBe(local.code);
        expect(remote.status).toBe(local.status);
        // The first sentence is the contract; the tails happen to coincide too
        // because both faces compile the same six functions today, so the whole
        // message is compared while that holds.
        expect(remote.message.split('. ')[0]).toBe(local.message.split('. ')[0]);
        expect(remote.message).toBe(local.message);
      });
    }

    /**
     * [#6409] The parity `count_distinct` moved to: both faces ANSWER it, and
     * they answer it the same way.
     *
     * The local driver runs a real better-sqlite3 database while this transport
     * builds a statement string, so the two are compared on the axis they
     * share — the SQL each emits for one aggregation. That the two agree on the
     * VALUES over a fixture with duplicates and nulls is the shared
     * `AGGREGATION_CASES` table's job, run against both faces by the two
     * conformance suites; this case is the local one, kept here because this
     * file is where "one query, one answer, whatever the connection string"
     * lives.
     */
    it('[#6409] `count_distinct` is COMPILED by both faces, not refused by either', async () => {
      const ast = declaredAst('count_distinct');

      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', ast);
      expect(calls.map((c) => c.sql))
        .toEqual(['SELECT count(distinct "stage") AS "n" FROM "deal"']);

      const d = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      await d.initObjects([
        { name: 'deal', fields: { id: { type: 'text', name: 'id' }, stage: { type: 'text', name: 'stage' } } } as any,
      ]);
      // An empty table on the local face, matching the empty result set the
      // capturing client returns: what is compared is that NEITHER face refuses,
      // which is the fork this case guards.
      await expect(d.aggregate('deal', ast)).resolves.toEqual([{ n: 0 }]);
    });

    /**
     * [#6409] The new refusal, on both faces: `count_distinct` with no `field`.
     * `COUNT(DISTINCT *)` is not valid SQL, so this is a mistake in the
     * aggregation node rather than a capability gap — `INVALID_QUERY` / 400 —
     * and #5240 applies to it like any other condition: one wording, both faces.
     * `code` AND `status`, never a bare `toThrow` (#6144, ADR-0112).
     */
    it('[#6409] a field-less `count_distinct` is refused identically by both faces', async () => {
      const ast = {
        object: 'deal',
        aggregations: [{ function: 'count_distinct', alias: 'n' }],
      } as QueryAST;

      const remote = await refusalOfAst('count_distinct', ast);
      const local = await localRefusalOf('count_distinct', ast);

      expect(remote.code).toBe('INVALID_QUERY');
      expect(remote.status).toBe(400);
      expect(local.code).toBe(remote.code);
      expect(local.status).toBe(remote.status);
      expect(remote.message.split('. ')[0]).toBe(local.message.split('. ')[0]);
      expect(remote.message).toBe(local.message);
      expect(remote.message).toContain('nothing to deduplicate');
      // ⛔ Not the capability-gap answer: both faces DO compile this function.
      expect(remote.message).not.toContain('capability gap');
      expect(remote.message).not.toContain('[RemoteTransport]');
      expect(local.message).not.toContain('[sql-driver]');
    });
  });

  // ── Controls: nothing but the refusal's identity moved ─────────────────────

  describe('the compiled vocabulary is untouched', () => {
    // The five whose lowering IS a function name. [#6409] The sixth,
    // `count_distinct`, deliberately cannot join this loop — its lowering puts
    // a keyword inside the argument list, which is the whole reason it needed a
    // change here at all, and it is asserted on its own above.
    it('emits byte-identical SQL for the five functions it lowers as a bare name', async () => {
      for (const fn of ['count', 'sum', 'avg', 'min', 'max'] as const) {
        const { t, calls } = transportWithCapturingClient();
        await t.aggregate('deal', declaredAst(fn));
        expect(calls.map((c) => c.sql)).toEqual([`SELECT ${fn}("stage") AS "n" FROM "deal"`]);
      }
    });

    /**
     * [#6203] Was `aliaslessAst('COUNT')` — off-contract on two axes at once, a
     * miscased name AND no `alias`. The miscased half is now refused, so the
     * fixture drops to the one axis it was actually pinning: how this transport
     * NAMES a result column when the caller gave it nothing to work with. The
     * expected SQL is unchanged, and that is the point of the case — the default
     * alias used to be built from the lowercased name and is now built from the
     * caller's own, which is the same string for every input that still
     * compiles, because every key in the lowering table is lowercase.
     */
    it('the default alias still spells itself from the function name', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', aliaslessAst('count'));
      expect(calls[0].sql).toBe('SELECT count("stage") AS "count_stage" FROM "deal"');
    });
  });

  // ── #6203: one spelling, both faces ───────────────────────────────────────

  /**
   * [#6203] A miscased function name is refused by BOTH faces, with one wire
   * identity — the half of the local/remote fork #5907 left open.
   *
   * This block replaces the `[filed, not fixed]` control that #5907's PR left
   * here recording `COUNT` compiling on this transport. That case pinned exactly
   * the limb this issue deletes, so re-spelling it was not an option: it is
   * flipped, not adjusted.
   *
   * # Reverse verification — direction predicted BEFORE it was run
   *
   * Restore `REMOTE_AGGREGATE_FUNCTIONS.get(func.toLowerCase())` and the four
   * cases below do NOT move together. Predicted, per case:
   *
   * - `COUNT`, `Count` — RED, and not on a comparison: the transport RESOLVES,
   *   so `refusalOfAst` throws its own "but it compiled to […]" error. These two
   *   are the cases this issue exists for; a name that differs from a compiled
   *   one only by case is the entire population the `toLowerCase()` moved.
   * - `COUNT_DISTINCT`, `Median` — GREEN, unchanged. Lowercasing them still
   *   misses the lowering table (`count_distinct`/`median` are not in it), and
   *   #5907 already classifies on the CALLER's spelling, so both faces answered
   *   `INVALID_QUERY`/400 with identical text before this change too.
   *
   * Measured after writing the above: exactly that — 2 of 4 red on the revert.
   * They are kept as one family regardless, because what the family asserts is
   * "no miscased spelling gets a different answer from the two faces", and the
   * two insensitive members are the standing guard on #5907's half of it: they
   * go red the day a `toLowerCase()` reappears in the CLASSIFICATION rather than
   * in the lookup, which the sensitive pair cannot see.
   */
  describe('[#6203] a miscased name gets ONE answer, not one per connection string', () => {
    // Every spelling here is off-contract by construction: `AggregationFunction`
    // is a case-sensitive `z.enum` (`AggregationFunction.parse('COUNT')` throws,
    // pinned in `packages/spec/src/data/query.test.ts`), so none of these can be
    // a `QueryAST` — hence `undeclaredAst`'s `as unknown as QueryAST`.
    const MISCASED = [
      'COUNT',           // differs from a COMPILED name only by case
      'Count',           // …and in mixed case
      'COUNT_DISTINCT',  // differs from a DECLARED-but-uncompiled name only by case
      'Median',          // differs from an undeclared name only by case
    ];

    for (const fn of MISCASED) {
      it(`"${fn}" is refused by both faces with the same code, status and wording`, async () => {
        const remote = await refusalOfUndeclared(fn);
        const local = await localRefusalOf(fn, undeclaredAst(fn));

        // #6144: `code` AND `status`, never "it threw" — the local face already
        // threw for all four before this change, so a bare `rejects.toThrow()`
        // would have been green throughout and blind to the whole defect.
        expect(remote.code).toBe('INVALID_QUERY');
        expect(remote.status).toBe(400);
        expect(local.code).toBe(remote.code);
        expect(local.status).toBe(remote.status);

        // Class 1, on both faces: a spelling the protocol never declared is a
        // query no backend can run, not a gap in this one — so never the 501.
        expect(remote.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(true);
        expect(remote.message.split('. ')[0]).toBe(local.message.split('. ')[0]);
        expect(remote.message).toBe(local.message);
        expect(remote.message).not.toContain('capability gap');

        // The refusal quotes the caller's own bytes — nothing normalised one of
        // them into a name the caller never wrote.
        expect(remote.message).toContain(`"${fn}"`);
        expect(remote.message).not.toContain(`"${fn.toLowerCase()}"`);
      });
    }

    it('the lowercase spelling the protocol DOES declare still compiles on both faces', async () => {
      // The control that keeps the above from being satisfiable by refusing
      // everything: the fork is closed by narrowing what this transport accepts,
      // not by breaking the vocabulary both faces share.
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', declaredAst('count'));
      expect(calls.map((c) => c.sql)).toEqual(['SELECT count("stage") AS "n" FROM "deal"']);

      const d = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      await d.initObjects([
        { name: 'deal', fields: { id: { type: 'text', name: 'id' }, stage: { type: 'text', name: 'stage' } } } as any,
      ]);
      await expect(d.aggregate('deal', declaredAst('count'))).resolves.toEqual([{ n: 0 }]);
    });
  });
});
