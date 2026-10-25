/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * `record:reference_rail` — two findings of the HotCRM browser pass
 * (objectui#12110 items 3 and 4).
 *
 * ## Item 3 (B-13): a row is named by the target object's `nameField`
 *
 * The rail named each related row through a fixed ladder of key names
 * (`name`, `title`, `subject`, …) and kept only the `fields` of the target
 * object's schema, so an object that declares its record name — ADR-0079's
 * `nameField` — was named by whichever ladder key it happened to carry. A case
 * object titled by `case_number` read as its `subject`.
 *
 * ## Item 4 (B-14): the rail refetches on the data-invalidation bus
 *
 * The rail fetched once per (parent id + entries) and never subscribed to the
 * bus, so a record action with `refreshAfter: true` — which posts
 * `notifyDataChanged({ objectName: <parent>, recordId })` — refreshed the
 * record and its related lists and left the rail's counts and rows stale. It
 * now refetches IN PLACE (AGENTS.md #8: refresh data, don't rebuild UI) for a
 * change to the parent record, to any entry's object, or to everything (`'*'`).
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { RecordContextProvider, notifyDataChanged } from '@object-ui/react';

import { RecordReferenceRailRenderer } from '../record-reference-rail';

/** Fires every observed entry as visible at once, so each card fetches. */
class ImmediateIO {
  constructor(private cb: (records: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
}

const SCHEMAS: Record<string, unknown> = {
  // Declares its record name: the case number, not the subject.
  crm_case: {
    name: 'crm_case',
    nameField: 'case_number',
    fields: {
      case_number: { type: 'text' },
      subject: { type: 'text' },
      account: { type: 'lookup', reference: 'crm_account' },
    },
  },
  // Declares none: the ladder still applies.
  crm_note: {
    name: 'crm_note',
    fields: { subject: { type: 'text' }, account: { type: 'lookup', reference: 'crm_account' } },
  },
};

function makeDataSource() {
  const caseRows = [{ id: 'c1', case_number: 'CS-0001', subject: 'Printer jam' }];
  let noteRows = [{ id: 'n1', subject: 'Kickoff notes' }];
  const find = vi.fn(async (objectName: string) => {
    if (objectName === 'crm_case') return { data: caseRows, total: caseRows.length };
    return { data: noteRows, total: noteRows.length };
  });
  return {
    find,
    getObjectSchema: vi.fn(async (name: string) => SCHEMAS[name]),
    /**
     * What a server-side action does behind the rail's back. Notes, not cases,
     * so the item 4 legs read through the unchanged ladder and stand on their
     * own, independent of item 3's `nameField` rung.
     */
    addNote(row: { id: string; subject: string }) {
      noteRows = [...noteRows, row];
    },
  };
}

const RAIL = {
  entries: [
    { objectName: 'crm_case', relationshipField: 'account', title: 'Cases' },
    { objectName: 'crm_note', relationshipField: 'account', title: 'Notes' },
  ],
};

function mount(ds: ReturnType<typeof makeDataSource>) {
  return render(
    <MemoryRouter>
      <RecordContextProvider objectName="crm_account" recordId="A-1" dataSource={ds as never}>
        <RecordReferenceRailRenderer schema={RAIL as never} />
      </RecordContextProvider>
    </MemoryRouter>,
  );
}

const notesFetches = (ds: ReturnType<typeof makeDataSource>) =>
  ds.find.mock.calls.filter(([o]) => o === 'crm_note').length;

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateIO as unknown as typeof IntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('record:reference_rail names a row by the target object\'s `nameField` (objectui#12110 item 3)', () => {
  it('THE DEFECT — a case titled by `case_number` reads "CS-0001", not its subject', async () => {
    mount(makeDataSource());
    expect(await screen.findByText('CS-0001')).toBeInTheDocument();
    expect(screen.queryByText('Printer jam')).toBeNull();
  });

  it('CONTROL: an object declaring no `nameField` keeps the ladder', async () => {
    mount(makeDataSource());
    expect(await screen.findByText('Kickoff notes')).toBeInTheDocument();
  });
});

describe('record:reference_rail refetches on the data-invalidation bus (objectui#12110 item 4)', () => {
  it('THE DEFECT — a parent-record change (what `refreshAfter: true` posts) refetches the rail in place', async () => {
    const ds = makeDataSource();
    mount(ds);
    const first = await screen.findByText('Kickoff notes');
    const before = notesFetches(ds);

    ds.addNote({ id: 'n2', subject: 'Follow-up notes' });
    act(() => notifyDataChanged({ objectName: 'crm_account', recordId: 'A-1' }));

    expect(await screen.findByText('Follow-up notes')).toBeInTheDocument();
    expect(notesFetches(ds)).toBeGreaterThan(before);
    // Refreshed in place, not rebuilt: the row already on screen is the same node.
    expect(screen.getByText('Kickoff notes')).toBe(first);
  });

  it('a change to an entry\'s own object refetches it too', async () => {
    const ds = makeDataSource();
    mount(ds);
    expect(await screen.findByText('Kickoff notes')).toBeInTheDocument();

    ds.addNote({ id: 'n3', subject: 'Call summary' });
    act(() => notifyDataChanged({ objectName: 'crm_note', recordId: 'n3' }));

    expect(await screen.findByText('Call summary')).toBeInTheDocument();
  });

  it('CONTROL: a change to an unrelated object, or to another parent record, does not refetch', async () => {
    const ds = makeDataSource();
    mount(ds);
    expect(await screen.findByText('Kickoff notes')).toBeInTheDocument();
    await waitFor(() => expect(notesFetches(ds)).toBe(1));

    act(() => notifyDataChanged({ objectName: 'crm_invoice' }));
    act(() => notifyDataChanged({ objectName: 'crm_account', recordId: 'A-2' }));
    // Give any (wrongly) dispatched refetch a chance to land.
    await new Promise((r) => setTimeout(r, 30));
    expect(notesFetches(ds)).toBe(1);
  });
});
