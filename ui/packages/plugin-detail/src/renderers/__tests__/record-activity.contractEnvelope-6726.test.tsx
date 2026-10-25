/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:activity` reads its `sys_activity` self-fetch as `QueryResult`
 * DECLARES it — and does NOT read `records` (objectui#6726).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * The renderer's read was `res?.data ?? res?.records ?? []`.
 *
 * MEASURED on this tree, no producer emits `records` at this `DataSource.find()`
 * seam: `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK
 * `records` envelope and returns `data` before returning, and every other
 * `find()` implementation in the repo returns `data` too. So the arm was dead
 * rather than actively wrong — but a dead arm is still a second de-facto
 * contract nobody is checking (AGENTS.md #0.1).
 *
 * Note the shape here has no bare-array arm and never did: this seam is fed by
 * `RecordContextValue.dataSource`, and both plugin-detail self-fetchers read
 * only the envelope. The `data` leg below is what makes the `records` leg a
 * reading — same rows, same mount, one paints the feed and one does not.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordActivityRenderer } from '../record-activity';

const EMPTY_FEED = 'No activity recorded';

/** Rows as `sys_activity` returns them for one record. */
const ROWS = [
  {
    id: 'act-1',
    type: 'updated',
    summary: 'Stage: draft to qualified',
    timestamp: '2026-01-02T00:00:00.000Z',
    actor_name: 'Grace',
  },
  {
    id: 'act-2',
    type: 'system',
    summary: 'Assignment rule ran',
    timestamp: '2026-01-05T00:00:00.000Z',
  },
];

/** How one case wraps its rows on the way back out of `find()`. */
type Envelope = (rows: unknown[]) => unknown;

const asData: Envelope = (rows) => ({ data: rows, total: rows.length });
const asRecords: Envelope = (rows) => ({ records: rows, total: rows.length });

function mount(envelope: Envelope) {
  const dataSource = { find: vi.fn(async () => envelope(ROWS)) } as any;
  render(
    <RecordContextProvider
      objectName="crm_account"
      recordId="rec-alpha"
      data={{ id: 'rec-alpha', name: 'Alpha' }}
      dataSource={dataSource}
    >
      <RecordActivityRenderer schema={{} as any} />
    </RecordContextProvider>,
  );
  return dataSource;
}

beforeEach(() => {
  cleanup();
});

describe('record:activity — the find() envelope it reads (objectui#6726)', () => {
  it("reads the contract's `data` member", async () => {
    const dataSource = mount(asData);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(await screen.findByText('Stage: draft to qualified')).toBeTruthy();
    expect(screen.getByText('Assignment rule ran')).toBeTruthy();
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    const dataSource = mount(asRecords);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    // An empty feed, honestly: the block probed and the envelope was refused.
    // Before the fix both rows above rendered off a key `QueryResult` does not
    // declare.
    expect(await screen.findByText(EMPTY_FEED)).toBeTruthy();
    expect(screen.queryByText('Stage: draft to qualified')).toBeNull();
  });
});
