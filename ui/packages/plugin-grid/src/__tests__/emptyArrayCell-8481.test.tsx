/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8481, consumer half — the surfaces that do NOT pre-check.
 *
 * `@object-ui/plugin-detail` guards the shared renderers with two private
 * upstream predicates (objectui#8474's `hasCellValue`, objectui#8459's
 * `RelatedList.isValueEmpty`). `ObjectGrid` has neither: it resolves a
 * renderer through `getCellRenderer(...)` and calls it with the RAW value at
 * five sites, and its one `EmptyValue` fallback is the no-renderer default
 * path, whose guard (`value != null && value !== ''`) carries the very same
 * hole one branch over. So a `multiselect` column holding `[]` painted a
 * childless flex-wrap DIV — a visually blank cell — in a real grid.
 *
 * ── Why this file renders BOTH widths ─────────────────────────────────────
 * `ObjectGrid` switches to a card layout below 768px (`window.innerWidth <
 * 768`), and that layout resolves its own cell renderers. Two independent
 * read paths, so both are pinned and the width is set explicitly in each —
 * never left at whatever the DOM environment happens to default to.
 *
 * ── Which of these cases discriminates ────────────────────────────────────
 * ⚠️ Not the blank-cell ones. An emptiness test answering EMPTY for every
 * value would satisfy every "[] renders the affordance" case here. The case
 * that refuses it is the POPULATED row rendered in the SAME grid: it is the
 * only assertion in this file that an over-correction fails.
 */

import React from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';
import { registerAllFields } from '@object-ui/fields';
import { ObjectGrid } from '../ObjectGrid';

registerAllFields();

const OPTIONS = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
];

/** One row whose multiselect is `[]`, one whose multiselect is populated. */
const ROWS = [
  { id: 'r1', name: 'Row one', tags: [] as string[] },
  { id: 'r2', name: 'Row two', tags: ['alpha', 'beta'] },
];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS, total: ROWS.length, hasMore: false, pageSize: 50 })),
    getObjectSchema: vi.fn(async (name: string) => ({
      name,
      fields: {
        id: { type: 'text' },
        name: { type: 'text', label: 'Name' },
        tags: { type: 'multiselect', label: 'Tags', options: OPTIONS },
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
              { field: 'tags', label: 'Tags', type: 'multiselect' },
            ],
            pagination: { pageSize: 50 },
          } as any}
          dataSource={ds}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/**
 * ⚠️ Every lookup below is SCOPED TO ONE ROW, and that is load-bearing.
 * Measured: the grid's own toolbar renders a `div.flex.flex-wrap` that is
 * legitimately empty when no filter chips are active, so an unscoped
 * "no childless flex-wrap anywhere" assertion reads the CHROME and fails
 * against a correct grid — an instrument pointed at the wrong thing.
 */
function rowOf(label: string): HTMLElement {
  const cell = screen.getByText(label);
  const row = cell.closest('tr') ?? cell.closest('[role="row"]') ?? cell.parentElement;
  if (!row) throw new Error(`no row found for ${label}`);
  return row as HTMLElement;
}

/** The defect's signature: an element occupying the cell with nothing in it. */
function childlessFlexWrap(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('div.flex.flex-wrap')).filter(
    (el) => el.childElementCount === 0,
  );
}

const affordances = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[data-slot="empty-value"]'));

describe('objectui#8481 — ObjectGrid paints no blank cell for an empty array', () => {
  it('DESKTOP — a multiselect column holding [] renders the No-value affordance', async () => {
    setWidth(1280);
    renderGrid();
    await waitFor(() => expect(screen.queryByText('Row one')).not.toBeNull());
    const emptyRow = rowOf('Row one');

    expect(
      childlessFlexWrap(emptyRow).length,
      'desktop grid: the [] row must not paint a childless flex-wrap cell (the objectui#8481 defect)',
    ).toBe(0);
    expect(
      affordances(emptyRow).length,
      'desktop grid: the [] cell must carry exactly one No-value affordance',
    ).toBe(1);
    expect(
      affordances(emptyRow)[0]?.getAttribute('aria-label'),
      'desktop grid: the affordance must carry its accessible name',
    ).toBe('No value');
  });

  it('⚠️ DISCRIMINATING — the POPULATED row in the SAME desktop grid still draws its badges', async () => {
    // The one case here an EMPTY-for-everything implementation fails.
    setWidth(1280);
    renderGrid();
    await waitFor(() => expect(screen.queryByText('Row two')).not.toBeNull());
    const filledRow = rowOf('Row two');

    expect(
      within(filledRow).queryByText('Alpha'),
      'the populated row must still draw its first badge',
    ).not.toBeNull();
    expect(
      within(filledRow).queryByText('Beta'),
      'the populated row must still draw its second badge',
    ).not.toBeNull();
    expect(
      affordances(filledRow).length,
      'the populated row has nothing empty in it, so it carries no affordance',
    ).toBe(0);
  });

  it('MOBILE CARD VIEW — the same column below the 768px breakpoint also renders the affordance', async () => {
    setWidth(390);
    renderGrid();
    await waitFor(() => expect(screen.queryByText('Row one')).not.toBeNull());
    const emptyCard = rowOf('Row one');
    const filledCard = rowOf('Row two');

    expect(
      childlessFlexWrap(emptyCard).length,
      'mobile card view: the [] card must not paint a childless flex-wrap cell',
    ).toBe(0);
    expect(
      affordances(emptyCard).length,
      'mobile card view: the [] card must carry a No-value affordance',
    ).toBeGreaterThan(0);
    expect(
      within(filledCard).queryByText('Alpha'),
      'mobile card view: the populated card must still draw its badge',
    ).not.toBeNull();
  });
});
