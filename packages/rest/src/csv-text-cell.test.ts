// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25078] The CSV text-cell rule, pinned at its three readers.
 *
 * The CSV export writes a text cell its consumer would interpret in a form that
 * consumer reads as text, and the CSV import reverses exactly that. The rule is
 * defined once (`csvTextCellNeedsMark` in `./export-format.ts`); this file pins
 *
 *   1. the predicate, as one table, boundary characters included;
 *   2. the writer (`rowsToCsv`), per value, on the metadata path and on the raw
 *      path (empty meta map): which cells it marks, which it leaves
 *      byte-identical, and that a column's DECLARED type decides, never the
 *      value's JS type;
 *   3. the CSV parse (`parseCsvToRows`), which removes exactly one mark from a
 *      cell whose remainder the rule would have marked, header row included.
 *
 * The round trip through each import door that parses CSV is pinned in
 * `csv-text-cell-round-trip.test.ts` (sync, async job, named mapping) and in
 * plugin-auth's `admin-import-users.test.ts` (admin user import).
 *
 * Control characters are written as escapes in this file, never as raw bytes.
 */

import { describe, it, expect } from 'vitest';
import {
  CSV_TEXT_CELL_MARK,
  csvTextCellNeedsMark,
  markCsvTextCell,
  unmarkCsvTextCell,
  isCsvTextColumn,
  type ExportFieldMeta,
} from './export-format';
import { rowsToCsv } from './rest-server';
import { parseCsvToRows } from './import-prepare';

/** Values the rule marks: a plain word after each trigger character. */
const MARKED = ['=Total', '+Name', '-Note', '@acme', '\tTotal', '\rTotal'];

/** Ordinary business values the rule leaves byte-identical. */
const UNMARKED_BUSINESS = ['+86 138 0013 8000', '+1 555 010 0000', '-120.50', 'Acme Ltd', '120.50'];

describe('csvTextCellNeedsMark — the one predicate (#25078)', () => {
  // [text, marked?, why]
  const TABLE: Array<[string, boolean, string]> = [
    // ── the six trigger characters, each before a plain word ──
    ['=Total', true, 'leads with = and holds a letter'],
    ['+Name', true, 'leads with + and holds a letter'],
    ['-Note', true, 'leads with - and holds a letter'],
    ['@acme', true, 'leads with @ and holds a letter'],
    ['\tTotal', true, 'leads with TAB'],
    ['\rTotal', true, 'leads with CR'],
    // ── a trigger character alone: = @ TAB CR are themselves outside the set ──
    ['=', true, '= is outside the numeric-text set'],
    ['@', true, '@ is outside the numeric-text set'],
    ['\t', true, 'TAB is outside the numeric-text set'],
    ['\r', true, 'CR is outside the numeric-text set'],
    ['+', false, '+ alone is all numeric-text characters'],
    ['-', false, '- alone is all numeric-text characters'],
    // ── second half: every character of the numeric-text set, after + and - ──
    ['+0', false, 'digit 0'], ['+9', false, 'digit 9'], ['+ ', false, 'space'],
    ['++', false, 'plus'], ['+-', false, 'minus'], ['+(', false, 'open paren'],
    ['+)', false, 'close paren'], ['+.', false, 'dot'], ['+,', false, 'comma'],
    ['-0', false, 'digit 0'], ['-9', false, 'digit 9'], ['- ', false, 'space'],
    ['-+', false, 'plus'], ['--', false, 'minus'], ['-(', false, 'open paren'],
    ['-)', false, 'close paren'], ['-.', false, 'dot'], ['-,', false, 'comma'],
    // ── second half: one character outside the set anywhere marks the cell ──
    ['+A', true, 'a capital letter'], ['-z', true, 'a small letter'],
    ['+86 138 0013 8000 ext', true, 'a phone number followed by a word'],
    ['-120.50 net', true, 'an amount followed by a word'],
    ['+中文', true, 'a non-ASCII letter'],
    // ── ordinary business values: unmarked ──
    ['+86 138 0013 8000', false, 'a phone number'],
    ['+1 555 010 0000', false, 'a phone number'],
    ['+1 (555) 010-0000', false, 'a phone number with parentheses'],
    ['-120.50', false, 'a signed amount'],
    ['-1,200.50', false, 'a signed amount with a group separator'],
    ['Acme Ltd', false, 'a name'],
    ['120.50', false, 'an unsigned amount'],
    ['', false, 'the empty cell'],
    // ── first character: the code-point neighbours of each trigger ──
    ['<Total', false, 'U+003C, before ='], ['>Total', false, 'U+003E, after ='],
    ['*Name', false, 'U+002A, before +'], [',Name', false, 'U+002C, after + and before -'],
    ['.Note', false, 'U+002E, after -'],
    ['?acme', false, 'U+003F, before @'], ['Aacme', false, 'U+0041, after @'],
    ['\bTotal', false, 'U+0008, before TAB'], ['\nTotal', false, 'U+000A, after TAB'],
    ['\fTotal', false, 'U+000C, before CR'], ['\u000eTotal', false, 'U+000E, after CR'],
    [' =Total', false, 'a leading space is not a trigger'],
    ["'Quoted", false, 'the mark itself is not a trigger'],
  ];

  it.each(TABLE)('%j → %s (%s)', (text, marked) => {
    expect(csvTextCellNeedsMark(text)).toBe(marked);
  });

  it('marks with exactly one U+0027', () => {
    expect(CSV_TEXT_CELL_MARK).toBe(String.fromCharCode(0x27));
    for (const [text, marked] of TABLE) {
      expect(markCsvTextCell(text)).toBe(marked ? `'${text}` : text);
    }
  });

  it('the parse half reverses the writer half for every value in the table', () => {
    for (const [text] of TABLE) {
      expect(unmarkCsvTextCell(markCsvTextCell(text))).toBe(text);
    }
  });
});

