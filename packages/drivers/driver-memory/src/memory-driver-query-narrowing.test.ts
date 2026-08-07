// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#6212 batch C — `InMemoryDriver`'s three driver-owned query
 * methods take `DriverQuery`, not a type that repeats the object name.
 *
 * `distinct` / `aggregate` / `performAggregation` are NOT declared on
 * `IDataDriver`, so #5181's narrowing and #6075's follow-through never reached
 * them: their first argument was already the object name while the query type
 * (`QueryInput` / `QueryAST`) still *required* `object`, so a caller holding
 * only a `where` could not name a type for it and reached for `as any` —
 * losing `where`, `orderBy` and `limit` checking in the same stroke
 * (cloud#1053, and `$like` surviving to runtime in cloud#1030).
 *
 * **Why the pins in this file are real.** They are resolved by `tsc`, not by
 * vitest: reverting a signature makes the `@ts-expect-error` directives unused,
 * and an unused directive is itself an error, so
 * `pnpm --filter @objectstack/driver-memory typecheck` goes red. That works
 * here only because this package's `tsconfig.json` does NOT exclude the
 * test-file glob — it has no `TEST_DEBT` entry in
 * `scripts/check-type-check-coverage.mjs` and reports zero errors, which is the
 * measurable baseline these pins move away from. The sibling `driver-mongodb`
 * package DOES exclude its tests, so the identical pin written there would be
 * the phantom check AGENTS.md's `PINS_CHECKED` invariant warns about — it is
 * deliberately not written; mongodb's narrowing is held by `tsc` over its
 * source plus the repo-wide `check:type-check-debt` re-measure.
 *
 * The `expect()` calls only give the assertions a home vitest will run.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { InMemoryDriver } from './memory-driver.js';

/** `'dropped'` when `T` does not carry `object` at all; `never` when it does. */
type DropsObject<T> = 'object' extends keyof T ? never : 'dropped';

describe('InMemoryDriver — driver-owned query methods take DriverQuery (#6212 batch C)', () => {
  let driver: InMemoryDriver;
  const tbl = 'narrowing_probe';

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
  });

  describe('signatures', () => {
    it('reads `object` off neither `distinct` nor the AST arm of `aggregate`', () => {
      // Read off the METHODS rather than off the `DriverQuery` alias. A revert
      // that puts `QueryInput` / `QueryAST` back on one signature while leaving
      // the alias imported would sail past any alias-scoped assertion; here that
      // slot resolves to `never` and the line goes red, naming which method.
      type DistinctQuery = NonNullable<Parameters<InMemoryDriver['distinct']>[2]>;
      // The AST arm is the non-array member of `aggregate`'s union.
      type AggregateArg = Parameters<InMemoryDriver['aggregate']>[1];
      type AggregateAstArm = Extract<AggregateArg, { object?: unknown } | DriverQuery>;

      const perMethod: [DropsObject<DistinctQuery>, DropsObject<AggregateAstArm>] = [
        'dropped',
        'dropped',
      ];
      expect(perMethod).toHaveLength(2);
    });

    it('keeps the mongo-pipeline arm of `aggregate` — BOTH arms have live producers', () => {
      // ⛔ Neither arm may be retired. The pipeline arm is fed by
      // `memory-analytics.ts` (`this.driver.aggregate(tableName, pipeline)`);
      // the AST arm by objectql's engine and `@objectstack/verify`'s
      // date-bucket parity probe. This pin fails if the union collapses.
      type AggregateArg = Parameters<InMemoryDriver['aggregate']>[1];
      type PipelineArmKept = Record<string, unknown>[] extends AggregateArg ? 'kept' : never;
      const kept: PipelineArmKept = 'kept';
      expect(kept).toBe('kept');
    });
  });

  describe('what the narrowing gives back', () => {
    it('lets `distinct` take a bare `where` — the literal that forced the casts', async () => {
      await driver.create(tbl, { id: '1', role: 'admin', active: true });
      await driver.create(tbl, { id: '2', role: 'user', active: false });
      await driver.create(tbl, { id: '3', role: 'user', active: true });

      // No cast. Before the narrowing `object` was REQUIRED on `QueryInput`, so
      // this literal did not compile at all.
      const roles = await driver.distinct(tbl, 'role', { where: { active: true } });
      expect(roles.sort()).toEqual(['admin', 'user']);
    });

    it('lets `aggregate` take a bare AST literal, with `where`/`groupBy` still checked', async () => {
      await driver.create(tbl, { id: '1', category: 'travel', amount: 100 });
      await driver.create(tbl, { id: '2', category: 'travel', amount: 50 });
      await driver.create(tbl, { id: '3', category: 'meals', amount: 30 });

      const rows = await driver.aggregate(tbl, {
        groupBy: ['category'],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'amount' }],
      });
      const byCat = Object.fromEntries(rows.map((r: any) => [r.category, r.amount]));
      expect(byCat).toEqual({ travel: 150, meals: 30 });
    });

    it('still runs a real MongoDB pipeline array through Mingo, unchanged', async () => {
      await driver.create(tbl, { id: '1', category: 'travel', amount: 100 });
      await driver.create(tbl, { id: '2', category: 'meals', amount: 30 });

      const rows = await driver.aggregate(tbl, [
        { $match: { category: 'travel' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      expect((rows[0] as any).total).toBe(100);
    });
  });

  // Every pin below sits on a real CALL to the narrowed method, never on a
  // `const x: DriverQuery = …` literal. An alias-scoped pin would stay green
  // through a revert of the signature — `DriverQuery` lacks `object` whatever
  // `distinct` declares — which is the dead-pin shape #5018/#4984 paid for.
  describe('what the narrowing now rejects', () => {
    it('refuses the redundant `object` key on a `distinct` call-site literal', async () => {
      // A caller can pass a typed variable through untouched…
      const q: DriverQuery = { where: { active: true } };
      expect(await driver.distinct(tbl, 'role', q)).toEqual([]);

      // …but may no longer state the object name a second time.
      await driver.distinct(tbl, 'role', {
        // @ts-expect-error - 'object' does not exist in type 'DriverQuery'
        object: tbl,
        where: { active: true },
      });
    });

    it('refuses the redundant `object` key on an `aggregate` call-site literal', async () => {
      await driver.aggregate(tbl, {
        // @ts-expect-error - 'object' does not exist in type 'DriverQuery'
        object: tbl,
        aggregations: [{ function: 'count', alias: 'n' }],
      });
    });

    it('restores the `orderBy` check a blanket cast switched off (#4674)', async () => {
      // `orderBy` is `SortNode[]` (`{ field, order }`), closed since #4721. The
      // `direction` spelling is `IReportService`'s vocabulary and sorted the
      // wrong way in silence. Before this batch the only way to hand `aggregate`
      // a bare AST was `as any`, which switched this check off with it.
      await driver.aggregate(tbl, {
        aggregations: [{ function: 'count', alias: 'n' }],
        // @ts-expect-error - spell the direction `order`, never `direction`
        orderBy: [{ field: 'amount', direction: 'desc' }],
      });
    });
  });
});
