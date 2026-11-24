import { describe, it, expect } from 'vitest';
import {
  buildTimesheetRows,
  dateFieldValue,
  dayKeyOf,
  parseCellInput,
  planCellWrite,
  resolveTimesheetConfig,
  rowValuesComplete,
  startOfWeek,
  weekDays,
  weekQueryBounds,
  type TimesheetBinding,
} from '../timesheetModel';

const binding: TimesheetBinding = { rowFields: ['project', 'task'], dateField: 'work_date', valueField: 'hours' };
const days = weekDays('2026-11-16');

describe('resolveTimesheetConfig', () => {
  it('reads a complete block', () => {
    expect(resolveTimesheetConfig({ rowFields: ['project'], dateField: 'd', valueField: 'v' })).toEqual({
      rowFields: ['project'],
      dateField: 'd',
      valueField: 'v',
    });
  });

  it.each([
    ['no block', undefined],
    ['no row fields', { rowFields: [], dateField: 'd', valueField: 'v' }],
    ['four row fields', { rowFields: ['a', 'b', 'c', 'd'], dateField: 'd', valueField: 'v' }],
    ['no date field', { rowFields: ['a'], valueField: 'v' }],
    ['no value field', { rowFields: ['a'], dateField: 'd' }],
    ['an empty row field name', { rowFields: [''], dateField: 'd', valueField: 'v' }],
  ])('refuses %s', (_label, block) => {
    expect(resolveTimesheetConfig(block)).toBeNull();
  });
});

describe('week arithmetic', () => {
  it('starts the week on the locale first day', () => {
    // Wednesday 18 November 2026.
    const wed = new Date(2026, 10, 18);
    expect(startOfWeek(wed, 1)).toBe('2026-11-16');
    expect(startOfWeek(wed, 0)).toBe('2026-11-15');
    expect(startOfWeek(wed, 6)).toBe('2026-11-14');
  });

  it('lists seven consecutive days across a month end', () => {
    expect(weekDays('2026-11-30')).toEqual([
      '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06',
    ]);
  });

  it('places a date-only value on its own day and an instant on the local day', () => {
    expect(dayKeyOf('2026-11-17')).toBe('2026-11-17');
    const local = new Date(2026, 10, 17, 23, 30);
    expect(dayKeyOf(local.toISOString())).toBe('2026-11-17');
    expect(dayKeyOf(null)).toBeNull();
    expect(dayKeyOf('not a date')).toBeNull();
  });

  it('writes a date-time day at local noon', () => {
    expect(dateFieldValue('2026-11-17')).toBe('2026-11-17');
    expect(dayKeyOf(dateFieldValue('2026-11-17', 'datetime'))).toBe('2026-11-17');
  });
});

describe('week query bounds, in the suite zone', () => {
  // The off-UTC cases are in `timesheet.dateTimeZone-34382.test.ts`, driven on
  // the forks pool by `scripts/__tests__/date-only-zone-pins-10183.test.ts`.
  it('bounds a date field by the day keys and a date-time field by instants', () => {
    expect(weekQueryBounds('2026-11-16', '2026-11-23', 'date')).toEqual(['2026-11-16', '2026-11-23']);
    expect(weekQueryBounds('2026-11-16', '2026-11-23')).toEqual(['2026-11-16', '2026-11-23']);
    expect(weekQueryBounds('2026-11-16', '2026-11-23', 'datetime')).toEqual([
      new Date(2026, 10, 16).toISOString(),
      new Date(2026, 10, 23).toISOString(),
    ]);
  });
});

describe('buildTimesheetRows', () => {
  const records = [
    { id: 'r1', project: { id: 'p1', name: 'Apollo' }, task: 'Design', work_date: '2026-11-16', hours: 2 },
    { id: 'r2', project: 'p1', task: 'Design', work_date: '2026-11-17', hours: 3.5 },
    { id: 'r3', project: 'p2', task: 'Build', work_date: '2026-11-17', hours: 1 },
    { id: 'r4', project: 'p2', task: 'Build', work_date: '2026-11-17', hours: 4 },
    { id: 'r5', project: 'p2', task: 'Build', work_date: '2026-11-23', hours: 8 },
  ];

  it('keys a row by its row field values, an expanded lookup by its id', () => {
    const grid = buildTimesheetRows(records, binding, days);
    expect(grid.rows).toHaveLength(2);
    const [apollo, build] = grid.rows;
    expect(apollo.cells['2026-11-16'].sum).toBe(2);
    expect(apollo.cells['2026-11-17'].sum).toBe(3.5);
    expect(apollo.total).toBe(5.5);
    expect(build.cells['2026-11-17'].records).toHaveLength(2);
    expect(build.cells['2026-11-17'].sum).toBe(5);
  });

  it('leaves out records outside the week and sums day and week totals', () => {
    const grid = buildTimesheetRows(records, binding, days);
    expect(grid.dayTotals['2026-11-16']).toBe(2);
    expect(grid.dayTotals['2026-11-17']).toBe(8.5);
    expect(grid.dayTotals['2026-11-22']).toBe(0);
    expect(grid.weekTotal).toBe(10.5);
  });

  it('appends added rows that no record made yet', () => {
    const grid = buildTimesheetRows(records, binding, days, [
      { project: 'p1', task: 'Design' },
      { project: 'p3', task: 'Test' },
    ]);
    expect(grid.rows).toHaveLength(3);
    expect(grid.rows[2].values).toEqual({ project: 'p3', task: 'Test' });
    expect(grid.rows[2].total).toBe(0);
  });
});

