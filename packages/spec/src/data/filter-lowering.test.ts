// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The shared `FilterCondition → FilterCondition` lowering's own unit table
 * (ADR-0053 D-D1, amended 2026-09-30 — #5930): each rule input → output, the
 * column-type scope, idempotence, the closure of the output vocabulary,
 * copy-on-write, provenance, and the shapes it deliberately passes through.
 * An ordinary suite, not a gate. The seams that call it pin their own
 * placement (`@objectstack/objectql`, `@objectstack/plugin-security`).
 */

import { describe, expect, it } from 'vitest';
import { lowerFilterCondition, type FilterLoweringOptions } from './filter-lowering';
import { filterSubtreeProvenanceOf, markFilterSubtreeProvenance } from './filter-subtree-provenance';
import { FILTER_LOGIC_CASES } from './filter-logic-conformance';
import { TEMPORAL_CASES } from './temporal-conformance';

/** A typed seam whose `at` column is the one declared `datetime`. */
const TYPED: FilterLoweringOptions = { isDatetimeColumn: (column) => column === 'at' };

interface Row {
  readonly name: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly options?: FilterLoweringOptions;
}

/** Rules 1 and 2 — the `$between` split and the whole-day upper bound. */
const BOUND_ROWS: readonly Row[] = [
  { name: '$lte on a bare day → $lt the next day, in the calendar-string domain',
    input: { at: { $lte: '2026-07-28' } }, output: { at: { $lt: '2026-07-29' } }, options: TYPED },
  { name: 'month and year rollover',
    input: { at: { $lte: '2026-12-31' } }, output: { at: { $lt: '2027-01-01' } }, options: TYPED },
  { name: 'leap day',
    input: { at: { $lte: '2024-02-28' } }, output: { at: { $lt: '2024-02-29' } }, options: TYPED },
  { name: '$lte on the last supported day keeps only { $null: false }',
    input: { at: { $lte: '9999-12-31' } }, output: { at: { $null: false } }, options: TYPED },
  { name: '$between → $gte its minimum, and the whole-day rule on its maximum',
    input: { at: { $between: ['2026-07-01', '2026-07-28'] } }, output: { at: { $gte: '2026-07-01', $lt: '2026-07-29' } }, options: TYPED },
  { name: '$between whose maximum is the last supported day keeps its minimum alone',
    input: { at: { $between: ['2026-07-01', '9999-12-31'] } }, output: { at: { $gte: '2026-07-01' } }, options: TYPED },
  { name: '$between whose maximum is an instant splits into $gte / $lte, the maximum kept as written',
    input: { at: { $between: ['2026-07-01', '2026-07-28T10:00:00.000Z'] } },
    output: { at: { $gte: '2026-07-01', $lte: '2026-07-28T10:00:00.000Z' } }, options: TYPED },
  { name: 'an instant $lte is never widened',
    input: { at: { $lte: '2026-07-28T10:00:00.000Z' } }, output: { at: { $lte: '2026-07-28T10:00:00.000Z' } }, options: TYPED },
  { name: 'a Date $lte is never widened',
    input: { at: { $lte: new Date('2026-07-28T00:00:00.000Z') } }, output: { at: { $lte: new Date('2026-07-28T00:00:00.000Z') } }, options: TYPED },
  { name: 'an impossible day is not a calendar day and is kept as written',
    input: { at: { $lte: '2026-02-30' } }, output: { at: { $lte: '2026-02-30' } }, options: TYPED },
  { name: '$gte / $gt / $lt keep their midnight anchor',
    input: { at: { $gte: '2026-07-01', $gt: '2026-07-02', $lt: '2026-07-28' } },
    output: { at: { $gte: '2026-07-01', $gt: '2026-07-02', $lt: '2026-07-28' } }, options: TYPED },
  { name: 'the dashboard window { $gte, $lte } keeps its lower bound and widens its upper',
    input: { at: { $gte: '2026-07-01', $lte: '2026-07-28' } }, output: { at: { $gte: '2026-07-01', $lt: '2026-07-29' } }, options: TYPED },
  { name: 'a lowered key never clobbers an author\'s own: the collision becomes its own conjunct',
    input: { at: { $lt: '2026-07-20', $lte: '2026-07-28' } },
    output: { at: { $lt: '2026-07-20' }, $and: [{ at: { $lt: '2026-07-29' } }] }, options: TYPED },
  { name: 'the rule reaches every depth: $and, $or and $not',
    input: { $or: [{ at: { $lte: '2026-07-28' } }, { $and: [{ at: { $between: ['2026-01-01', '2026-01-31'] } }] }] },
    output: { $or: [{ at: { $lt: '2026-07-29' } }, { $and: [{ at: { $gte: '2026-01-01', $lt: '2026-02-01' } }] }] },
    options: TYPED },
];

/** Item 7 — the column-type scope. */
const SCOPE_ROWS: readonly Row[] = [
  { name: 'typed seam: a date column lowers byte-identical',
    input: { on: { $lte: '2026-07-28' } }, output: { on: { $lte: '2026-07-28' } }, options: TYPED },
  { name: 'typed seam: a $between on a non-datetime column is left whole',
    input: { amount: { $between: [5, 25] } }, output: { amount: { $between: [5, 25] } }, options: TYPED },
  { name: 'typed seam: a text column holding a day is not widened',
    input: { code: { $lte: '2026-07-28' } }, output: { code: { $lte: '2026-07-28' } }, options: TYPED },
  { name: 'type-blind seam: every column takes the rule (sound on date text: < next-day orders as <= day)',
    input: { on: { $lte: '2026-07-28' } }, output: { on: { $lt: '2026-07-29' } } },
  { name: 'type-blind seam: $between splits on any column',
    input: { amount: { $between: [5, 25] } }, output: { amount: { $gte: 5, $lte: 25 } } },
];

/** Rule 3 — NULL polarity, leaf by leaf, exactly as the four hand copies compile it. */
const NULL_ROWS: readonly Row[] = [
  { name: '$ne a value: a row with no value satisfies it',
    input: { stage: { $ne: 'won' } }, output: { $and: [{ $or: [{ stage: { $null: true } }, { stage: { $ne: 'won' } }] }] } },
  { name: '$nin: a row with no value satisfies it',
    input: { stage: { $nin: ['won'] } }, output: { $and: [{ $or: [{ stage: { $null: true } }, { stage: { $nin: ['won'] } }] }] } },
  { name: '$notContains: a row with no value satisfies it',
    input: { name: { $notContains: 'x' } }, output: { $and: [{ $or: [{ name: { $null: true } }, { name: { $notContains: 'x' } }] }] } },
  { name: '$ne: null is the total IS NOT NULL and is left alone',
    input: { stage: { $ne: null } }, output: { stage: { $ne: null } } },
  { name: '$ne a { $field } is a total column comparison and is left alone',
    input: { a: { $ne: { $field: 'b' } } }, output: { a: { $ne: { $field: 'b' } } } },
  { name: 'only the negative operator moves; its siblings stay under the key',
    input: { amount: { $gt: 1, $ne: 5 } }, output: { amount: { $gt: 1 }, $and: [{ $or: [{ amount: { $null: true } }, { amount: { $ne: 5 } }] }] } },
  { name: '$not over a positive leaf requires a value',
    input: { $not: { stage: 'won' } }, output: { $not: { $and: [{ stage: { $null: false } }, { stage: 'won' }] } } },
  { name: '$not over a negative leaf keeps the NULL escape',
    input: { $not: { stage: { $ne: 'won' } } }, output: { $not: { $and: [{ $or: [{ stage: { $null: true } }, { stage: { $ne: 'won' } }] }] } } },
  { name: '$not over a total leaf is left alone',
    input: { $not: { stage: { $null: true } } }, output: { $not: { stage: { $null: true } } } },
  { name: '$not totalises leaf by leaf through $or (De Morgan stays sound)',
    input: { $not: { $or: [{ a: 1 }, { b: { $nin: [1] } }] } },
    output: { $not: { $or: [{ $and: [{ a: { $null: false } }, { a: 1 }] }, { $and: [{ $or: [{ b: { $null: true } }, { b: { $nin: [1] } }] }] }] } } },
  { name: 'the whole-day rule runs first, then the $not guard reads the lowered leaf',
    input: { $not: { at: { $lte: '2026-07-28' } } }, output: { $not: { $and: [{ at: { $null: false } }, { at: { $lt: '2026-07-29' } }] } }, options: TYPED },
  { name: 'a positive leaf outside $not is left alone (UNKNOWN already reads as no match there)',
    input: { a: 1, b: { $gt: 2 }, c: { $in: [1] } }, output: { a: 1, b: { $gt: 2 }, c: { $in: [1] } } },
];

/** What the lowering deliberately passes through — it is not a door. */
const PASS_THROUGH_ROWS: readonly Row[] = [
  { name: 'a malformed $between (not a pair) is left for the face that refuses it',
    input: { at: { $between: ['2026-07-01'] } }, output: { at: { $between: ['2026-07-01'] } }, options: TYPED },
  { name: 'a $between holding a { $field } is left whole — split, $gte would accept a reference $between refuses',
    input: { at: { $between: [{ $field: 'opened_at' }, '2026-07-28'] } },
    output: { at: { $between: [{ $field: 'opened_at' }, '2026-07-28'] } }, options: TYPED },
  { name: 'an unresolved placeholder is not a calendar day',
    input: { at: { $lte: '{today}' } }, output: { at: { $lte: '{today}' } }, options: TYPED },
  { name: 'an unknown $ key at node level is passed through',
    input: { $where: 'x', at: { $gte: '2026-07-01' } }, output: { $where: 'x', at: { $gte: '2026-07-01' } }, options: TYPED },
  { name: 'implicit equality on a datetime column is untouched',
    input: { at: '2026-07-28' }, output: { at: '2026-07-28' }, options: TYPED },
];

const ALL_ROWS = [...BOUND_ROWS, ...SCOPE_ROWS, ...NULL_ROWS, ...PASS_THROUGH_ROWS];

/** Every operator key (`$`-prefixed) anywhere in a filter. */
function operatorKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) operatorKeys(item, out);
  } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('$')) out.add(key);
      operatorKeys(child, out);
    }
  }
  return out;
}

