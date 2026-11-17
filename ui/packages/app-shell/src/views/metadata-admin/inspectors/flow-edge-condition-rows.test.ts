// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34818 item 3 — the edge guard's rows bridge, pinned both ways:
 *
 *  - every row the builder offers writes one CEL spelling, the formula
 *    engine evaluates that spelling as the row means, and the spelling reads
 *    back into the same row;
 *  - every OTHER stored guard reads back as `null` (the inspector keeps it in
 *    the formula input, unchanged), including near misses of the writer's own
 *    spellings.
 */

import { describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';
import { celToRows, rowsToCel, type EdgeConditionField, type EdgeConditionGroup, type EdgeConditionRow } from './flow-edge-condition-rows.js';

const FIELDS: EdgeConditionField[] = [
  { value: 'record.meeting_date', label: 'Meeting date', type: 'date' },
  { value: 'record.starts_at', label: 'Starts at', type: 'datetime' },
  { value: 'record.title', label: 'Title', type: 'text' },
  { value: 'record.attendees', label: 'Attendees', type: 'number' },
  { value: 'record.is_online', label: 'Online', type: 'boolean' },
  { value: 'record.status', label: 'Status', type: 'select', options: [{ value: 'draft', label: 'Draft' }, { value: 'done', label: 'Done' }] },
  { value: 'record.tags', label: 'Tags', type: 'select', multiple: true },
  { value: 'record.owner', label: 'Owner', type: 'lookup' },
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

const isoDay = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const evaluate = (cel: string, record: Record<string, unknown>) => {
  const r = celEngine.evaluate({ dialect: 'cel', source: cel }, { record });
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
};

describe('rows → CEL → rows (objectstack#34818 item 3)', () => {
  const cases: Array<[string, EdgeConditionGroup, string]> = [
    ['date after today', group('and', { field: 'record.meeting_date', operator: 'after', value: '{today}' }),
      'record.meeting_date != null && record.meeting_date > today()'],
    ['date before a day', group('and', { field: 'record.meeting_date', operator: 'before', value: '2026-12-01' }),
      "record.meeting_date != null && record.meeting_date < '2026-12-01'"],
    ['date between', group('and', { field: 'record.meeting_date', operator: 'between', value: ['2026-01-01', '{tomorrow}'] }),
      "record.meeting_date != null && record.meeting_date >= '2026-01-01' && record.meeting_date <= daysFromNow(1)"],
    ['datetime after yesterday', group('and', { field: 'record.starts_at', operator: 'after', value: '{yesterday}' }),
      'record.starts_at != null && record.starts_at > daysAgo(1)'],
    ['number ≥', group('and', { field: 'record.attendees', operator: 'greater_than_or_equal', value: 10 }),
      'record.attendees != null && record.attendees >= 10'],
    ['text equals with a quote', group('and', { field: 'record.title', operator: 'equals', value: "Bob's sync" }),
      "record.title == 'Bob\\'s sync'"],
    ['text contains', group('and', { field: 'record.title', operator: 'contains', value: 'weekly' }),
      "record.title != null && record.title.contains('weekly')"],
    ['text does not contain', group('and', { field: 'record.title', operator: 'not_contains', value: 'draft' }),
      "record.title == null || !record.title.contains('draft')"],
    ['text is empty', group('and', { field: 'record.title', operator: 'is_empty' }),
      "record.title == null || record.title == ''"],
    ['date is empty', group('and', { field: 'record.meeting_date', operator: 'is_empty' }), 'record.meeting_date == null'],
    ['text is not null', group('and', { field: 'record.title', operator: 'is_not_null' }), 'record.title != null'],
    ['multi-value is not empty', group('and', { field: 'record.tags', operator: 'is_not_empty' }),
      'record.tags != null && size(record.tags) != 0'],
    ['boolean', group('and', { field: 'record.is_online', operator: 'equals', value: true }), 'record.is_online == true'],
    ['select in', group('and', { field: 'record.status', operator: 'in', value: ['draft', 'done'] }),
      "record.status in ['draft', 'done']"],
    ['select not in', group('and', { field: 'record.status', operator: 'not_in', value: ['done'] }), "!(record.status in ['done'])"],
    ['lookup not equals', group('and', { field: 'record.owner', operator: 'not_equals', value: 'usr_1' }), "record.owner != 'usr_1'"],
    ['two rows, AND', group('and',
      { field: 'record.meeting_date', operator: 'after', value: '{today}' },
      { field: 'record.status', operator: 'equals', value: 'draft' }),
      "(record.meeting_date != null && record.meeting_date > today()) && record.status == 'draft'"],
    ['two rows, OR', group('or',
      { field: 'record.status', operator: 'equals', value: 'done' },
      { field: 'record.title', operator: 'is_empty' }),
      "record.status == 'done' || (record.title == null || record.title == '')"],
  ];

  it.each(cases)('%s', (_name, rows, cel) => {
    expect(write(rows)).toBe(cel);
    expect(celToRows(cel, FIELDS)).toEqual(rows);
  });

  it('no finished row writes an empty guard, and an empty guard reads as no rows', () => {
    expect(write(group('and', { field: '', operator: 'equals', value: '' }))).toBe('');
    expect(write(group('and', { field: 'record.title', operator: 'equals', value: '' }))).toBe('');
    expect(celToRows('', FIELDS)).toEqual({ logic: 'and', conditions: [] });
  });
});

describe('what the rows write is what the engine evaluates', () => {
  it('「会议日期 晚于 今天」 routes a meeting tomorrow and not one yesterday, nor one with no date', () => {
    const cel = write(group('and', { field: 'record.meeting_date', operator: 'after', value: '{today}' }));
    expect(evaluate(cel, { meeting_date: isoDay(1) })).toBe(true);
    expect(evaluate(cel, { meeting_date: isoDay(-1) })).toBe(false);
    expect(evaluate(cel, { meeting_date: null })).toBe(false);
  });

  it('the text and list spellings evaluate on a null value without faulting', () => {
    expect(evaluate(write(group('and', { field: 'record.title', operator: 'contains', value: 'x' })), { title: null })).toBe(false);
    expect(evaluate(write(group('and', { field: 'record.title', operator: 'not_contains', value: 'x' })), { title: null })).toBe(true);
    expect(evaluate(write(group('and', { field: 'record.status', operator: 'in', value: ['draft'] })), { status: 'draft' })).toBe(true);
    expect(evaluate(write(group('and', { field: 'record.tags', operator: 'is_empty' })), { tags: [] })).toBe(true);
  });
});

describe('every other stored guard stays in the formula input', () => {
  it.each([
    // The writer's own shapes, near misses.
    ['an unguarded ordering', 'record.meeting_date > today()'],
    ['a parenthesised single row', "(record.status == 'done')"],
    ['an unparenthesised compound row beside another', "record.title == null || record.title == '' || record.status == 'done'"],
    ['a parenthesised simple row beside another', "(record.status == 'done') && record.is_online == true"],
    ['double quotes', 'record.status == "done"'],
    ['other spacing', "record.status=='done'"],
    ['a number in quotes on a number column', "record.attendees == '10'"],
    ['a string on a boolean column', "record.is_online == 'true'"],
    ['a date literal on a datetime column', "record.starts_at != null && record.starts_at > '2026-01-01'"],
    ['an empty check that does not match the column', 'record.title == null || size(record.title) == 0'],
    ['mixed joins', "record.status == 'done' && record.is_online == true || record.attendees == 1"],
    // Subjects the rows do not offer.
    ['a flow variable', 'vars.approved == true'],
    ['a prior value', 'previous.status != record.status'],
    ['a bare field', "status == 'done'"],
    ['an unknown column', "record.nope == 'x'"],
    // Anything else.
    ['a literal', 'true'],
    ['a function call', "record.title.matches('^A')"],
    ['arithmetic', 'record.attendees + 1 > 3'],
  ])('%s', (_name, cel) => {
    expect(celToRows(cel, FIELDS)).toBeNull();
  });
});

describe('rows the bridge cannot spell are refused, never re-spelled', () => {
  it.each([
    ['case-insensitive contains', { field: 'record.title', operator: 'icontains', value: 'x' }],
    ['a datetime literal (no zone)', { field: 'record.starts_at', operator: 'after', value: '2026-01-01T09:00' }],
    ['a relative window', { field: 'record.meeting_date', operator: 'between', value: ['{week_start}', '{week_end}'] }],
    ['an operator the column does not offer', { field: 'record.title', operator: 'greater_than', value: 'a' }],
    ['a comparison on a multi-value column', { field: 'record.tags', operator: 'in', value: ['a'] }],
  ])('%s', (_name, row) => {
    expect(rowsToCel(group('and', row as EdgeConditionRow), FIELDS)).toEqual({ ok: false, refused: ['edge-row-0'] });
  });
});