describe('planCellWrite', () => {
  const row = { values: { project: { id: 'p1', name: 'Apollo' }, task: 'Design' } };
  const empty = { records: [], sum: 0 };
  const one = { records: [{ id: 'r1', hours: 2 }], sum: 2 };
  const two = { records: [{ id: 'r1', hours: 2 }, { id: 'r2', hours: 1 }], sum: 3 };

  it('creates a record carrying the row values, the day and the value', () => {
    expect(planCellWrite(binding, row, '2026-11-18', empty, 4)).toEqual({
      kind: 'create',
      data: { project: 'p1', task: 'Design', work_date: '2026-11-18', hours: 4 },
    });
  });

  it('writes nothing when an empty cell stays empty', () => {
    expect(planCellWrite(binding, row, '2026-11-18', empty, null)).toEqual({ kind: 'none' });
  });

  it('updates a one-record cell and deletes it when cleared', () => {
    expect(planCellWrite(binding, row, '2026-11-18', one, 6)).toEqual({ kind: 'update', id: 'r1', data: { hours: 6 } });
    expect(planCellWrite(binding, row, '2026-11-18', one, 2)).toEqual({ kind: 'none' });
    expect(planCellWrite(binding, row, '2026-11-18', one, null)).toEqual({ kind: 'delete', id: 'r1' });
  });

  it('never writes a cell holding several records', () => {
    expect(planCellWrite(binding, row, '2026-11-18', two, 9)).toEqual({ kind: 'readonly' });
    expect(planCellWrite(binding, row, '2026-11-18', two, null)).toEqual({ kind: 'readonly' });
  });
});

describe('parseCellInput and rowValuesComplete', () => {
  it('parses numbers, clears on empty, refuses text', () => {
    expect(parseCellInput(' 7.5 ', 'en')).toBe(7.5);
    expect(parseCellInput('-2', 'en')).toBe(-2);
    expect(parseCellInput('', 'en')).toBeNull();
    expect(parseCellInput('abc', 'en')).toBe('invalid');
    // Number() would take these; a typed hour never means them.
    expect(parseCellInput('0x10', 'en')).toBe('invalid');
    expect(parseCellInput('1e3', 'en')).toBe('invalid');
  });

  it('reads the ungrouped display back in its own locale', () => {
    expect(parseCellInput('1234.5', 'en')).toBe(1234.5);
    expect(parseCellInput('1234,5', 'de')).toBe(1234.5);
  });

  it("en: a comma groups thousands, so `1,000` is a thousand, never one (#34382 L2 S2)", () => {
    expect(parseCellInput('1,000', 'en')).toBe(1000);
    expect(parseCellInput('1,234', 'en')).toBe(1234);
    expect(parseCellInput('1,234.5', 'en')).toBe(1234.5);
    expect(parseCellInput('12,345,678', 'en')).toBe(12345678);
    // A comma that is not between whole groups of three is refused, not read as a decimal.
    expect(parseCellInput('1,5', 'en')).toBe('invalid');
    expect(parseCellInput('1,234,5', 'en')).toBe('invalid');
    expect(parseCellInput('1.2.3', 'en')).toBe('invalid');
  });

  it('de: a comma is the decimal and a dot groups thousands, so `1.000` is a thousand', () => {
    expect(parseCellInput('1,5', 'de')).toBe(1.5);
    expect(parseCellInput('1.000', 'de')).toBe(1000);
    expect(parseCellInput('1.234', 'de')).toBe(1234);
    expect(parseCellInput('1.234,5', 'de')).toBe(1234.5);
    expect(parseCellInput('1,000', 'de')).toBe(1);
    expect(parseCellInput('7.5', 'de')).toBe('invalid');
    expect(parseCellInput('1,2,3', 'de')).toBe('invalid');
  });

  it('a locale that groups with a space takes a space there; a locale with its own decimal mark reads Latin input', () => {
    expect(parseCellInput('1 234,5', 'fr')).toBe(1234.5);
    expect(parseCellInput('1\u202f234,5', 'fr')).toBe(1234.5);
    expect(parseCellInput('7.5', 'ar-EG')).toBe(7.5);
  });

  it('requires every row field', () => {
    expect(rowValuesComplete({ project: 'p1', task: 'x' }, binding.rowFields)).toBe(true);
    expect(rowValuesComplete({ project: 'p1', task: '' }, binding.rowFields)).toBe(false);
    expect(rowValuesComplete({ project: 'p1' }, binding.rowFields)).toBe(false);
  });
});
