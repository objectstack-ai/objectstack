// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6321] `aggregate` and `func` are not keys of the Query Protocol, and
 * `SqlDriver.aggregate` no longer reads them.
 *
 * # What was there
 *
 * ```ts
 * const aggregates = query.aggregations || query.aggregate;   // sql-driver.ts
 * const funcName   = agg.function      || agg.func;
 * ```
 *
 * `QueryASTSchema` declares `aggregations`; `AggregationNodeSchema` declares
 * `function`. Neither `aggregate` nor `func` appears in `packages/spec` at all —
 * they are a dialect this consumer tolerated, which PD#12 rejects: a lenient
 * `||` in a consumer fossilises the wrong spelling into a second de-facto
 * contract and hides the producer's bug.
 *
 * # Why nobody noticed
 *
 * This is #4984's family. The measurement that closed it: the ONLY writers of
 * either key in the whole repository were `sql-driver-advanced.test.ts` (7),
 * `sql-driver-queryast.test.ts` (1) and driver-sqlite-wasm's two mirrors (8) —
 * the drivers' own fixtures. Non-test writers: zero. So the limbs were exercised
 * on every run, always passed, and no test in existence could have gone red on
 * their deletion. Re-spelling the fixtures to the declared keys took the writer
 * count to zero, and ADR-0049 enforce-or-remove then says the tolerance goes.
 *
 * # ⚠️ This file pins a KEY, so its primary channel is `tsc`, not vitest
 *
 * What "`aggregations`/`function` are the only authoring surface" MEANS is that
 * the other spelling does not compile. That is a compile-time fact, so the
 * `@ts-expect-error` cases below are the load-bearing ones — and they are real
 * checks rather than phantoms because `driver-sql/tsconfig.json` includes
 * `src/**` and this file lives there (`PINS_CHECKED`, AGENTS.md). `vitest` never
 * type-checks, so those cases can only fail under `pnpm typecheck`.
 *
 * They are written against `Parameters<SqlDriver['aggregate']>[1]` rather than
 * against `DriverQuery` directly, because what this PR changed is that METHOD's
 * parameter: read off the signature, the pin fails if the signature slips back
 * to `any` even though `DriverQuery` itself is unharmed (spec's own
 * `data-driver.test.ts` guards the type; nothing guarded the door).
 *
 * The runtime cases beside them record what an off-contract JS caller — one with
 * no `tsc` in the loop at all — now gets, and they are what makes a
 * REINTRODUCED limb go red in the test run too.
 *
 * # Reverse verification — direction predicted BEFORE it was run, per channel
 *
 * Restore the two `||` limbs and nothing else:
 *
 * - `pnpm test`: the two runtime cases go RED, in two different ways. The
 *   `aggregate:` case fails on `toBeUndefined()` — the limb computes the sum and
 *   the column appears. The `func:` case fails through `refusalOf`'s "expected a
 *   refusal, but it resolved" branch, because with `agg.func` read again there is
 *   a compilable function name and nothing refuses.
 * - `pnpm typecheck`: UNCHANGED, green. Excess-property checking does not care
 *   what the body reads.
 *
 * Restore the `query: any` signature as well:
 *
 * - `pnpm typecheck` goes RED on the `@ts-expect-error` lines with TS2578
 *   ("Unused '@ts-expect-error' directive"), which is the pin firing.
 * - `pnpm test` is unaffected by that second revert on its own.
 *
 * Recording it per channel rather than as one number is the point: a reader who
 * ran only vitest would conclude the key pins are dead, and a reader who ran only
 * tsc would conclude the limb deletion is untested. Both halves are needed.
 *
 * Measured after writing the above, exactly as predicted:
 *
 * ```
 * limbs restored, signature kept   vitest: 2 failed / 57 passed of 59
 *   drops an `aggregate:` list  -> AssertionError: expected 30 to be undefined
 *   refuses a `func:`-spelled   -> Error: expected the driver to refuse the
 *                                  query, but it resolved
 *                                  tsc: clean
 * signature back to `any`          tsc: sql-driver-aggregate-undeclared-keys
 *                                  .test.ts(116,7) + (124,7) error TS2578:
 *                                  Unused '@ts-expect-error' directive.
 * ```
 *
 * Note which cases did NOT move under the first revert: the re-spelled fixtures
 * in `sql-driver-advanced.test.ts` / `sql-driver-queryast.test.ts` stayed green,
 * because a restored `a || b` still reads `a` first. That is the whole reason the
 * fixture re-spelling had to come FIRST and cannot double as the pin — those
 * files can no longer tell whether the alias limb exists.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import type { DriverQuery } from '@objectstack/spec/contracts';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/** The narrowed door, read off the signature rather than restated. */
