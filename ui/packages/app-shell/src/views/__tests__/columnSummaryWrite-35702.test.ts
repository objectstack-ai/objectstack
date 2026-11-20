/** objectstack#35702 — the view's `columns` the footer menu saves. */
import { describe, it, expect } from 'vitest';
import { columnsWithSummary } from '../columnSummaryWrite';

describe('columnsWithSummary (objectstack#35702)', () => {
  it('sets the calculation on the view\'s own column, in the object form', () => {
    expect(columnsWithSummary(['name', 'amount'], 'amount', 'sum', [])).toEqual([
      { field: 'name' }, { field: 'amount', summary: 'sum' },
    ]);
  });
  it('keeps the object form\'s field override and moves only the calculation', () => {
    expect(columnsWithSummary([{ field: 'amount', summary: { type: 'sum', field: 'amount_base' } }], 'amount', 'avg', []))
      .toEqual([{ field: 'amount', summary: { type: 'avg', field: 'amount_base' } }]);
  });
  it('takes the calculation off for None', () => {
    expect(columnsWithSummary([{ field: 'amount', label: 'Amount', summary: 'sum' }], 'amount', null, []))
      .toEqual([{ field: 'amount', label: 'Amount' }]);
  });
  it('writes the drawn columns for a view that declares none, so it keeps drawing them', () => {
    expect(columnsWithSummary(undefined, 'amount', 'max', ['name', 'amount'])).toEqual([
      { field: 'name' }, { field: 'amount', summary: 'max' },
    ]);
  });
  it('appends a column the view does not list', () => {
    expect(columnsWithSummary(['name'], 'amount', 'sum', ['name', 'amount'])).toEqual([
      { field: 'name' }, { field: 'amount', summary: 'sum' },
    ]);
  });
});
