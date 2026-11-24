// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36998 — the record drawer is drawn over the right end of the
 * console's top bar, where the assistant's one standing entry (the robot) is,
 * and over the assistant's own drawer. Its bar carries the entry itself:
 *
 *   - drawn only where the robot is — a layout that hosts the assistant hands
 *     a dock handle (`ChatDockControlProvider`) only while the runtime serves
 *     AI; under no handle, no entry;
 *   - a click opens the record shown as its full page (the same hop as ⤢) and
 *     then opens the assistant (the handle's `open`, on whatever it shows).
 *
 * Mounted through the real `RecordStackDrawer` (the object list's drawer and
 * a record page's drawer) and the real `NavigationOverlay` it draws.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

import { RecordStackDrawer, useRecordDrawerStack, type RecordDrawerLevel } from '../recordDrawerStack';
import { ChatDockControlProvider, type ChatDockControl } from '../../layout/chatDockControl';

afterEach(() => cleanup());

const OBJECTS = [{ name: 'crm_lead', label: 'Lead' }];

function Host({ onOpenAsPage }: { onOpenAsPage?: (path: RecordDrawerLevel[]) => void }) {
  const root = React.useMemo(() => ({ objectName: 'crm_lead', recordId: 'L-1' }), []);
  const stack = useRecordDrawerStack({ root });
  return (
    <RecordStackDrawer
      stack={stack}
      open
      objects={OBJECTS}
      onClose={() => {}}
      onOpenAsPage={onOpenAsPage}
      mainContent={<div>the list</div>}
      renderRecord={(level) => <div data-testid="record-body">{level.recordId}</div>}
    />
  );
}

function control(calls: string[]): ChatDockControl {
  return {
    expanded: false,
    fullWindow: false,
    toggle: () => calls.push('toggle'),
    open: (...args) => calls.push(`open:${JSON.stringify(args)}`),
  };
}

function mount(dock: ChatDockControl | null, onOpenAsPage?: (path: RecordDrawerLevel[]) => void) {
  render(
    <MemoryRouter initialEntries={['/apps/crm/crm_lead?recordId=L-1']}>
      <ChatDockControlProvider value={dock}>
        <Host onOpenAsPage={onOpenAsPage} />
      </ChatDockControlProvider>
    </MemoryRouter>,
  );
  return screen.getByRole('dialog');
}

describe('objectstack#36998 — the record drawer\'s bar opens the assistant', () => {
  it('with the assistant served, the bar draws the entry; a click opens the record as its page, then the assistant', async () => {
    const calls: string[] = [];
    const drawer = mount(control(calls), (path) => calls.push(`page:${path.map((l) => l.recordId).join('>')}`));
    await screen.findByTestId('record-body');
    const entry = within(drawer).getByRole('button', { name: 'AI Assistant' });
    expect(entry).toHaveAttribute('data-testid', 'record-pane-open-assistant');
    // The bar's own control, beside ⤢ in the bar.
    expect(entry.closest('[data-record-top-bar]')).not.toBeNull();
    fireEvent.click(entry);
    expect(calls).toEqual(['page:L-1', 'open:[]']);
  });

  it('without the assistant (no dock handle), no entry is drawn', async () => {
    const drawer = mount(null, vi.fn());
    await screen.findByTestId('record-body');
    expect(within(drawer).queryByTestId('record-pane-open-assistant')).toBeNull();
    // ⤢ is still there: only the assistant's entry depends on the handle.
    expect(within(drawer).getByTestId('record-pane-open-page')).toBeInTheDocument();
  });

  it('a drawer that cannot open its record as a page draws no entry', async () => {
    const drawer = mount(control([]));
    await screen.findByTestId('record-body');
    expect(within(drawer).queryByTestId('record-pane-open-assistant')).toBeNull();
  });
});
