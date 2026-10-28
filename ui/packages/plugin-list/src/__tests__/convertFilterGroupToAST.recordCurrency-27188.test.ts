/**
 * objectstack#27188 — a record-mode amount's filter row and its code
 * companion lower to `amount op X AND code = C` (ADR-0144 D6), with no
 * currency knowledge in the lowering.
 */
import { describe, it, expect } from 'vitest';
import { syncRecordCurrencyRows, VALUELESS_FILTER_BUILDER_OPERATORS } from '@object-ui/components';
import type { FilterBuilderRowGroup } from '@object-ui/components';
import { recordCurrencyField } from '@object-ui/i18n';
import { convertFilterGroupToAST } from '../ListView';

const AMOUNT = { type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } };

describe('record-mode amount filter → AST', () => {
  it('lowers the pair to amount op X AND code = C', () => {
    const fields = [{ value: 'amount', currencyField: recordCurrencyField(AMOUNT) }];
    const group = syncRecordCurrencyRows(
      { id: 'root', logic: 'and', conditions: [{ id: 'a', field: 'amount', operator: 'greater_than', value: 100 }] },
      fields,
      'USD',
      (op) => !VALUELESS_FILTER_BUILDER_OPERATORS.has(op),
    ) as FilterBuilderRowGroup;
    expect(convertFilterGroupToAST(group)).toEqual([
      'and',
      ['amount', '>', 100],
      ['currency_code', '=', 'USD'],
    ]);
  });
});
