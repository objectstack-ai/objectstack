/**
 * Off-spec `rowHeight` resolves at the state boundary (#4443).
 *
 * `ObjectGrid` seeds `rowHeightMode` from `schema.rowHeight`. Before #4443 the
 * seed was `schema.rowHeight ?? 'compact'`, so the component answered the same
 * question two different ways: an ABSENT `rowHeight` landed on `compact`, while
 * an OFF-SPEC one fell through the rendering ternaries to their terminal
 * `else` — the `medium` styling. That is the absent-vs-off-spec split #4440
 * removed from `ListView`, and the third answer to a question `@object-ui/core`
 * (`rowHeightToDensityMode` abstains) and the `@object-ui/react` spec bridge had
 * already agreed on.
 *
 * These tests pin the boundary, not the ternaries: `medium` stays a real value
 * with its own styling arm, and the terminal `else` stays that arm. What must
 * hold is that nothing off-spec ever reaches it.
 *
 * Two off-spec spellings are covered because they FAIL DIFFERENTLY before the
 * fix, which the issue text did not distinguish:
 *   - a plain off-spec value (`'garbage'`) is not a key of the toolbar's icon
 *     map either, so `rowHeightIcons[mode]` is `undefined` and rendering
 *     `<RowHeightIcon />` throws — the standalone grid does not render AT ALL;
 *   - a prototype member (`'toString'`) IS reachable through the icon map's
 *     prototype chain, so it survives to the ternary and renders as `medium` —
 *     the defect exactly as filed. Same reason `core` uses `hasOwnProperty`
 *     rather than `in` (see `normalize-list-view.ts`).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

const rows = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

function makeSchema(opts?: Record<string, any>) {
  return {
    type: 'object-grid',
    objectName: 'test_object',
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: rows },
    ...opts,
  } as any;
}

function renderGrid(opts?: Record<string, any>) {
  return render(
    <ActionProvider>
      <ObjectGrid schema={makeSchema(opts)} />
    </ActionProvider>,
  );
}

/**
 * The two independent copies of the density ternary, as they reach the DOM:
 *
 *  - COLUMN_COPY (`ObjectGrid.tsx` ~1833, `rowHeightCellClass`) is attached per
 *    column and is the only copy carrying the `h-*` row-height floor. It lands
 *    on the data columns.
 *  - TABLE_COPY (`ObjectGrid.tsx` ~2370, `dataTableSchema.cellClassName`) is the
 *    table-level default for columns that declare none — the narrow row-number
 *    column — and carries padding/leading only, no `h-*`.
 *
 * They are therefore separately observable, and each case below asserts both.
 */
const COLUMN_COPY: Record<string, string[]> = {
  compact: ['px-3', 'py-1', 'h-9', 'text-[13px]', 'leading-tight'],
  short: ['px-3', 'py-1', 'h-9', 'text-[13px]', 'leading-normal'],
  medium: ['px-3', 'py-1.5', 'h-11', 'text-[13px]', 'leading-normal'],
  tall: ['px-3', 'py-2.5', 'h-14', 'text-sm'],
  extra_tall: ['px-3', 'py-3.5', 'h-16', 'text-sm', 'leading-relaxed'],
};

const TABLE_COPY: Record<string, string[]> = {
  compact: ['px-3', 'py-1', 'text-[13px]', 'leading-tight'],
  short: ['px-3', 'py-1', 'text-[13px]', 'leading-normal'],
  medium: ['px-3', 'py-1.5', 'text-[13px]', 'leading-normal'],
  tall: ['px-3', 'py-2.5', 'text-sm'],
  extra_tall: ['px-3', 'py-3.5', 'text-sm', 'leading-relaxed'],
};

/** Every `h-*` floor the column copy can emit — exactly one may be present. */
const ALL_HEIGHTS = ['h-9', 'h-11', 'h-14', 'h-16'];
/** Every vertical padding the table copy can emit — exactly one may be present. */
const ALL_PADDINGS = ['py-1', 'py-1.5', 'py-2.5', 'py-3.5'];

async function renderAndSettle(opts?: Record<string, any>) {
  const utils = renderGrid(opts);
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  return utils;
}

function cellsOf(container: HTMLElement) {
  const row = container.querySelector('tbody tr');
  expect(row, 'expected a rendered body row').toBeTruthy();
  const tds = Array.from(row!.querySelectorAll('td'));
  const dataCell = tds.find((td) => !td.classList.contains('w-10'));
  const plainCell = tds.find((td) => td.classList.contains('w-10'));
  expect(dataCell, 'expected a data column cell (column-level cellClassName)').toBeTruthy();
  expect(plainCell, 'expected a row-number cell (table-level cellClassName)').toBeTruthy();
  return { dataCell: dataCell!, plainCell: plainCell! };
}

