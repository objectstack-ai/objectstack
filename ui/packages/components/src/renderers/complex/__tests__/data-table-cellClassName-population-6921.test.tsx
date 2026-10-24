/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6921 — WHICH body cells the SCHEMA-level `cellClassName` reaches,
 * measured in the DOM rather than stated in prose.
 *
 * ## The sentence this file replaces with a measurement
 *
 * For three days a census sentence said the schema-level key was "folded into
 * every body cell's `className`". It was false the day it was written and was
 * copied forward, text to text, for three days before a reviewer measured it
 * (objectui#6882 review, PR #6918). Re-derived here against `data-table.tsx`,
 * the schema-level key is folded at exactly THREE sites, every one a UTILITY
 * cell:
 *
 *   - the selection (checkbox) cell,
 *   - the row-number cell,
 *   - the row-actions cell.
 *
 * The MAIN DATA cell folds `col.cellClassName` — the per-column twin declared
 * on `TableColumn` — and never the schema-level key. The two slots style
 * DISJOINT cells and never combine on one.
 *
 * ## Why every assertion is about rendered `td` elements
 *
 * A prose pin ("the comment does not say every body cell") passes on a comment
 * that has been deleted, and a source-text pin on `data-table.tsx` breaks on
 * any reformat. What the card actually asks is a question about the DOM: given
 * a schema class and a column class, which cells carry which? So this suite
 * renders the table with every utility column switched ON, takes the one body
 * row, classifies its cells by CONTENT (checkbox / row number / value / actions
 * container), and reads the class list off each. The classification is total —
 * every cell matches exactly one role — so a cell that changed role or count is
 * reported as such rather than silently skipped. Since objectui#12423 the
 * checkbox and the row number share ONE leading cell when both are on, a role
 * of its own here; the row-number cell alone is measured without selection.
 *
 * ## ⛔ The fence, as a pin
 *
 * Whether the schema-level key SHOULD reach data cells is a different question
 * the card neither asks nor answers (its ruling would be a renderer change with
 * its own card). The plausible WRONG fix for the false sentence is to make it
 * true — teach the data cell to fold the schema-level key. The first test below
 * refuses exactly that: it goes red when the data cell folds `cellClassName`
 * (measured: the fold added, this file red on the data-cell assertion; the fold
 * swapped for the schema-level key, red on both data-cell assertions).
 *
 * ## Non-regression, the other direction
 *
 * The corrected prose says three utility cells DO fold the key. A later
 * "cleanup" that drops one fold would make the corrected sentence false the
 * other way with nothing going red — so each of the three is asserted by name,
 * and the count is asserted too (measured: the row-actions fold removed, red
 * naming that cell; the selection fold removed, red naming that cell).
 *
 * ## The control: zero cells
 *
 * With no selection, row-number or row-actions column the schema-level key
 * reaches ZERO body cells while the column key still reaches the data cell.
 * That is the reading that broke the original mdx example (objectui#6921's
 * comment record: with `data: []` and no utility column its `cellClassName`
 * reached nothing and the empty state rendered). Here it is the control for
 * the instrument: the schema class is not being sprayed onto every cell by
 * `cn()`, so the three positive hits above mean what they say.
 *
 * The prose these cell names are asserted against lives in
 * `packages/plugin-grid/src/ObjectGrid.tsx` (the schema-slot census) and is
 * pinned by `packages/plugin-grid/src/__tests__/cellClassNameCensusProse-6921.test.ts`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
import '../data-table';

/** Probe classes — unique tokens no utility or renderer class could collide with. */
const SCHEMA_SLOT = 'probe-schema-slot-6921';
const COLUMN_SLOT = 'probe-column-slot-6921';

/** The one cell value in the one data row; how the DATA cell is found. */
const VALUE = 'Ada Lovelace 6921';

type UtilityColumns = { selectable: boolean; showRowNumbers: boolean; rowActions: boolean };

function renderTable(utility: UtilityColumns) {
  const DataTable = ComponentRegistry.get('data-table') as any;
  if (!DataTable) throw new Error('data-table not registered');
  return render(
    <DataTable
      schema={{
        data: [{ id: '1', name: VALUE }],
        pagination: false,
        searchable: false,
        columns: [{ header: 'Name', accessorKey: 'name', cellClassName: COLUMN_SLOT }],
        cellClassName: SCHEMA_SLOT,
        ...utility,
      }}
    />,
  );
}

/** The body row: the `tr` that holds the data value. */
function bodyRowCells(): HTMLTableCellElement[] {
  const row = screen.getByText(VALUE).closest('tr');
  if (!row) throw new Error('data value rendered outside a table row');
  return Array.from(row.querySelectorAll('td'));
}

type Role = 'selection' | 'row-number' | 'leading' | 'data' | 'row-actions';

/**
 * Classify a body cell by what it CONTAINS, never by position: the selection
 * cell holds the checkbox, the row-number cell reads `1` (first row), the data
 * cell holds the value, the row-actions cell holds the actions container
 * (`flex … justify-end`), which `data-table.tsx` renders unconditionally
 * whenever `rowActions` is on — even when no menu item survives the row's
 * predicates.
 */
function classify(td: HTMLTableCellElement): Role | 'UNCLASSIFIED' {
  const hits: Role[] = [];
  // objectui#12423 — with selection AND row numbers on, both share ONE
  // leading cell: the checkbox and the number `1`.
  if (td.querySelector('[role="checkbox"]') && td.textContent?.trim() === '1') return 'leading';
  if (td.querySelector('[role="checkbox"]')) hits.push('selection');
  if (td.textContent?.trim() === '1') hits.push('row-number');
  if (td.textContent?.includes(VALUE)) hits.push('data');
  if (td.querySelector('div.justify-end')) hits.push('row-actions');
  if (hits.length !== 1) return 'UNCLASSIFIED';
  return hits[0];
}

function cellsByRole(): Record<Role, HTMLTableCellElement> {
  const cells = bodyRowCells();
  const byRole = {} as Record<Role, HTMLTableCellElement>;
  for (const td of cells) {
    const role = classify(td);
    if (role === 'UNCLASSIFIED') {
      throw new Error(`a body cell matched no role or several: "${td.outerHTML.slice(0, 200)}"`);
    }
    if (byRole[role]) throw new Error(`two body cells classified as ${role}`);
    byRole[role] = td;
  }
  return byRole;
}

describe('data-table: which body cells the SCHEMA-level cellClassName reaches (objectui#6921)', () => {
  beforeAll(() => {
    expect(ComponentRegistry.has('data-table')).toBe(true);
  });

  /**
   * ⛔ THE FENCE. The data cell folds the per-column key and NOT the
   * schema-level one. Making the false census sentence true in the renderer
   * would turn this red — which is the point: the card corrects the sentence,
   * not the behaviour.
   */
  it('the MAIN DATA cell folds col.cellClassName and NOT the schema-level cellClassName', () => {
    renderTable({ selectable: true, showRowNumbers: true, rowActions: true });
    const { data } = cellsByRole();
    expect(data).toHaveClass(COLUMN_SLOT);
    expect(data).not.toHaveClass(SCHEMA_SLOT);
  });

  /**
   * NON-REGRESSION. Each of the three utility cells folds the schema-level
   * key, named one by one so a dropped fold reports WHICH cell lost it.
   */
  it('the selection, row-number and row-actions cells each fold the schema-level cellClassName', () => {
    // The row-number cell is its own cell only without selection
    // (objectui#12423), so the three sites are measured over two tables.
    renderTable({ selectable: true, showRowNumbers: false, rowActions: true });
    const withSelection = cellsByRole();
    for (const role of ['selection', 'row-actions'] as const) {
      expect(withSelection[role], `${role} cell should carry the schema-level class`).toHaveClass(SCHEMA_SLOT);
    }
    cleanup();
    renderTable({ selectable: false, showRowNumbers: true, rowActions: false });
    expect(cellsByRole()['row-number'], 'row-number cell should carry the schema-level class').toHaveClass(SCHEMA_SLOT);
  });

  /**
   * THE CENSUS AS A NUMBER, every utility column on: three body cells (the
   * shared leading cell, the data cell, the row-actions cell), exactly two
   * carry the schema-level class, exactly one carries the column class, and no
   * cell carries both — the two slots style disjoint cells.
   */
  it('every utility column on: the schema-level class reaches the leading and row-actions cells, the column class the data cell, disjoint', () => {
    renderTable({ selectable: true, showRowNumbers: true, rowActions: true });
    const cells = bodyRowCells();
    expect(cells).toHaveLength(3);
    const withSchema = cells.filter((td) => td.classList.contains(SCHEMA_SLOT));
    const withColumn = cells.filter((td) => td.classList.contains(COLUMN_SLOT));
    expect(withSchema.map(classify).sort()).toEqual(['leading', 'row-actions']);
    expect(withColumn.map(classify)).toEqual(['data']);
    expect(cells.filter((td) => td.classList.contains(SCHEMA_SLOT) && td.classList.contains(COLUMN_SLOT))).toHaveLength(0);
  });

  /**
   * THE CONTROL. With every utility column off the schema-level key reaches
   * ZERO body cells — the reading behind the broken mdx example — while the
   * column key still reaches the data cell. Without this, a renderer that
   * folded the schema class into EVERY cell would still satisfy the three
   * positive assertions above.
   */
  it('with no utility column the schema-level class reaches ZERO body cells while the column class still lands', () => {
    renderTable({ selectable: false, showRowNumbers: false, rowActions: false });
    const cells = bodyRowCells();
    expect(cells).toHaveLength(1);
    expect(cells[0]).toHaveClass(COLUMN_SLOT);
    expect(cells.filter((td) => td.classList.contains(SCHEMA_SLOT))).toHaveLength(0);
  });
});
