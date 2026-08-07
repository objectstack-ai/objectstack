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
