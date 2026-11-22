// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36366 — the list header reads the object's list-page pins
 * (`pinnedActions.list`): the pinned toolbar actions and the page's pinned
 * Import (`$import`) and Export (`$export`) are its buttons, in pin order,
 * and every other toolbar action is in the toolbar's own ⋯. No pins: the
 * header draws as before (the control). An environment list never reads them.
 *
 * The real subject is `ObjectViewPageBarActions`; the `action:bar` node is
 * stood in by a readout of what it is handed (its actions as buttons or menu
 * entries, and its inline budget), which is the part this change arranges.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('./objectViewHeaderLaunchGate', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ListHeaderActionBar: ({ schema }: { schema: { actions: Array<{ name: string; component?: string }>; maxVisible?: number } }) => (
    <span data-testid="bar" data-max={schema.maxVisible ?? ''}>
      {schema.actions.map((a) => `${a.component === 'action:menu' ? '⋯' : ''}${a.name}`).join(' ')}
    </span>
  ),
}));
vi.mock('../environment/EnvironmentListToolbar', () => ({
  EnvironmentListToolbar: () => <span data-testid="environment-toolbar" />,
}));

import { ObjectViewPageBarActions } from './objectViewPageHeader';

const TOOLBAR = [
  { name: 'new_task', label: 'New task', locations: ['list_toolbar'] },
  { name: 'mass_assign', label: 'Assign', locations: ['list_toolbar'] },
  { name: 'export_csv', label: 'CSV', locations: ['list_toolbar'] },
];

const t = ((k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k) as never;

function mount(pinnedActions?: unknown, extra: Record<string, unknown> = {}) {
  const objectDef = { name: 'crm_task', label: 'Task', actions: TOOLBAR, ...(pinnedActions ? { pinnedActions } : {}) };
  render(
    <div data-testid="header">
      <ObjectViewPageBarActions
        {...({
          objectDef,
          objectPluralLabel: 'Tasks',
          objectDesc: () => '',
          createButton: <button type="button">New</button>,
          importShown: true,
          setShowImport: () => {},
          importDisabled: false,
          t,
          listActions: TOOLBAR,
          isEnvironmentList: false,
          headerToolbarActions: TOOLBAR,
          environmentEntitlements: undefined,
          toolbarBar: { type: 'action:bar', actions: TOOLBAR },
          listFavorite: null,
          foldedHeaderActions: [],
          barEnd: { exportDoor: {}, folded: false },
          ...extra,
        } as unknown as React.ComponentProps<typeof ObjectViewPageBarActions>)}
      />
    </div>,
  );
}

/** What the header draws, in order: each bar's readout, and the pinned built-ins by their test id. */
function drawn(): string[] {
  const kept = ['bar', 'object-view-import-pinned', 'object-view-export-pinned'];
  return [...screen.getByTestId('header').querySelectorAll('[data-testid]')]
    .filter((el) => kept.includes(el.getAttribute('data-testid') ?? ''))
    .map((el) => (el.getAttribute('data-testid') === 'bar' ? `bar(${el.textContent})` : el.getAttribute('data-testid')!));
}

afterEach(cleanup);

describe('the list header reads the list-page pins (objectstack#36366)', () => {
  it('CONTROL — no pins: one toolbar bar with every action, as before; Import and Export in their menu', () => {
    mount();
    expect(drawn()).toEqual(['bar(new_task mass_assign export_csv)']);
    expect(screen.getByTestId('bar')).toHaveAttribute('data-max', '');
  });

  it('pins draw in pin order, the built-ins between the actions; the rest go to the toolbar ⋯', () => {
    mount({ list: ['mass_assign', '$export', 'new_task'] });
    expect(drawn()).toEqual([
      'bar(mass_assign)',
      'object-view-export-pinned',
      'bar(new_task)',
      'bar(⋯export_csv)',
    ]);
    // Each pinned run is a bar whose budget is its own length: nothing folds.
    expect(screen.getAllByTestId('bar')[0]).toHaveAttribute('data-max', '1');
  });

  it('a pinned Import is a button of its own and leaves the Import / Export menu', () => {
    mount({ list: ['$import'] });
    expect(drawn()).toEqual(['object-view-import-pinned', 'bar(⋯new_task ⋯mass_assign ⋯export_csv)']);
  });

  it('a pin naming nothing this reader is offered draws nothing', () => {
    mount({ list: ['ghost', '$import'] }, { importShown: false });
    expect(drawn()).toEqual(['bar(⋯new_task ⋯mass_assign ⋯export_csv)']);
  });

  it('a record-page arm alone leaves the list header as it was', () => {
    mount({ record: ['convert'] });
    expect(drawn()).toEqual(['bar(new_task mass_assign export_csv)']);
  });

  it('an environment list never reads the pins', () => {
    mount({ list: ['mass_assign'] }, { isEnvironmentList: true });
    expect(screen.getByTestId('environment-toolbar')).toBeInTheDocument();
    expect(screen.queryByTestId('bar')).toBeNull();
  });
});
