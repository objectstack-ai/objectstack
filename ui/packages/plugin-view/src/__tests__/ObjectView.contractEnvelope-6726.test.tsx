/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectView`'s non-grid fetch reads a `find()` answer as `QueryResult`
 * DECLARES it — and does NOT read `records` (objectui#6726).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * This block's unwrap was a four-branch ladder — bare array, `data`, `records`,
 * `value` — and the `records` branch sat between the contract's member and the
 * OData one.
 *
 * MEASURED on this tree, no producer emits `records` at this `DataSource.find()`
 * seam: `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK
 * `records` envelope and returns `{ data, total, page, pageSize, hasMore }`
 * before returning, and every other `find()` implementation in the repo returns
 * `data` or a bare array. The branch was unreachable in practice — and an
 * unreachable tolerant branch is precisely where a non-conforming producer
 * would keep working unrejected (AGENTS.md #0.1).
 *
 * OUT OF THIS CARD'S FENCE, recorded so the silence is not read as a verdict:
 * the `value` branch is a below-the-adapter spelling by the same argument, and
 * it is left standing here. objectui#6726 names `records`; `value` is filed
 * separately rather than fixed on a card that did not measure it.
 *
 * The rows reach the child as `data={data}`, so that prop is what this pin
 * reads. The `data` and bare-array legs push the SAME rows through the SAME
 * mount, which is what makes the `records` leg a reading rather than a mount
 * that never rendered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ObjectView } from '../ObjectView';
import type { ObjectViewSchema } from '@object-ui/types';

/** Every `data` prop the view handed to SchemaRenderer, in order. */
const delivered: unknown[][] = [];

vi.mock('@object-ui/react', async (importOriginal) => {
  const React = await import('react');
  return {
    // Inherit the real export surface, then override only what this pin reads.
    // A hand-listed factory freezes the mock at whatever was typed that day, and
    // the next export any module in this file's import graph reads at module
    // scope kills the file during COLLECTION -- zero failed assertions, tests
    // that never ran (objectui#6768 / #6849).
    ...(await importOriginal<Record<string, unknown>>()),
    SchemaRenderer: ({ data }: any) => {
      if (Array.isArray(data)) delivered.push(data);
      return <div data-testid="schema-renderer" />;
    },
    SchemaRendererContext: React.createContext(null),
    subscribeDataChanges: () => () => {},
    notifyDataChanged: () => {},
  };
});
vi.mock('@object-ui/plugin-grid', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectGrid: () => <div data-testid="object-grid" />,
}));
vi.mock('@object-ui/plugin-form', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectForm: () => <div data-testid="object-form" />,
}));

const ROWS = [{ id: 'r1', name: 'Ada' }, { id: 'r2', name: 'Grace' }];

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/**
 * Mount the view over a `find()` that answers with `envelope`, and return the
 * LAST row array the child was handed.
 *
 * ⛔ Call this ONCE per case, and NEVER from inside a `waitFor` predicate
 * (objectui#7802). It renders, and `waitFor` re-runs its callback on DOM
 * MUTATIONS as well as on its interval, so a predicate that renders schedules
 * its own next run — self-feeding — and every run leaks the container div
 * `render` appends to `document.body` (RTL's `unmount()` tears down the React
 * root but leaves that div behind). Measured on THIS helper with `interval`
 * pinned AT `timeout`, so the interval timer can never re-run the callback:
 *
 *   sync predicate rendering into the document .. 200 runs / 191ms, growth 200
 *   sync predicate rendering into a DETACHED div ... 1 run / 2006ms, growth 0
 *   inert predicate ................................ 1 run / 2002ms, growth 0
 *
 * 200 where the interval permitted one — objectui#7756's worker-killing shape.
 *
 * An `async` predicate happened to be spared: `wait-for.js`'s `checkCallback`
 * early-returns while `promiseStatus === 'pending'`, so a DOM mutation cannot
 * re-enter a predicate still in flight. Same measurement, async shape: 1 run
 * pinned, 19 runs at the default 50ms cadence, `document.body` growth equal to
 * the run count either way.
 *
 * ⚠️ That early return is RTL's IMPLEMENTATION, not its contract. It made the
 * leak BOUNDED by accident, and dropping the `async` removes the only thing
 * holding it — measured: the synchronous form of the call below reported no
 * tests at all and had to be killed at a 480s wall, where the file otherwise
 * passes in under two seconds. So the render lives out here, once, and the
 * cases assert on its answer directly.
 */
async function deliveredThrough(envelope: Envelope): Promise<unknown[]> {
  delivered.length = 0;
  const ds: any = {
    find: vi.fn().mockResolvedValue(envelope(ROWS)),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn().mockResolvedValue({ name: 'store', fields: {} }),
  };
  render(
    <ObjectView
      schema={{ type: 'object-view', objectName: 'store' } as ObjectViewSchema}
      views={[{ id: 'k', label: 'Board', type: 'kanban' as any }]}
      dataSource={ds}
    />,
  );
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. It is what makes the read below a reading of the ANSWER
  // rather than of the mount's initial empty `data` state: `ObjectView` hands
  // the child `data={[]}` three times before the fetch lands, so
  // `delivered.length > 0` alone is satisfied by an EMPTY delivery. Measured
  // (objectui#7802) with the fetch deferred 50 / 200 / 500ms, `data` envelope:
  // waiting only on `delivered.length > 0` returned `[]` at all three; waiting
  // on this first returned the two rows at all three.
  await ds.find.mock.results[0].value;
  await waitFor(() => expect(delivered.length).toBeGreaterThan(0));
  return delivered[delivered.length - 1];
}

beforeEach(() => {
  cleanup();
});

describe('ObjectView — the find() envelope its non-grid fetch reads (objectui#6726)', () => {
  it("reads the contract's `data` member", async () => {
    expect(await deliveredThrough(asData)).toHaveLength(2);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    expect(await deliveredThrough(asBareArray)).toHaveLength(2);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Nothing delivered: the envelope was refused. Before the fix the two rows
    // above reached the board off a key `QueryResult` does not declare.
    expect(await deliveredThrough(asRecords)).toHaveLength(0);
  });
});
