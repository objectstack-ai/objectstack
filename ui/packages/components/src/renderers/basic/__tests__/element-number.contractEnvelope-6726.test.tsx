/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `element:number` (`elements.tsx`) reads a `find()` answer as `QueryResult`
 * DECLARES it — and does NOT read `records` (objectui#6726).
 *
 * This is the block's client-side aggregate fallback: reached when the adapter
 * has no `aggregate()`, it pulls rows through `find()` and counts/sums them
 * locally. Its read was
 * `res?.data ?? res?.records ?? (Array.isArray(res) ? res : [])` — `records`
 * between the contract's one rows member and the bare-array arm.
 *
 * MEASURED on this tree, no producer emits `records` at this `DataSource.find()`
 * seam: `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK
 * `records` envelope and returns `data`; every other `find()` in the repo
 * returns `data` or a bare array.
 *
 * What makes the `records` zero a reading and not a broken harness: the `data`
 * leg and the bare-array leg push the SAME three rows through the SAME mount
 * and both paint `3`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { AdapterCtx, SchemaRenderer } from '@object-ui/react';
// Registers every `element:*` renderer at module scope, not in a hook
// (object-ui/no-dynamic-import-in-test-hook, objectui#3010).
import '../../../renderers';

afterEach(cleanup);

const ROWS = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];

type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asBareArray: Envelope = (rows) => rows;
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

/**
 * No `aggregate()` on this adapter ON PURPOSE — that is the branch under test.
 * An adapter carrying one would answer from the server and never reach the
 * envelope read at all.
 */
function mount(envelope: Envelope) {
  const adapter = { find: vi.fn(async () => envelope(ROWS)) };
  const view = render(
    <AdapterCtx.Provider value={adapter as never}>
      <SchemaRenderer
        schema={
          {
            type: 'element:number',
            id: 'metric',
            // Display config lives in the `properties` bag (`readProps`); the
            // query is the node-level `dataSource` binding (objectui#11880).
            dataSource: { object: 'contact' },
            properties: { aggregate: 'count' },
          } as never
        }
      />
    </AdapterCtx.Provider>,
  );
  return { adapter, view };
}

/** The number the block painted (empty while the loading skeleton shows, objectui#12889). */
const painted = (view: ReturnType<typeof render>) =>
  view.container.querySelector('.tabular-nums')?.textContent ?? '';

describe('element:number — the find() envelope its client-side count reads (objectui#6726)', () => {
  it("counts the contract's `data` member", async () => {
    const { adapter, view } = mount(asData);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(painted(view)).toBe('3'));
  });

  it('still counts a bare array — the live non-envelope shape fakes answer with', async () => {
    const { adapter, view } = mount(asBareArray);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    await waitFor(() => expect(painted(view)).toBe('3'));
  });

  it('does NOT count `records` — not a QueryResult member', async () => {
    const { adapter, view } = mount(asRecords);
    await waitFor(() => expect(adapter.find).toHaveBeenCalled());
    // Zero countable rows, not three: before the fix this metric painted `3`
    // off a key the contract does not declare.
    await waitFor(() => expect(painted(view)).toBe('0'));
  });
});
