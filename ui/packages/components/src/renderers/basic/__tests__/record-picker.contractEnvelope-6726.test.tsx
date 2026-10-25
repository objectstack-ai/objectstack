/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:record_picker` reads a `find()` answer as `QueryResult` DECLARES it
 * — and does NOT read `records` (objectui#6726).
 *
 * The picker's read was
 * `res?.data ?? res?.records ?? (Array.isArray(res) ? res : [])` — `records`
 * between the contract's one rows member (`data`) and the bare-array arm.
 *
 * MEASURED on this tree, no producer emits `records` at this `DataSource.find()`
 * seam: `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK
 * `records` envelope and returns `data`; every other `find()` in the repo
 * returns `data` or a bare array.
 *
 * The observable is the picker's own empty-state line, which it renders exactly
 * when the query came back with no rows — so the `records` leg is measured by
 * what the user would see, not by an internal. The two live legs push the SAME
 * rows through the SAME mount and both suppress that line, which is what makes
 * the `records` reading a reading.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const ROWS = [
  { id: 'a1', name: 'Acme' },
  { id: 'a2', name: 'Zephyr' },
];

type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

function mount(envelope: Envelope) {
  const adapter = {
    find: vi.fn(async () => envelope(ROWS)),
    getObjectSchema: vi.fn(async () => ({ name: 'account', fields: {} })),
  };
  render(
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer
        schema={
          {
            type: 'element:record_picker',
            id: 'picker',
            // Display config lives in the `properties` bag (`readProps`); the
            // query is the node-level `dataSource` binding (objectui#11880).
            dataSource: { object: 'account' },
          } as never
        }
      />
    </AdapterCtx.Provider>,
  );
  return adapter;
}

describe('element:record_picker — the find() envelope it reads (objectui#6726)', () => {
  it("reads the contract's `data` member — rows offered, no empty-state line", async () => {
    const adapter = mount(asData);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('record-picker-trigger')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('No data')).toBeNull());
  });

  it('still reads a bare array — the live non-envelope shape fakes answer with', async () => {
    const adapter = mount(asBareArray);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('record-picker-trigger')).toBeTruthy());
    await waitFor(() => expect(screen.queryByText('No data')).toBeNull());
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    const adapter = mount(asRecords);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // The empty-state line (the bundle's `common.noData` since objectui#12910),
    // offered to the user: before the fix the picker
    // offered the two rows above off a key the contract does not declare.
    await waitFor(() => expect(screen.getByText('No data')).toBeTruthy());
  });
});
