// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25778] `DatasetMeasureSchema.duration` — a measure over the time between two
 * `datetime` columns of the same record (`{ from, to, unit }`), reduced by the
 * measure's `aggregate`.
 *
 * What parses: two bare column names of the dataset's own object, a
 * fixed-length unit, and one of the four aggregates that read a number. What is
 * refused, each with the slot it names: a relationship path, an expression or
 * the row wildcard in either column (ADR-0021: no raw SQL or expressions), a
 * unit outside the four, the same column twice, a `field` / `derived` /
 * `currency` beside it, and an aggregate that is missing or counts. The key is
 * optional: a measure without it parses exactly as before.
 */

import { describe, it, expect } from 'vitest';
import {
  DATASET_DURATION_AGGREGATES,
  DATASET_DURATION_FIELD_TYPE,
  DATASET_DURATION_UNIT_SECONDS,
  DatasetDurationUnit,
  DatasetMeasureSchema,
  DatasetSchema,
} from './dataset.zod';

const DURATION = { from: 'opened_at', to: 'resolved_at', unit: 'hours' } as const;
const measure = (extra: Record<string, unknown> = {}) => ({ name: 'avg_hours', aggregate: 'avg', duration: DURATION, ...extra });

const issuesOf = (value: unknown) => {
  const parsed = DatasetMeasureSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
};

describe('[#25778] DatasetMeasureSchema.duration', () => {
  it('accepts each of the four aggregates in each unit, and keeps the value', () => {
    for (const aggregate of DATASET_DURATION_AGGREGATES) {
      for (const unit of DatasetDurationUnit.options) {
        const parsed = DatasetMeasureSchema.safeParse(measure({ aggregate, duration: { ...DURATION, unit } }));
        expect(parsed.success, `${aggregate} ${unit}`).toBe(true);
        expect(parsed.data?.duration).toEqual({ ...DURATION, unit });
      }
    }
  });

  it('a measure-scoped filter and a format ride beside it', () => {
    expect(issuesOf(measure({ filter: { priority: 'high' }, format: '0.0' }))).toEqual([]);
  });

  it('the constants every consumer reads: the units in seconds, the aggregates, the one field type', () => {
    expect(DATASET_DURATION_UNIT_SECONDS).toEqual({ seconds: 1, minutes: 60, hours: 3600, days: 86400 });
    expect(Object.isFrozen(DATASET_DURATION_UNIT_SECONDS)).toBe(true);
    expect(Object.keys(DATASET_DURATION_UNIT_SECONDS)).toEqual(DatasetDurationUnit.options);
    expect([...DATASET_DURATION_AGGREGATES]).toEqual(['avg', 'min', 'max', 'sum']);
    expect(DATASET_DURATION_FIELD_TYPE).toBe('datetime');
  });

  it.each([
    ['a relationship path', 'account.created_at'],
    ['an expression', 'resolved_at - opened_at'],
    ['raw SQL', "julianday('now')"],
    ['the row wildcard', '*'],
    ['an empty string', ''],
    ['a padded name', ' opened_at'],
  ])('refuses %s in a column, naming the slot', (_label, column) => {
    const found = issuesOf(measure({ duration: { ...DURATION, from: column } }));
    expect(found).toHaveLength(1);
    expect(found[0].path).toBe('duration.from');
    expect(found[0].message).toContain('a duration reads two columns of the SAME record');
    expect(found[0].message).toContain('ADR-0021');
  });

  it('refuses a unit with no one length in seconds', () => {
    for (const unit of ['weeks', 'months', 'years', 'ms']) {
      expect(issuesOf(measure({ duration: { ...DURATION, unit } })).map((i) => i.path), unit).toEqual(['duration.unit']);
    }
  });

  it('refuses the same column twice', () => {
    const found = issuesOf(measure({ duration: { ...DURATION, to: 'opened_at' } }));
    expect(found).toEqual([{ path: 'duration.to', message: expect.stringContaining('every record\'s duration is zero') }]);
  });

  it.each([
    ['a `field`', { field: 'resolved_at' }, 'field', 'it takes no `field`'],
    ['`derived`', { derived: { op: 'ratio', of: ['a', 'b'] } }, 'derived', 'never both'],
    ['`currency`', { currency: 'USD' }, 'currency', 'not an amount of money'],
  ])('refuses %s beside it', (_label, extra, path, words) => {
    const found = issuesOf(measure(extra));
    expect(found.map((i) => i.path)).toContain(path);
    expect(found.find((i) => i.path === path)?.message).toContain(words);
  });

  it('refuses a missing aggregate, and one that counts', () => {
    expect(issuesOf({ name: 'avg_hours', duration: DURATION })).toEqual([
      { path: 'aggregate', message: expect.stringContaining('a duration measure needs `aggregate`') },
    ]);
    for (const aggregate of ['count', 'count_distinct']) {
      expect(issuesOf(measure({ aggregate })), aggregate).toEqual([
        { path: 'aggregate', message: expect.stringContaining('declare a `count` measure') },
      ]);
    }
  });

  it('refuses an unknown key inside it, and maps the near spellings onto the real ones', () => {
    expect(issuesOf(measure({ duration: { ...DURATION, bucket: 'month' } })).map((i) => i.path)).toEqual(['duration']);
    const parsed = DatasetMeasureSchema.safeParse(measure({ duration: { start: 'opened_at', end: 'resolved_at', unit: 'hours' } }));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.message).join('\n')).toMatch(/`from`[\s\S]*`to`|`to`[\s\S]*`from`/);
  });

  it('a measure without it parses exactly as before', () => {
    expect(issuesOf({ name: 'total', aggregate: 'sum', field: 'amount' })).toEqual([]);
    expect(DatasetMeasureSchema.parse({ name: 'tickets', aggregate: 'count' }).duration).toBeUndefined();
  });

  it('a dataset accepts a duration measure with no `field`, and a derived measure over it', () => {
    const parsed = DatasetSchema.safeParse({
      name: 'resolution',
      label: 'Resolution',
      object: 'ticket',
      dimensions: [{ name: 'category', field: 'category', type: 'string' }],
      measures: [
        { name: 'tickets', aggregate: 'count' },
        measure({ aggregate: 'sum', duration: { ...DURATION, unit: 'seconds' }, name: 'total_seconds' }),
        { name: 'seconds_per_ticket', derived: { op: 'ratio', of: ['total_seconds', 'tickets'] } },
      ],
    });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
