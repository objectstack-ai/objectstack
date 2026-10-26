/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6697 (item 1) — `RelatedList`'s collection fetch must survive a
 * DISCARDED `defaultSortSpec` / `listFilterNode` memo.
 *
 * The family contract (objectui#6018/#5976/#6591/#6592/#6698/#6701): `useMemo`
 * is a pure optimisation, not a correctness dependency. React is permitted to
 * throw a memo's cache away and recompute even when the dependency array
 * compares equal, so an effect whose OWN dependency array names the memoised
 * OBJECT re-runs on a discard alone. Here that meant an extra
 * `dataSource.find` for the related collection with nothing an author or a
 * caller controls having changed.
 *
 * ⚠️ WHY THE FAMILY'S USUAL DISCARD PROXY DOES NOT WORK ON THIS COMPONENT.
 * The pins for `ObjectMap`/`ObjectTree` force the recompute by handing the
 * component a NEW prop reference carrying equal content, because those memos
 * are keyed on the prop object itself. `RelatedList`'s two memos are already
 * keyed on `JSON.stringify`-derived STRINGS (`defaultSortKey` / `filterKey`),
 * so a new `defaultSort` / `filter` reference with equal content produces an
 * EQUAL key and the memo simply keeps its cache — the trigger would never fire
 * and the pin would pass no matter what the source said. That is exactly how
 * `ObjectCalendar`'s first pin in #6592 came out green pre-fix: a pin that
 * cannot fail is indistinguishable from a working guard.
 *
 * So this file forces the DISCARD ITSELF instead of varying a prop. `useMemo`
 * is replaced at the MODULE level, because it cannot be replaced any other
 * way: `RelatedList` reaches it through `import * as React from 'react'`, and
 * that namespace is a frozen `[object Module]` — `vi.spyOn`, plain assignment
 * and `Object.defineProperty` all fail on it ("Cannot redefine property"),
 * while patching the separate `import React from 'react'` interop default
 * object succeeds and reaches NOTHING in this component. Measured in this
 * session: a first draft that patched only the default binding reported all
 * four cases green against the UNFIXED source. `provesTheProxyDiscriminates`
 * below is the permanent guard against that recurring.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import * as ReactNS from 'react';
import { RelatedList } from '../RelatedList';

/**
 * Armed per-test by `armDiscardProxy`. While `markers` is empty the mock below
 * is a pure pass-through, so every other test in this file sees stock React
 * semantics. `epoch` is what actually fires a discard: it is appended to the
 * deps of every MARKED memo, so bumping it once invalidates exactly those
 * caches, exactly once. (Appending unconditionally while armed also keeps the
 * deps array a CONSTANT length for the lifetime of a marked memo — arming
 * mid-test would otherwise change its size between renders, which React
 * reports as a warning and handles on its own terms.)
 */
const memoProxy = vi.hoisted(() => ({ markers: [] as unknown[], epoch: 0 }));

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<any>();
  const realUseMemo = actual.useMemo;
  const patched = (factory: () => unknown, deps?: unknown[]) =>
    Array.isArray(deps) && deps.some((d) => memoProxy.markers.includes(d))
      ? // An extra dependency that changes only when `discardNow()` says so ==
        // a cache thrown away at exactly that moment == the memo recomputing
        // precisely as a discard makes it.
        realUseMemo(factory, [...deps, memoProxy.epoch])
      : realUseMemo(factory, deps);
  return { ...actual, useMemo: patched, default: { ...(actual.default ?? actual), useMemo: patched } };
});

afterEach(() => {
  cleanup();
  memoProxy.markers = [];
});

/**
 * Put every `useMemo` whose dependency array contains one of `markers` under
 * this file's control. Scoped by marker rather than applied globally so the
 * assertions below isolate the memos under test; arming alone discards
 * nothing.
 */
function armDiscardProxy(markers: unknown[]): () => void {
  memoProxy.markers = markers;
  return () => {
    memoProxy.markers = [];
  };
}

