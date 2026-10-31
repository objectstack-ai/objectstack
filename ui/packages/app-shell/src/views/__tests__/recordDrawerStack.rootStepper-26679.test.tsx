// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26679 — `↑` `↓` at the ROOT of the record drawer (ruling 3: the
 * controls stay). Since objectstack#27524 (Target 7) the top bar draws the
 * counter 「n / N」 before them, and its left end at the root is the
 * breadcrumb 「对象 › 记录名」.
 *
 * The root level steps through the sibling set its host hands it — on the
 * object list, the rows `ListView` reports through `onRowsChange` — exactly as
 * a nested level steps through its parent's related rows: present when the
 * host knows the set, absent when it passes none, disabled (never wrapped) at
 * the first and the last row, and a step hands the new root to the host.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

import { RecordStackDrawer, useRecordDrawerStack } from '../recordDrawerStack';

afterEach(() => cleanup());

const OBJECTS = [{ name: 'crm_lead', label: 'Lead' }];
const ROWS = ['L-1', 'L-2', 'L-3'];

/** The list host's shape: the root is host state, stepped by `onRootStep`. */
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
      renderRecord={(level) => <div data-testid="record-body">{level.recordId}</div>}
    />
  );
}

function mount(start: string, siblings?: readonly string[]) {
  render(
    <MemoryRouter>
      <ListHost start={start} siblings={siblings} />
    </MemoryRouter>,
  );
}

const body = () => screen.getByTestId('record-body').textContent;
const previous = () => screen.queryByRole('button', { name: 'Previous record' }) as HTMLButtonElement | null;
const next = () => screen.queryByRole('button', { name: 'Next record' }) as HTMLButtonElement | null;

describe('the drawer root steps through the host\'s rows (objectstack#26679)', () => {
  it('draws ↑ ↓ when the host knows the set, and a step moves the root', () => {
    mount('L-2', ROWS);
    expect(previous()).not.toBeNull();
    expect(next()).not.toBeNull();
    fireEvent.click(next()!);
    expect(body()).toBe('L-3');
    fireEvent.keyDown(document.body, { key: 'k' });
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(body()).toBe('L-1');
    // Still the root: the breadcrumb, no ← and no path (objectstack#27524) —
    // the record names itself by its id until it reports a title.
    expect(screen.getByTestId('record-drawer-crumb').textContent).toBe('Lead#L-1');
    expect(screen.queryByTestId('record-drawer-trail')).toBeNull();
    // objectstack#27524, Target 7 — the counter follows the step.
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('↑ at the first row and ↓ at the last are disabled, never wrapped', () => {
    mount('L-1', ROWS);
    expect(previous()!.disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'ArrowUp' });
    expect(body()).toBe('L-1');
    fireEvent.click(next()!);
    fireEvent.click(next()!);
    expect(body()).toBe('L-3');
    expect(next()!.disabled).toBe(true);
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(body()).toBe('L-3');
  });

  it('control: no ↑ ↓ when the host passes no set', () => {
    mount('L-2');
    expect(previous()).toBeNull();
    expect(next()).toBeNull();
  });

  it('control: no ↑ ↓ when the root is not in the set the host passed', () => {
    mount('L-9', ROWS);
    expect(previous()).toBeNull();
    expect(next()).toBeNull();
  });
});
