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
 * The one control that is off-contract on TWO axes at once — a miscased name
 * and no `alias` (which `AggregationNodeSchema` requires) — because what it pins
 * is precisely how this transport names a result column when the caller gave it
 * nothing to work with. Same `as unknown as QueryAST` discipline.
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

/** Class 2's inputs: declared names, so the fixture is a real `QueryAST`. */
const refusalOfDeclared = (fn: AggregationNode['function']) => refusalOfAst(fn, declaredAst(fn));

describe('[#5907] RemoteTransport refuses an aggregate function it cannot compile', () => {
  describe('a function name the Query Protocol never declared', () => {
    const UNDECLARED = ['median', 'stddev', 'percentile_cont', 'group_concat'];

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

    it('quotes the spelling the CALLER wrote, not the normalised one', async () => {
      // This transport lowercases before its own lookup; the refusal is judged
      // and worded on the caller's own bytes, so `COUNT_DISTINCT` is undeclared
      // here exactly as it is on the local driver — the two faces agree on the
      // class instead of splitting 400/501 over a normalisation difference.
      const err = await refusalOfUndeclared('COUNT_DISTINCT');
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      expect(err.message).toContain('"COUNT_DISTINCT"');
      expect(err.message).not.toContain('"count_distinct"');
    });
  });

  describe('a DECLARED function this backend cannot compile', () => {
    // Typed against the declared enum on purpose — see the twin's note (#4918).
    const UNCOMPILABLE: Array<AggregationNode['function']> = [
      'count_distinct',
      'array_agg',
      'string_agg',
    ];

    it('the fixture is exactly the declared-but-uncompiled set', () => {
      const compiled = ['count', 'sum', 'avg', 'min', 'max'];
      expect([...AggregationFunction.options].filter((f) => !compiled.includes(f)).sort())
        .toEqual([...UNCOMPILABLE].sort());
    });

    for (const fn of UNCOMPILABLE) {
      it(`refuses "${fn}" with NOT_IMPLEMENTED / 501`, async () => {
        const err = await refusalOfDeclared(fn);
        expect(err.code).toBe('NOT_IMPLEMENTED');
        expect(err.status).toBe(501);
        expect(err.message.startsWith(UNCOMPILABLE_SENTENCE(fn))).toBe(true);
        expect(err.message).not.toContain('is not a declared aggregate function');
        expect(err.message).toContain('capability gap');
        expect(err.message).toContain('count, sum, avg, min, max');
        expect(err.message).not.toContain('[RemoteTransport]');
      });
    }
  });

  // ── The cross-package half: one condition, one wording ─────────────────────

  describe('local/remote parity (#5240 — one condition, one wording)', () => {
    const localRefusalOf = async (fn: string, ast: QueryAST): Promise<WireBearingError> => {
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
    };

    // Compared as RUNTIME messages from the two packages, not as two copies of a
    // literal — a shared constant would agree with itself no matter how far the
    // two faces drifted. This is what makes "首句逐字一致" checkable.
    // One entry per class, each carrying the query value its class is entitled
    // to: `median` cannot be a `QueryAST` (that is what class 1 means), the three
    // declared names can and are.
    const PARITY: Array<[fn: string, ast: QueryAST]> = [
      ['median', undeclaredAst('median')],
      ['count_distinct', declaredAst('count_distinct')],
      ['array_agg', declaredAst('array_agg')],
      ['string_agg', declaredAst('string_agg')],
    ];
    for (const [fn, ast] of PARITY) {
      it(`"${fn}" is answered identically by the local driver and this transport`, async () => {
        const remote = await refusalOfAst(fn, ast);
        const local = await localRefusalOf(fn, ast);
        expect(remote.code).toBe(local.code);
        expect(remote.status).toBe(local.status);
        // The first sentence is the contract; the tails happen to coincide too
        // because both faces compile the same five functions today, so the whole
        // message is compared while that holds.
        expect(remote.message.split('. ')[0]).toBe(local.message.split('. ')[0]);
        expect(remote.message).toBe(local.message);
      });
    }
  });

  // ── Controls: nothing but the refusal's identity moved ─────────────────────

  describe('the compiled vocabulary is untouched', () => {
    it('emits byte-identical SQL for the five functions it lowers', async () => {
      for (const fn of ['count', 'sum', 'avg', 'min', 'max'] as const) {
        const { t, calls } = transportWithCapturingClient();
        await t.aggregate('deal', declaredAst(fn));
        expect(calls.map((c) => c.sql)).toEqual([`SELECT ${fn}("stage") AS "n" FROM "deal"`]);
      }
    });

    it('the default alias still spells itself with the NORMALISED name', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', aliaslessAst('COUNT'));
      expect(calls[0].sql).toBe('SELECT count("stage") AS "count_stage" FROM "deal"');
    });

    /**
     * Pinned as it IS, not as it should be. This transport lowercases the
     * function name before its lookup and the local driver does not, so `COUNT`
     * compiles here and is refused there — measured on `origin/main` @
     * `80f7dc6a3`, before this change and unchanged by it:
     *
     * ```
     * COUNT  REMOTE -> RESOLVED "SELECT count(...)"   LOCAL -> THREW
     * ```
     *
     * That fork is a normalisation question, not an envelope one: no in-repo
     * caller emits a miscased name and `AggregationNodeSchema.function` cannot
     * express one, so it is filed as **#6203** rather than fixed under this
     * issue's envelope scope. This case exists so the next reader finds it
     * recorded instead of rediscovering it, and so a change to the normalisation
     * is a deliberate one that has to come here and say so.
     */
    it('[filed, not fixed] `COUNT` still compiles HERE while the local driver refuses it', async () => {
      const { t, calls } = transportWithCapturingClient();
      await t.aggregate('deal', undeclaredAst('COUNT'));
      expect(calls.map((c) => c.sql)).toEqual(['SELECT count("stage") AS "n" FROM "deal"']);
    });
  });
});
