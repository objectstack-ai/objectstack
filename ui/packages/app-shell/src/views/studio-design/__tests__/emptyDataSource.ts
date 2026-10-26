// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The adapter double for suites that render the Data pillar's records grid,
 * plus the pin that keeps an absorbed fetch error from going unnoticed
 * (objectui#8620).
 *
 * ## The defect this replaces
 *
 * These suites used to mock `useAdapter` as `() => ({})`: an object with no
 * `find()`. The pillar hands the adapter to `PluginObjectView` and from there
 * to `ListView`, whose fetch effect calls `dataSource.find(...)`. The call threw,
 * and `ListView`'s best-effort `catch` absorbed it: it logs
 * `ListView data fetch error: TypeError: dataSource.find is not a function`,
 * renders its load-error panel, and the test goes on. No assertion read that
 * path, so every suite was green while printing the same error on every run,
 * and a suite that always prints an error cannot show you a new one.
 *
 * ## Why the pin is a console spy read in `afterEach`
 *
 * The product `catch` is deliberate (a failed fetch must not crash the view),
 * so nothing thrown from inside `find()` can ever reach the test. What does
 * leave the `catch` is the `console.error` line. So the line is RECORDED as it
 * is written and ASSERTED in `afterEach`, where no product `catch` can reach
 * it: the same shape as the network-escape guard (objectui#6640,
 * `vitest.setup.network-escape-guard.ts`).
 *
 * ⚠️ The spy has no mock implementation: every call still goes through to the
 * real `console.error` and still prints. Nothing is silenced. The pin fails
 * only on the absorbed-fetch-error line and ignores all other output.
 *
 * ⚠️ The matcher reads the producers' log prefix, which is the one thing a
 * console spy can see. Those prefixes come from `ListView`'s fetch `catch`
 * (`"ListView data fetch error:"`) and `ObjectView`'s (`"ObjectView data fetch
 * error:"`). If either is ever reworded, this pin passes without checking
 * anything. The ablation on objectui#8620's pull request (put `({})` back and
 * watch this pin go red) is the evidence that it fires. Nothing re-runs that
 * ablation automatically.
 */

import { afterEach, beforeEach, expect, vi, type MockInstance } from 'vitest';
import type { DataSource } from '@object-ui/types';

/**
 * An adapter over an EMPTY backend, typed against the published `DataSource`
 * contract. If the contract gains a required member, this stops compiling
 * instead of drifting.
 *
 * Reads answer "nothing there" in the shape the contract declares: `find`
 * resolves an empty `QueryResult`, `findOne` resolves `null`, and
 * `getObjectSchema` resolves `null`. A `null` schema is how both `ListView` and
 * `useSettledSchema` settle when there is no schema to read, so the grid still
 * loads its rows. A rejection here would log a DIFFERENT absorbed error, from
 * `useSettledSchema`.
 *
 * Writes are not modelled. They REJECT and name this double, so a suite that
 * starts exercising a write fails loudly instead of getting back a success
 * nobody wrote.
 *
 * Call it ONCE at module scope and have the `useAdapter` mock return that
 * binding. The pillar then gets the same adapter on every render. A fresh
 * object per render changes a dependency of the fetch effect each time, which
 * re-issues `find()` (the objectui#4567 convention, see
 * `StudioDesignSurface.gridColumns.test.tsx`).
 */
export function createEmptyDataSource(): DataSource {
  const notModelled = (member: string) => () =>
    Promise.reject(
      new Error(`createEmptyDataSource: \`${member}\` is not modelled; this double answers reads only`),
    );
  return {
    find: async () => ({ data: [] }),
    findOne: async () => null,
    getObjectSchema: async () => null,
    create: notModelled('create'),
    update: notModelled('update'),
    delete: notModelled('delete'),
  };
}

/** The log prefix of a view's best-effort data-fetch `catch`. */
const ABSORBED_FETCH_ERROR = /\bdata fetch error:/;

/**
 * Registers a `beforeEach`/`afterEach` pair that fails the test if a view
 * absorbed a data-fetch error while it ran. Call it once at module scope, before
 * the file's own hooks. After-hooks run in reverse registration order, so this
 * check runs after the file's own teardown and still sees anything that
 * teardown logged.
 */
export function failOnAbsorbedFetchError(): void {
  let spy: MockInstance<typeof console.error> | undefined;

  beforeEach(() => {
    // Record only. With no mock implementation, every call passes through.
    spy = vi.spyOn(console, 'error');
  });

  afterEach(() => {
    const recorded = spy;
    spy = undefined;
    if (!recorded) return;
    // A `vi.restoreAllMocks()` in the file's own teardown would already have
    // restored and CLEARED this spy, and an empty record reads the same as a
    // clean run. Refuse to read it rather than pass on nothing.
    const stillInstalled = Object.is(console.error, recorded);
    const absorbed = recorded.mock.calls
      .filter(([first]) => typeof first === 'string' && ABSORBED_FETCH_ERROR.test(first))
      .map((args) => args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '));
    recorded.mockRestore();
    expect(
      stillInstalled,
      'the absorbed-fetch-error spy was replaced before afterEach could read it, so this pin would be reading an empty record',
    ).toBe(true);
    expect(
      absorbed,
      'a view absorbed a data-fetch error in its best-effort catch; the test stayed green only because that catch swallowed it',
    ).toEqual([]);
  });
}
