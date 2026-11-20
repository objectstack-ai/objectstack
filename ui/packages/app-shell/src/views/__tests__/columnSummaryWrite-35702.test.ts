/** objectstack#35702 — the view's `columns` the footer menu saves. */
import { describe, it, expect } from 'vitest';
import { columnsWithSummary, declaredColumnFields } from '../columnSummaryWrite';

describe('columnsWithSummary (objectstack#35702)', () => {
  it('sets the calculation on the view\'s own column, in the object form', () => {
    expect(columnsWithSummary(['name', 'amount'], 'amount', 'sum')).toEqual([
      { field: 'name' }, { field: 'amount', summary: 'sum' },
    ]);
  });
  it('keeps the object form\'s field override and moves only the calculation', () => {
    expect(columnsWithSummary([{ field: 'amount', summary: { type: 'sum', field: 'amount_base' } }], 'amount', 'avg'))
      .toEqual([{ field: 'amount', summary: { type: 'avg', field: 'amount_base' } }]);
  });
  it('takes the calculation off for None', () => {
    expect(columnsWithSummary([{ field: 'amount', label: 'Amount', summary: 'sum' }], 'amount', null))
      .toEqual([{ field: 'amount', label: 'Amount' }]);
  });
  // L1 7048239634: the pick writes the calculation, never the reader's layout.
  it('writes only the calculation: the view\'s columns stay, whatever the reader hid or added', () => {
    // The view declares [a, b]; the reader hid b and added c for themselves.
    expect(columnsWithSummary(['a', 'b'], 'a', 'sum')).toEqual([{ field: 'a', summary: 'sum' }, { field: 'b' }]);
  });
  it('saves nothing for a column the view does not declare', () => {
    expect(columnsWithSummary(['a', 'b'], 'c', 'sum')).toBeNull();
  });
  it('saves nothing on a view that declares no columns', () => {
    expect(columnsWithSummary(undefined, 'amount', 'max')).toBeNull();
    expect(columnsWithSummary([], 'amount', 'max')).toBeNull();
  });
  it('names the declared fields, in the view\'s order, for the menu offer', () => {
    expect(declaredColumnFields(['b', { field: 'a', summary: 'sum' }])).toEqual(['b', 'a']);
    expect(declaredColumnFields(undefined)).toEqual([]);
  });
});
