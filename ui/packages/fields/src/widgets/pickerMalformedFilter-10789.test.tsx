/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The two record pickers report a refused filter instead of throwing out of
 * render — objectui#10789.
 *
 * Both merge an authored filter inside a RENDER-time `useMemo` through
 * `mergeFilterNodes`, which lowers through the THROWING converter form:
 *
 *  - `PeoplePicker`'s `recentFilter` (the declared `lookupFilters` /
 *    `baseFilter` beside the recents' id restriction), and
 *  - `RecordPickerDialog`'s `mergedFilter` (the record-form filters beside a
 *    spec `ViewFilterRule[]` — an author's `add.picker.filter`).
 *
 * A malformed authored filter threw a `FilterOperatorError` into the nearest
 * error boundary. Each now lowers through `toFilterNodeSafely` and reports the
 * refusal in the error state a refusal from `dataSource.find` already reaches,
 * and runs no query without the filter.
 *
 * Assertions are the notice's CONTENT (the operator the refusal names) plus
 * the absence of any unfiltered read — never a bare "did not throw".
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PeoplePicker } from './PeoplePicker';
import { RecordPickerDialog } from './RecordPickerDialog';
import { pushRecentLookupId } from './recentLookups';

beforeEach(() => {
  // jsdom has no matchMedia; useIsMobile needs it. Default to desktop width.
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1280 });
  window.matchMedia = ((query: string) => ({
    matches: window.innerWidth < 768,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as any;
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

const rows = [{ id: 'u1', name: 'Amy Lin' }];

/** A lenient source: it answers every read, so only the picker can refuse. */
function makeDataSource() {
  return { find: vi.fn(async () => ({ data: rows, total: rows.length })) } as any;
}

/**
 * The reads that carry the recents' id restriction — found by the remembered
 * id itself, since the restriction reaches the wire either as the record form
 * or lowered into an AST beside the declared filter.
 */
const recentsReads = (ds: any) =>
  ds.find.mock.calls.filter((c: any[]) => JSON.stringify(c[1]?.$filter ?? null).includes('"u1"'));

describe('PeoplePicker — a refused declared filter (objectui#10789)', () => {
  it('reports the refusal in the candidate area and skips the recents read', async () => {
    pushRecentLookupId('sys_user', 'u1');
    const ds = makeDataSource();
    render(
      <PeoplePicker
        open
        objectName="sys_user"
        dataSource={ds}
        baseFilter={{ name: { $regex: '^A' } }}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    const notice = await screen.findByTestId('people-picker-error');
    expect(notice.textContent).toContain('$regex');
    // The refused filter is never replaced by "no filter" on the recents read.
    expect(recentsReads(ds)).toHaveLength(0);
    // Nothing to retry: the picker refused before reading.
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('CONTROL — a well-formed declared filter still reads the recents with it', async () => {
    pushRecentLookupId('sys_user', 'u1');
    const ds = makeDataSource();
    render(
      <PeoplePicker
        open
        objectName="sys_user"
        dataSource={ds}
        baseFilter={{ name: 'Amy Lin' }}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    await waitFor(() => expect(recentsReads(ds)).toHaveLength(1));
    const recents = JSON.stringify(recentsReads(ds)[0][1].$filter);
    expect(recents).toContain('Amy Lin');
    expect(screen.queryByTestId('people-picker-error')).toBeNull();
  });
});

describe('RecordPickerDialog — a refused add.picker.filter rule (objectui#10789)', () => {
  it('reports the refusal in the dialog error state and reads nothing', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="contacts"
        onSelect={vi.fn()}
        // `icontains` with an empty comparand: refused by the view-rule arm
        // (objectui#9048), which names the operator.
        baseFilter={[{ field: 'name', operator: 'icontains', value: '' }]}
      />,
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('icontains');
    // Refused, not dropped: no unfiltered read of `contacts`.
    expect(ds.find).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('CONTROL — a well-formed rule array still reads with the rule lowered', async () => {
    const ds = makeDataSource();
    render(
      <RecordPickerDialog
        open
        onOpenChange={vi.fn()}
        dataSource={ds}
        objectName="contacts"
        onSelect={vi.fn()}
        baseFilter={[{ field: 'name', operator: 'icontains', value: 'am' }]}
      />,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(JSON.stringify(ds.find.mock.calls[0][1].$filter)).toContain('icontains');
  });
});
