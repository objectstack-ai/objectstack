// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27056, Target 4 — in the record drawer, `↑` `↓` prefetch the next
 * record's related counts.
 *
 * The drawer names the record a step would show next — onward in the
 * direction of the last step, `↓` before any — and the record drawn in it
 * warms that record's counts once its own record has loaded, so the next
 * page draws its counts from the store.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { RelatedCountStore } from '@object-ui/components';

import {
  PrefetchUpcomingRelatedCounts,
  RecordDrawerUpcomingContext,
  RecordStackDrawer,
  useRecordDrawerStack,
} from '../recordDrawerStack';

beforeEach(() => RelatedCountStore._reset());
afterEach(() => cleanup());

const OBJECTS = [{ name: 'crm_lead', label: 'Lead' }];
const ROWS = ['L-1', 'L-2', 'L-3', 'L-4'];

function Upcoming() {
  const upcoming = React.useContext(RecordDrawerUpcomingContext);
  return <div data-testid="upcoming">{upcoming ? `${upcoming.objectName}:${upcoming.recordId}` : 'none'}</div>;
}

function ListHost({ start, siblings }: { start: string; siblings?: readonly string[] }) {
  const [recordId, setRecordId] = React.useState(start);
  const root = React.useMemo(
    () => ({ objectName: 'crm_lead', recordId, ...(siblings ? { siblings } : {}) }),
    [recordId, siblings],
  );
  const stack = useRecordDrawerStack({ root, onRootStep: setRecordId });
  return (
    <RecordStackDrawer
      stack={stack}
      open
      objects={OBJECTS}
      onClose={() => {}}
      renderRecord={(level) => (
        <>
          <div data-testid="record-body">{level.recordId}</div>
          <Upcoming />
        </>
      )}
    />
  );
}

const upcoming = () => screen.getByTestId('upcoming').textContent;
const previous = () => screen.getByRole('button', { name: 'Previous record' });
const next = () => screen.getByRole('button', { name: 'Next record' });

describe('the record drawer names the record ↑ ↓ shows next (objectstack#27056)', () => {
  it('onward in the last step\'s direction, ↓ before any, and back at the end of the set', () => {
    render(<MemoryRouter><ListHost start="L-2" siblings={ROWS} /></MemoryRouter>);
    expect(upcoming()).toBe('crm_lead:L-3');
    fireEvent.click(previous());
    expect(screen.getByTestId('record-body').textContent).toBe('L-1');
    // Stepping up at the first row: the only way on is back down.
    expect(upcoming()).toBe('crm_lead:L-2');
    fireEvent.click(next());
    fireEvent.click(next());
    fireEvent.click(next());
    expect(screen.getByTestId('record-body').textContent).toBe('L-4');
    expect(upcoming()).toBe('crm_lead:L-3');
  });

  it('names none without a sibling set', () => {
    render(<MemoryRouter><ListHost start="L-2" /></MemoryRouter>);
    expect(upcoming()).toBe('none');
  });
});

describe('PrefetchUpcomingRelatedCounts (objectstack#27056)', () => {
  const page = {
    type: 'record',
    regions: [
      {
        components: [
          { type: 'record:related_list', properties: { objectName: 'crm_task', relationshipField: 'lead' } },
          { type: 'record:related_list', properties: { objectName: 'crm_note', relationshipField: 'lead' } },
        ],
      },
    ],
  };

  function mount(ready: boolean, upcomingRecord: { objectName: string; recordId: string } | null) {
    const find = vi.fn(async () => ({ data: [], total: 3 }));
    const view = render(
      <RecordDrawerUpcomingContext.Provider value={upcomingRecord}>
        <PrefetchUpcomingRelatedCounts page={page} objectName="crm_lead" dataSource={{ find }} ready={ready} />
      </RecordDrawerUpcomingContext.Provider>,
    );
    return { find, view };
  }

  it('warms the next record\'s counts once the record on screen has loaded', async () => {
    const { find, view } = mount(false, { objectName: 'crm_lead', recordId: 'L-3' });
    await act(async () => {});
    expect(find).not.toHaveBeenCalled();
    view.rerender(
      <RecordDrawerUpcomingContext.Provider value={{ objectName: 'crm_lead', recordId: 'L-3' }}>
        <PrefetchUpcomingRelatedCounts page={page} objectName="crm_lead" dataSource={{ find }} ready />
      </RecordDrawerUpcomingContext.Provider>,
    );
    await act(async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    });
    expect(find.mock.calls.map(([object, query]: any[]) => [object, query.$filter, query.$count])).toEqual([
      ['crm_task', { lead: 'L-3' }, true],
      ['crm_note', { lead: 'L-3' }, true],
    ]);
    expect(RelatedCountStore.get('crm_task', 'lead', 'L-3')).toBe(3);
  });

  it('warms nothing for a record of another object, or with none next', async () => {
    const other = mount(true, { objectName: 'crm_account', recordId: 'A-1' });
    const none = mount(true, null);
    await act(async () => {});
    expect(other.find).not.toHaveBeenCalled();
    expect(none.find).not.toHaveBeenCalled();
  });
});
