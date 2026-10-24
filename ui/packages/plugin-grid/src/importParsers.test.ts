/**
 * ObjectUI – Copyright (c) 2024-present ObjectStack Inc.
 * Licensed under MIT.
 */
import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import {
  parseDelimited, parseCSV, parseExcelArrayBuffer, parseClipboardTable,
  inferColumnType, isTypeCompatible, ImportParseError, parseSpreadsheetFile,
  suggestColumnMappings, scoreToConfidence, type MappableField,
} from './importParsers';

describe('parseDelimited', () => {
  it('parses CSV with quotes, escaped quotes and embedded commas/newlines', () => {
    const csv = 'name,note\n"Doe, John","say ""hi""\nthere"\nJane,plain';
    expect(parseCSV(csv)).toEqual([
      ['name', 'note'],
      ['Doe, John', 'say "hi"\nthere'],
      ['Jane', 'plain'],
    ]);
  });

  it('parses TSV when given a tab delimiter', () => {
    expect(parseDelimited('a\tb\n1\t2', '\t')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('drops all-empty rows', () => {
    expect(parseDelimited('a,b\n,\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('inferColumnType', () => {
  it('detects numbers (years stay numeric)', () => {
    expect(inferColumnType(['1', '2.5', '-3', '2020'])).toBe('number');
  });
  it('treats pure 0/1 columns as numbers, not booleans', () => {
    expect(inferColumnType(['0', '1', '1', '0'])).toBe('number');
  });
  it('detects booleans from words', () => {
    expect(inferColumnType(['true', 'false', 'yes', '否'])).toBe('boolean');
  });
  it('detects dates and datetimes', () => {
    expect(inferColumnType(['2024-01-01', '2024-12-31'])).toBe('date');
    expect(inferColumnType(['2024-01-01T08:30', '2024-12-31 09:00'])).toBe('datetime');
  });
  it('falls back to text for mixed or empty columns', () => {
    expect(inferColumnType(['1', 'abc', '2024-01-01'])).toBe('text');
    expect(inferColumnType(['', '  ', undefined])).toBe('text');
  });
  it('ignores blanks when all remaining values agree', () => {
    expect(inferColumnType(['10', '', '20'])).toBe('number');
  });
});

// `Date.parse` reads `Phase 2` as 2001-02-01, so a text column whose values end
// in a number used to infer as a date and draw a "Looks like Date" hint.
describe('inferColumnType: text ending in a number is not a date (objectui#11813)', () => {
  const TEXT_ENDING_IN_A_NUMBER = ['Phase 2', 'Building 7', 'Room 12', 'Imported QA task 1'];
  // Same defect, other shapes: a word whose first letters spell a month, a
  // month word beside other words, a code, a version.
  const OTHER_TEXT_DATE_PARSE_ACCEPTS = ['Marketing 2026', 'Room 101, Oct', 'A-12', 'task-1', '1.2.3'];

  it.each([...TEXT_ENDING_IN_A_NUMBER, ...OTHER_TEXT_DATE_PARSE_ACCEPTS])('infers %j as text', (value) => {
    expect(inferColumnType([value])).toBe('text');
  });

  it('infers whole columns of such values as text', () => {
    expect(inferColumnType(TEXT_ENDING_IN_A_NUMBER)).toBe('text');
    expect(inferColumnType(['Imported QA task 1', 'Imported QA task 2'])).toBe('text');
  });

  // A soft name match onto a text field is halved for a column inferred as a
  // date, which drops `Task title` → `title` below the auto-apply threshold.
  it('feeds text, not date, to the mapping suggestion for such a column', () => {
    const [title] = suggestColumnMappings(
      ['Task title'],
      [{ name: 'title', label: 'Title', type: 'text' }],
      [['Imported QA task 1'], ['Imported QA task 2']],
    );
    expect(title.inferredType).toBe('text');
    expect(title.fieldName).toBe('title');
  });

  // Control: real dates keep their inference.
  it.each([
    ['2026-10-07', 'date'],
    ['2026/10/07', 'date'],
    ['2026-10', 'date'],
    ['10/07/2026', 'date'],
    ['7.10.2026', 'date'],
    ['10/7/26', 'date'],
    ['Oct 7, 2026', 'date'],
    ['7 October 2026', 'date'],
    ['7-Oct-2026', 'date'],
    ['Tuesday, October 7, 2026', 'date'],
    ['2026-10-07T12:00:00Z', 'datetime'],
    ['2024-03-14T08:30:00.000Z', 'datetime'],
    ['2026-10-07 12:00:00 GMT+0800', 'datetime'],
    ['10/07/2026 2:30 PM', 'datetime'],
    ['Wed, 07 Oct 2026 12:00:00 GMT', 'datetime'],
  ])('still infers %j as %s', (value, type) => {
    expect(inferColumnType([value])).toBe(type);
  });

  it('still infers a column of real dates as date', () => {
    expect(inferColumnType(['2026-10-07', '10/07/2026', '7.10.2026', 'Oct 7, 2026', '7 October 2026'])).toBe('date');
  });
});

describe('isTypeCompatible', () => {
  it('maps numeric inference to number/currency/percent', () => {
    expect(isTypeCompatible('number', 'currency')).toBe(true);
    expect(isTypeCompatible('number', 'text')).toBe(false);
  });
  it('treats text as compatible with anything', () => {
    expect(isTypeCompatible('text', 'date')).toBe(true);
  });
  it('matches dates against date/datetime fields only', () => {
    expect(isTypeCompatible('date', 'datetime')).toBe(true);
    expect(isTypeCompatible('datetime', 'number')).toBe(false);
  });
});

describe('parseClipboardTable', () => {
  it('parses an HTML table (Excel/Sheets clipboard)', () => {
    const html = '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>';
    expect(parseClipboardTable(html, null)).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('falls back to TSV plain text', () => {
    expect(parseClipboardTable(null, 'a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('returns null when there is no tabular payload', () => {
    expect(parseClipboardTable(null, '')).toBeNull();
    expect(parseClipboardTable(null, null)).toBeNull();
  });
});

describe('parseExcelArrayBuffer', () => {
  it('reads the first sheet into a string grid, formatting dates & numbers', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['name', 'amount', 'when']);
    ws.addRow(['Alice', 100, new Date(Date.UTC(2024, 2, 14))]);
    ws.addRow(['Bob', 42.5, new Date(Date.UTC(2024, 0, 1))]);
    const buf = await wb.xlsx.writeBuffer();

    const grid = await parseExcelArrayBuffer(buf as ArrayBuffer);
    expect(grid[0]).toEqual(['name', 'amount', 'when']);
    expect(grid[1]).toEqual(['Alice', '100', '2024-03-14']);
    expect(grid[2]).toEqual(['Bob', '42.5', '2024-01-01']);
  });
});

describe('parseSpreadsheetFile', () => {
  const makeFile = (name: string, body: BlobPart) => new File([body], name);

  it('rejects legacy .xls with a dedicated code', async () => {
    await expect(parseSpreadsheetFile(makeFile('old.xls', 'x'))).rejects.toThrow(ImportParseError.LegacyXls);
  });
  it('rejects unknown extensions', async () => {
    await expect(parseSpreadsheetFile(makeFile('data.pdf', 'x'))).rejects.toThrow(ImportParseError.Unsupported);
  });
  it('parses a .csv file', async () => {
    const grid = await parseSpreadsheetFile(makeFile('data.csv', 'a,b\n1,2'));
    expect(grid).toEqual([['a', 'b'], ['1', '2']]);
  });

  // Encoding sniffing (#185): zh-CN Excel's "save as CSV" writes GBK, which a
  // plain UTF-8 read turns into unmappable mojibake headers.
  it('decodes a GBK/GB18030 .csv (zh-CN Excel default) via fallback', async () => {
    // '名称 *,编号 *\n测试岛2,TEST-001' encoded as GBK
    const gbk = new Uint8Array([
      0xc3, 0xfb, 0xb3, 0xc6, 0x20, 0x2a, 0x2c, 0xb1, 0xe0, 0xba, 0xc5, 0x20, 0x2a, 0x0a,
      0xb2, 0xe2, 0xca, 0xd4, 0xb5, 0xba, 0x32, 0x2c, 0x54, 0x45, 0x53, 0x54, 0x2d, 0x30, 0x30, 0x31,
    ]);
    const grid = await parseSpreadsheetFile(makeFile('data.csv', gbk));
    expect(grid).toEqual([['名称 *', '编号 *'], ['测试岛2', 'TEST-001']]);
  });

  it('keeps plain UTF-8 Chinese without a BOM intact', async () => {
    const grid = await parseSpreadsheetFile(makeFile('data.csv', '名称,城市\n张三,北京'));
    expect(grid).toEqual([['名称', '城市'], ['张三', '北京']]);
  });

  it('strips a UTF-8 BOM (our own downloaded template round-trips)', async () => {
    const grid = await parseSpreadsheetFile(makeFile('data.csv', '﻿a,b\n1,2'));
    expect(grid).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('decodes UTF-16 LE with a BOM', async () => {
    // 'name,城市\n1,北京' encoded as UTF-16 LE with BOM
    const utf16 = new Uint8Array([
      0xff, 0xfe, 0x6e, 0x00, 0x61, 0x00, 0x6d, 0x00, 0x65, 0x00, 0x2c, 0x00,
      0xce, 0x57, 0x02, 0x5e, 0x0a, 0x00, 0x31, 0x00, 0x2c, 0x00, 0x17, 0x53, 0xac, 0x4e,
    ]);
    const grid = await parseSpreadsheetFile(makeFile('data.csv', utf16));
    expect(grid).toEqual([['name', '城市'], ['1', '北京']]);
  });
});

describe('suggestColumnMappings', () => {
  const FIELDS: MappableField[] = [
    { name: 'full_name', label: '姓名', type: 'text' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: '手机', type: 'text' },
    { name: 'amount', label: '金额', type: 'currency' },
    { name: 'active', label: '启用', type: 'boolean' },
    { name: 'due_date', label: '截止日期', type: 'date' },
  ];
  const byCol = (s: ReturnType<typeof suggestColumnMappings>) =>
    Object.fromEntries(s.map((x) => [x.columnIndex, x.fieldName]));

  it('matches exact and normalized header names with high confidence', () => {
    const s = suggestColumnMappings(['Full Name', 'email'], FIELDS);
    expect(s[0]).toMatchObject({ fieldName: 'full_name', confidence: 'high' });
    expect(s[1]).toMatchObject({ fieldName: 'email', reason: 'exact', confidence: 'high' });
  });

  it('resolves bilingual synonyms (邮箱→email, 电话→phone)', () => {
    const s = suggestColumnMappings(['邮箱', '电话'], FIELDS);
    expect(byCol(s)).toMatchObject({ 0: 'email', 1: 'phone' });
    expect(s[0].reason).toBe('synonym');
  });

  it('assigns each field to at most one column (global greedy)', () => {
    // Two columns both look like email; only the better one wins the field.
    const s = suggestColumnMappings(['email', 'e-mail address'], FIELDS,
      [['a@x.com', 'b@x.com']]);
    const assigned = s.map((x) => x.fieldName).filter(Boolean);
    expect(assigned).toContain('email');
    expect(new Set(assigned).size).toBe(assigned.length); // no dup field
  });

  it('uses content type to gate a fuzzy match (numeric column → currency)', () => {
    const s = suggestColumnMappings(['金额'], FIELDS, [['1200'], ['3400']]);
    expect(s[0]).toMatchObject({ fieldName: 'amount' });
    expect(s[0].inferredType).toBe('number');
  });

  it('discounts a name match when the content type is incompatible', () => {
    // Header rhymes with a boolean field, but the sampled data is text → no confident map.
    const s = suggestColumnMappings(['active'], [{ name: 'active', label: 'Active', type: 'boolean' }],
      [['some free text'], ['more prose here']]);
    // exact name still wins (exact matches aren't type-gated)…
    expect(s[0].fieldName).toBe('active');
    // …but a merely-fuzzy header with bad type stays unmapped:
    const s2 = suggestColumnMappings(['is_it_on'], [{ name: 'active', label: 'Active', type: 'boolean' }],
      [['free text'], ['prose']]);
    expect(s2[0].fieldName).toBeNull();
  });

  it('leaves an unknown column unmapped', () => {
    const s = suggestColumnMappings(['xyzzy_42'], FIELDS);
    expect(s[0]).toMatchObject({ fieldName: null, confidence: null, reason: 'none' });
  });

  it('scoreToConfidence buckets by threshold', () => {
    expect(scoreToConfidence(1)).toBe('high');
    expect(scoreToConfidence(0.6)).toBe('medium');
    expect(scoreToConfidence(0.3)).toBe('low');
    expect(scoreToConfidence(0)).toBeNull();
  });
});
