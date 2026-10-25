/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8490, consumer half — the fabricated value reached a real grid.
 *
 * `ObjectGrid` resolves its cell renderers through `getCellRenderer(...)` and
 * calls them with the RAW value, so a `boolean` column holding `[]` painted a
 * CHECKED, disabled checkbox in a real row, and a `number` column holding `[]`
 * printed the digit `0` — each an assertion about the record that the record
 * never made. The renderer half of the evidence lives in `@object-ui/fields`'
 * `cellRenderers.fabricatedValue-8490.test.tsx`; this file pins the surface.
 *
 * Both widths are rendered for the same reason objectui#8481's consumer pin
 * does: the sub-768px card layout resolves its own renderers, so it is a
 * second read path.
 *
 * ⚠️ The DISCRIMINATING case is the populated row in the SAME grid — a real
 * `true` still checked, a real stored `0` still printed. An EMPTY-for-
 * everything implementation passes every `[]` case here and fails only that.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

/** One row whose boolean and number are `[]`, one whose are real values. */
const ROWS = [
  { id: 'r1', name: 'Row one', is_active: [] as unknown[], amount: [] as unknown[] },
  { id: 'r2', name: 'Row two', is_active: true, amount: 0 },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        is_active: { type: 'boolean', label: 'Active' },
        amount: { type: 'number', label: 'Amount' },
      },
    })),
  } as any;
}

const ORIGINAL_INNER_WIDTH = window.innerWidth;

function setWidth(px: number) {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: px });
}

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => {
  setWidth(ORIGINAL_INNER_WIDTH);
  cleanup();
});

function renderGrid() {
  const ds = makeDataSource();
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid
          schema={{
            type: 'object-grid',
            objectName: 'test_object',
            columns: [
              { field: 'name', label: 'Name' },
              { field: 'is_active', label: 'Active', type: 'boolean' },
              { field: 'amount', label: 'Amount', type: 'number' },
            ],
            pagination: { pageSize: 50 },
          } as any}
          dataSource={ds}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Every lookup below is SCOPED TO ONE ROW (objectui#8481's measured lesson). */
function rowOf(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const row = cell.closest('tr') ?? cell.closest('[role="row"]') ?? cell.parentElement;
  if (!row) throw new Error(`no row found for ${label}`);
  return row as HTMLElement;
}

const affordances = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-slot="empty-value"]'));

describe('objectui#8490 — ObjectGrid fabricates no value for an empty array', () => {
  it('DESKTOP — a boolean column holding [] draws no checkbox and a number column holding [] prints no 0', async () => {
    setWidth(1280);
    renderGrid();
    await waitFor(() => expect(screen.queryByText('Row one')).not.toBeNull());
    const emptyRow = rowOf('Row one');

    expect(
      emptyRow.querySelector('[role="checkbox"]'),
      'desktop grid: the [] boolean cell must not draw a checkbox (a checked one was the objectui#8490 defect)',
    ).toBeNull();
    expect(
      within(emptyRow).queryAllByText('0').length,
      'desktop grid: the [] number cell must not print a fabricated 0',
    ).toBe(0);
    expect(
      affordances(emptyRow).length,
      'desktop grid: the two [] cells must each carry the No-value affordance',
    ).toBe(2);
    expect(
      affordances(emptyRow)[0]?.getAttribute('aria-label'),
      'desktop grid: the affordance must carry its accessible name',
    ).toBe('No value');
  });

  it('⚠️ DISCRIMINATING — the POPULATED row in the SAME desktop grid still checks its box and prints its 0', async () => {
    setWidth(1280);
    renderGrid();
    await waitFor(() => expect(screen.queryByText('Row two')).not.toBeNull());
    const filledRow = rowOf('Row two');

    const box = filledRow.querySelector('[role="checkbox"]');
    expect(box, 'the populated row must still draw its checkbox').not.toBeNull();
    expect(box?.getAttribute('aria-checked'), 'a real true is still checked').toBe('true');
    expect(
      within(filledRow).queryAllByText('0').length,
      'a real stored 0 must still print',
    ).toBe(1);
    expect(
      affordances(filledRow).length,
      'the populated row has nothing empty in it, so it carries no affordance',
    ).toBe(0);
  });

  it('MOBILE CARD VIEW — the same columns below the 768px breakpoint draw no checkbox for [] and keep the real one', async () => {
    setWidth(390);
    renderGrid();
    await waitFor(() => expect(screen.queryByText('Row one')).not.toBeNull());
    const emptyCard = rowOf('Row one');
    const filledCard = rowOf('Row two');

    expect(
      emptyCard.querySelector('[role="checkbox"]'),
      'mobile card view: the [] boolean must not draw a checkbox',
    ).toBeNull();
    expect(
      affordances(emptyCard).length,
      'mobile card view: the [] card must carry a No-value affordance',
    ).toBeGreaterThan(0);
    expect(
      filledCard.querySelector('[role="checkbox"]')?.getAttribute('aria-checked'),
      'mobile card view: the populated card still draws its checked box',
    ).toBe('true');
  });
});
