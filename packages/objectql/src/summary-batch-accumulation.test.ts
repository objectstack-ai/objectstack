// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25579] The in-memory accumulation a bulk insert overlays on its rules'
 * related bindings — one function of the stored summary and the batch's
 * admitted rows, per roll-up kind. The end-to-end half (the real import door,
 * the real engine, a real sqlite driver) is
 * `packages/rest/src/import-batch-parent-summary-rule.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { createBatchSummaryAccumulator } from './summary-batch-accumulation.js';
import type { SummaryDescriptor } from './summary-aggregate.js';
import type { RelatedRecordBinding } from './validation/rule-validator.js';

const CHILD_FIELDS = {
  amount: { type: 'number' },
  is_primary: { type: 'boolean' },
  kind: { type: 'text' },
  note: { type: 'text' },
  order: { type: 'lookup', reference: 'xt_order' },
};

const desc = (over: Partial<SummaryDescriptor>): SummaryDescriptor => ({
  parentObject: 'xt_order', summaryField: 'total', childObject: 'xt_line', fkField: 'order',
  fn: 'sum', sourceField: 'amount', ...over,
});

/** The binding the engine hands a rule reading `record.order.<field>` on parent `id`. */
const bound = (row: Record<string, unknown>): RelatedRecordBinding => ({ order: { object: 'xt_order', row } });

describe('[#25579] createBatchSummaryAccumulator — per roll-up kind', () => {
  it('count: each admitted row adds one; the summary filter is evaluated on the new row', () => {
    const acc = createBatchSummaryAccumulator([desc({ summaryField: 'primaries', fn: 'count', filter: { is_primary: true } })], CHILD_FIELDS)!;
    const stored = bound({ id: 'o1', primaries: 0 });
    acc.accept({ order: 'o1', is_primary: false });
    expect(acc.overlay(stored)).toBe(stored);
    acc.accept({ order: 'o1', is_primary: true });
    expect(acc.overlay(stored)!.order!.row).toEqual({ id: 'o1', primaries: 1 });
    acc.accept({ order: 'o1', is_primary: true });
    expect(acc.overlay(stored)!.order!.row).toEqual({ id: 'o1', primaries: 2 });
  });

  it('sum: adds the admitted values, skips a null, starts a never-computed (null) sum at 0', () => {
    const acc = createBatchSummaryAccumulator([desc({})], CHILD_FIELDS)!;
    acc.accept({ order: 'o1', amount: 60 });
    acc.accept({ order: 'o1', amount: null });
    acc.accept({ order: 'o1', amount: 15 });
    expect(acc.overlay(bound({ id: 'o1', total: 10 }))!.order!.row!.total).toBe(85);
    expect(acc.overlay(bound({ id: 'o1', total: null }))!.order!.row!.total).toBe(75);
  });

  it('min / max: fold the admitted values into the stored one; an empty (null) stored value is the admitted extreme', () => {
    const acc = createBatchSummaryAccumulator([
      desc({ summaryField: 'lowest', fn: 'min' }),
      desc({ summaryField: 'highest', fn: 'max' }),
    ], CHILD_FIELDS)!;
    acc.accept({ order: 'o1', amount: 7 });
    acc.accept({ order: 'o1', amount: 3 });
    expect(acc.overlay(bound({ id: 'o1', lowest: 5, highest: 5 }))!.order!.row).toEqual({ id: 'o1', lowest: 3, highest: 7 });
    expect(acc.overlay(bound({ id: 'o1', lowest: 1, highest: 9 }))!.order!.row).toEqual({ id: 'o1', lowest: 1, highest: 9 });
    expect(acc.overlay(bound({ id: 'o1', lowest: null, highest: null }))!.order!.row).toEqual({ id: 'o1', lowest: 3, highest: 7 });
  });

  it('[#27462] count with no sourceField (a count reads no child field): each admitted row still adds one', () => {
    const acc = createBatchSummaryAccumulator([desc({ summaryField: 'lines', fn: 'count', sourceField: undefined })], CHILD_FIELDS)!;
    acc.accept({ order: 'o1', amount: 5 });
    acc.accept({ order: 'o1' });
    expect(acc.overlay(bound({ id: 'o1', lines: 1 }))!.order!.row).toEqual({ id: 'o1', lines: 3 });
  });

  it('a row never accepted moves nothing: the caller accepts only the rows its rules admitted', () => {
    const acc = createBatchSummaryAccumulator([desc({ summaryField: 'primaries', fn: 'count' })], CHILD_FIELDS)!;
    const stored = bound({ id: 'o1', primaries: 0 });
    expect(acc.overlay(stored)).toBe(stored);
  });
});

describe('[#25579] createBatchSummaryAccumulator — what it leaves as it was', () => {
  it('avg is not accumulated: no accumulator at all when it is the only roll-up', () => {
    expect(createBatchSummaryAccumulator([desc({ fn: 'avg' })], CHILD_FIELDS)).toBeUndefined();
    expect(createBatchSummaryAccumulator([], CHILD_FIELDS)).toBeUndefined();
  });

  it('a filter naming a dotted path is not evaluated on the new row: that roll-up keeps the stored value', () => {
    expect(createBatchSummaryAccumulator([desc({ fn: 'count', filter: { 'order.status': 'open' } })], CHILD_FIELDS)).toBeUndefined();
    expect(createBatchSummaryAccumulator([desc({ fn: 'count', filter: { $or: [{ 'order.status': 'open' }] } })], CHILD_FIELDS)).toBeUndefined();
  });

  it('a non-number value stops that roll-up for the rest of the batch; a sibling roll-up keeps accumulating', () => {
    const acc = createBatchSummaryAccumulator([desc({}), desc({ summaryField: 'lines', fn: 'count' })], CHILD_FIELDS)!;
    acc.accept({ order: 'o1', amount: 5 });
    acc.accept({ order: 'o1', amount: 'five' });
    expect(acc.overlay(bound({ id: 'o1', total: 1, lines: 0 }))!.order!.row).toEqual({ id: 'o1', total: 1, lines: 2 });
  });

  it('a filter the walker refuses stops that roll-up, rather than guessing', () => {
    const acc = createBatchSummaryAccumulator([desc({ fn: 'count', summaryField: 'lines', filter: { kind: { $nope: 1 } } })], CHILD_FIELDS)!;
    acc.accept({ order: 'o1', kind: 'a' });
    const stored = bound({ id: 'o1', lines: 0 });
    expect(acc.overlay(stored)).toBe(stored);
  });

  it('a stored value that is not a number is left as it is', () => {
    const acc = createBatchSummaryAccumulator([desc({})], CHILD_FIELDS)!;
    acc.accept({ order: 'o1', amount: 5 });
    expect(acc.overlay(bound({ id: 'o1', total: 'n/a' }))!.order!.row!.total).toBe('n/a');
  });

  it('only the parent the admitted rows name moves, only the roll-up the rule reads, and the shared row is never mutated', () => {
    const acc = createBatchSummaryAccumulator([desc({ summaryField: 'lines', fn: 'count' })], CHILD_FIELDS)!;
    acc.accept({ order: 'o1' });
    const other = bound({ id: 'o2', lines: 4 });
    expect(acc.overlay(other)).toBe(other);
    const unread = bound({ id: 'o1', name: 'O-1' });
    expect(acc.overlay(unread)).toBe(unread);
    const sharedRow = { id: 'o1', lines: 4 };
    const shared = bound(sharedRow);
    expect(acc.overlay(shared)!.order!.row!.lines).toBe(5);
    expect(sharedRow.lines).toBe(4);
  });

  it('an unavailable binding and a different parent object pass through untouched', () => {
    const acc = createBatchSummaryAccumulator([desc({ summaryField: 'lines', fn: 'count' })], CHILD_FIELDS)!;
    acc.accept({ order: 'o1' });
    const unavailable: RelatedRecordBinding = { order: { object: 'xt_order', unavailable: 'no-reference' } };
    expect(acc.overlay(unavailable)).toBe(unavailable);
    const foreign: RelatedRecordBinding = { order: { object: 'xt_quote', row: { id: 'o1', lines: 1 } } };
    expect(acc.overlay(foreign)).toBe(foreign);
    expect(acc.overlay(undefined)).toBeUndefined();
  });
});
