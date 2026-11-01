// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D1 — the item history names the person and says why.
 *
 * Each event's `actor` is a `sys_user` id. The panel asks the user directory
 * once for every distinct id and shows the user's name; an id with no row
 * behind it (a deleted user), or a directory read that fails, shows the id
 * marked unresolved. A `null` actor (a write no person made) shows no actor.
 * The event's change note (`message`) is shown under the row.
 *
 * Real: `HistoryPanel` and its directory hook. Stubbed: the metadata client's
 * `history` read and the data adapter's `find`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { AdapterCtx } from '@object-ui/react';
import { HistoryPanel } from './ResourceHistoryPage';

afterEach(cleanup);

const EVENTS = [
  { seq: 4, op: 'publish', version: 3, actor: 'u_ada', message: 'Split the queue by priority' },
  { seq: 3, op: 'update', version: 2, actor: 'u_gone', message: 'publish app package \'com.x\'' },
  { seq: 2, op: 'update', version: 2, actor: 'u_ada' },
  { seq: 1, op: 'create', version: 1, actor: null },
];

function historyClient(events: unknown[] = EVENTS) {
  return { history: vi.fn(async () => ({ events })) };
}

function renderPanel(adapter: unknown, client = historyClient()) {
  return render(
    <AdapterCtx.Provider value={adapter as React.ContextType<typeof AdapterCtx>}>
      <HistoryPanel type="object" name="st_ticket" client={client as never} locale="en-US" />
    </AdapterCtx.Provider>,
  );
}

/** The `<li>` of the event with this `seq`, newest first as the panel draws them. */
async function rows() {
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(EVENTS.length));
  return screen.getAllByRole('listitem');
}

describe('HistoryPanel names the actor (ADR-0146 D1)', () => {
  it('shows the user’s name, keeps the id on its title, and asks the directory once for every distinct id', async () => {
    const find = vi.fn(async () => ({ data: [{ id: 'u_ada', name: 'Ada Lovelace', email: 'ada@example.com' }] }));
    renderPanel({ find });
    const [newest, , third, oldest] = await rows();

    await waitFor(() => expect(within(newest!).getByText('Ada Lovelace')).toBeInTheDocument());
    expect(within(newest!).getByText('Ada Lovelace')).toHaveAttribute('title', 'u_ada');
    expect(within(third!).getByTestId('history-event-actor')).toHaveTextContent('by Ada Lovelace');
    expect(within(newest!).queryByText('u_ada')).toBeNull();
    // No person made the oldest write: no actor at all, never a made-up one.
    expect(within(oldest!).queryByTestId('history-event-actor')).toBeNull();

    expect(find).toHaveBeenCalledTimes(1);
    const [object, query] = find.mock.calls[0] as unknown as [string, any];
    expect(object).toBe('sys_user');
    expect([...query.$filter.id.$in].sort()).toEqual(['u_ada', 'u_gone']);
  });

  it('a user the directory has no row for (deleted) shows the id, marked unresolved', async () => {
    const find = vi.fn(async () => ({ data: [{ id: 'u_ada', name: 'Ada Lovelace' }] }));
    renderPanel({ find });
    const [, second] = await rows();

    await waitFor(() => expect(within(second!).getByText('(unresolved user)')).toBeInTheDocument());
    expect(within(second!).getByText('u_gone')).toHaveClass('font-mono');
  });

  it('a failed directory read shows every id, marked unresolved, and still draws the timeline', async () => {
    const find = vi.fn(async () => {
      throw new Error('OBJECT_API_DISABLED');
    });
    renderPanel({ find });
    const [newest, second] = await rows();

    await waitFor(() => expect(within(newest!).getByText('(unresolved user)')).toBeInTheDocument());
    expect(within(newest!).getByText('u_ada')).toBeInTheDocument();
    expect(within(second!).getByText('(unresolved user)')).toBeInTheDocument();
  });
});

describe('HistoryPanel shows the change note under the row (ADR-0146 D1)', () => {
  it('each event with a note shows it; one without shows none', async () => {
    renderPanel({ find: vi.fn(async () => ({ data: [] })) });
    const [newest, second, third] = await rows();

    expect(within(newest!).getByTestId('history-event-note')).toHaveTextContent('Split the queue by priority');
    expect(within(second!).getByTestId('history-event-note')).toHaveTextContent("publish app package 'com.x'");
    expect(within(third!).queryByTestId('history-event-note')).toBeNull();
  });
});
