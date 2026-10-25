// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The read half opens a stored condition as an editable row ONLY when the
 * builder can hold that row (objectui#10257).
 *
 * ## The defect: two ways to open a row the builder cannot hold
 *
 * The inspector commits on every change (`DatasetFilterField.commitFilterGroup`),
 * so every row `conditionToGroup` opens is re-serialized by `groupToCondition`
 * the next time the author edits ANY row in the group. A row the builder cannot
 * hold faithfully is therefore rewritten or dropped by an edit to a SIBLING.
 *
 *  1. AN INCOMPLETE STORED VALUE — `{ $eq: '' }`, `{ $in: [] }`. The read half
 *     opened it as a row; the write half drops the same row as unfinished, so a
 *     sibling edit erased it. For `$in: []` that widens the dataset from no
 *     rows to every row.
 *  2. A TOKEN READ BACK AS AN OPERATOR THE COLUMN'S BUCKET DOES NOT OFFER —
 *     `$in` on a date or number column, `$gt` on a text column. The panel drew
 *     a BLANK operator trigger (objectui#4768 / #7561), and one touch of the
 *     row's field picker ran `reconcileOperatorForField` ⇒ `equals` plus a
 *     reshape, committing a different filter (the objectui#9382 defect).
 *
 * ## The direction, and why this one
 *
 * One of two, for both classes: the read half calls these shapes
 * non-representable (the Source tab takes them), or the write half keeps them.
 * This follows the read-half direction of objectui#10062, the bridge's own
 * `$between` guard, and generalises it from the pair arity to every token.
 *
 * objectui#9363 and objectui#9372 made the write half CARRY a shape only where
 * the spec has a token for exactly what a FINISHED builder row means. Where the
 * write half cannot carry a shape faithfully, they kept it out of the builder
 * (it dropped, inertly, or the stored form read back as non-representable) and
 * never emitted "something anyway". Neither class here can be carried by the
 * write half:
 *
 *  - `equals ''` is also the row the builder SEEDS when "Add condition" is
 *    clicked. A write half that kept `{ $eq: '' }` would emit a filter for
 *    every unfinished row, the "silently-wrong filter" its incomplete-row drop
 *    exists to prevent.
 *  - The bucket gap is not in the write half at all. The operator is lost in
 *    the PANEL, before anything reaches the bridge.
 *
 * ## DIRECTION, predicted before running, on the unmodified tree
 *
 *  - every `class 1` and `class 2` leg expecting `representable: false` — RED;
 *  - the swept invariant — RED, naming the incomplete and off-bucket reads;
 *  - the three real-inspector refusals — RED (the builder trigger is drawn
 *    where the Source-tab note is expected);
 *  - every `WHY`, `CONTROL` and `reachable` leg, the builder-domain sweep, and
 *    the field-less read — GREEN in both directions, by construction. They are
 *    not pins: a suite built only on them could not fail.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FieldOperatorsSchema, FilterConditionSchema } from '@objectstack/spec/data';
import {
  VALUELESS_FILTER_BUILDER_OPERATORS,
  operatorsForFieldType,
  reconcileOperatorForField,
} from '@object-ui/components';
import {
  conditionToGroup,
  groupToCondition,
  type BuilderFieldDef,
  type BuilderGroup,
  type FilterCondition,
} from './datasetFilterCondition';

// Only the real-inspector pins at the bottom read this: the catalog hooks
// stubbed so `DatasetDefaultInspector` renders without a MetadataClient, with
// the same columns as `FIELDS` below.
vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({
    relationships: [],
    fieldOptions: [
      { value: 'stage', label: 'Stage', type: 'text' },
      { value: 'name', label: 'Name', type: 'text' },
      { value: 'region', label: 'Region', type: 'select' },
      { value: 'closed_at', label: 'Closed at', type: 'date' },
      { value: 'amount', label: 'Amount', type: 'number' },
      { value: 'flag', label: 'Flag', type: 'boolean' },
    ],
    loading: false,
  }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { DatasetDefaultInspector } from './DatasetDefaultInspector';

afterEach(cleanup);

/** The inspector's filter columns, as `DatasetFilterField` hands them to both halves. */
const FIELDS: BuilderFieldDef[] = [
  { value: 'stage', label: 'Stage', type: 'text' },
  { value: 'name', label: 'Name', type: 'text' },
  { value: 'region', label: 'Region', type: 'select' },
  { value: 'closed_at', label: 'Closed at', type: 'date' },
  { value: 'amount', label: 'Amount', type: 'number' },
  { value: 'flag', label: 'Flag', type: 'boolean' },
];

/** The bucket the dropdown lists: no opt-in extras, as the inspector mounts it. */
const offeredBy = (type: string | undefined): string[] => operatorsForFieldType(type).map((o) => o.value);

/**
 * The author's sibling edit: change the `stage` row's value, then serialize
 * the group exactly as the inspector does on commit.
 */
function editStage(group: BuilderGroup, value: string): FilterCondition | undefined {
  return groupToCondition({
    ...group,
    conditions: group.conditions.map((c) => (c.field === 'stage' ? { ...c, value } : c)),
  });
}

/** A stored filter holding a finished `stage` row beside `other`. */
const beside = (other: FilterCondition): FilterCondition => ({ $and: [{ stage: { $eq: 'won' } }, other] });

describe('class 1 — an incomplete stored value is not opened as a row the next commit drops', () => {
  /** Stored conditions whose value the write half calls unfinished. */
  const INCOMPLETE: ReadonlyArray<FilterCondition> = [
    { name: { $eq: '' } },
    { region: { $in: [] } },
    { name: { $ne: '' } },
    { region: { $nin: [] } },
    { name: { $contains: '' } },
    { name: { $eq: null } },
    { amount: { $gt: '' } },
    // The implicit-equality spelling of the same shapes.
    { name: '' },
    { name: null },
    { region: [] },
  ];

  it('reachable: the spec accepts all but one of them, so a Source-tab or AI-authored filter can carry it', () => {
    // Through `@objectstack/spec` 17.4.0 the spec accepted EVERY row. 17.5.0
    // refuses the bare-array implicit-equality comparand (`{ region: [] }`) at
    // the door, by name, with its `$in` prescription (objectui#11073) — so that
    // one row is reachable now only as a document stored before the bump, and
    // the read-half cases below keep it for exactly that reason.
    const refusedSince1750 = JSON.stringify({ region: [] });
    for (const c of INCOMPLETE) {
      const parsed = FilterConditionSchema.safeParse(beside(c));
      if (JSON.stringify(c) === refusedSince1750) {
        expect(parsed.success, JSON.stringify(c)).toBe(false);
        expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.code} @ ${i.path.join('.')}`)).toEqual([
          'custom @ $and.1.region',
        ]);
        continue;
      }
      expect(parsed.success, JSON.stringify(c)).toBe(true);
    }
    expect(FieldOperatorsSchema.safeParse({ $eq: '' }).success).toBe(true);
    expect(FieldOperatorsSchema.safeParse({ $in: [] }).success).toBe(true);
  });

  it('WHY: read as rows, a sibling edit drops them, and `$in: []` widens the dataset from nothing to everything', () => {
    // The hypothetical group the pre-fix read produced, built by hand so this
    // leg reads the WRITE half only and stays lit in both directions.
    const asRows: BuilderGroup = {
      id: 'g',
      logic: 'and',
      conditions: [
        { id: 'c0', field: 'stage', operator: 'equals', value: 'won' },
        { id: 'c1', field: 'name', operator: 'equals', value: '' },
        { id: 'c2', field: 'region', operator: 'in', value: [] },
      ],
    };
    expect(editStage(asRows, 'lost')).toEqual({ stage: { $eq: 'lost' } });
  });

  it('THE CARD: `{ name: { $eq: "" } }` beside a finished row is not representable — the Source tab, not a silent drop', () => {
    const { group, representable } = conditionToGroup(beside({ name: { $eq: '' } }), FIELDS);
    expect(representable).toBe(false);
    expect(group.conditions).toEqual([]);
  });

  it('THE CARD: `{ region: { $in: [] } }` beside a finished row is not representable', () => {
    const { group, representable } = conditionToGroup(beside({ region: { $in: [] } }), FIELDS);
    expect(representable).toBe(false);
    expect(group.conditions).toEqual([]);
  });

  it('every incomplete shape, with the field list and without it — completeness does not depend on the column', () => {
    for (const c of INCOMPLETE) {
      expect(conditionToGroup(beside(c), FIELDS).representable, `${JSON.stringify(c)} with fields`).toBe(false);
      expect(conditionToGroup(beside(c)).representable, `${JSON.stringify(c)} field-less`).toBe(false);
      expect(conditionToGroup(c, FIELDS).representable, `${JSON.stringify(c)} alone`).toBe(false);
    }
  });

  it('a stored condition keyed by an empty field name is not opened either: the write half drops a row with no field', () => {
    expect(FilterConditionSchema.safeParse(beside({ '': { $eq: 'x' } })).success).toBe(true);
    expect(conditionToGroup(beside({ '': { $eq: 'x' } }), FIELDS).representable).toBe(false);
  });

  it('CONTROL: `0` and `false` are values, not blanks — still opened, and a sibling edit keeps them byte-identical', () => {
    for (const other of [{ amount: { $eq: 0 } }, { amount: { $gt: 0 } }, { flag: { $eq: false } }]) {
      const { group, representable } = conditionToGroup(beside(other), FIELDS);
      expect(representable, JSON.stringify(other)).toBe(true);
      expect(editStage(group, 'lost')).toEqual({ $and: [{ stage: { $eq: 'lost' } }, other] });
    }
  });

  it('CONTROL: the value-less tokens carry no value to be incomplete, and stay opened', () => {
    for (const other of [{ name: { $empty: true } }, { name: { $null: true } }]) {
      const { group, representable } = conditionToGroup(beside(other), FIELDS);
      expect(representable, JSON.stringify(other)).toBe(true);
      expect(editStage(group, 'lost')).toEqual({ $and: [{ stage: { $eq: 'lost' } }, other] });
    }
  });
});

describe('class 2 — a stored token is not opened as an operator the column\'s bucket does not offer', () => {
  /** The addendum's measured rows (comment 5817965568), plus the value-less tokens on a boolean column. */
  const OFF_BUCKET: ReadonlyArray<{ stored: FilterCondition; type: string; readAs: string }> = [
    { stored: { closed_at: { $in: ['2026-01-01', '2026-02-01'] } }, type: 'date', readAs: 'in' },
    { stored: { name: { $gt: 'm' } }, type: 'text', readAs: 'greater_than' },
    { stored: { amount: { $in: [1, 2] } }, type: 'number', readAs: 'in' },
    // "Every token" includes the value-less arms: the boolean bucket offers
    // only `equals` / `notEquals`.
    { stored: { flag: { $empty: false } }, type: 'boolean', readAs: 'is_not_empty' },
    { stored: { flag: { $null: false } }, type: 'boolean', readAs: 'is_not_null' },
  ];

  it('the premise: each read-back operator is missing from its column\'s bucket, and the builder would reconcile it to `equals`', () => {
    for (const { type, readAs } of OFF_BUCKET) {
      const bucket = offeredBy(type);
      expect(bucket.length, `${type} bucket is empty, so membership would be vacuous`).toBeGreaterThan(0);
      expect(bucket, `${type} offers ${readAs}`).not.toContain(readAs);
      expect(reconcileOperatorForField(readAs, operatorsForFieldType(type))).toBe('equals');
    }
  });

  it('reachable: the spec accepts every one of them', () => {
    for (const { stored } of OFF_BUCKET) {
      expect(FilterConditionSchema.safeParse(stored).success, JSON.stringify(stored)).toBe(true);
    }
  });

  it.each(OFF_BUCKET)('a token read back as $readAs on a $type column is not representable — the Source tab', ({ stored }) => {
    const alone = conditionToGroup(stored, FIELDS);
    expect(alone.representable, JSON.stringify(stored)).toBe(false);
    expect(alone.group.conditions).toEqual([]);
    expect(conditionToGroup(beside(stored), FIELDS).representable, `${JSON.stringify(stored)} beside a row`).toBe(false);
  });

  it('CONTROL: `$in` on a select column, which its bucket offers, still opens as `in` and round-trips byte-identical', () => {
    const stored = { region: { $in: ['NA', 'EU'] } };
    expect(offeredBy('select')).toContain('in');
    const { group, representable } = conditionToGroup(stored, FIELDS);
    expect(representable).toBe(true);
    expect(group.conditions).toEqual([{ id: 'c0', field: 'region', operator: 'in', value: ['NA', 'EU'] }]);
    expect(groupToCondition(group)).toEqual(stored);
    expect(editStage(conditionToGroup(beside(stored), FIELDS).group, 'lost'))
      .toEqual({ $and: [{ stage: { $eq: 'lost' } }, stored] });
  });

  it('CONTROL: the value-less tokens on a column whose bucket offers them still open', () => {
    for (const stored of [{ name: { $empty: false } }, { closed_at: { $null: false } }, { region: { $empty: true } }]) {
      const { group, representable } = conditionToGroup(stored, FIELDS);
      expect(representable, JSON.stringify(stored)).toBe(true);
      expect(groupToCondition(group)).toEqual(stored);
    }
  });

  it('a column listed WITHOUT a type, or not listed at all, is judged against the text bucket the builder draws for it', () => {
    // The builder draws `operatorsForFieldType(field?.type)` for every row, so
    // both get the text bucket: the rule objectui#10062 set for `$between`,
    // now for every token.
    expect(offeredBy(undefined)).toEqual(offeredBy('text'));
    expect(conditionToGroup({ f: { $in: ['a'] } }, [{ value: 'f' }]).representable).toBe(false);
    expect(conditionToGroup({ ghost: { $in: ['a'] } }, FIELDS).representable).toBe(false);
    // CONTROL: a token the text bucket offers stays opened there.
    expect(conditionToGroup({ ghost: { $contains: 'a' } }, FIELDS).representable).toBe(true);
  });

  it('no field list at all: the field-less spec-shape read is unchanged', () => {
    // No caller that draws a panel reads without a field list; this is the
    // pure spec-shape read the field-less round-trip pins rely on.
    for (const { stored, readAs } of OFF_BUCKET) {
      const { group, representable } = conditionToGroup(stored);
      expect(representable, JSON.stringify(stored)).toBe(true);
      expect(group.conditions[0].operator).toBe(readAs);
      expect(groupToCondition(group)).toEqual(stored);
    }
  });
});

/**
 * The two classes stated as ONE property over the whole read domain: every row
 * the read half opens is a row the panel can draw (its operator is in the
 * column's bucket) and the write half keeps byte-identical when a SIBLING row
 * is edited. A fix for one class that missed the other, or missed a token, is
 * named here by the read that breaks it.
 */
describe('the invariant, swept: every row the read half opens, the panel draws and a sibling edit keeps', () => {
  const TYPES = [
    'text', 'number', 'currency', 'percent', 'rating', 'date', 'datetime', 'time',
    'boolean', 'select', 'status', 'lookup', 'master_detail', 'user',
  ] as const;

  const SCALARS: readonly unknown[] = ['x', 0, false, '2026-01-01', '', null];
  const LISTS: readonly unknown[] = [['a'], [1, 2], []];
  const PAIRS: readonly unknown[] = [['2026-01-01', '2026-03-31'], ['2026-01-01', ''], []];

  /** Every per-field stored value this sweep reads: each token with its arity's probes, plus implicit equality. */
  const SHAPES: ReadonlyArray<{ stored: unknown; implicit: boolean }> = [
    ...['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$contains', '$notContains', '$startsWith', '$endsWith']
      .flatMap((t) => SCALARS.map((v) => ({ stored: { [t]: v }, implicit: false }))),
    ...['$in', '$nin'].flatMap((t) => LISTS.map((v) => ({ stored: { [t]: v }, implicit: false }))),
    ...PAIRS.map((v) => ({ stored: { $between: v }, implicit: false })),
    // `$empty` is what the empty pair writes since objectui#10813; `$exists`,
    // what it wrote before, stays in the domain — it is now REFUSED (no
    // operator this inspector offers reads it back), which the invariant
    // accepts, and a read that still opened it would be named by the
    // byte-identical check below.
    ...[true, false].flatMap((b) => [
      { stored: { $empty: b }, implicit: false },
      { stored: { $exists: b }, implicit: false },
      { stored: { $null: b }, implicit: false },
    ]),
    ...[...SCALARS, ...LISTS].map((v) => ({ stored: v, implicit: true })),
  ];

  it('holds for every column type and stored shape, and both answers occur', () => {
    const broken: string[] = [];
    let opened = 0;
    let refused = 0;
    for (const type of TYPES) {
      const fields: BuilderFieldDef[] = [{ value: 'stage', type: 'text' }, { value: 'f', type }];
      const bucket = offeredBy(type);
      for (const { stored, implicit } of SHAPES) {
        const { group, representable } = conditionToGroup(beside({ f: stored } as FilterCondition), fields);
        if (!representable) { refused++; continue; }
        opened++;
        const where = `${type} / ${JSON.stringify(stored)}`;
        const row = group.conditions.find((c) => c.field === 'f');
        if (!row || !bucket.includes(row.operator)) broken.push(`${where} -> read as ${String(row?.operator)}, not in the bucket`);
        // Implicit equality is written back in its `$eq` spelling, which is
        // the same predicate; every `$`-token must come back byte-identical.
        const kept = implicit ? { $eq: stored } : stored;
        const after = editStage(group, 'lost');
        const expected = { $and: [{ stage: { $eq: 'lost' } }, { f: kept }] };
        if (JSON.stringify(after) !== JSON.stringify(expected)) {
          broken.push(`${where} -> a sibling edit committed ${JSON.stringify(after)}`);
        }
      }
    }
    expect(broken).toEqual([]);
    // Denominators, so a read that refused everything, or opened everything,
    // cannot pass as a clean sweep.
    expect(opened).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(100);
  });

  it('CONTROL: every row the dropdown can BUILD, finished, still reopens as itself and writes back byte-identical', () => {
    /** A value each operator's row is finished with. */
    const finished = (operator: string): unknown => {
      if (VALUELESS_FILTER_BUILDER_OPERATORS.has(operator)) return '';
      if (operator === 'between') return ['2026-01-01', '2026-03-31'];
      if (operator === 'in' || operator === 'not_in') return ['a'];
      return '2026-01-01';
    };
    const lost: string[] = [];
    let checked = 0;
    for (const type of TYPES) {
      const fields: BuilderFieldDef[] = [{ value: 'f', type }];
      for (const operator of offeredBy(type)) {
        const stored = groupToCondition({ id: 'g', logic: 'and', conditions: [{ id: 'c1', field: 'f', operator, value: finished(operator) }] });
        const { group, representable } = conditionToGroup(stored, fields);
        checked++;
        if (!representable) { lost.push(`${type}/${operator} -> Source tab`); continue; }
        if (group.conditions[0]?.operator !== operator) lost.push(`${type}/${operator} -> ${String(group.conditions[0]?.operator)}`);
        if (JSON.stringify(groupToCondition(group)) !== JSON.stringify(stored)) lost.push(`${type}/${operator} -> rewritten`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(lost).toEqual([]);
  });
});

describe('the real inspector: the builder is never drawn for a row it cannot hold', () => {
  const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };
  const draftWith = (filter: unknown) => ({
    name: 'sales', label: 'Sales', object: 'opportunity', include: [], dimensions: [], measures: [], filter,
  });

  it.each([
    { what: 'the card: an incomplete `$eq` beside a finished row', filter: beside({ name: { $eq: '' } }) },
    { what: 'the card: an empty `$in` beside a finished row', filter: beside({ region: { $in: [] } }) },
    { what: 'the addendum: `$in` on a date column', filter: { closed_at: { $in: ['2026-01-01', '2026-02-01'] } } },
  ])('$what shows the Source-tab note and no filter trigger', ({ filter }) => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} draft={draftWith(filter)} onPatch={onPatch} readOnly={false} />);
    expect(screen.getByText(/Advanced filter/)).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ conditions?$/)).toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('CONTROL: `$in` on a select column opens the builder, its operator drawn as "In", nothing written back', () => {
    const onPatch = vi.fn();
    render(<DatasetDefaultInspector {...baseProps} draft={draftWith({ region: { $in: ['NA'] } })} onPatch={onPatch} readOnly={false} />);
    expect(screen.queryByText(/Advanced filter/)).toBeNull();
    fireEvent.click(screen.getByText('1 condition'));
    expect(screen.getAllByRole('combobox').some((el) => el.textContent === 'In')).toBe(true);
    expect(onPatch).not.toHaveBeenCalled();
  });
});
