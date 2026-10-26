/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:repeater` (`data-list.tsx`) reads a `find()` answer as `QueryResult`
 * DECLARES it — and does NOT read `records` (objectui#6726).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * The renderer's read was `res?.data ?? res?.records ?? (Array.isArray(res) ? res : [])`
 * — `records` sat between the contract's member and the bare-array arm.
 *
 * MEASURED on this tree, no producer emits `records` at this `DataSource.find()`
 * seam: `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK
 * `records` envelope and returns `data`, and every other `find()` in the repo
 * returns `data` (or a bare array). So the arm was dead — but a dead arm still
 * costs the contract its authority: a raw SDK client handed in where a
 * `DataSource` belongs would have kept working, unnoticed and unrejected
 * (AGENTS.md #0.1).
 *
 * Both live arms are pinned alongside it. That is what makes the `records` zero
 * a reading rather than a broken harness: the `data` leg and the bare-array leg
 * answer with the SAME rows through the SAME mount, so a leg that renders
 * nothing rendered nothing because the envelope was refused.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';
import { SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const ROWS = [{ id: 'r1', name: 'Ada' }, { id: 'r2', name: 'Grace' }];

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

function mount(envelope: Envelope) {
  const adapter = { find: vi.fn(async () => envelope(ROWS)) };
  render(
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer
        schema={
          {
            type: 'element:repeater',
            id: 'rep',
            // The query is the node-level `dataSource` binding and the display
            // config the `properties` bag (`readProps`) — the doors an authored
            // page writes through.
            dataSource: { object: 'contact' },
            properties: { fields: ['name'] },
          } as never
        }
      />
    </AdapterCtx.Provider>,
  );
  return adapter;
}

/** The rows the block actually painted. */
const painted = () =>
  Array.from(screen.queryByTestId('repeater')?.querySelectorAll('li') ?? []).map(
    (li) => li.textContent ?? '',
  );

describe('element:repeater — the find() envelope it reads (objectui#6726)', () => {
  it("reads the contract's `data` member", async () => {
    const adapter = mount(asData);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('repeater')).toBeTruthy());
    expect(painted().join('|')).toContain('Ada');
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    const adapter = mount(asBareArray);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('repeater')).toBeTruthy());
    expect(painted().join('|')).toContain('Ada');
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    const adapter = mount(asRecords);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // The empty-state paragraph, not the list: before the fix this painted the
    // two rows above.
    await waitFor(() => expect(screen.getByText('No data')).toBeTruthy());
    expect(screen.queryByTestId('repeater')).toBeNull();
  });
});