/** Assert BOTH ternary copies resolved to `mode`. */
function expectDensity(container: HTMLElement, mode: keyof typeof COLUMN_COPY) {
  const { dataCell, plainCell } = cellsOf(container);

  // Copy 1 — per-column class, the one with the `h-*` floor.
  for (const token of COLUMN_COPY[mode]) {
    expect(
      dataCell.classList.contains(token),
      `data cell should carry ${mode} token "${token}" (column-level copy), got "${dataCell.className}"`,
    ).toBe(true);
  }
  const heights = ALL_HEIGHTS.filter((h) => dataCell.classList.contains(h));
  expect(heights, `data cell should carry exactly the ${mode} row-height floor`).toEqual(
    ALL_HEIGHTS.filter((h) => COLUMN_COPY[mode].includes(h)),
  );

  // Copy 2 — table-level class on the column that declares none.
  for (const token of TABLE_COPY[mode]) {
    expect(
      plainCell.classList.contains(token),
      `row-number cell should carry ${mode} token "${token}" (table-level copy), got "${plainCell.className}"`,
    ).toBe(true);
  }
  const paddings = ALL_PADDINGS.filter((p) => plainCell.classList.contains(p));
  expect(paddings, `row-number cell should carry exactly the ${mode} padding`).toEqual(
    ALL_PADDINGS.filter((p) => TABLE_COPY[mode].includes(p)),
  );
}

describe('ObjectGrid rowHeight — off-spec resolves at the state boundary (#4443)', () => {
  // ---------------------------------------------------------------------
  // The direction that must NOT change.
  // ---------------------------------------------------------------------
  it('absent rowHeight stays compact', async () => {
    const { container } = await renderAndSettle();
    expectDensity(container, 'compact');
  });

  // ---------------------------------------------------------------------
  // The five admitted values keep their own styling — the ternary chain is
  // untouched and `medium` remains a real value, not just a fallback.
  // ---------------------------------------------------------------------
  it.each(['compact', 'short', 'medium', 'tall', 'extra_tall'] as const)(
    'in-spec rowHeight %s maps to its own styling',
    async (mode) => {
      const { container } = await renderAndSettle({ rowHeight: mode });
      expectDensity(container, mode);
    },
  );

  // ---------------------------------------------------------------------
  // Off-spec input. Before the fix these fall through to the terminal else.
  // ---------------------------------------------------------------------
  it('off-spec rowHeight renders as compact, not medium (toolbar suppressed)', async () => {
    // `hideRowHeightToggle` keeps the icon-map crash (below) out of the way so
    // this case observes the STYLING ternaries for a plain off-spec value.
    const { container } = await renderAndSettle({ rowHeight: 'garbage', hideRowHeightToggle: true });
    expectDensity(container, 'compact');
  });

  it('off-spec rowHeight leaves a standalone grid renderable, and compact', async () => {
    // Standalone: `showRowHeightToggle` is true whenever `schema.rowHeight` is
    // defined, so the toolbar looks the off-spec value up in its icon map.
    const { container } = await renderAndSettle({ rowHeight: 'garbage' });
    expectDensity(container, 'compact');
    expect(screen.getByTitle('Row height: compact')).toBeInTheDocument();
  });

  it('a prototype-member spelling resolves to compact, not through the prototype chain', async () => {
    const { container } = await renderAndSettle({ rowHeight: 'toString' });
    expectDensity(container, 'compact');
    // Pins the resolved STATE, not just the styling: before the fix this read
    // "Row height: toString".
    expect(screen.getByTitle('Row height: compact')).toBeInTheDocument();
  });

  it('a non-string rowHeight resolves to compact', async () => {
    const { container } = await renderAndSettle({ rowHeight: 42, hideRowHeightToggle: true });
    expectDensity(container, 'compact');
  });

  // ---------------------------------------------------------------------
  // The second entry point: the effect that re-syncs state when the prop
  // changes (e.g. a parent ListView's density toggle). One resolver, one
  // answer, at every entry.
  // ---------------------------------------------------------------------
  it('re-syncing to an off-spec rowHeight resolves to compact too', async () => {
    const { container, rerender } = render(
      <ActionProvider>
        <ObjectGrid schema={makeSchema({ rowHeight: 'tall', hideRowHeightToggle: true })} />
      </ActionProvider>,
    );
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expectDensity(container, 'tall');

    rerender(
      <ActionProvider>
        <ObjectGrid schema={makeSchema({ rowHeight: 'garbage', hideRowHeightToggle: true })} />
      </ActionProvider>,
    );
    await waitFor(() => expectDensity(container, 'compact'));
  });
});
