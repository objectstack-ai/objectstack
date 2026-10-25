// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11796 — the dashboard inspector's Layout fields render in ONE column.
 *
 * `@objectstack/spec`'s `dashboardForm` declares its Layout section with three
 * columns. The inspector is a narrow side panel, and `SchemaForm` honoured that
 * declaration in it: Columns / Gap / Refresh Interval Seconds each got a third
 * of the panel, so a two-digit value showed one digit and the labels wrapped
 * onto several lines. The inspector now stacks every section of the form.
 *
 * The control renders the SAME spec form through `SchemaForm` directly: it
 * keeps the declared three columns, so the stacking is this panel's, and
 * `SchemaForm`'s grid is unchanged for every other form it renders.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DashboardDefaultInspector } from './DashboardDefaultInspector';
import { SchemaForm } from '../SchemaForm';
import { getDashboardForm, getDashboardSchema } from '../dashboard-schema';

afterEach(cleanup);

const LAYOUT_FIELDS = ['Columns', 'Gap', 'Refresh Interval Seconds'];

const draft = {
  name: 'ops',
  label: 'Delivery Operations',
  columns: 12,
  gap: 4,
  refreshIntervalSeconds: 60,
  widgets: [],
};

/** The section grid a form field's cell sits in, and that cell. */
function gridOf(label: string): { grid: HTMLElement; cell: HTMLElement } {
  const lab = screen.getByText(label, { selector: 'label' });
  let cell: HTMLElement = lab;
  while (cell.parentElement && !cell.parentElement.style.gridTemplateColumns) {
    cell = cell.parentElement;
  }
  if (!cell.parentElement) throw new Error(`no section grid holds the "${label}" field`);
  return { grid: cell.parentElement, cell };
}

describe('the dashboard inspector stacks its Layout fields (objectui#11796)', () => {
  it('renders Columns / Gap / Refresh Interval Seconds in one single-column grid', () => {
    render(
      <DashboardDefaultInspector
        type="dashboard"
        name="ops"
        locale="en-US"
        draft={draft}
        onPatch={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
      />,
    );
    const cells = LAYOUT_FIELDS.map(gridOf);
    const grid = cells[0].grid;
    // All three in the SAME grid, as declared — only its column count changed.
    for (const c of cells) expect(c.grid).toBe(grid);
    expect(grid.style.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
    for (const c of cells) expect(c.cell.style.gridColumn).toBe('span 1');
  });

  it('clamps the full-width header field to the single column instead of adding grid tracks', () => {
    render(
      <DashboardDefaultInspector
        type="dashboard"
        name="ops"
        locale="en-US"
        draft={draft}
        onPatch={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
      />,
    );
    // The spec declares `header` with `colSpan: 3`; a span of 3 in a
    // one-column grid would add two implicit tracks beside the panel.
    const { grid } = gridOf('Gap');
    const spans = Array.from(grid.children).map((c) => (c as HTMLElement).style.gridColumn);
    expect(spans.length).toBeGreaterThan(LAYOUT_FIELDS.length);
    expect(new Set(spans)).toEqual(new Set(['span 1']));
  });

  it('control: SchemaForm given the same spec form keeps the declared three columns', () => {
    render(
      <SchemaForm
        schema={getDashboardSchema()!}
        form={getDashboardForm('en-US')}
        value={draft}
        hiddenFields={['name', 'label', 'description', 'widgets']}
        onChange={vi.fn()}
      />,
    );
    const cells = LAYOUT_FIELDS.map(gridOf);
    expect(cells[0].grid.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    for (const c of cells) expect(c.grid).toBe(cells[0].grid);
  });
});
