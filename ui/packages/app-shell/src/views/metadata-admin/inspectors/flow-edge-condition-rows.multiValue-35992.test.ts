// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35992 — a flow edge's rows on a LIST-valued column (a `select` /
 * `lookup` / `user` declared `multiple: true`, or a `multiselect`).
 *
 * The guard is CEL, evaluated by `@objectstack/formula`'s `celEngine`. On a
 * list, `S == V` compares the whole list with one value (false for every
 * record), `S.contains(V)` faults ("no matching overload"), and `V in S` is
 * membership. So the rows offer what the shared builder offers such a column
 * (`operatorsForField`, which reads `jsonColumnFilterOperators`) and write
 * `contains` / `not_contains` as membership; the engine's own answer is pinned
 * beside each spelling, and a single-value column of the same type keeps its
 * equality spelling.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { jsonColumnFilterOperators, operatorsForField } from '@object-ui/components';
import { celToRows, rowsToCel, type EdgeConditionField, type EdgeConditionGroup, type EdgeConditionRow } from './flow-edge-condition-rows.js';

const FIELDS: EdgeConditionField[] = [
  { value: 'record.attendees', label: 'Attendees', type: 'user', multiple: true },
  { value: 'record.accounts', label: 'Accounts', type: 'lookup', multiple: true },
  { value: 'record.regions', label: 'Regions', type: 'select', multiple: true, options: [{ value: 'emea', label: 'EMEA' }] },
  { value: 'record.labels', label: 'Labels', type: 'multiselect' },
  { value: 'record.owner', label: 'Owner', type: 'user' },
  { value: 'record.region', label: 'Region', type: 'select' },
];

const group = (logic: 'and' | 'or', ...conditions: EdgeConditionRow[]): EdgeConditionGroup => ({
  logic,
  conditions: conditions.map((c, i) => ({ id: `edge-row-${i}`, ...c })),
});

const write = (g: EdgeConditionGroup): string => {
  const out = rowsToCel(g, FIELDS);
  if (!out.ok) throw new Error(`refused ${out.refused.join(',')}`);
  return out.cel;
};

const evaluate = (cel: string, record: Record<string, unknown>) => {
  const r = celEngine.evaluate({ dialect: 'cel', source: cel }, { record });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

const LIST_COLUMNS = FIELDS.filter((f) => f.multiple === true || f.type === 'multiselect');

describe('a list-valued column is offered what the shared builder offers it (objectstack#35992)', () => {
  it.each(LIST_COLUMNS)('$label takes the helper’s set, and every other operator is refused', (field) => {
    const offered = operatorsForField({ type: field.type, multiple: field.multiple === true }).map((o) => o.value);
    expect(offered).toEqual([...jsonColumnFilterOperators({ type: field.type, multiple: field.multiple === true })!]);
    for (const operator of ['equals', 'not_equals', 'in', 'not_in']) {
      const value = operator.endsWith('in') ? ['x'] : 'x';
      expect(rowsToCel(group('and', { field: field.value, operator, value }), FIELDS), operator)
        .toEqual({ ok: false, refused: ['edge-row-0'] });
    }
  });
});

describe('membership on a list writes `V in S`, and the engine answers it as membership', () => {
  it.each(LIST_COLUMNS)('$label: contains / does not contain', (field) => {
    const s = field.value;
    const name = s.slice('record.'.length);
    const contains = group('and', { field: s, operator: 'contains', value: 'u1' });
    const notContains = group('and', { field: s, operator: 'not_contains', value: 'u1' });

    expect(write(contains)).toBe(`${s} != null && 'u1' in ${s}`);
    expect(write(notContains)).toBe(`${s} == null || !('u1' in ${s})`);
    expect(celToRows(write(contains), FIELDS)).toEqual(contains);
    expect(celToRows(write(notContains), FIELDS)).toEqual(notContains);

    expect(evaluate(write(contains), { [name]: ['u1', 'u2'] })).toBe(true);
    expect(evaluate(write(contains), { [name]: ['u2'] })).toBe(false);
    expect(evaluate(write(contains), { [name]: null })).toBe(false);
    expect(evaluate(write(notContains), { [name]: ['u2'] })).toBe(true);
    expect(evaluate(write(notContains), { [name]: ['u1'] })).toBe(false);
    expect(evaluate(write(notContains), { [name]: null })).toBe(true);
  });

  it('two membership rows joined by OR are any-of', () => {
    const cel = write(group('or',
      { field: 'record.labels', operator: 'contains', value: 'frontend' },
      { field: 'record.labels', operator: 'contains', value: 'backend' }));
    expect(cel).toBe("(record.labels != null && 'frontend' in record.labels) || (record.labels != null && 'backend' in record.labels)");
    expect(evaluate(cel, { labels: ['backend'] })).toBe(true);
    expect(evaluate(cel, { labels: ['qa'] })).toBe(false);
  });

  it('the control: the equality spelling this replaces is false for a record that holds the member', () => {
    expect(evaluate("record.attendees == 'u1'", { attendees: ['u1'] })).toBe(false);
  });
});

describe('a single-value column of the same type keeps its spellings', () => {
  it('user / select equals still write equality, and contains is not offered there', () => {
    expect(write(group('and', { field: 'record.owner', operator: 'equals', value: 'u1' }))).toBe("record.owner == 'u1'");
    expect(write(group('and', { field: 'record.region', operator: 'in', value: ['emea'] }))).toBe("record.region in ['emea']");
    expect(rowsToCel(group('and', { field: 'record.owner', operator: 'contains', value: 'u1' }), FIELDS))
      .toEqual({ ok: false, refused: ['edge-row-0'] });
  });

  it('a membership guard on a single-value column stays in the formula input', () => {
    expect(celToRows("record.owner != null && 'u1' in record.owner", FIELDS)).toBeNull();
  });
});
