/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectDataTable` reads its `find()` answer as `QueryResult` DECLARES it —
 * and does NOT read `records` (objectui#6839).
 *
 * The widget unwraps through `extractRecords` (`@object-ui/core`). The read
 * lives in ONE shared helper, so this file is not asking "was this copy
 * repaired" (objectui#6726's question, where each of seven consumers carried
 * its own copy) — it asks whether THIS module actually routes its answer
 * through the helper. A module that unwrapped the envelope itself, as
 * `plugin-list`'s `ListView` still does, would inherit nothing from the
 * helper's own pin while a repo-wide "nothing reads `records`" assertion passed
 * over it in silence.
 *
 * MEASURED for this module: no `find()` in `plugin-dashboard`, nor in any app
 * or example mounting this widget, emits a `records` envelope — the package's
 * three `records:` occurrences are a `.then((records: any) =>` parameter name
 * and two doc comments. CONTROL, so the zero is a reading: the same sweep
 * finds a live `find()` double emitting `{ records: [...] }` at `plugin-list`'s
 * ObjectGallery, and `records`-keyed payloads on the raw-HTTP and client-SDK
 * seams below the adapters.
 *
 * ⚠️ The refusal case is ALSO satisfied by an `extractRecords` that returns
 * `[]` for everything — an implementation strictly worse than the bug. The
 * `data` and bare-array cases refuse it: same rows, same mount.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

/**
 * The underlying `data-table` renderer, replaced by a reader of the ROWS the
 * widget handed it. The real one pulls the whole component registry, and what
 * this file observes is the row count, not the table's chrome.
 */
vi.mock('@object-ui/react', async () => {
  const actual: any = await vi.importActual('@object-ui/react');
  return {
    ...actual,
    SchemaRenderer: ({ schema }: any) => (
      <div data-testid="rows" data-row-count={String((schema.data ?? []).length)} />
    ),
    useDataScope: () => undefined,
  };
});

import { ObjectDataTable } from '../ObjectDataTable';

const ROWS = [{ name: 'Acme' }, { name: 'Initech' }];

const FIELDS = { fields: { name: { type: 'text', label: 'Name' } } };

const schema: any = {
  type: 'object-data-table',
  objectName: 'account',
  columns: [{ header: 'Name', accessorKey: 'name' }],
};

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/**
 * Mount the widget over a `find()` answering `envelope`, and hand back what it
 * settled on: the number of rows it delivered, or `'empty-state'` when it drew
 * its own "no records" panel instead.
 *
 * The two outcomes are DIFFERENT DOM, not a count of 0 — this widget returns
 * early on an empty result set and never mounts the table at all. Reporting
 * which one happened is what keeps a refused envelope distinguishable from a
 * mount that simply never rendered.
 *
 * ⛔ Call ONCE per case, never inside a `waitFor` predicate (objectui#7802):
 * it renders, and `waitFor` re-runs its callback on DOM mutations, so a
 * predicate that renders feeds itself and leaks a container div per run.
 */
async function settledOn(envelope: Envelope): Promise<number | 'empty-state'> {
  const find = vi.fn(async () => envelope(ROWS));
  const ds: any = { find, getObjectSchema: vi.fn(async () => FIELDS) };
  render(<ObjectDataTable schema={schema} dataSource={ds} />);
  await waitFor(() => expect(find).toHaveBeenCalled());
  // `find`'s OWN answer, settled — a pure read of the mock's call record that
  // touches no DOM. Without it the read below is satisfied by the loading
  // skeleton every arm passes through identically.
  await find.mock.results[0].value;
  await waitFor(() =>
    expect(
      screen.queryByTestId('rows') ?? screen.queryByTestId('table-empty-state'),
    ).toBeTruthy(),
  );
  const rows = screen.queryByTestId('rows');
  return rows ? Number(rows.getAttribute('data-row-count')) : 'empty-state';
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ObjectDataTable — the find() envelope it reads (objectui#6839)', () => {
  it("still reads the contract's `data` member", async () => {
    expect(await settledOn(asData), 'the declared rows member must still draw').toBe(2);
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    expect(await settledOn(asBareArray), 'the bare-array arm must still draw').toBe(2);
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    // Before the fix these two rows drew off a key `QueryResult` does not
    // declare, and did so AHEAD of `data`. The widget now settles on its own
    // "no records" panel — a DIFFERENT node from the table, which is what makes
    // this a reading of the refusal rather than of a mount that never happened.
    expect(
      await settledOn(asRecords),
      'a `records` envelope must reach the widget as no rows at all, not as the rows it names',
    ).toBe('empty-state');
  });
});
