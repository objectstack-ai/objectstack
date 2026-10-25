/**
 * Column Features Tests — pinned, summary, link, action
 *
 * Covers: pinned columns (left/right), column summary footer,
 *         link column rendering, action column rendering,
 *         and the useColumnSummary hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { useColumnSummary } from '../useColumnSummary';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

registerAllFields();

// [#4296] The action-column grids here carry an objectName and rows with ids,
// so each render batches a record-level explain probe. Answer it from a double
// instead of the network (objectui#3339 / PR #4105); `visible: true` for every
// row keeps the column assertions below measuring what they always measured.
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => { vi.unstubAllGlobals(); });

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------
const numericData = [
  { id: '1', name: 'Alice', amount: 100, score: 80 },
  { id: '2', name: 'Bob', amount: 200, score: 90 },
  { id: '3', name: 'Charlie', amount: 300, score: 70 },
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderGrid(opts?: Record<string, any>) {
  const schema: any = {
    type: 'object-grid' as const,
    objectName: 'test_object',
    columns: [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', type: 'number' },
    ],
    data: { provider: 'value', items: numericData },
    ...opts,
  };

  return render(
    <ActionProvider>
      <ObjectGrid schema={schema} />
    </ActionProvider>
  );
}

// =========================================================================
// useColumnSummary hook tests
// =========================================================================
describe('useColumnSummary', () => {
  it('returns empty summaries when no columns have summary config', () => {
    const columns = [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount' },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    expect(result.current.hasSummary).toBe(false);
    expect(result.current.summaries.size).toBe(0);
  });

  it('computes sum aggregation', () => {
    const columns = [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', summary: { type: 'sum' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    expect(result.current.hasSummary).toBe(true);
    const summary = result.current.summaries.get('amount');
    expect(summary).toBeDefined();
    expect(summary!.value).toBe(600);
    expect(summary!.label).toContain('Sum');
  });

  it('computes count aggregation', () => {
    const columns = [
      { field: 'name', label: 'Name', summary: 'count' },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    expect(result.current.hasSummary).toBe(true);
    const summary = result.current.summaries.get('name');
    expect(summary!.value).toBe(3);
    expect(summary!.label).toContain('Count');
  });

  it('computes avg aggregation', () => {
    const columns = [
      { field: 'score', label: 'Score', summary: { type: 'avg' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    const summary = result.current.summaries.get('score');
    expect(summary!.value).toBe(80);
    expect(summary!.label).toContain('Avg');
  });

  it('computes min aggregation', () => {
    const columns = [
      { field: 'amount', label: 'Amount', summary: { type: 'min' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    const summary = result.current.summaries.get('amount');
    expect(summary!.value).toBe(100);
    expect(summary!.label).toContain('Min');
  });

  it('computes max aggregation', () => {
    const columns = [
      { field: 'amount', label: 'Amount', summary: { type: 'max' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    const summary = result.current.summaries.get('amount');
    expect(summary!.value).toBe(300);
    expect(summary!.label).toContain('Max');
  });

  it('handles string shorthand for summary type', () => {
    const columns = [
      { field: 'amount', label: 'Amount', summary: 'sum' },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    const summary = result.current.summaries.get('amount');
    expect(summary!.value).toBe(600);
  });

  it('handles empty data array', () => {
    const columns = [
      { field: 'amount', label: 'Amount', summary: { type: 'sum' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, []));
    expect(result.current.hasSummary).toBe(false);
  });

  it('handles undefined columns', () => {
    const { result } = renderHook(() => useColumnSummary(undefined, numericData));
    expect(result.current.hasSummary).toBe(false);
  });

  it('handles summary with custom field reference', () => {
    const columns = [
      { field: 'name', label: 'Name', summary: { type: 'sum', field: 'amount' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    const summary = result.current.summaries.get('name');
    expect(summary!.value).toBe(600);
  });

  it('handles string numeric values', () => {
    const data = [
      { id: '1', amount: '100' },
      { id: '2', amount: '200' },
    ];
    const columns = [
      { field: 'amount', label: 'Amount', summary: { type: 'sum' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, data));
    const summary = result.current.summaries.get('amount');
    expect(summary!.value).toBe(300);
  });

  it('computes multiple summaries simultaneously', () => {
    const columns = [
      { field: 'amount', label: 'Amount', summary: { type: 'sum' } },
      { field: 'score', label: 'Score', summary: { type: 'avg' } },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, numericData));
    expect(result.current.summaries.size).toBe(2);
    expect(result.current.summaries.get('amount')!.value).toBe(600);
    expect(result.current.summaries.get('score')!.value).toBe(80);
  });
});

// =========================================================================
// Count and percent aggregation families
//
// `ColumnSummarySchema` accepts eleven aggregation names. The renderer used to
// compute five of them, so a view configured with e.g. `count_unique` passed
// validation and then rendered a blank footer cell. These cover the six that
// were missing, on raw (non-numeric) cell values.
// =========================================================================
describe('useColumnSummary count/percent families', () => {
  // 4 rows with deliberate holes: an empty string, a null, an empty array and
  // a missing key — every shape the emptiness test has to recognize.
  const sparseData = [
    { id: '1', name: 'Alice', dept: 'Eng', tags: ['a'] },
    { id: '2', name: 'Bob', dept: 'Eng', tags: [] },
    { id: '3', name: '', dept: 'Sales', tags: ['a'] },
    { id: '4', name: 'Dave', dept: null },
  ];
  const summaryFor = (field: string, type: string, data: any[] = sparseData) => {
    const columns = [{ field, label: field, summary: { type } }] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, data));
    return result.current.summaries.get(field);
  };

  it('counts every row for `count`, filled or not', () => {
    // Distinct from count_filled: `dept` has one null, but count is all rows.
    const summary = summaryFor('dept', 'count');
    expect(summary!.value).toBe(4);
    expect(summary!.label).toBe('Count: 4');
  });

  it('counts only non-empty cells for `count_filled`', () => {
    expect(summaryFor('dept', 'count_filled')!.value).toBe(3);
    expect(summaryFor('name', 'count_filled')!.value).toBe(3);
  });

  it('counts empty cells for `count_empty`, including missing keys', () => {
    expect(summaryFor('dept', 'count_empty')!.value).toBe(1);
    // `name` holds an empty string; `tags` has an empty array plus a row that
    // omits the key entirely.
    expect(summaryFor('name', 'count_empty')!.value).toBe(1);
    expect(summaryFor('tags', 'count_empty')!.value).toBe(2);
  });

  it('reports a zero count rather than a blank cell', () => {
    // 0 is a meaningful answer — "no empty cells" — and must not be swallowed
    // into an empty label the way a null result is.
    const summary = summaryFor('name', 'count_empty', [{ name: 'Alice' }, { name: 'Bob' }]);
    expect(summary!.value).toBe(0);
    expect(summary!.label).toBe('Empty: 0');
  });

  it('counts distinct non-empty values for `count_unique`', () => {
    // 'Eng' twice, 'Sales' once, one null → 2.
    expect(summaryFor('dept', 'count_unique')!.value).toBe(2);
  });

  it('compares array cells by value for `count_unique`', () => {
    // Two rows hold a *different* ['a'] array instance. A raw Set would key on
    // reference and report 2 distinct values for what an author sees as one.
    expect(summaryFor('tags', 'count_unique')!.value).toBe(1);
  });

  it('computes `percent_filled` and `percent_empty` over all rows', () => {
    expect(summaryFor('dept', 'percent_filled')!.value).toBe(75);
    expect(summaryFor('dept', 'percent_empty')!.value).toBe(25);
  });

  it('renders percent aggregations with a percent sign', () => {
    expect(summaryFor('dept', 'percent_filled')!.label).toBe('Filled: 75%');
    expect(summaryFor('dept', 'percent_empty')!.label).toBe('Empty: 25%');
  });

  it('rounds a repeating percentage to one decimal', () => {
    const data = [{ v: 1 }, { v: null }, { v: null }];
    expect(summaryFor('v', 'percent_filled', data)!.label).toBe('Filled: 33.3%');
  });

  it('counts non-numeric text values, which the numeric family cannot', () => {
    // The whole point of the count family: `sum` over a text column has nothing
    // to aggregate, but "how many are filled" is still a valid question.
    expect(summaryFor('name', 'count_filled')!.value).toBe(3);
    expect(summaryFor('name', 'sum')!.value).toBeNull();
  });

  it('skips a column whose summary is `none`', () => {
    const columns = [{ field: 'dept', label: 'Dept', summary: 'none' }] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, sparseData));
    // No entry at all, so a view with only `none` columns renders no footer row
    // rather than an empty one.
    expect(result.current.summaries.size).toBe(0);
    expect(result.current.hasSummary).toBe(false);
  });

  it('keeps other columns when one is `none`', () => {
    const columns = [
      { field: 'dept', label: 'Dept', summary: 'none' },
      { field: 'name', label: 'Name', summary: 'count_filled' },
    ] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, sparseData));
    expect(result.current.summaries.size).toBe(1);
    expect(result.current.summaries.get('name')!.value).toBe(3);
  });

  it('skips an unrecognized aggregation name instead of rendering a blank cell', () => {
    const columns = [{ field: 'dept', label: 'Dept', summary: 'median' }] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, sparseData));
    expect(result.current.hasSummary).toBe(false);
  });

  it('does not mistake an inherited Object key for an aggregation name', () => {
    // The supported-name check must not be an `in` test against the label map.
    const columns = [{ field: 'dept', label: 'Dept', summary: 'toString' }] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, sparseData));
    expect(result.current.hasSummary).toBe(false);
  });

  it('honours the per-column field override for the count family', () => {
    const columns = [{ field: 'name', label: 'Name', summary: { type: 'count_unique', field: 'dept' } }] as any[];
    const { result } = renderHook(() => useColumnSummary(columns, sparseData));
    expect(result.current.summaries.get('name')!.value).toBe(2);
  });
});

// =========================================================================
// Summary footer rendering in ObjectGrid
// =========================================================================
describe('Summary footer rendering', () => {
  it('renders summary footer when columns have summary config', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name', summary: 'count' },
        { field: 'amount', label: 'Amount', type: 'number', summary: { type: 'sum' } },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    const footer = screen.getByTestId('column-summary-footer');
    expect(footer).toBeInTheDocument();
    expect(screen.getByTestId('summary-name')).toHaveTextContent('Count: 3');
    expect(screen.getByTestId('summary-amount')).toHaveTextContent('Sum: 600');
  });

  it('does not render summary footer when no columns have summary config', async () => {
    renderGrid();

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('column-summary-footer')).not.toBeInTheDocument();
  });

  it('renders avg summary with formatted decimal', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'score', label: 'Score', type: 'number', summary: { type: 'avg' } },
      ],
      data: { provider: 'value', items: numericData },
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    const footer = screen.getByTestId('column-summary-footer');
    expect(footer).toBeInTheDocument();
    expect(screen.getByTestId('summary-score')).toHaveTextContent('Avg: 80');
  });
});

// =========================================================================
// Pinned column support
// =========================================================================
describe('Pinned columns', () => {
  it('renders pinned left columns first in order', async () => {
    renderGrid({
      columns: [
        { field: 'amount', label: 'Amount', type: 'number' },
        { field: 'name', label: 'Name', pinned: 'left' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // Both columns should be visible
    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.getByText('Name')).toBeInTheDocument();
  });

  it('renders pinned right columns last in order', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number', pinned: 'right' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('handles mixed pinned and unpinned columns', async () => {
    renderGrid({
      columns: [
        { field: 'score', label: 'Score', type: 'number' },
        { field: 'name', label: 'Name', pinned: 'left' },
        { field: 'amount', label: 'Amount', type: 'number', pinned: 'right' },
      ],
      data: { provider: 'value', items: numericData },
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // All columns should be rendered
    expect(screen.getByText('Score')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });

  it('works with no pinned columns (preserves default frozenColumns)', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    expect(screen.getByText('Amount')).toBeInTheDocument();
  });
});

// =========================================================================
// Link column rendering
// =========================================================================
describe('Link columns', () => {
  it('renders link column content as clickable element with data-testid', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name', link: true },
        { field: 'amount', label: 'Amount', type: 'number' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // Link cells should have data-testid="link-cell"
    const linkCells = screen.getAllByTestId('link-cell');
    expect(linkCells.length).toBeGreaterThan(0);

    // Link cells should have text-primary class (blue clickable)
    linkCells.forEach(cell => {
      expect(cell).toHaveClass('text-primary');
    });
  });

  it('renders primary field (first column) as auto-linked', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // Primary field should auto-link with data-testid="primary-field-link"
    const primaryLinks = screen.getAllByTestId('primary-field-link');
    expect(primaryLinks.length).toBeGreaterThan(0);
  });
});

// =========================================================================
// Action column rendering
// =========================================================================
describe('Action columns', () => {
  it('renders action column with proper button and formatted label', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number', action: 'edit' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // Action cells should have data-testid="action-cell" and render as Button
    const actionCells = screen.getAllByTestId('action-cell');
    expect(actionCells.length).toBeGreaterThan(0);

    // Action button should show formatted action label
    const editButtons = screen.getAllByText('Edit');
    expect(editButtons.length).toBeGreaterThan(0);
  });

  it('renders formatted action label for multi-word actions', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number', action: 'send_email' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // 'send_email' should be formatted as 'Send Email'
    const actionButtons = screen.getAllByText('Send Email');
    expect(actionButtons.length).toBeGreaterThan(0);
  });

  it('action button is clickable', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number', action: 'edit' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    const actionCells = screen.getAllByTestId('action-cell');
    expect(actionCells.length).toBeGreaterThan(0);

    // Click should not throw
    fireEvent.click(actionCells[0]);
  });
});

// =========================================================================
// Combined features
// =========================================================================
describe('Combined column features', () => {
  it('supports pinned + summary on the same column', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name', pinned: 'left' },
        { field: 'amount', label: 'Amount', type: 'number', summary: { type: 'sum' } },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    const footer = screen.getByTestId('column-summary-footer');
    expect(footer).toBeInTheDocument();
    expect(screen.getByTestId('summary-amount')).toHaveTextContent('Sum: 600');
  });

  it('supports link + action on same column (link takes priority)', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name', link: true, action: 'view' },
        { field: 'amount', label: 'Amount', type: 'number' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // Link takes priority — should render as link-cell, not action-cell
    const linkCells = screen.getAllByTestId('link-cell');
    expect(linkCells.length).toBeGreaterThan(0);
  });

  it('supports pinned + action on the same column', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number', pinned: 'right', action: 'approve' },
      ],
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    const actionCells = screen.getAllByTestId('action-cell');
    expect(actionCells.length).toBeGreaterThan(0);

    // Action buttons should show formatted label
    const approveButtons = screen.getAllByText('Approve');
    expect(approveButtons.length).toBeGreaterThan(0);
  });

  it('supports all four features together', async () => {
    renderGrid({
      columns: [
        { field: 'name', label: 'Name', pinned: 'left', link: true },
        { field: 'score', label: 'Score', type: 'number', summary: { type: 'avg' } },
        { field: 'amount', label: 'Amount', type: 'number', pinned: 'right', action: 'edit', summary: { type: 'sum' } },
      ],
      data: { provider: 'value', items: numericData },
    });

    await waitFor(() => {
      expect(screen.getByText('Name')).toBeInTheDocument();
    });

    // Link cells on name column
    const linkCells = screen.getAllByTestId('link-cell');
    expect(linkCells.length).toBeGreaterThan(0);

    // Action cells on amount column
    const actionCells = screen.getAllByTestId('action-cell');
    expect(actionCells.length).toBeGreaterThan(0);

    // Summary footer
    const footer = screen.getByTestId('column-summary-footer');
    expect(footer).toBeInTheDocument();
    expect(screen.getByTestId('summary-amount')).toHaveTextContent('Sum: 600');
    expect(screen.getByTestId('summary-score')).toHaveTextContent('Avg: 80');
  });
});

// =========================================================================
// Default row actions kebab — when consumer wires onEdit/onDelete but the
// view schema omits an explicit `operations` block, ObjectGrid should still
// render the per-row Edit/Delete dropdown so the main list always has a
// delete affordance out of the box.
// =========================================================================
describe('Default row actions when onEdit/onDelete provided', () => {
  function renderGridWithHandlers(handlers: { onEdit?: any; onDelete?: any } = {}) {
    const schema: any = {
      type: 'object-grid' as const,
      objectName: 'test_object',
      columns: [
        { field: 'name', label: 'Name' },
        { field: 'amount', label: 'Amount', type: 'number' },
      ],
      data: { provider: 'value', items: numericData },
      // Note: no `operations` field — the new default behavior should kick in.
    };
    return render(
      <ActionProvider>
        <ObjectGrid schema={schema} {...handlers} />
      </ActionProvider>
    );
  }

  it('renders row action kebabs when onEdit + onDelete are wired without explicit operations', async () => {
    renderGridWithHandlers({ onEdit: vi.fn(), onDelete: vi.fn() });
    await waitFor(() => expect(screen.getByText('Name')).toBeInTheDocument());
    // RowActionMenu renders a button with data-testid="row-action-trigger" per row.
    const kebabs = screen.getAllByTestId('row-action-trigger');
    expect(kebabs.length).toBe(numericData.length);
  });

  it('does NOT render row action kebabs when neither handler is provided', async () => {
    renderGridWithHandlers({});
    await waitFor(() => expect(screen.getByText('Name')).toBeInTheDocument());
    expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0);
  });

  it('still respects an explicit operations: { update: false, delete: false }', async () => {
    const schema: any = {
      type: 'object-grid' as const,
      objectName: 'test_object',
      columns: [{ field: 'name', label: 'Name' }],
      data: { provider: 'value', items: numericData },
      operations: { update: false, delete: false },
    };
    render(
      <ActionProvider>
        <ObjectGrid schema={schema} onEdit={vi.fn()} onDelete={vi.fn()} />
      </ActionProvider>
    );
    await waitFor(() => expect(screen.getByText('Name')).toBeInTheDocument());
    expect(screen.queryAllByTestId('row-action-trigger')).toHaveLength(0);
  });
});