/** Throw away the armed memos' caches — one discard event, on demand. */
function discardNow(): void {
  memoProxy.epoch += 1;
}

const ROWS = [{ id: 'c1', name: 'Alice' }];
const SORT = [{ field: 'name', order: 'asc' as const }];
/**
 * The spec's own `ViewFilterRule[]` vocabulary, chosen for what
 * `toFilterNode` does with it: an array holding rule OBJECTS goes through
 * `source.map(viewFilterRuleToNode)`, which builds a fresh array on every
 * call — the identity churn a real discard produces. An array of bare AST
 * nodes would NOT do: `toFilterNode` hands that straight back by identity, so
 * the memo would survive a discard by accident and blunt the trigger.
 */
const FILTER = [{ field: 'stage', operator: 'equals' as const, value: 'won' }];
/** The exact strings `RelatedList` keys the two memos on. */
const SORT_KEY = JSON.stringify(SORT);
const FILTER_KEY = JSON.stringify(FILTER);

const makeDS = () => ({
  // Params are declared so `find.mock.calls[n][1]` is typed as the query
  // object rather than as an out-of-range index on an empty tuple.
  find: vi.fn(async (_object: string, _params: Record<string, any>) => ROWS),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

const listElement = (ds: any, over: Record<string, any> = {}) => (
  <RelatedList
    title="Contacts"
    type="table"
    api="contact"
    objectName="contact"
    referenceField="account"
    parentId="ACC-1"
    defaultSort={SORT}
    filter={FILTER}
    dataSource={ds as any}
    {...over}
  />
);

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('RelatedList — the collection fetch survives a discarded memo (objectui#6697)', () => {
  it('provesTheProxyDiscriminates: the proxy reaches the same React binding the component uses', () => {
    const MARKER = 'canary-marker';
    const seen: unknown[] = [];
    // Deliberately the NAMESPACE binding — the one `RelatedList` itself
    // imports. A canary written against the interop default would pass while
    // the component under test never saw the proxy at all.
    const Probe: React.FC = () => {
      seen.push(ReactNS.useMemo(() => ({}), [MARKER]));
      return null;
    };

    const restore = armDiscardProxy([MARKER]);
    try {
      const { rerender } = render(<Probe />);
      // Armed but not fired: normal caching still holds, so a green result
      // below cannot come from the proxy simply churning everything.
      rerender(<Probe />);
      expect(seen[1]).toBe(seen[0]);

      discardNow();
      rerender(<Probe />);
    } finally {
      restore();
    }
    // Same deps, new identity — the shape a discarded cache produces.
    expect(seen[2]).not.toBe(seen[1]);
  });

  it('does not re-fetch when `defaultSortSpec`/`listFilterNode` are discarded under UNCHANGED keys', async () => {
    const ds = makeDS();
    const restore = armDiscardProxy([SORT_KEY, FILTER_KEY]);
    try {
      const { rerender } = render(listElement(ds));
      await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));

      // One discard, then a re-render with byte-identical props — the same
      // `defaultSort` and `filter` references, so both memo KEYS are
      // unchanged and only the memoised objects' identities move. Nothing
      // here is a reason to talk to the server again.
      discardNow();
      rerender(listElement(ds));
      await settle();

      expect(ds.find).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it('still DOES re-fetch when the list filter genuinely changes', async () => {
    const ds = makeDS();
    const { rerender } = render(listElement(ds));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));

    rerender(listElement(ds, { filter: [{ field: 'stage', operator: 'equals' as const, value: 'lost' }] }));

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
  });

  it('still DOES re-fetch when the declared default sort genuinely changes', async () => {
    const ds = makeDS();
    const { rerender } = render(listElement(ds, { pageSize: 10 }));
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(1));
    expect(ds.find.mock.calls[0][1].$orderby).toEqual(SORT);

    rerender(listElement(ds, { pageSize: 10, defaultSort: [{ field: 'created', order: 'desc' }] }));

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    expect(ds.find.mock.calls[1][1].$orderby).toEqual([{ field: 'created', order: 'desc' }]);
  });
});