describe('isCsvTextColumn — decided by the declared type (#25078)', () => {
  it.each([
    'number', 'currency', 'percent', 'rating', 'slider', 'progress', 'summary',
    'boolean', 'toggle', 'date', 'datetime',
  ])('a %s column is not a text column', (type) => {
    expect(isCsvTextColumn({ name: 'f', type })).toBe(false);
  });

  it.each([
    'text', 'textarea', 'email', 'url', 'phone', 'select', 'multiselect', 'lookup',
    'master_detail', 'user', 'formula', 'autonumber', 'time', 'json',
  ])('a %s column is a text column', (type) => {
    expect(isCsvTextColumn({ name: 'f', type })).toBe(true);
  });

  it('a column with no metadata, or no declared type, is a text column', () => {
    expect(isCsvTextColumn(undefined)).toBe(true);
    expect(isCsvTextColumn({ name: 'f' })).toBe(true);
  });
});

/** The CSV writer's cells for one data row, header row dropped, split on the line ending. */
function dataLines(csv: string): string[] {
  return csv.split('\r\n').slice(1, -1);
}

describe('rowsToCsv — the writer table, metadata path (#25078)', () => {
  const META = new Map<string, ExportFieldMeta>([
    ['id', { name: 'id', type: 'text', label: 'ID' }],
    ['body', { name: 'body', type: 'text', label: 'Body' }],
  ]);

  it.each(MARKED)('a text cell %j is written with one leading mark', (value) => {
    const csv = rowsToCsv(['id', 'body'], [{ id: '1', body: value }], true, META);
    const expected = value.startsWith('\r') ? `1,"'${value}"` : `1,'${value}`;
    expect(dataLines(csv)).toEqual([expected]);
  });

  it.each(UNMARKED_BUSINESS)('a text cell %j is byte-identical', (value) => {
    const csv = rowsToCsv(['id', 'body'], [{ id: '1', body: value }], true, META);
    expect(dataLines(csv)).toEqual([`1,${value}`]);
  });

  it('marks BEFORE RFC-4180 quoting: the quote wraps the mark', () => {
    const csv = rowsToCsv(['id', 'body'], [{ id: '1', body: '-Note, later' }], true, META);
    expect(dataLines(csv)).toEqual([`1,"'-Note, later"`]);
  });

  it('a number / currency / percent field holding -120.5 stays numeric and unprefixed', () => {
    const meta = new Map<string, ExportFieldMeta>([
      ['n', { name: 'n', type: 'number', label: 'N' }],
      ['c', { name: 'c', type: 'currency', label: 'C' }],
      ['p', { name: 'p', type: 'percent', label: 'P' }],
    ]);
    const csv = rowsToCsv(['n', 'c', 'p'], [{ n: -120.5, c: -120.5, p: -120.5 }], true, meta);
    expect(csv).toBe('N,C,P\r\n-120.5,-120.5,-120.5\r\n');
  });

  it('the DECLARED type decides, never the JS type: a string in a numeric, boolean, date or datetime column is never marked', () => {
    const meta = new Map<string, ExportFieldMeta>([
      ['n', { name: 'n', type: 'number', label: 'N' }],
      ['c', { name: 'c', type: 'currency', label: 'C' }],
      ['p', { name: 'p', type: 'percent', label: 'P' }],
      ['b', { name: 'b', type: 'boolean', label: 'B' }],
      ['d', { name: 'd', type: 'date', label: 'D' }],
      ['t', { name: 't', type: 'datetime', label: 'T' }],
    ]);
    const row = { n: '-Note', c: '-Note', p: '-Note', b: '-Note', d: '-Note', t: '-Note' };
    const csv = rowsToCsv(['n', 'c', 'p', 'b', 'd', 't'], [row], true, meta);
    expect(dataLines(csv)).toEqual(['-Note,-Note,-Note,-Note,-Note,-Note']);
  });

  it('a JS number in a text column stays a number', () => {
    const csv = rowsToCsv(['id', 'body'], [{ id: '1', body: -120.5 }], true, META);
    expect(dataLines(csv)).toEqual(['1,-120.5']);
  });

  it('a header label starting with a trigger character is marked', () => {
    const meta = new Map<string, ExportFieldMeta>([
      ['id', { name: 'id', type: 'text', label: 'ID' }],
      ['note', { name: 'note', type: 'number', label: '-Note' }],
      ['tag', { name: 'tag', type: 'text', label: '@acme' }],
    ]);
    const csv = rowsToCsv(['id', 'note', 'tag'], [], true, meta);
    expect(csv).toBe("ID,'-Note,'@acme\r\n");
  });

  it('a reference display title starting with a trigger character is marked', () => {
    const meta = new Map<string, ExportFieldMeta>([
      ['owner', { name: 'owner', type: 'lookup', label: 'Owner', reference: 'account', displayField: 'name' }],
    ]);
    const rows = [
      { owner: { id: 'a1', name: '@acme' } },
      { owner: { id: 'a2', name: 'Acme Ltd' } },
      { owner: [{ id: 'a1', name: '@acme' }, { id: 'a3', name: '+86 138 0013 8000' }] },
    ];
    const csv = rowsToCsv(['owner'], rows, true, meta);
    expect(dataLines(csv)).toEqual(["'@acme", 'Acme Ltd', `"'@acme, +86 138 0013 8000"`]);
  });
});