type AggregateQuery = Parameters<SqlDriver['aggregate']>[1];

describe('[#6321] SqlDriver.aggregate reads only the declared aggregation keys', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          amount: { type: 'number', name: 'amount' },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'won', amount: 10 });
    await driver.create('deal', { id: '2', stage: 'won', amount: 20 });
    await driver.create('deal', { id: '3', stage: 'lost', amount: 30 });
  });

  // ── The compile-time half: neither key is an authoring surface ─────────────
  //
  // Each literal is kept on ONE line on purpose: `@ts-expect-error` covers the
  // next line only, and the excess-property error is reported at the offending
  // property, not at the `const`.

  describe('the undeclared spellings do not compile', () => {
    it('rejects `aggregate:` where the protocol declares `aggregations:`', () => {
      // @ts-expect-error [#6321] `aggregate` is not a key of QueryAST.
      const undeclaredList: AggregateQuery = { aggregate: [{ function: 'sum', field: 'amount', alias: 'total' }] };
      // The directive above IS the assertion; the value is only touched so the
      // binding is not dead code.
      expect(Object.keys(undeclaredList)).toEqual(['aggregate']);
    });

    it('rejects `func:` where the protocol declares `function:`', () => {
      // @ts-expect-error [#6321] `func` is not a key of AggregationNode — and
      // the required `function` is then missing, so the line is wrong twice.
      const undeclaredFunc: AggregateQuery = { aggregations: [{ func: 'sum', field: 'amount', alias: 'total' }] };
      expect(Object.keys(undeclaredFunc)).toEqual(['aggregations']);
    });

    it('admits the declared spelling — the pin is not green because nothing fits', () => {
      // No directive here, deliberately. Without this case the two above would
      // stay green if `AggregateQuery` degenerated into a type that admits
      // nothing at all, which would be a broken door rather than a strict one.
      const declared: AggregateQuery = {
        groupBy: ['stage'],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      };
      expect(declared.aggregations).toHaveLength(1);
    });
  });

  // ── The runtime half: what an off-contract JS caller now gets ──────────────

  describe('an off-contract caller that writes them anyway', () => {
    /**
     * Spelled `as unknown as DriverQuery`, never `as any`: it names the contract
     * being bypassed, keeps every other key checked, and greps as a deliberate
     * act — the distinction `query-options/no-any-erasure` exists to enforce.
     */
    const offContract = (q: Record<string, unknown>) => q as unknown as DriverQuery;

    const refusalOf = async (query: DriverQuery): Promise<WireBearingError> => {
      try {
        await driver.aggregate('deal', query);
      } catch (e) {
        return e as WireBearingError;
      }
      throw new Error('expected the driver to refuse the query, but it resolved');
    };

    it('drops an `aggregate:` list — the column it asked for is simply not there', async () => {
      const rows = await driver.aggregate(
        'deal',
        offContract({
          groupBy: ['stage'],
          aggregate: [{ function: 'sum', field: 'amount', alias: 'total' }],
        }),
      );

      // The grouping still happens — only the undeclared key goes unread — so
      // this is the honest description of the loss rather than "it throws".
      expect(rows.map((r: any) => r.stage).sort()).toEqual(['lost', 'won']);
      for (const row of rows) expect(row.total).toBeUndefined();
    });

    it('refuses a `func:`-spelled aggregation with INVALID_QUERY / 400', async () => {
      // With the alias limb gone `agg.function` is `undefined`, so the name
      // reaches `refuseAggregateFunction` and is classified there: the caller
      // gets the named 400 this door already gives every undeclared function
      // name (#5907), not a silently different answer.
      const err = await refusalOf(
        offContract({ aggregations: [{ func: 'sum', field: 'amount', alias: 'total' }] }),
      );
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      expect(err.message).toContain('is not a declared aggregate function');
    });
  });

  // ── Control: the declared spelling computes what it always computed ────────

  it('computes the same aggregate through the declared keys', async () => {
    const rows = await driver.aggregate('deal', {
      groupBy: ['stage'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    });

    const byStage = Object.fromEntries(rows.map((r: any) => [r.stage, Number(r.total)]));
    expect(byStage).toEqual({ won: 30, lost: 30 });
  });
});
