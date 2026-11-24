// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25579] The in-memory accumulation a bulk insert overlays on its rules'
 * related bindings — one function of the stored summary and the batch's
 * admitted rows, per roll-up kind. The end-to-end half (the real import door,
 * the real engine, a real sqlite driver) is
 * `packages/rest/src/import-batch-parent-summary-rule.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { createBatchSummaryAccumulator, createPredicateUpdateSummaryFold, loadPredicateUpdateSummaryBases, MIN_MAX_EXCLUDED_ID_BUDGET, summaryPatchCanMove } from './summary-batch-accumulation.js';
import type { MatchedRowStates, SummaryBase, SummaryBases, SummaryDependents, SummaryFoldStandDown } from './summary-batch-accumulation.js';
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

describe('[#34466] overlayRow — the master-detail header a field-level parent. predicate reads', () => {
  it('moves the summary on a header row of the roll-up\'s parent object, on a copy', () => {
    const acc = createBatchSummaryAccumulator([desc({ summaryField: 'lines', fn: 'count', sourceField: undefined })], CHILD_FIELDS)!;
    const header = { id: 'o1', lines: 1, status: 'draft' };
    acc.accept({ order: 'o1' });
    acc.accept({ order: 'o1' });
    expect(acc.overlayRow('xt_order', header)).toEqual({ id: 'o1', lines: 3, status: 'draft' });
    expect(header.lines).toBe(1);
  });

  it('leaves as it was: an unbound header, another parent, another object, a header not handed the summary', () => {
    const acc = createBatchSummaryAccumulator([desc({ summaryField: 'lines', fn: 'count', sourceField: undefined })], CHILD_FIELDS)!;
    acc.accept({ order: 'o1' });
    expect(acc.overlayRow('xt_order', null)).toBeNull();
    expect(acc.overlayRow('xt_order', undefined)).toBeUndefined();
    const other = { id: 'o2', lines: 0 };
    expect(acc.overlayRow('xt_order', other)).toBe(other);
    const elsewhere = { id: 'o1', lines: 0 };
    expect(acc.overlayRow('xt_quote', elsewhere)).toBe(elsewhere);
    const narrow = { id: 'o1', status: 'draft' };
    expect(acc.overlayRow('xt_order', narrow)).toBe(narrow);
  });
});

describe('[#34465] createPredicateUpdateSummaryFold — consecutive by-id updates, folded over a base', () => {
  const base = (over: Partial<SummaryBase>): SummaryBase => ({ count: 0, sum: 0, nonNull: 0, min: null, max: null, ...over });
  const states = (...pairs: Array<[Record<string, unknown>, Record<string, unknown>]>): MatchedRowStates[] =>
    pairs.map(([previous, next]) => ({ previous, next }));
  const total = (fold: ReturnType<typeof createPredicateUpdateSummaryFold>, field: string, id = 'o1') =>
    fold!.overlay(bound({ id, [field]: 'stored' }))!.order!.row![field];

  it('count / sum / avg over a base that holds the matched rows as stored: each judged row leaves its old part and takes its new one', () => {
    const count = desc({ summaryField: 'primaries', fn: 'count', filter: { is_primary: true } });
    const sum = desc({ summaryField: 'total' });
    const avg = desc({ summaryField: 'mean', fn: 'avg' });
    const matched = states(
      [{ id: 'a', order: 'o1', amount: 10, is_primary: false }, { id: 'a', order: 'o1', amount: 30, is_primary: true }],
      [{ id: 'b', order: 'o1', amount: 20, is_primary: false }, { id: 'b', order: 'o1', amount: 30, is_primary: true }],
    );
    // Stored: a, b and one row outside the match (amount 30, primary).
    const bases: SummaryBases = new Map([
      [count, new Map([['o1', base({ count: 1 })]])],
      [sum, new Map([['o1', base({ sum: 60 })]])],
      [avg, new Map([['o1', base({ sum: 60, nonNull: 3 })]])],
    ]);
    const fold = createPredicateUpdateSummaryFold(bases, matched, CHILD_FIELDS)!;
    expect([total(fold, 'primaries'), total(fold, 'total'), total(fold, 'mean')]).toEqual([1, 60, 20]);
    fold.advance(0);
    expect([total(fold, 'primaries'), total(fold, 'total'), total(fold, 'mean')]).toEqual([2, 80, 80 / 3]);
    fold.advance(1);
    expect([total(fold, 'primaries'), total(fold, 'total'), total(fold, 'mean')]).toEqual([3, 90, 30]);
  });

  it('min / max over a base that leaves the matched rows out: a matched row holding the extreme takes it with it', () => {
    const min = desc({ summaryField: 'lowest', fn: 'min' });
    const max = desc({ summaryField: 'highest', fn: 'max' });
    const matched = states(
      [{ id: 'a', order: 'o1', amount: 5 }, { id: 'a', order: 'o1', amount: 70 }],
      [{ id: 'b', order: 'o1', amount: 90 }, { id: 'b', order: 'o1', amount: 70 }],
    );
    const bases: SummaryBases = new Map([
      [min, new Map([['o1', base({ min: 50 })]])],
      [max, new Map([['o1', base({ max: 50 })]])],
    ]);
    const fold = createPredicateUpdateSummaryFold(bases, matched, CHILD_FIELDS)!;
    expect([total(fold, 'lowest'), total(fold, 'highest')]).toEqual([5, 90]);
    fold.advance(0);
    expect([total(fold, 'lowest'), total(fold, 'highest')]).toEqual([50, 90]);
    fold.advance(1);
    expect([total(fold, 'lowest'), total(fold, 'highest')]).toEqual([50, 70]);
  });

  it('a reparent: the row leaves the old parent and joins the new one; the header overlay reads the same values', () => {
    const count = desc({ summaryField: 'line_count', fn: 'count' });
    const matched = states([{ id: 'a', order: 'o1' }, { id: 'a', order: 'o2' }]);
    const fold = createPredicateUpdateSummaryFold(new Map([[count, new Map([['o1', base({ count: 2 })], ['o2', base({ count: 0 })]])]]), matched, CHILD_FIELDS)!;
    fold.advance(0);
    expect(fold.overlayRow('xt_order', { id: 'o1', line_count: 2 })).toEqual({ id: 'o1', line_count: 1 });
    expect(fold.overlayRow('xt_order', { id: 'o2', line_count: 0 })).toEqual({ id: 'o2', line_count: 1 });
    expect(fold.overlayRow('xt_order', null)).toBeNull();
  });

  it('leaves the stored value where it cannot say it exactly: a non-number value, a dotted-path filter, a parent with no base', () => {
    const sum = desc({});
    const matched = states([{ id: 'a', order: 'o1', amount: '12' }, { id: 'a', order: 'o1', amount: 3 }]);
    expect(createPredicateUpdateSummaryFold(new Map([[sum, new Map([['o1', base({ sum: 12 })]])]]), matched, CHILD_FIELDS)).toBeUndefined();
    const plain = states([{ id: 'a', order: 'o1', amount: 1 }, { id: 'a', order: 'o1', amount: 2 }]);
    const fold = createPredicateUpdateSummaryFold(new Map([[sum, new Map([['o1', base({ sum: 1 })]])]]), plain, CHILD_FIELDS)!;
    const other = bound({ id: 'o9', total: 7 });
    expect(fold.overlay(other)).toBe(other);
    expect(createPredicateUpdateSummaryFold(new Map(), plain, CHILD_FIELDS)).toBeUndefined();
  });
});

describe('[#34465] the fold hands the folded roll-ups to what computes the parent fields calculated from them', () => {
  it('patches a calculated field the row carries, with the folded values; leaves the rest of the row and a field it does not carry', () => {
    const sum = desc({});
    const matched: MatchedRowStates[] = [
      { previous: { id: 'a', order: 'o1', amount: 40 }, next: { id: 'a', order: 'o1', amount: 70 } },
      { previous: { id: 'b', order: 'o1', amount: 40 }, next: { id: 'b', order: 'o1', amount: 70 } },
    ];
    const fold = createPredicateUpdateSummaryFold(new Map([[sum, new Map([['o1', { count: 0, sum: 80, nonNull: 0, min: null, max: null }]])]]), matched, CHILD_FIELDS)!;
    expect(fold.foldedSummaries()).toEqual(new Map([['xt_order', { fields: new Set(['total']), parentIds: new Set(['o1']) }]]));
    const asked: unknown[] = [];
    fold.setDependents((object, parentId, moved) => {
      asked.push([object, parentId, { ...moved }]);
      return { remaining: 100 - (moved.total ?? 0), other: 'x' };
    });
    // A binding that names only the calculated field (the rule reads `record.order.remaining`).
    const binding: RelatedRecordBinding = { order: { object: 'xt_order', row: { id: 'o1', remaining: 20 } } };
    expect(fold.overlay(binding)!.order!.row).toEqual({ id: 'o1', remaining: 20 });
    fold.advance(0);
    expect(fold.overlay(binding)!.order!.row).toEqual({ id: 'o1', remaining: -10 });
    expect(binding.order!.row).toEqual({ id: 'o1', remaining: 20 });
    expect(asked).toEqual([['xt_order', 'o1', { total: 80 }], ['xt_order', 'o1', { total: 110 }]]);
  });

  it('tells the dependents, after each judged row, every parent that row names (as stored and as left) with the roll-ups it leaves', () => {
    const sum = desc({});
    const matched: MatchedRowStates[] = [
      { previous: { id: 'a', order: 'o1', amount: 40 }, next: { id: 'a', order: 'o2', amount: 40 } },
      { previous: { id: 'b', order: 'o1', amount: 40 }, next: { id: 'b', order: 'o1', amount: 70 } },
    ];
    const base = (s: number) => ({ count: 0, sum: s, nonNull: 0, min: null, max: null });
    const fold = createPredicateUpdateSummaryFold(new Map([[sum, new Map([['o1', base(80)], ['o2', base(0)]])]]), matched, CHILD_FIELDS)!;
    const advanced: unknown[] = [];
    const dependents = Object.assign(() => undefined, { advance: (object: string, parentId: string, moved: Readonly<Record<string, number | null>>) => { advanced.push([object, parentId, { ...moved }]); } });
    fold.setDependents(dependents);
    fold.advance(0);
    fold.advance(1);
    expect(advanced).toEqual([
      ['xt_order', 'o1', { total: 40 }], ['xt_order', 'o2', { total: 40 }],
      ['xt_order', 'o1', { total: 70 }],
    ]);
  });
});

describe('[#34465] loadPredicateUpdateSummaryBases — the base a predicate update folds over', () => {
  const recorder = (answer: (query: any) => any[]) => {
    const calls: any[] = [];
    return { calls, engine: { aggregate: async (_object: string, query: any) => { calls.push(query); return answer(query); } } };
  };
  const matched: MatchedRowStates[] = [
    { previous: { id: 'a', order: 'o1', amount: 1 }, next: { id: 'a', order: 'o2', amount: 1 } },
    { previous: { id: 'b', order: 'o1', amount: 2 }, next: { id: 'b', order: 'o1', amount: 2 } },
  ];

  it('count / sum read every child as stored, min / max exclude the matched ids, avg reads its sum and non-null count; every parent named as stored or as left', async () => {
    const { calls, engine } = recorder(() => [{ order: 'o1', value: 7, value_count: 3 }]);
    const sum = desc({});
    const min = desc({ summaryField: 'lowest', fn: 'min' });
    const avg = desc({ summaryField: 'mean', fn: 'avg' });
    const bases = await loadPredicateUpdateSummaryBases(engine, [sum, min, avg], matched);
    expect(calls.map((q) => q.where)).toEqual([
      { order: { $in: ['o1', 'o2'] } },
      { $and: [{ order: { $in: ['o1', 'o2'] } }, { id: { $nin: ['a', 'b'] } }] },
      { $and: [{ order: { $in: ['o1', 'o2'] } }, { amount: { $ne: null } }] },
    ]);
    expect(calls.every((q) => q.groupBy[0] === 'order')).toBe(true);
    expect(bases.get(sum)!.get('o1')!.sum).toBe(7);
    expect(bases.get(sum)!.get('o2')).toEqual({ count: 0, sum: 0, nonNull: 0, min: null, max: null });
    expect(bases.get(min)!.get('o1')!.min).toBe(7);
    expect(bases.get(avg)!.get('o1')).toMatchObject({ sum: 7, nonNull: 3 });
  });

  it('leaves out a roll-up whose answer is no number, one whose filter names a dotted path, and a min / max past the exclusion budget', async () => {
    const { engine } = recorder(() => [{ order: 'o1', value: '2026-01-01' }]);
    expect((await loadPredicateUpdateSummaryBases(engine, [desc({ fn: 'min', summaryField: 'first_day', sourceField: 'day' })], matched)).size).toBe(0);
    expect((await loadPredicateUpdateSummaryBases(engine, [desc({ fn: 'count', filter: { 'account.kind': 'x' } })], matched)).size).toBe(0);
    const many: MatchedRowStates[] = Array.from({ length: MIN_MAX_EXCLUDED_ID_BUDGET + 1 }, (_, i) => ({ previous: { id: `r${i}`, order: 'o1' }, next: { id: `r${i}`, order: 'o1' } }));
    const counted = recorder(() => []);
    expect((await loadPredicateUpdateSummaryBases(counted.engine, [desc({ fn: 'max', summaryField: 'highest' })], many)).size).toBe(0);
    expect(counted.calls).toEqual([]);
    expect((await loadPredicateUpdateSummaryBases(counted.engine, [desc({ fn: 'count', summaryField: 'n' })], many)).size).toBe(1);
  });

  it('leaves out, before any statement, a roll-up whose filter reads through a reference in the nested form; an operator object beneath a field is no such read', async () => {
    const nested = recorder(() => [{ order: 'o1', value: 1 }]);
    for (const filter of [{ account: { status: 'x' } }, { $and: [{ kind: 'a' }, { account: { status: 'x' } }] }, { account: { status: { $in: ['x'] } } }]) {
      expect((await loadPredicateUpdateSummaryBases(nested.engine, [desc({ fn: 'min', summaryField: 'low', filter })], matched)).size).toBe(0);
    }
    expect(nested.calls).toEqual([]);
    // CONTROL: a field condition spelled with operators is evaluated in memory, so its roll-up is loaded.
    expect((await loadPredicateUpdateSummaryBases(nested.engine, [desc({ fn: 'min', summaryField: 'low', filter: { kind: { $in: ['a'] } } })], matched)).size).toBe(1);
  });
});

describe('[#34821] the bulk insert accumulator screens a filter reading through a reference as the predicate update\'s fold does', () => {
  it('a filter in the nested one-level form, at any depth of $and / $or / $not, is not accumulated: no accumulator when it is the only roll-up', () => {
    for (const filter of [{ account: { status: 'x' } }, { $not: { account: { status: 'x' } } }, { $or: [{ kind: 'a' }, { account: { status: 'x' } }] }, { account: {} }]) {
      expect(createBatchSummaryAccumulator([desc({ fn: 'count', filter })], CHILD_FIELDS)).toBeUndefined();
    }
  });

  it('CONTROL: a field condition spelled with operators is still accumulated', () => {
    const acc = createBatchSummaryAccumulator([desc({ fn: 'count', summaryField: 'n', filter: { kind: { $in: ['a'] } } })], CHILD_FIELDS)!;
    acc.accept({ order: 'o1', kind: 'a' });
    expect(acc.overlay(bound({ id: 'o1', n: 1 }))!.order!.row).toEqual({ id: 'o1', n: 2 });
  });
});

describe('[#34821] the bulk insert accumulator hands the moved roll-ups to what computes the parent fields calculated from them', () => {
  const sum = desc({});

  it('names, per parent object a rule reads, the roll-ups it moves and the parents the rows name', () => {
    const acc = createBatchSummaryAccumulator([sum, desc({ parentObject: 'xt_other', summaryField: 'n', fn: 'count' })], CHILD_FIELDS)!;
    const rows = [{ order: 'o1' }, { order: 'o2' }, { order: null }, null];
    expect(acc.foldedSummaries(rows, new Set(['xt_order']))).toEqual(new Map([['xt_order', { fields: new Set(['total']), parentIds: new Set(['o1', 'o2']) }]]));
    expect(acc.foldedSummaries(rows, new Set())).toEqual(new Map());
  });

  it('a binding naming only the calculated field: the roll-up is moved from the stored parent, and the calculated field patched with what the dependents compute', () => {
    const acc = createBatchSummaryAccumulator([sum], CHILD_FIELDS)!;
    const asked: unknown[] = [];
    const dependents = Object.assign((object: string, parentId: string, moved: Readonly<Record<string, number | null>>) => {
      asked.push([object, parentId, { ...moved }]);
      return { remaining: 100 - (moved.total ?? 0), other: 'x' };
    }, { stored: (object: string, parentId: string) => (object === 'xt_order' && parentId === 'o1' ? { id: 'o1', total: 80 } : undefined) }) as SummaryDependents;
    acc.setDependents(dependents);
    const binding: RelatedRecordBinding = { order: { object: 'xt_order', row: { id: 'o1', remaining: 20 } } };
    // No admitted row yet: nothing moves, the dependents are not asked.
    expect(acc.overlay(binding)).toBe(binding);
    acc.accept({ order: 'o1', amount: 30 });
    expect(acc.overlay(binding)!.order!.row).toEqual({ id: 'o1', remaining: -10 });
    expect(binding.order!.row).toEqual({ id: 'o1', remaining: 20 });
    expect(asked).toEqual([['xt_order', 'o1', { total: 110 }]]);
  });

  it('a binding carrying the roll-up moves it from the value it carries; the header overlay reads the same', () => {
    const acc = createBatchSummaryAccumulator([sum], CHILD_FIELDS)!;
    acc.setDependents(Object.assign((_o: string, _p: string, moved: Readonly<Record<string, number | null>>) => ({ remaining: 100 - (moved.total ?? 0) }), { stored: () => ({ id: 'o1', total: 0 }) }) as SummaryDependents);
    acc.accept({ order: 'o1', amount: 30 });
    expect(acc.overlay(bound({ id: 'o1', total: 80, remaining: 20 }))!.order!.row).toEqual({ id: 'o1', total: 110, remaining: -10 });
    expect(acc.overlayRow('xt_order', { id: 'o1', total: 80, remaining: 20 })).toEqual({ id: 'o1', total: 110, remaining: -10 });
  });

  it('tells the dependents, after each admitted row, every parent that row names with the roll-ups it moves them to', () => {
    const acc = createBatchSummaryAccumulator([sum], CHILD_FIELDS)!;
    const advanced: unknown[] = [];
    acc.setDependents(Object.assign(() => undefined, {
      stored: (_o: string, parentId: string) => ({ id: parentId, total: parentId === 'o1' ? 80 : 0 }),
      advance: (object: string, parentId: string, moved: Readonly<Record<string, number | null>>) => { advanced.push([object, parentId, { ...moved }]); },
    }) as SummaryDependents);
    acc.accept({ order: 'o1', amount: 30 });
    acc.accept({ order: 'o2', amount: 5 });
    acc.accept({ order: 'o1', amount: -50 });
    expect(advanced).toEqual([
      ['xt_order', 'o1', { total: 110 }],
      ['xt_order', 'o2', { total: 5 }],
      ['xt_order', 'o1', { total: 60 }],
    ]);
  });
});

describe('[#34821] summaryPatchCanMove — a roll-up a predicate update\'s patch cannot move is not folded', () => {
  const filtered = desc({ fn: 'count', summaryField: 'n', filter: { $and: [{ kind: 'a' }, { $or: [{ is_primary: true }, { $not: { note: 'x' } }] }] } });

  it('moves when the patch writes the foreign key, the source field, or a field the filter names at any depth', () => {
    expect(summaryPatchCanMove(desc({}), { order: 'o2' })).toBe(true);
    expect(summaryPatchCanMove(desc({}), { amount: 1 })).toBe(true);
    expect(summaryPatchCanMove(desc({ fn: 'avg' }), { amount: null })).toBe(true);
    for (const field of ['kind', 'is_primary', 'note']) expect(summaryPatchCanMove(filtered, { [field]: null })).toBe(true);
  });

  it('cannot move when the patch writes none of them; a count reads no source field', () => {
    expect(summaryPatchCanMove(desc({}), { kind: 'b', note: 'n' })).toBe(false);
    expect(summaryPatchCanMove(filtered, { amount: 5 })).toBe(false);
    expect(summaryPatchCanMove(desc({ fn: 'count', sourceField: undefined }), { amount: 5 })).toBe(false);
  });

  it('a filter holding a condition whose fields it cannot read is taken to move', () => {
    expect(summaryPatchCanMove(desc({ fn: 'count', filter: { $expr: { $gt: ['$amount', 1] } } }), { kind: 'b' })).toBe(true);
  });

  it('moves when the patch writes a field the filter reads as a { $field } comparand or an addDays offset, and not otherwise', () => {
    const late = desc({ fn: 'count', summaryField: 'n', filter: { closed_day: { $gt: { $field: 'due_day' } } } });
    expect(summaryPatchCanMove(late, { due_day: 1 })).toBe(true);
    expect(summaryPatchCanMove(late, { closed_day: 1 })).toBe(true);
    const shifted = desc({ fn: 'count', summaryField: 'n', filter: { $or: [{ closed_on: { $lt: { $field: 'due_on', addDays: { $field: 'grace' } } } }] } });
    expect(summaryPatchCanMove(shifted, { grace: 2 })).toBe(true);
    expect(summaryPatchCanMove(shifted, { due_on: '2026-01-01' })).toBe(true);
    // CONTROL: a patch writing none of the filter's fields, as key or as referent.
    expect(summaryPatchCanMove(late, { other: 1 })).toBe(false);
    expect(summaryPatchCanMove(shifted, { other: 1 })).toBe(false);
    // A referent naming no field by a string is a condition this cannot read.
    expect(summaryPatchCanMove(desc({ fn: 'count', filter: { closed_day: { $gt: { $field: 7 } } } }), { other: 1 })).toBe(true);
  });
});

describe('[#34821] each stand-down of a predicate update\'s fold is reported once, naming the roll-up and why', () => {
  const recorder = (answer: () => any[]) => ({ aggregate: async () => answer() });
  const matched: MatchedRowStates[] = [
    { previous: { id: 'a', order: 'o1', amount: 1 }, next: { id: 'a', order: 'o1', amount: 2 } },
    { previous: { id: 'b', order: 'o1', amount: 2 }, next: { id: 'b', order: 'o1', amount: 3 } },
  ];
  const sink = () => {
    const told: Array<[string, SummaryFoldStandDown]> = [];
    return { told, standDown: (d: SummaryDescriptor, reason: SummaryFoldStandDown) => { told.push([d.summaryField, reason]); } };
  };

  it('the base loader: a filter reading through a reference, an answer that is no number, a min / max past the exclusion budget', async () => {
    const { told, standDown } = sink();
    await loadPredicateUpdateSummaryBases(recorder(() => [{ order: 'o1', value: 1 }]), [desc({ fn: 'count', summaryField: 'nested', filter: { account: { status: 'x' } } })], matched, undefined, standDown);
    await loadPredicateUpdateSummaryBases(recorder(() => [{ order: 'o1', value: '2026-01-01' }]), [desc({ fn: 'min', summaryField: 'first_day', sourceField: 'day' })], matched, undefined, standDown);
    const many: MatchedRowStates[] = Array.from({ length: MIN_MAX_EXCLUDED_ID_BUDGET + 1 }, (_, i) => ({ previous: { id: `r${i}`, order: 'o1' }, next: { id: `r${i}`, order: 'o1' } }));
    await loadPredicateUpdateSummaryBases(recorder(() => []), [desc({ fn: 'max', summaryField: 'highest' })], many, undefined, standDown);
    // CONTROL: a roll-up the loader folds is not reported.
    await loadPredicateUpdateSummaryBases(recorder(() => [{ order: 'o1', value: 3 }]), [desc({})], matched, undefined, standDown);
    expect(told).toEqual([['nested', 'filter'], ['first_day', 'not_a_number'], ['highest', 'exclusion_budget']]);
  });

  it('the fold: a filter the walker refuses, a matched value that is no number', () => {
    const { told, standDown } = sink();
    const base = new Map([['o1', { count: 0, sum: 3, nonNull: 0, min: null, max: null }]]);
    const refused = desc({ fn: 'count', summaryField: 'refused', filter: { kind: { $nope: 1 } } });
    const texty = desc({ summaryField: 'texty', sourceField: 'note' });
    const kept = desc({});
    const rows: MatchedRowStates[] = [{ previous: { id: 'a', order: 'o1', amount: 1, kind: 'a', note: 'x' }, next: { id: 'a', order: 'o1', amount: 2, kind: 'a', note: 'y' } }];
    const fold = createPredicateUpdateSummaryFold(new Map([[refused, base], [texty, base], [kept, base]]), rows, CHILD_FIELDS, standDown);
    expect(fold!.foldedSummaries().get('xt_order')!.fields).toEqual(new Set(['total']));
    expect(told).toEqual([['refused', 'filter'], ['texty', 'not_a_number']]);
  });
});