describe('rowsToCsv — the writer table, raw path (empty meta map) (#25078)', () => {
  const RAW = new Map<string, ExportFieldMeta>();

  it.each(MARKED)('a string cell %j is written with one leading mark', (value) => {
    const csv = rowsToCsv(['id', 'body'], [{ id: '1', body: value }], true, RAW);
    const expected = value.startsWith('\r') ? `1,"'${value}"` : `1,'${value}`;
    expect(dataLines(csv)).toEqual([expected]);
  });

  it.each(UNMARKED_BUSINESS)('a string cell %j is byte-identical', (value) => {
    const csv = rowsToCsv(['id', 'body'], [{ id: '1', body: value }], true, RAW);
    expect(dataLines(csv)).toEqual([`1,${value}`]);
  });

  it('a JS number stays a number', () => {
    const csv = rowsToCsv(['id', 'amount'], [{ id: '1', amount: -120.5 }], true, RAW);
    expect(dataLines(csv)).toEqual(['1,-120.5']);
  });

  it('the header row is the field names, marked by the same rule', () => {
    expect(rowsToCsv(['id', '-note'], [], true, RAW)).toBe("id,'-note\r\n");
  });
});

describe('parseCsvToRows — the import reversal (#25078)', () => {
  it.each(MARKED)('a marked cell %j parses back to the value', (value) => {
    const csv = rowsToCsv(['id', 'body'], [{ id: '1', body: value }], true, new Map());
    expect(parseCsvToRows(csv)).toEqual([{ id: '1', body: value }]);
  });

  it.each(UNMARKED_BUSINESS)('an unmarked cell %j parses unchanged', (value) => {
    expect(parseCsvToRows(`id,body\r\n1,"${value}"\r\n`)).toEqual([{ id: '1', body: value }]);
  });

  it('removes exactly one mark, and only when the remainder satisfies the rule', () => {
    const csv = [
      'id,body',
      "1,'Quoted",
      "2,'+86 138 0013 8000",
      "3,''=Total",
      "4,'-Note",
      "5,'",
    ].join('\r\n');
    expect(parseCsvToRows(csv).map((r) => r.body)).toEqual([
      "'Quoted",
      "'+86 138 0013 8000",
      "''=Total",
      '-Note',
      "'",
    ]);
  });

  it('a user-authored cell that is a mark before a rule-satisfying remainder imports without that mark', () => {
    expect(parseCsvToRows("id,body\r\n1,'@acme\r\n")).toEqual([{ id: '1', body: '@acme' }]);
  });

  it('reverses a marked header BEFORE the mapping lookup, so a mapping names the label as exported', () => {
    const csv = "ID,'-Note\r\n1,'=Total\r\n";
    expect(parseCsvToRows(csv, { ID: 'id', '-Note': 'body' })).toEqual([{ id: '1', body: '=Total' }]);
  });
});
