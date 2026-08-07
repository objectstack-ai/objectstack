// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The driver side of #5181's `DriverQuery` narrowing (#6075).
 *
 * `packages/spec/src/contracts/data-driver.test.ts` already pins the CONTRACT:
 * `IDataDriver`'s six query-taking methods declare `DriverQuery`. That pin says
 * nothing about the implementations, and it cannot: method parameters are
 * compared bivariantly, so an implementation declaring the wider `QueryAST`
 * satisfies the narrower contract and every gate stays green. That is exactly
 * how five drivers kept a stale signature through a full `pnpm typecheck`
 * (125/125) after #6076 merged.
 *
 * The cost of the gap was a dormant lie rather than a live defect: a caller is
 * now free to omit `object`, so an implementation declaring `query: QueryAST`
 * promised a `string` where the runtime value could be `undefined`. No driver
 * read it — a repo-wide grep for `query.object` across every driver source
 * tree came back empty — so nothing was broken, and nothing stopped the next
 * reader from writing the line that would break.
 *
 * These pins close that. They resolve in tsc, not in vitest: widening any of
 * the six signatures back to `QueryAST` turns the `@ts-expect-error` below into
 * an unused directive, which is itself an error, and `DropsObject` resolves to
 * `never` per method so the failure names which one moved. The `expect()` calls
 * only give the assertions a home the runner will execute.
 *
 * `SqlDriver` is the base `SqliteWasmDriver` and `TursoDriver` extend, so these
 * pins cover their inherited signatures too; `TursoDriver`'s own overrides and
 * the memory / mongodb implementations carry the same narrowing, held by their
 * own suites' call-site literals, which no longer spell `object` and therefore
 * no longer compile against a re-widened parameter.
 */

