/**
 * objectstack#35702 — the list's resident footer row: the record count in its
 * first cell, and, for a reader who may change the view, each column's cell
 * the menu that picks its calculation by the field's type.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';

import { ObjectGrid } from '../ObjectGrid';
import { offeredColumnSummaries, isTemporalSummaryField } from '../useColumnSummary';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider } from '@object-ui/react';

beforeAll(() => {
  registerAllFields();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as unknown as Element['scrollIntoView'];
  }
});
beforeEach(() => {
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
});

describe('offeredColumnSummaries (objectstack#35702)', () => {
  it('offers the numeric calculations on an amount and the counts on any field', () => {
    expect(offeredColumnSummaries({ type: 'currency' })).toEqual([
      'sum', 'avg', 'min', 'max', 'count_unique', 'count_filled', 'count_empty', 'percent_filled', 'percent_empty',
    ]);
  });
  it('offers no sum or average on a text field', () => {
    const offered = offeredColumnSummaries({ type: 'text' });
    expect(offered).not.toContain('sum');
    expect(offered).not.toContain('avg');
    expect(offered).toContain('count_filled');
  });
  it('offers only counts on a lookup', () => {
    expect(offeredColumnSummaries({ type: 'lookup' }).every((s) => s.startsWith('count') || s.startsWith('percent'))).toBe(true);
  });
  it('offers earliest / latest on a date, named so', () => {
    const offered = offeredColumnSummaries({ type: 'date' });
    expect(offered).toEqual(expect.arrayContaining(['min', 'max']));
    expect(offered).not.toContain('sum');
    expect(isTemporalSummaryField({ type: 'date' })).toBe(true);
    expect(isTemporalSummaryField({ type: 'number' })).toBe(false);
  });
  it.each(['boolean', 'toggle'])('offers a %s no sum, average or extremes', (type) => {
    expect(offeredColumnSummaries({ type }).filter((s) => ['sum', 'avg', 'min', 'max'].includes(s))).toEqual([]);
    expect(offeredColumnSummaries({ type })).toContain('count_filled');
  });
  it('offers an unknown field the counts it can draw, never count_unique', () => {
    expect(offeredColumnSummaries(undefined)).toEqual(['count_filled', 'count_empty', 'percent_filled', 'percent_empty']);
  });
});

const OBJECT = 'plan_line';
const ROWS = [
  { id: 'r1', name: 'Line 1', amount: 100, due: '2026-01-05' },
  { id: 'r2', name: 'Line 2', amount: 250, due: '2026-03-09' },
];
const FIELDS = {
  id: { type: 'text', label: 'Id' },
  name: { type: 'text', label: 'Name' },
  amount: { type: 'number', label: 'Amount' },
  due: { type: 'date', label: 'Due' },
};

const dataSource = () => ({
  find: vi.fn(async () => ({ data: ROWS.map((r) => ({ ...r })), total: ROWS.length })),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: FIELDS })),
});

function renderGrid(props: Partial<React.ComponentProps<typeof ObjectGrid>>, columns: unknown[] = [
  { field: 'name', label: 'Name' },
  { field: 'amount', label: 'Amount' },
  { field: 'due', label: 'Due' },
]) {
  return render(
    <ActionProvider>
      <ObjectGrid
        schema={{ type: 'object-grid', objectName: OBJECT, columns, data: { provider: 'value', items: ROWS } } as unknown as ObjectGridSchema}
        dataSource={dataSource() as unknown as DataSource}
        {...props}
      />
    </ActionProvider>,
  );
}

describe('the resident footer row (objectstack#35702)', () => {
  it('is drawn with no calculation declared, the record count in its first cell, and reports itself', async () => {
    const reported = vi.fn();
    renderGrid({ residentSummaryRow: true, onResidentSummaryRowChange: reported });
    const row = await screen.findByTestId('data-table-summary-row');
    expect(within(row).getByTestId('data-table-summary-lead')).toHaveTextContent('Count 2');
    expect(reported).toHaveBeenLastCalledWith(true);
  });

  it('is not drawn for a host that does not ask for it', async () => {
    renderGrid({});
    await screen.findByText('Line 1');
    expect(screen.queryByTestId('data-table-summary-row')).toBeNull();
  });

  it('offers no menu to a reader who may not change the view, and still draws the figure', async () => {
    renderGrid({ residentSummaryRow: true }, [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', summary: 'sum' },
    ]);
    const row = await screen.findByTestId('data-table-summary-row');
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).getByTestId('data-table-summary-amount')).toHaveTextContent('Sum 350');
  });

  it('picks a calculation from the cell, draws it at once, ticks it, and None takes it off', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    renderGrid({ residentSummaryRow: true, onColumnSummaryPick: onPick });
    await screen.findByTestId('data-table-summary-row');
    expect(screen.getByTestId('summary-picker-hint-amount')).toHaveTextContent('Calculate');

    await user.click(screen.getByTestId('summary-picker-amount'));
    const menu = await screen.findByTestId('summary-menu-amount');
    expect(within(menu).getByTestId('summary-option-sum')).toHaveTextContent('Sum');
    expect(within(menu).getByTestId('summary-option-none')).toHaveTextContent('None');
    await user.click(within(menu).getByTestId('summary-option-sum'));

    expect(onPick).toHaveBeenLastCalledWith('amount', 'sum');
    await waitFor(() => expect(screen.getByTestId('summary-picker-amount')).toHaveTextContent('Sum 350'));

    await user.click(screen.getByTestId('summary-picker-amount'));
    const again = await screen.findByTestId('summary-menu-amount');
    expect(within(again).getByTestId('summary-option-sum').querySelector('svg')).toHaveClass('opacity-100');
    await user.click(within(again).getByTestId('summary-option-none'));
    expect(onPick).toHaveBeenLastCalledWith('amount', null);
    await waitFor(() => expect(screen.getByTestId('summary-picker-amount')).not.toHaveTextContent('Sum'));
  });

  it('names a date column\'s extremes Earliest and Latest', async () => {
    const user = userEvent.setup();
    renderGrid({ residentSummaryRow: true, onColumnSummaryPick: vi.fn() });
    await screen.findByTestId('data-table-summary-row');
    await user.click(screen.getByTestId('summary-picker-due'));
    const menu = await screen.findByTestId('summary-menu-due');
    expect(within(menu).getByTestId('summary-option-min')).toHaveTextContent('Earliest');
    expect(within(menu).getByTestId('summary-option-max')).toHaveTextContent('Latest');
    expect(within(menu).queryByTestId('summary-option-sum')).toBeNull();
    await user.click(within(menu).getByTestId('summary-option-max'));
    await waitFor(() => expect(screen.getByTestId('summary-picker-due')).toHaveTextContent(/^Latest /));
  });

  // L1 7048239634: the menu only where the host can save the pick, and a pick
  // the host did not save is taken back.
  it('offers the menu only on the columns the host can save; the others draw their figure only', async () => {
    renderGrid({ residentSummaryRow: true, onColumnSummaryPick: vi.fn(), summaryPickFields: ['amount'] }, [
      { field: 'name', label: 'Name', summary: 'count_filled' },
      { field: 'amount', label: 'Amount' },
      { field: 'due', label: 'Due' },
    ]);
    await screen.findByTestId('data-table-summary-row');
    expect(screen.getByTestId('summary-picker-amount')).toBeInTheDocument();
    expect(screen.queryByTestId('summary-picker-due')).toBeNull();
    expect(screen.queryByTestId('summary-picker-name')).toBeNull();
    expect(screen.getByTestId('data-table-summary-name')).toHaveTextContent('Filled 2');
  });

  it.each([
    ['answers false', () => false],
    ['resolves false', async () => false],
    ['rejects', async () => { throw new Error('refused'); }],
  ])('takes a pick back when the host %s', async (_label, answer) => {
    const user = userEvent.setup();
    const onPick = vi.fn(answer);
    renderGrid({ residentSummaryRow: true, onColumnSummaryPick: onPick });
    await screen.findByTestId('data-table-summary-row');
    await user.click(screen.getByTestId('summary-picker-amount'));
    await user.click(within(await screen.findByTestId('summary-menu-amount')).getByTestId('summary-option-sum'));
    expect(onPick).toHaveBeenLastCalledWith('amount', 'sum');
    await waitFor(() => expect(screen.getByTestId('summary-picker-amount')).not.toHaveTextContent('Sum'));
    expect(screen.getByTestId('summary-picker-hint-amount')).toHaveTextContent('Calculate');
  });

  it('keeps a pick the host saved', async () => {
    const user = userEvent.setup();
    renderGrid({ residentSummaryRow: true, onColumnSummaryPick: vi.fn(async () => true) });
    await screen.findByTestId('data-table-summary-row');
    await user.click(screen.getByTestId('summary-picker-amount'));
    await user.click(within(await screen.findByTestId('summary-menu-amount')).getByTestId('summary-option-sum'));
    await waitFor(() => expect(screen.getByTestId('summary-picker-amount')).toHaveTextContent('Sum 350'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('summary-picker-amount')).toHaveTextContent('Sum 350');
  });

  // L1 7049007771: the trigger is a flex box, which the cell's text-align does
  // not move; a right-aligned amount's figure ends under the amounts.
  it('justifies the cell from its column\'s alignment', async () => {
    renderGrid({ residentSummaryRow: true, onColumnSummaryPick: vi.fn() }, [
      { field: 'name', label: 'Name' },
      { field: 'amount', label: 'Amount', align: 'right', summary: 'sum' },
      { field: 'due', label: 'Due', align: 'center' },
    ]);
    await screen.findByTestId('data-table-summary-row');
    expect(screen.getByTestId('summary-picker-amount')).toHaveClass('justify-end');
    expect(screen.getByTestId('summary-picker-due')).toHaveClass('justify-center');
    expect(screen.getByTestId('summary-picker-name')).toHaveClass('justify-start');
  });
});