/** The vocabulary the lowering may introduce (the design's §3.4 closed output set, T1 subset). */
const INTRODUCED = new Set(['$and', '$or', '$lt', '$gte', '$lte', '$null']);

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    for (const child of Object.values(value as object)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

describe('lowerFilterCondition — the rule table', () => {
  for (const row of ALL_ROWS) {
    it(row.name, () => {
      expect(lowerFilterCondition(row.input, row.options)).toEqual(row.output);
    });
  }
});

describe('lowerFilterCondition — idempotence (a bound is lowered at most once)', () => {
  it('lower(lower(x)) deep-equals lower(x) for every row of the table', () => {
    for (const row of ALL_ROWS) {
      const once = lowerFilterCondition(row.input, row.options);
      expect(lowerFilterCondition(once, row.options), row.name).toEqual(once);
    }
  });

  it('…and for every FILTER_LOGIC_CASES and TEMPORAL_CASES filter, typed and type-blind', () => {
    const filters = [...FILTER_LOGIC_CASES.map((c) => c.filter), ...TEMPORAL_CASES.map((c) => c.filter)];
    expect(filters.length).toBeGreaterThan(40);
    for (const options of [TYPED, undefined]) {
      for (const filter of filters) {
        const once = lowerFilterCondition(filter, options);
        expect(lowerFilterCondition(once, options), JSON.stringify(filter)).toEqual(once);
      }
    }
  });

  it('a filter already in lowered form is returned by reference (the NULL escape and the requirement are recognised)', () => {
    for (const lowered of [
      { at: { $lt: '2026-07-29' } },
      { $and: [{ $or: [{ stage: { $null: true } }, { stage: { $ne: 'won' } }] }] },
      { $not: { $and: [{ stage: { $null: false } }, { stage: 'won' }] } },
    ]) {
      expect(lowerFilterCondition(lowered, TYPED)).toBe(lowered);
    }
  });
});

describe('lowerFilterCondition — the output vocabulary is closed', () => {
  it('introduces no operator outside $and / $or / $lt / $gte / $lte / $null, and leaves no $between it applies to', () => {
    const filters = [
      ...ALL_ROWS.map((r) => [r.input, r.options] as const),
      ...FILTER_LOGIC_CASES.map((c) => [c.filter, undefined] as const),
      ...TEMPORAL_CASES.map((c) => [c.filter, undefined] as const),
    ];
    for (const [input, options] of filters) {
      const before = operatorKeys(input);
      const after = operatorKeys(lowerFilterCondition(input, options));
      for (const op of after) {
        expect(before.has(op) || INTRODUCED.has(op), `${op} in ${JSON.stringify(input)}`).toBe(true);
      }
    }
  });

  it('every TEMPORAL_CASES datetime bound leaves the typed seam with no bare-day $lte and no $between', () => {
    const typed: FilterLoweringOptions = { isDatetimeColumn: (column) => column === 'at' };
    for (const c of TEMPORAL_CASES.filter((t) => t.kind === 'datetime')) {
      const text = JSON.stringify(lowerFilterCondition(c.filter, typed));
      expect(text, c.name).not.toMatch(/"\$lte":"\d{4}-\d{2}-\d{2}"/);
      expect(text, c.name).not.toContain('"$between"');
    }
  });
});

describe('lowerFilterCondition — copy-on-write, provenance, non-nodes', () => {
  it('never edits its input', () => {
    for (const row of ALL_ROWS) {
      const input = deepFreeze(structuredClone(row.input));
      expect(() => lowerFilterCondition(input, row.options), row.name).not.toThrow();
    }
  });

  it('returns the SAME reference when nothing lowers', () => {
    const where = { a: 1, b: { $gt: 2 }, $or: [{ c: { $in: [1] } }] };
    expect(lowerFilterCondition(where)).toBe(where);
  });

  it('keeps unchanged sibling subtrees by reference', () => {
    const untouched = { c: { $in: [1] } };
    const lowered = lowerFilterCondition({ $or: [untouched, { at: { $lte: '2026-07-28' } }] }, TYPED) as {
      $or: unknown[];
    };
    expect(lowered.$or[0]).toBe(untouched);
  });

  it('carries the provenance mark of every node it replaces', () => {
    const author = markFilterSubtreeProvenance({ at: { $lte: '2026-07-28' } }, 'author');
    const policy = markFilterSubtreeProvenance({ stage: { $ne: 'won' } }, 'policy');
    const lowered = lowerFilterCondition({ $and: [author, policy] }, TYPED) as { $and: unknown[] };
    expect(lowered.$and[0]).not.toBe(author);
    expect(filterSubtreeProvenanceOf(lowered.$and[0])).toBe('author');
    expect(filterSubtreeProvenanceOf(lowered.$and[1])).toBe('policy');
  });

  it('hands a value that is not a filter node back as it is', () => {
    for (const value of [undefined, null, 5, 'x', [], new Date(0)]) {
      expect(lowerFilterCondition(value)).toBe(value);
    }
  });
});