import { describe, it, expect } from 'vitest';
import type { DriverQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from './sql-driver.js';
import type { SqlWindowFunctionQuery, SqlWindowFunctionSpec } from './sql-driver.js';

/** Resolves to `'dropped'` only while `T` has no `object` key; `never` otherwise. */
type DropsObject<T> = 'object' extends keyof T ? never : 'dropped';

describe('SqlDriver query signatures follow the DriverQuery contract (#6075)', () => {
  it('declares a query parameter without `object` on all six contract methods', () => {
    // Read off the CLASS, not off the alias: a revert that puts `QueryAST` back
    // on one implementation while `DriverQuery` stays imported would sail past
    // any alias-scoped assertion. Here that slot resolves to `never`.
    const perMethod: [
      DropsObject<Parameters<SqlDriver['find']>[1]>,
      DropsObject<Parameters<SqlDriver['findOne']>[1]>,
      DropsObject<NonNullable<Parameters<SqlDriver['count']>[1]>>,
      DropsObject<Parameters<SqlDriver['updateMany']>[1]>,
      DropsObject<Parameters<SqlDriver['deleteMany']>[1]>,
      DropsObject<Parameters<SqlDriver['explain']>[1]>,
    ] = ['dropped', 'dropped', 'dropped', 'dropped', 'dropped', 'dropped'];
    expect(perMethod).toHaveLength(6);
  });

  it('makes a driver reading `query.object` a compile error — the whole point', () => {
    // This is the line the narrowing exists to reject. Before it, the read
    // compiled and typed as `string` while the runtime value could be
    // `undefined`; after it, tsc refuses. Nothing else in this PR is worth
    // anything if this directive ever stops being needed.
    const readsObject = (query: Parameters<SqlDriver['find']>[1]) =>
      // @ts-expect-error - Property 'object' does not exist on type 'DriverQuery'
      query.object;
    expect(typeof readsObject).toBe('function');
  });

  it('rejects the redundant `object` key in a call-site literal', () => {
    // The object name arrives as argument one. Spelling it again in the query
    // is the redundancy #5181 removed, and the excess-property check is what
    // keeps the two spellings from ever disagreeing.
    // @ts-expect-error - 'object' does not exist in type 'DriverQuery'
    const redundant: Parameters<SqlDriver['find']>[1] = { object: 'account', where: { status: 'open' } };
    expect(redundant).toBeTruthy();
  });

  it('accepts a query carrying only the parts a driver actually reads', () => {
    const q: DriverQuery = { where: { status: 'open' }, orderBy: [{ field: 'id', order: 'asc' }], limit: 10 };
    const accepted: Parameters<SqlDriver['find']>[1] = q;
    expect(accepted.limit).toBe(10);
  });
});

/**
 * The two SQL-driver-OWN query doors — not on `IDataDriver`, so #5181/#6075
 * never reached them and both kept `query: any` (#6212).
 *
 * `any` on a query parameter is not "unchecked object name"; it is every check
 * off. `where`'s filter dialect, `orderBy`'s sort-node shape, `limit`/`offset`
 * being numbers — all of it was erased, on doors whose bodies read exactly
 * those members. That is the same class of hole `$like` walked through
 * (cloud#1030) before the contract methods were narrowed.
 *
 * `DropsObject` below is doing double duty on purpose: `keyof any` is
 * `string | number | symbol`, so `'object' extends keyof any` is TRUE and
 * `DropsObject<any>` resolves to `never`. Widening either parameter back to
 * `any` therefore fails these assignments just as loudly as re-adding `object`
 * would — one pin, both regressions.
 */
describe('SqlDriver own query doors declare a query type (#6212)', () => {
  describe('analyzeQuery — the DriverQuery half (batch A)', () => {
    it('takes `DriverQuery`, the same type `explain()` forwards to it', () => {
      // `explain(object, query: DriverQuery)` is a one-line forward to
      // `analyzeQuery`, so the pair was self-inconsistent: the contract door
      // declared the AST and the implementation behind it declared `any`.
      const perMethod: [
        DropsObject<Parameters<SqlDriver['explain']>[1]>,
        DropsObject<Parameters<SqlDriver['analyzeQuery']>[1]>,
      ] = ['dropped', 'dropped'];
      expect(perMethod).toHaveLength(2);

      // Assignability in the direction that matters: what `explain` hands over
      // must be exactly what `analyzeQuery` accepts.
      const forwarded: Parameters<SqlDriver['analyzeQuery']>[1] = {} as Parameters<SqlDriver['explain']>[1];
      expect(forwarded).toBeDefined();
    });

    it('accepts every member the body actually reads', () => {
      // fields / where / orderBy / limit / offset — the whole read set, all
      // inside `DriverQuery`. This is the measurement that made batch A a pure
      // annotation: no fixture in driver-sql or driver-sqlite-wasm had to move.
      const q: Parameters<SqlDriver['analyzeQuery']>[1] = {
        fields: ['id', 'amount'],
        where: { $and: [{ status: 'completed' }, { amount: { $gt: 100 } }] },
        orderBy: [{ field: 'amount', order: 'desc' }],
        limit: 10,
        offset: 5,
      };
      expect(q.limit).toBe(10);
    });

    it('rejects a key outside `DriverQuery` at the call site', () => {
      // @ts-expect-error - 'sortBy' does not exist in type 'DriverQuery' (it is `orderBy`)
      const misspelled: Parameters<SqlDriver['analyzeQuery']>[1] = { sortBy: [{ field: 'amount' }] };
      expect(misspelled).toBeTruthy();
    });

    it('does NOT reopen the retired request-surface keys', () => {
      // `windowFunctions` is a `retiredKey()` tombstone on `QueryAST` (#4286).
      // `analyzeQuery` never read it, and taking `DriverQuery` keeps it shut —
      // the window door is a SEPARATE method with its own type, below.
      const withWindows: Parameters<SqlDriver['analyzeQuery']>[1] = {
        // @ts-expect-error - `windowFunctions` was removed from the query surface (#4286)
        windowFunctions: [{ function: 'rank', alias: 'r' }],
      };
      expect(withWindows).toBeTruthy();
    });
  });

  describe('findWithWindowFunctions — the local flat shape (batch E)', () => {
    it('compiles the payload this door\'s own published documentation shows', () => {
      // THE acceptance criterion. #4286 tombstoned `query.windowFunctions` and
      // published this door as the migration prescription — in the tombstone
      // message, `migrations/registry.ts`, five docs pages, the release notes
      // and the upgrade guide. A type that rejects the payload those texts
      // print would make the prescription uncompilable, which is why the door
      // could not simply take `DriverQuery` (whose `windowFunctions` is the
      // tombstone, i.e. `undefined`).
      //
      // Copied verbatim from content/docs/data-modeling/queries.mdx.
      const documented: SqlWindowFunctionQuery = {
        windowFunctions: [
          {
            function: 'rank',
            alias: 'salary_rank',
            partitionBy: ['department'],
            orderBy: [{ field: 'salary', order: 'desc' }],
          },
        ],
      };
      const accepted: Parameters<SqlDriver['findWithWindowFunctions']>[1] = documented;
      expect(accepted.windowFunctions?.[0]?.alias).toBe('salary_rank');
    });

    it('keeps the contract half of the query checked', () => {
      // The point of `Omit<DriverQuery, 'windowFunctions'> & …` rather than a
      // bare `{ windowFunctions?: … }`: `where` / `orderBy` / `limit` / `offset`
      // are read by this body too and are now checked exactly as on `find()`.
      const q: Parameters<SqlDriver['findWithWindowFunctions']>[1] = {
        where: { status: 'completed' },
        orderBy: [{ field: 'amount', order: 'desc' }],
        limit: 5,
        offset: 1,
        windowFunctions: [{ function: 'ROW_NUMBER', alias: 'row_num' }],
      };
      expect(q.limit).toBe(5);
    });

    it('drops the redundant object name like every other query door', () => {
      const dropped: DropsObject<Parameters<SqlDriver['findWithWindowFunctions']>[1]> = 'dropped';
      expect(dropped).toBe('dropped');
      // @ts-expect-error - 'object' does not exist in type 'SqlWindowFunctionQuery'
      const redundant: SqlWindowFunctionQuery = { object: 'employee', windowFunctions: [] };
      expect(redundant).toBeTruthy();
    });

    it('rejects the SPEC vocabulary #4286 removed — the shapes the builder never read', () => {
      // `WindowFunctionNodeSchema` declared `field` / `over` / `frame`;
      // `buildWindowFunction` reads none of them (it emits `FUNC()` with no
      // argument at all, so `lag(revenue)` renders `LAG()`). #4286 deleted that
      // cluster rather than leave a false affordance, and re-declaring it here
      // would be that same false affordance one layer down.
      const withRemovedMembers: SqlWindowFunctionSpec[] = [
        // @ts-expect-error - `field` / `over` / `frame` are the removed spec vocabulary; this door has none of them
        { function: 'lag', alias: 'prev', field: 'revenue', over: { partitionBy: ['dept'] }, frame: 'rows' },
      ];
      expect(withRemovedMembers).toHaveLength(1);
    });

    it('requires the two members the builder cannot run without', () => {
      // `spec.function.toUpperCase()` and the `as ??` binding on `wf.alias`
      // both dereference unconditionally — absence is a runtime failure, so it
      // is a compile failure.
      // @ts-expect-error - Property 'alias' is missing
      const noAlias: SqlWindowFunctionSpec = { function: 'rank' };
      // @ts-expect-error - Property 'function' is missing
      const noFunction: SqlWindowFunctionSpec = { alias: 'r' };
      expect([noAlias, noFunction]).toHaveLength(2);
    });

    it('accepts an inner sort without `order` — the builder defaults it', () => {
      // A `DriverQuery`'s top-level `SortNode` has `order` REQUIRED (the Zod
      // default is applied in the output type). Inside `OVER (…)` the builder
      // reads `s.order || 'asc'`, so absence is a spelling this door genuinely
      // accepts and the local type must not over-declare.
      const spec: SqlWindowFunctionSpec = {
        function: 'ROW_NUMBER',
        alias: 'n',
        orderBy: [{ field: 'amount' }],
      };
      expect(spec.orderBy?.[0]?.order).toBeUndefined();
    });

    it('pins WHY the type `Omit`s the tombstoned key instead of intersecting it', () => {
      // `query.windowFunctions` is `retiredKey(...)` — `z.never().optional()` —
      // so `DriverQuery['windowFunctions']` is `undefined`. A plain
      // `DriverQuery & { windowFunctions?: SqlWindowFunctionSpec[] }` therefore
      // intersects an array with `undefined` and leaves the property
      // UNWRITABLE: the door's own documented payload would stop compiling,
      // silently, with no error anywhere near the type declaration.
      //
      // This assertion is that trap, held still. Simplify the `Omit` away and
      // `naive` goes red here rather than in the docs.
      type Writable<T> = SqlWindowFunctionSpec[] extends NonNullable<T> ? 'writable' : 'unwritable';
      const naive: Writable<(DriverQuery & { windowFunctions?: SqlWindowFunctionSpec[] })['windowFunctions']> =
        'unwritable';
      const real: Writable<SqlWindowFunctionQuery['windowFunctions']> = 'writable';
      expect([naive, real]).toEqual(['unwritable', 'writable']);
    });
  });
});
