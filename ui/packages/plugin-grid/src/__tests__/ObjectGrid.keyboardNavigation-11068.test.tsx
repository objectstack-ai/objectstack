/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `object-grid`'s `keyboardNavigation` (objectui#11068) — the key the spec's
 * `object-grid` row declares since `@objectstack/spec` 17.6.0, now READ:
 * `ObjectGrid` resolves it and relays the answer to the `data-table` it builds,
 * which moves a roving focus across its cells with the arrow keys
 * (`data-table-keyboard-navigation-11068.test.tsx` in `@object-ui/components`
 * pins that behaviour). This file pins the RELAY and the DEFAULT, through the
 * real registration:
 *
 *   1. a read-only grid keeps today's Tab behaviour (every cell its own stop)
 *      unless `keyboardNavigation: true` is authored;
 *   2. an editable grid has it ON — since objectstack#36270 it selects a cell
 *      first (the list page's model), the arrows move that selection, and
 *      `keyboardNavigation: false` no longer turns it off there (the spec's
 *      describe narrowed to what is enforced, ruling A);
 *   3. the `editable` the default follows is the one the grid RENDERS: an
 *      `editable: true` grid shown to a viewer with no update grant is
 *      read-only, so it keeps its Tab behaviour too;
 *   4. the authored document (`{ type, properties }`) reaches the same reads.
 *
 * Each "off" reading is paired with an "on" reading on the same probe.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

// The viewer's update grant, switchable per test. Stable stub identity:
// `ObjectGrid` keeps `perms` in memo dependency arrays.
const { permsStub, grant } = vi.hoisted(() => {
  const grant = { update: true };
  return {
    grant,
    permsStub: {
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => undefined,
      can: (_obj: string, action: string) => (action === 'update' ? grant.update : true),
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub };
});

import { ActionProvider, SchemaRenderer } from '@object-ui/react';
// Registers `object-grid`, the block under test.
import { ObjectGridRenderer } from '../index';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';

// objectstack#27365 — an editable grid asks the record-grained `update`
// verdict for the rows on screen even with no kebab Edit wired. Answer it from
// the double (every row permitted), never the network.
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  grant.update = true;
});

const ROWS = [
  { id: '1', name: 'Alpha', status: 'Open' },
  { id: '2', name: 'Beta', status: 'Closed' },
  { id: '3', name: 'Gamma', status: 'Open' },
];
const DATA_COLUMNS = 2;

const grid = (extra: Record<string, unknown> = {}) => ({
  type: 'object-grid',
  objectName: 'probe',
  columns: ['name', 'status'],
  data: { provider: 'value', items: ROWS },
  ...extra,
});

async function renderGrid(extra: Record<string, unknown> = {}) {
  const utils = render(<ObjectGridRenderer schema={grid(extra)} />);
  await screen.findByText('Gamma', {}, { timeout: 5000 });
  return utils;
}

/** The body cells the table renders for the data columns — the ones that take a `tabindex`. */
const dataCells = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>('tbody td[tabindex]'));

/** The data cell at (row, data column). */
const cellAt = (container: HTMLElement, row: number, col: number) =>
  container.querySelectorAll('tbody tr')[row].querySelectorAll<HTMLElement>('td[tabindex]')[col];

/** What the arrows and the Tab sequence see, in one reading. */
function reading(container: HTMLElement) {
  const cells = dataCells(container);
  cellAt(container, 0, 0).focus();
  const arrowTaken = !fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
  return {
    cells: cells.length,
    tabStops: cells.filter((td) => td.tabIndex === 0).length,
    role: container.querySelector('table')?.getAttribute('role') ?? null,
    arrowTaken,
    focusAfterArrowDown: document.activeElement === cellAt(container, 1, 0) ? 'next row' : 'stayed',
  };
}

const OFF = { cells: ROWS.length * DATA_COLUMNS, tabStops: ROWS.length * DATA_COLUMNS, role: null, arrowTaken: false, focusAfterArrowDown: 'stayed' };
const ON = { cells: ROWS.length * DATA_COLUMNS, tabStops: 1, role: 'grid', arrowTaken: true, focusAfterArrowDown: 'next row' };

/**
 * objectstack#36270 — the reading of a grid that renders editable, which
 * selects a cell first: a click selects, the selection (not DOM focus) is what
 * the arrows move, and the one Tab stop is the grid's own key catcher, so no
 * data cell is a Tab stop.
 */
function selectFirstReading(container: HTMLElement) {
  const cells = dataCells(container);
  fireEvent.click(cellAt(container, 0, 0));
  const catcher = container.querySelector<HTMLElement>('[data-slot="cell-type-catcher"]');
  const arrowTaken = catcher ? !fireEvent.keyDown(catcher, { key: 'ArrowDown' }) : false;
  return {
    cells: cells.length,
    cellTabStops: cells.filter((td) => td.tabIndex === 0).length,
    role: container.querySelector('table')?.getAttribute('role') ?? null,
    arrowTaken,
    selectionAfterArrowDown: cellAt(container, 1, 0).hasAttribute('data-selected-cell') ? 'next row' : 'stayed',
  };
}

