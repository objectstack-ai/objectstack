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
 *   2. an editable grid has it ON by default — one Tab stop, arrows move it —
 *      and `keyboardNavigation: false` turns it off;
 *   3. the `editable` the default follows is the one the grid RENDERS: an
 *      `editable: true` grid shown to a viewer with no update grant is
 *      read-only, so it keeps its Tab behaviour too;
 *   4. the authored document (`{ type, properties }`) reaches the same reads.
 *
 * Each "off" reading is paired with an "on" reading on the same probe.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
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

describe('an editable `object-grid` has it on by default; `false` turns it off (objectui#11068)', () => {
  it('`editable: true`, no key: one roving Tab stop, and ArrowDown moves it', async () => {
    const { container } = await renderGrid({ editable: true });
    expect(reading(container)).toEqual(ON);
  });

  it('`editable: true` with `keyboardNavigation: false`: every cell its own stop again', async () => {
    const { container } = await renderGrid({ editable: true, keyboardNavigation: false });
    expect(reading(container)).toEqual(OFF);
  });

  it('Enter still opens the focused cell, and Enter hands focus back to it', async () => {
    const { container } = await renderGrid({ editable: true });
    const cell = cellAt(container, 1, 0);
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Enter' });
    const input = await waitFor(() => {
      const el = cell.querySelector('input');
      expect(el).not.toBeNull();
      return el as HTMLInputElement;
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(cell.querySelector('input')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cell));
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

  it('`properties.editable: true` turns it on, and `properties.keyboardNavigation: false` turns it off', async () => {
    const on = render(page({ editable: true }));
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    expect(reading(on.container)).toEqual(ON);
    cleanup();

    const off = render(page({ editable: true, keyboardNavigation: false }));
    await screen.findByText('Gamma', {}, { timeout: 5000 });
    expect(reading(off.container)).toEqual(OFF);
  });
});
