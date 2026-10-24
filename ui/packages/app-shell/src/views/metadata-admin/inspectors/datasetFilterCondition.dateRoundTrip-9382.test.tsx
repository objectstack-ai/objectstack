// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset filter built with `After` on a date column reads back as an
 * operator that column offers (objectui#9382).
 *
 * ## The defect
 *
 * `OP_TO_MONGO` writes `$gt` for BOTH `greaterThan` and `after`, and the spec's
 * filter vocabulary has one token for "strictly greater" — there is no
 * `$after`. So the stored filter is correct and filters correctly; what the
 * fixed read-back table lost was the LABEL. A `$gt` came back as `greaterThan`,
 * which the date bucket does not list, and Radix draws a blank trigger for a
 * value no mounted item carries.
 *
 * ## DIRECTION, predicted before running
 *
 * On the pre-fix tree:
 *
 *   - `the operator a date column reads back is one it offers` — RED, for
 *     `after` and `before`, on each of `date` / `datetime` / `time`;
 *   - `the panel names the operator the author picked` — RED, trigger is `""`;
 *   - `every pair the dropdown can build survives the round trip` — RED on
 *     exactly those 6 pairs and green on the other 116;
 *   - everything under `controls` and `boundaries the repair must not cross` —
 *     GREEN in both directions, by construction. They are not pins: a suite
 *     built only on them could not fail.
 *
 * ## The control this card's own body insists on
 *
 * `greaterThan` IS a member of the number bucket. That is what makes "the date
 * bucket does not contain it" a reading about DATES rather than a lookup that
 * answers `false` for everything, and it is asserted here rather than assumed.
 * The same guard runs on the identity of the answers: the round trip must yield
 * a NON-EMPTY operator and the bucket must be NON-EMPTY, so the membership test
 * can never pass by comparing two absences.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import {
  FilterBuilder,
  operatorsForFieldType,
  reconcileOperatorForField,
  reshapeFilterValue,
} from '@object-ui/components';
import { groupToCondition, conditionToGroup, type BuilderFieldDef } from './datasetFilterCondition';

// Only the inspector-level pins at the bottom of this file read this: the
// catalog hooks stubbed so `DatasetDefaultInspector` renders without a
// MetadataClient, with one number and one date column for its filter builder.
// Nothing else in this file imports the hooks.
vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({
    relationships: [],
    fieldOptions: [
      { value: 'amount', label: 'Amount', type: 'number' },
      { value: 'closed_at', label: 'Closed at', type: 'date' },
    ],
    loading: false,
  }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { DatasetDefaultInspector } from './DatasetDefaultInspector';

/** Every field type whose bucket the dataset inspector can draw. */
const PROBE_FIELD_TYPES = [
  'text', 'number', 'currency', 'percent', 'rating',
  'date', 'datetime', 'time', 'boolean',
  'select', 'status', 'lookup', 'master_detail', 'user',
] as const;

/** The bucket the dropdown actually lists — no opt-in extras, as the inspector mounts it. */
const offeredBy = (type: string): string[] => operatorsForFieldType(type).map((o) => o.value);

/**
 * A value each operator's row is complete with.
 *
 * `between` carries two DAYS: the builder offers it on the date bucket only,
 * and since objectui#10062 it is stored, so its bounds reach the round trip.
 */
function probeValue(operator: string): unknown {
  if (operator === 'between') return ['2026-01-01', '2026-03-31'];
  if (operator === 'in' || operator === 'not_in') return ['a'];
  return '2026-01-01';
}

/**
 * The whole author gesture, end to end: build the row the way the panel builds
 * it, store what the inspector stores, then reopen it the way the inspector
 * reopens it. Deliberately NOT a lookup in either table — a pin that asserted
 * the mapping directly would pass on a repair that never reached the round trip.
 */
function roundTrip(field: string, operator: string, fields: readonly BuilderFieldDef[]) {
  const built = { id: 'g', logic: 'and' as const, conditions: [{ id: 'c1', field, operator, value: probeValue(operator) }] };
  const stored = groupToCondition(built);
  const { group, representable } = conditionToGroup(stored, fields);
  return { stored, representable, readBack: group.conditions[0]?.operator };
}

const FIELDS: BuilderFieldDef[] = [
  { value: 'closed_at', label: 'Closed at', type: 'date' },
  { value: 'logged_at', label: 'Logged at', type: 'datetime' },
  { value: 'starts_at', label: 'Starts at', type: 'time' },
  { value: 'amount', label: 'Amount', type: 'number' },
];

describe('the operator a date column reads back is one it offers (objectui#9382)', () => {
  it.each([
    { field: 'closed_at', type: 'date', operator: 'after', token: '$gt' },
    { field: 'closed_at', type: 'date', operator: 'before', token: '$lt' },
    { field: 'logged_at', type: 'datetime', operator: 'after', token: '$gt' },
    { field: 'logged_at', type: 'datetime', operator: 'before', token: '$lt' },
    { field: 'starts_at', type: 'time', operator: 'after', token: '$gt' },
    { field: 'starts_at', type: 'time', operator: 'before', token: '$lt' },
  ])('$type column filtered with $operator reopens as $operator', ({ field, type, operator, token }) => {
    const { stored, representable, readBack } = roundTrip(field, operator, FIELDS);

    // The stored bytes are the collapse and stay the collapse — this repair is
    // on the READ half and gives `after` no new token of its own.
    expect(stored).toEqual({ [field]: { [token]: '2026-01-01' } });
    expect(representable).toBe(true);

    // Two absences must not compare equal: the answer has to be a real operator.
    expect(typeof readBack).toBe('string');
    expect(readBack).not.toBe('');

    expect(readBack).toBe(operator);
    expect(offeredBy(type)).toContain(readBack);
  });

  it('every pair the dropdown can build survives the round trip into that same bucket', () => {
    const broken: string[] = [];
    let checked = 0;
    for (const type of PROBE_FIELD_TYPES) {
      const offered = offeredBy(type);
      expect(offered.length, `${type} bucket is empty — the membership test would be vacuous`).toBeGreaterThan(0);
      for (const operator of offered) {
        const fields: BuilderFieldDef[] = [{ value: 'f', type }];
        const { stored, readBack } = roundTrip('f', operator, fields);
        // Every operator a bucket offers is stored now — `between` was the
        // last one skipped here, and objectui#10062 maps it — so a dropped row
        // is a break, not something to step over.
        if (stored === undefined) { broken.push(`${type}/${operator} -> dropped`); continue; }
        checked++;
        if (!readBack || !offered.includes(readBack)) broken.push(`${type}/${operator} -> ${String(readBack)}`);
      }
    }
    // The denominator is asserted too, so a suite that silently stopped
    // building rows could not read as a clean sweep.
    expect(checked).toBeGreaterThan(100);
    expect(broken).toEqual([]);
  });
});

describe('a date range reopens as the range the author built (objectui#10062)', () => {
  it.each([
    { field: 'closed_at', type: 'date' },
    { field: 'logged_at', type: 'datetime' },
    { field: 'starts_at', type: 'time' },
  ])('$type column filtered with between stores $between and reopens as between, bounds intact', ({ field, type }) => {
    const { stored, representable, readBack } = roundTrip(field, 'between', FIELDS);

    expect(stored).toEqual({ [field]: { $between: ['2026-01-01', '2026-03-31'] } });
    expect(representable).toBe(true);
    expect(readBack).toBe('between');
    expect(offeredBy(type)).toContain(readBack);
    // The bounds come back as the pair, in order — not as one bound or a string.
    expect(conditionToGroup(stored, FIELDS).group.conditions[0].value).toEqual(['2026-01-01', '2026-03-31']);
  });

  it('the panel draws the stored range: "Between", both bounds on screen, nothing written back', () => {
    const { group } = conditionToGroup({ closed_at: { $between: ['2026-01-01', '2026-03-31'] } }, FIELDS);
    const onChange = vi.fn();
    render(<FilterBuilder fields={FIELDS as never} value={group as never} onChange={onChange} />);

    expect(screen.getAllByRole('combobox')[1]?.textContent).toBe('Between');
    expect(screen.getByDisplayValue('2026-01-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-03-31')).toBeInTheDocument();
    // A COMPLETE pair: neither bound is marked as the missing one.
    expect(document.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('the panel names the operator the author picked', () => {
  /** What the operator trigger DISPLAYS. Blank is the symptom this card is about. */
  const operatorTriggerText = () => screen.getAllByRole('combobox')[1]?.textContent;

  it.each([
    { operator: 'after', label: 'After' },
    { operator: 'before', label: 'Before' },
  ])('a date filter stored from $operator reopens showing "$label"', ({ operator, label }) => {
    const { group } = conditionToGroup(
      groupToCondition({ id: 'g', logic: 'and', conditions: [{ id: 'c1', field: 'closed_at', operator, value: '2026-01-01' }] }),
      FIELDS,
    );
    const onChange = vi.fn();
    render(<FilterBuilder fields={FIELDS as never} value={group as never} onChange={onChange} />);

    expect(operatorTriggerText()).toBe(label);
    // Reopening a stored filter must not itself write one back.
    expect(onChange).not.toHaveBeenCalled();
    cleanup();
  });
});

describe('controls — these are lit in BOTH directions and are not pins', () => {
  it('greaterThan IS a member of the number bucket', () => {
    // Without this, "the date bucket does not contain greaterThan" could be a
    // lookup that answers false for every word.
    expect(offeredBy('number')).toContain('greater_than');
    expect(offeredBy('date')).not.toContain('greater_than');
    expect(offeredBy('date')).toContain('after');
  });

  it('a number column still round-trips greaterThan / lessThan unchanged', () => {
    expect(roundTrip('amount', 'greater_than', FIELDS).readBack).toBe('greater_than');
    expect(roundTrip('amount', 'less_than', FIELDS).readBack).toBe('less_than');
  });
});

describe('boundaries the repair must not cross', () => {
  it('reads back through the fixed table when no fields are supplied', () => {
    // The pure spec-shape callers pass no field list; they must keep the
    // unchanged default rather than get an invented answer.
    expect(conditionToGroup({ closed_at: { $gt: '2026-01-01' } }).group.conditions[0].operator).toBe('greater_than');
  });

  it('a field not in the list is judged against the text bucket the builder draws for it, not given an invented operator', () => {
    // This leg used to expect `greaterThan` here. `readBackOperator` still
    // gives the fixed-table answer for an unknown type, so nothing is
    // invented. But the builder draws an unlisted column with its default text
    // bucket, which does not offer `greaterThan`, so the row would open under a
    // BLANK operator trigger. objectui#10257 sends it to the Source tab, as
    // objectui#10062 already did for `$between` on the same column.
    expect(offeredBy('text')).not.toContain('greater_than');
    expect(conditionToGroup({ mystery: { $gt: 1 } }, FIELDS).representable).toBe(false);
    // CONTROL: a token the text bucket offers still reads back unchanged there.
    expect(conditionToGroup({ mystery: { $eq: 1 } }, FIELDS).group.conditions[0].operator).toBe('equals');
  });

  it('leaves the unambiguous tokens alone on a date column', () => {
    expect(roundTrip('closed_at', 'equals', FIELDS).readBack).toBe('equals');
    expect(roundTrip('closed_at', 'not_equals', FIELDS).readBack).toBe('not_equals');
    expect(roundTrip('closed_at', 'is_null', FIELDS).readBack).toBe('is_null');
    expect(roundTrip('closed_at', 'is_not_null', FIELDS).readBack).toBe('is_not_null');
    expect(roundTrip('closed_at', 'is_empty', FIELDS).readBack).toBe('is_empty');
    expect(roundTrip('closed_at', 'is_not_empty', FIELDS).readBack).toBe('is_not_empty');
  });

  it('does not widen what the bridge accepts', () => {
    // An operator no bucket writes is still non-representable, and a
    // multi-operator object is still refused.
    expect(conditionToGroup({ f: { $nope: 1 } }, FIELDS).representable).toBe(false);
    expect(conditionToGroup({ f: { $gt: 1, $lt: 9 } }, FIELDS).representable).toBe(false);
  });
});

/**
 * A stored `$between` opens as an editable row ONLY on a column whose bucket
 * offers `between` (objectui#10062, contract review round 2).
 *
 * `$between` has one preimage, so {@link readBackOperator} never consults the
 * bucket for it. Read back on a number column, it would seed the panel with an
 * operator that column's dropdown does not list — a BLANK trigger (the
 * objectui#4768 / #7561 shape) — and one touch of that row's field picker
 * reconciles it to `equals` and reshapes the pair, committing a different
 * filter than the one stored: the objectui#9382 defect. Before objectui#10062
 * every stored `$between` went to the Source tab, so the mapping is what opened
 * this, and the bucket rule is what closes it again.
 *
 * DIRECTION, predicted before running on `83eb57f0` (the mapping without the
 * bucket rule): every leg that expects `representable: false` on a column
 * whose bucket lacks `between` is RED, and so is the inspector pin that
 * expects the Source-tab note; the date control, the field-less read and the
 * `WHY` leg are GREEN in both directions.
 */
describe('a stored `$between` opens as a row only where the column\'s bucket offers `between` (objectui#10062)', () => {
  const RANGE = [1, 100];

  it('a NUMBER column: `{ amount: { $between: [1, 100] } }` is not representable — the Source tab', () => {
    expect(offeredBy('number'), 'the premise: the number bucket does not offer between').not.toContain('between');
    const { group, representable } = conditionToGroup({ amount: { $between: RANGE } }, FIELDS);
    expect(representable).toBe(false);
    expect(group.conditions).toEqual([]);
  });

  it('CONTROL: the same value on a DATE column stays representable and reads back as between', () => {
    const { group, representable } = conditionToGroup({ closed_at: { $between: RANGE } }, FIELDS);
    expect(representable).toBe(true);
    expect(group.conditions[0]).toMatchObject({ field: 'closed_at', operator: 'between', value: RANGE });
  });

  it('every bucket the inspector can draw: representable exactly when that bucket offers `between`', () => {
    const answers = new Set<boolean>();
    for (const type of PROBE_FIELD_TYPES) {
      const offers = offeredBy(type).includes('between');
      answers.add(offers);
      expect(
        conditionToGroup({ f: { $between: RANGE } }, [{ value: 'f', type }]).representable,
        `${type}: bucket ${offers ? 'offers' : 'does not offer'} between`,
      ).toBe(offers);
    }
    // Both answers occur, so the sweep cannot pass as a constant.
    expect([...answers].sort()).toEqual([false, true]);
  });

  it('a column listed WITHOUT a type, or not listed at all, draws the builder\'s default text bucket — not representable', () => {
    // The builder draws `operatorsForFieldType(field?.type)` for every row, so
    // a missing type and a missing column both get the text bucket. That is
    // the bucket the panel WOULD draw, not an unknown one.
    expect(operatorsForFieldType(undefined).map((o) => o.value)).not.toContain('between');
    expect(conditionToGroup({ f: { $between: RANGE } }, [{ value: 'f' }]).representable).toBe(false);
    expect(conditionToGroup({ ghost: { $between: RANGE } }, FIELDS).representable).toBe(false);
  });

  it('no field list at all: the field-less spec-shape read is unchanged', () => {
    // No caller that draws a panel reads without a field list, and this is
    // the pure spec-shape read the round-trip pins rely on.
    expect(conditionToGroup({ amount: { $between: RANGE } }).representable).toBe(true);
  });

  it('WHY: had the panel drawn it, one field-picker touch would store `$eq`, not the range', () => {
    // The builder's own reconciliation, read rather than restated: `between`
    // is not in the number bucket, so it falls to that bucket's first entry,
    // and the pair is reshaped to a scalar.
    const next = reconcileOperatorForField('between', operatorsForFieldType('number'));
    expect(next).toBe('equals');
    expect(reshapeFilterValue(RANGE, next)).toBe(1);
  });

  describe('the real inspector: the builder is never drawn for it', () => {
    const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };
    const draftWith = (filter: unknown) => ({
      name: 'sales', label: 'Sales', object: 'opportunity', include: [], dimensions: [], measures: [], filter,
    });

    it('a number-column `$between` shows the Source-tab note and no filter trigger', () => {
      render(<DatasetDefaultInspector {...baseProps} draft={draftWith({ amount: { $between: RANGE } })} onPatch={vi.fn()} readOnly={false} />);
      expect(screen.getByText(/Advanced filter/)).toBeInTheDocument();
      expect(screen.queryByText('1 condition')).toBeNull();
      cleanup();
    });

    it('CONTROL: a date-column `$between` opens the builder, drawn as "Between" with both bounds', () => {
      const onPatch = vi.fn();
      render(<DatasetDefaultInspector {...baseProps} draft={draftWith({ closed_at: { $between: ['2026-01-01', '2026-03-31'] } })} onPatch={onPatch} readOnly={false} />);
      expect(screen.queryByText(/Advanced filter/)).toBeNull();
      fireEvent.click(screen.getByText('1 condition'));
      expect(screen.getAllByRole('combobox').some((el) => el.textContent === 'Between')).toBe(true);
      expect(screen.getByDisplayValue('2026-01-01')).toBeInTheDocument();
      expect(screen.getByDisplayValue('2026-03-31')).toBeInTheDocument();
      expect(onPatch).not.toHaveBeenCalled();
      cleanup();
    });
  });
});
