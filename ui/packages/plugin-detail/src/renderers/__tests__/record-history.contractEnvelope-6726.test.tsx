/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `record:history` reads its `sys_activity` self-fetch as `QueryResult`
 * DECLARES it — and does NOT read `records` (objectui#6726).
 *
 * `QueryResult` (`@object-ui/types`) declares exactly one rows member: `data`.
 * The renderer's read was `res?.data ?? res?.records ?? []`.
 *
 * MEASURED on this tree, no producer emits `records` at this `DataSource.find()`
 * seam: `ObjectStackAdapter.normalizeQueryResult` CONSUMES the server/SDK
 * `records` envelope and returns `data`; every other `find()` in the repo
 * returns `data` too. The arm was dead — and a dead tolerant arm is exactly
 * where a non-conforming producer would keep working unrejected.
 *
 * This is a SEPARATE pin from its sibling `record:activity`, deliberately: one
 * blanket "nothing reads `records`" assertion would stay green with either
 * module repaired wrongly. Each module states its own reading.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { RecordContextProvider } from '@object-ui/react';
import { RecordHistoryRenderer } from '../record-history';

const EMPTY_HISTORY = 'No history yet';

/** `sys_activity` rows whose `type` is in the history set. */
const ROWS = [
  {
    id: 'h-1',
    type: 'updated',
    summary: 'Owner changed to Ada',
    timestamp: '2026-01-02T00:00:00.000Z',
    actor_name: 'Grace',
  },
  {
    id: 'h-2',
    type: 'created',
    summary: 'Record created',
    timestamp: '2026-01-01T00:00:00.000Z',
    actor_name: 'Ada',
  },
];

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
      <RecordHistoryRenderer schema={{} as any} />
    </RecordContextProvider>,
  );
  return dataSource;
}

beforeEach(() => {
  cleanup();
});

describe('record:history — the find() envelope it reads (objectui#6726)', () => {
  it("reads the contract's `data` member", async () => {
    const dataSource = mount(asData);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    expect(await screen.findByText('Owner changed to Ada')).toBeTruthy();
    expect(screen.getByText('Record created')).toBeTruthy();
  });

  it('does NOT read `records` — not a QueryResult member', async () => {
    const dataSource = mount(asRecords);
    await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
    // The empty timeline, honestly: before the fix both rows above rendered off
    // a key `QueryResult` does not declare.
    expect(await screen.findByText(EMPTY_HISTORY)).toBeTruthy();
    expect(screen.queryByText('Owner changed to Ada')).toBeNull();
  });
});
