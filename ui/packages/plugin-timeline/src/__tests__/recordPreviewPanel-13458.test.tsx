/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13458 — the timeline's record overlay mounts the shared
 * `RecordDetailPanel`, as the grid, tree, kanban, calendar and gantt overlays
 * do, in place of a raw `Object.entries(record)` dump.
 *
 * The object declares a label for `owner` and hides `internal_code`. The raw
 * dump drew neither the label (it printed the key) nor honoured `hidden` (it
 * printed every key the row carried), so this row was RED before the change.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  assertNoOtherNetworkEscape,
  installRecordSecurityExplainDouble,
} from '@object-ui/test-support';
import { ObjectTimeline, type ObjectTimelineProps } from '../ObjectTimeline';

const OBJECT = 'duly_event';
const DEF = {
  name: OBJECT,
  fields: {
    name: { type: 'text', label: 'Event Name' },
    start_date: { type: 'date', label: 'Starts' },
    owner: { type: 'text', label: 'Assigned To' },
    internal_code: { type: 'text', label: 'Internal Code', hidden: true },
  },
};
const RECORDS = [
  { id: '1', name: 'Kickoff', start_date: '2024-01-05', owner: 'Ada Lovelace', internal_code: 'ZZ-SECRET' },
];

beforeEach(() => installRecordSecurityExplainDouble(vi));

afterEach(() => {
  assertNoOtherNetworkEscape(expect);
  cleanup();
  vi.unstubAllGlobals();
});

describe('ObjectTimeline record overlay (objectui#13458)', () => {
  it('mounts RecordDetailPanel: declared labels, `hidden` honoured', async () => {
    const dataSource = {
      find: vi.fn(async () => RECORDS),
      getObjectSchema: vi.fn(async () => DEF),
    };
    const schema = {
      type: 'timeline',
      objectName: OBJECT,
      timeline: { startDateField: 'start_date', titleField: 'name' },
      navigation: { mode: 'drawer' },
    } satisfies ObjectTimelineProps['schema'];
    // `data` is read off the PROPS (pre-fetched records), so the click is the
    // only thing under test; the data source answers the object definition.
    const extra = { data: RECORDS, dataSource } as Record<string, unknown>;
    render(<ObjectTimeline schema={schema} {...extra} />);
    fireEvent.click(await screen.findByText('Kickoff'));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    const panel = screen.getByRole('dialog');
    await waitFor(() => expect(within(panel).getByText('Assigned To')).toBeInTheDocument());
    expect(within(panel).getByText('Ada Lovelace')).toBeInTheDocument();
    expect(within(panel).queryByText('ZZ-SECRET')).toBeNull();
    // The raw dump's spelling of a key, which the panel never prints.
    expect(within(panel).queryByText('internal code')).toBeNull();
  });
});
