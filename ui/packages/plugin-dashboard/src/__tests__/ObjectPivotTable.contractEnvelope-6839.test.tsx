/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectPivotTable` reads its `find()` answer as `QueryResult` DECLARES it —
 * and does NOT read `records` (objectui#6839).
 *
 * The widget unwraps through `extractRecords` (`@object-ui/core`). The read
 * lives in ONE shared helper, so this file is not asking "was this copy
 * repaired" — it asks whether THIS module actually routes its answer through
 * the helper, which a repo-wide "nothing reads `records`" assertion cannot say.
 *
 * ⭐ This sink behaves DIFFERENTLY from its sibling `ObjectDataTable`, which is
 * why it gets a pin rather than sharing one. `ObjectDataTable` returns early on
 * an empty result set and never mounts its table; this one hands `finalData`
 * straight through to `PivotTable` as the identity key of the cross-tabulation
 * memo, so a refused envelope arrives as a real, empty `schema.data` — the same
 * rows slot the live arms fill. Reading it there is what makes the refusal
 * legible as a refusal.
 *
 * MEASURED for this module: no `find()` in `plugin-dashboard`, nor in any app
 * or example mounting this widget, emits a `records` envelope. CONTROL, so the
 * zero is a reading: the same sweep finds a live `find()` double emitting
 * `{ records: [...] }` at `plugin-list`'s ObjectGallery.
 *
 * ⚠️ The refusal case is ALSO satisfied by an `extractRecords` that returns
 * `[]` for everything — an implementation strictly worse than the bug. The
 * `data` and bare-array cases refuse it: same rows, same mount, same slot.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * `PivotTable`, replaced by a reader of the rows slot. The real one
 * cross-tabulates, which is orthogonal to how many rows reached it.
 */
vi.mock('../PivotTable', () => ({
  PivotTable: ({ schema }: any) => (
    <div data-testid="pivot" data-row-count={String((schema.data ?? []).length)} />
  ),
}));

import { ObjectPivotTable } from '../ObjectPivotTable';

const ROWS = [
  { stage: 'won', owner: 'ada', amount: 10 },
  { stage: 'lost', owner: 'grace', amount: 20 },
];

const schema: any = {
  type: 'pivot-table',
  objectName: 'opportunity',
  rowField: 'stage',
  columnField: 'owner',
  valueField: 'amount',
};

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/**
 * Mount the widget over a `find()` answering `envelope`, return the row count
 * that reached `PivotTable`.
 *
 * ⛔ Call ONCE per case, never inside a `waitFor` predicate (objectui#7802):
 * it renders, and `waitFor` re-runs its callback on DOM mutations, so a
 * predicate that renders feeds itself and leaks a container div per run.
 */
async function rowsThrough(envelope: Envelope): Promise<number> {
  const find = vi.fn(async () => envelope(ROWS));
  const ds: any = {
    find,
    getObjectSchema: vi.fn(async () => ({
      name: 'opportunity',
      fields: {
        stage: { type: 'text', label: 'Stage' },
        owner: { type: 'text', label: 'Owner' },
        amount: { type: 'number', label: 'Amount' },
      },
    })),
  };
  render(<ObjectPivotTable schema={schema} dataSource={ds} />);
  await waitFor(() => expect(find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it the read below is satisfied by the mount's
  // initial empty `data`, which every arm passes through identically.
  await find.mock.results[0].value;
  await waitFor(() => expect(screen.queryByTestId('pivot')).toBeTruthy());
  return Number(screen.getByTestId('pivot').getAttribute('data-row-count'));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ObjectPivotTable — the find() envelope it reads (objectui#6839)', () => {
  it("still reads the contract's `data` member", async () => {
    expect(await rowsThrough(asData), 'the declared rows member must still reach the pivot').toBe(2);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    expect(await rowsThrough(asBareArray), 'the bare-array arm must still reach the pivot').toBe(2);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Before the fix these two rows cross-tabulated off a key `QueryResult`
    // does not declare, and did so AHEAD of `data`.
    expect(
      await rowsThrough(asRecords),
      'a `records` envelope must reach the pivot as zero rows, not as the rows it names',
    ).toBe(0);
  });
});