const SELECT_FIRST = { cells: ROWS.length * DATA_COLUMNS, cellTabStops: 0, role: 'grid', arrowTaken: true, selectionAfterArrowDown: 'next row' };

/* ── 1. Read-only ────────────────────────────────────────────────────────── */

describe('a read-only `object-grid` keeps its Tab behaviour unless `keyboardNavigation: true` (objectui#11068)', () => {
  it('no `editable`, no key: every data cell is its own Tab stop and the arrows are the browser\'s', async () => {
    const { container } = await renderGrid();
    expect(reading(container)).toEqual(OFF);
  });

  it('`keyboardNavigation: true` turns it on for a read-only grid', async () => {
    const { container } = await renderGrid({ keyboardNavigation: true });
    expect(reading(container)).toEqual(ON);
  });
});

/* ── 2. Editable ─────────────────────────────────────────────────────────── */

describe('an editable `object-grid` always has it on: it selects a cell first (objectui#11068, objectstack#36270)', () => {
  it('`editable: true`, no key: the grid pattern, and ArrowDown moves the selection', async () => {
    const { container } = await renderGrid({ editable: true });
    expect(selectFirstReading(container)).toEqual(SELECT_FIRST);
  });

  it('`editable: true` with `keyboardNavigation: false`: still on — `false` is no longer honoured on an editable grid', async () => {
    const { container } = await renderGrid({ editable: true, keyboardNavigation: false });
    expect(selectFirstReading(container)).toEqual(SELECT_FIRST);
  });

  it('Enter opens the selected cell, and Enter commits and keeps it selected', async () => {
    const { container } = await renderGrid({ editable: true });
    const cell = cellAt(container, 1, 0);
    fireEvent.click(cell);
    const catcher = container.querySelector<HTMLElement>('[data-slot="cell-type-catcher"]')!;
    fireEvent.keyDown(catcher, { key: 'Enter' });
    const input = await waitFor(() => {
      const el = container.querySelector<HTMLInputElement>('td[data-editing-cell] input');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(container.querySelector('td[data-editing-cell]')).toBeNull());
    expect(cellAt(container, 1, 0)).toHaveAttribute('data-selected-cell');
  });

  it('CONTROL: a host that keeps the staged model (`cellSelection: false`) keeps the roving cell focus, and `false` turns it off', async () => {
    const on = render(<ObjectGridRenderer schema={grid({ editable: true })} cellSelection={false} />);
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    expect(reading(on.container)).toEqual(ON);
    cleanup();
    const off = render(<ObjectGridRenderer schema={grid({ editable: true, keyboardNavigation: false })} cellSelection={false} />);
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    expect(reading(off.container)).toEqual(OFF);
  });
});

/* ── 3. The `editable` that counts is the one the grid renders ───────────── */

describe('the default follows the editable the grid RENDERS, not the authored key alone (objectui#11068)', () => {
  it('`editable: true` for a viewer with no update grant renders read-only, so it stays off', async () => {
    grant.update = false;
    const { container } = await renderGrid({ editable: true });
    // The grid really is read-only for this viewer: Enter opens nothing.
    const cell = cellAt(container, 0, 0);
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(cell.querySelector('input')).toBeNull();
    expect(reading(container)).toEqual(OFF);
  });

  it('LIT CONTROL — the same viewer with an explicit `keyboardNavigation: true` gets it', async () => {
    grant.update = false;
    const { container } = await renderGrid({ editable: true, keyboardNavigation: true });
    expect(reading(container)).toEqual(ON);
  });
});

/* ── 4. The authored document ────────────────────────────────────────────── */

describe('the authored `{ type, properties }` document reaches the same reads (objectui#11068)', () => {
  const page = (properties: Record<string, unknown>) => (
    <ActionProvider>
      <SchemaRenderer
        schema={{
          type: 'object-grid',
          properties: { objectName: 'probe', columns: ['name', 'status'], data: { provider: 'value', items: ROWS }, ...properties },
        } as never}
      />
    </ActionProvider>
  );

  it('`properties.editable: true` turns it on (select-first), and `properties.keyboardNavigation: false` does not turn it off', async () => {
    const on = render(page({ editable: true }));
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    expect(selectFirstReading(on.container)).toEqual(SELECT_FIRST);
    cleanup();

    const off = render(page({ editable: true, keyboardNavigation: false }));
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    expect(selectFirstReading(off.container)).toEqual(SELECT_FIRST);
  });

  it('LIT CONTROL: `properties.keyboardNavigation: true` on a read-only node turns it on', async () => {
    render(page({ keyboardNavigation: true }));
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    expect(reading(document.body)).toEqual(ON);
  });
});
