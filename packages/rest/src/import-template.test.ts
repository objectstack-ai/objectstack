// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit pins for `import-template.ts` — the column rule of the export door's
 * `?template=true` mode, its request reading, the instructions' claims about
 * the import reader, and the workbook it builds (read back with exceljs).
 *
 * Each row of the column-rule table has ONE test below whose fixture only that
 * row's rule excludes, so removing the rule turns exactly that test red.
 */

import { describe, it, expect } from 'vitest';
import {
  IMPORT_BOOLEAN_FALSE_TOKENS,
  IMPORT_BOOLEAN_TRUE_TOKENS,
} from '@objectstack/spec/data';
import {
  TEMPLATE_COLUMN_EXCLUSIONS,
  TEMPLATE_INAPPLICABLE_PARAMS,
  TEMPLATE_READER_CLAIMS,
  TEMPLATE_VALIDATED_ROWS,
  buildImportTemplateWorkbook,
  columnLetter,
  describeTemplateColumns,
  isTemplateRequired,
  readTemplateMode,
  resolveTemplateProjection,
  templateColumns,
  templateText,
} from './import-template.js';
import {
  coerceFieldValue,
  parseBooleanCell,
  parseDateCell,
  parseNumberCell,
  splitMulti,
} from './import-coerce.js';
import { buildFieldMetaMap } from './export-format.js';
import { loadXlsxWorkbook } from './xlsx-test-loader.js';

/** An object whose one plain field every rule keeps, so each test has a control. */
function objectWith(extra: Record<string, Record<string, unknown>>): { name: string; fields: Record<string, unknown> } {
  return {
    name: 'proj',
    fields: {
      title: { name: 'title', type: 'text', label: 'Title' },
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { name: k, ...v }])),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The column rule — one test per row of the table
// ─────────────────────────────────────────────────────────────────────────────

describe('templateColumns — the column rule, row by row', () => {
  it('declares the four exclusion rows, in the table\'s order', () => {
    expect(TEMPLATE_COLUMN_EXCLUSIONS.map((r) => r.id)).toEqual(['system', 'readonly', 'computed', 'autonumber']);
  });

  it('starting point: every schema field is a candidate (a plain field of each kind is kept)', () => {
    const schema = objectWith({
      amount: { type: 'number' },
      done: { type: 'boolean' },
      stage: { type: 'select', options: [{ label: 'Open', value: 'open' }] },
      due: { type: 'date' },
      account: { type: 'lookup', reference: 'account' },
    });
    expect(templateColumns(schema)).toEqual(['title', 'amount', 'done', 'stage', 'due', 'account']);
  });

  it('system: a `system: true` field is excluded', () => {
    expect(templateColumns(objectWith({ owner_id: { type: 'lookup', reference: 'sys_user', system: true } })))
      .toEqual(['title']);
  });

  it('hidden: a writable `hidden: true` field is KEPT — the import stores it', () => {
    expect(templateColumns(objectWith({ secret_note: { type: 'text', hidden: true } }))).toEqual(['title', 'secret_note']);
    // …and a hidden field that is also readonly stays out, by the readonly row.
    expect(templateColumns(objectWith({ org: { type: 'text', hidden: true, readonly: true } }))).toEqual(['title']);
  });

  it('readonly: a `readonly: true` field is excluded', () => {
    expect(templateColumns(objectWith({ approval_status: { type: 'text', readonly: true } }))).toEqual(['title']);
  });

  it('formula / summary: both computed types are excluded', () => {
    expect(templateColumns(objectWith({
      doubled: { type: 'formula', expression: 'amount * 2' },
      total: { type: 'summary', summaryOperations: { object: 'line', field: 'qty', function: 'sum' } },
    }))).toEqual(['title']);
  });

  it('autonumber: an autonumber field is excluded', () => {
    expect(templateColumns(objectWith({ code: { type: 'autonumber', autonumberFormat: 'P-{0000}' } }))).toEqual(['title']);
  });

  it('FLS: only the fields the caller\'s projection admits are columns — both sides', () => {
    const schema = objectWith({ salary: { type: 'number' }, notes: { type: 'text' } });
    const cols = templateColumns(schema, { permitted: new Set(['title', 'notes']) });
    expect(cols).not.toContain('salary');
    expect(cols).toEqual(['title', 'notes']);
    // No projection (no field-level security composed) narrows nothing.
    expect(templateColumns(schema)).toEqual(['title', 'salary', 'notes']);
  });

  it('?fields=: an explicit list is honoured verbatim — no rule and no projection narrows it', () => {
    const schema = objectWith({ code: { type: 'autonumber' }, salary: { type: 'number' } });
    expect(templateColumns(schema, { explicitFields: ['code', 'salary'], permitted: new Set(['title']) }))
      .toEqual(['code', 'salary']);
  });

  it('column order: the author\'s declaration order, a required field NOT moved forward', () => {
    const schema = objectWith({
      b_field: { type: 'text' },
      a_required: { type: 'text', required: true },
      c_field: { type: 'text' },
    });
    expect(templateColumns(schema)).toEqual(['title', 'b_field', 'a_required', 'c_field']);
  });

  it('reads the array `fields` shape too, by each entry\'s own name', () => {
    const schema = { fields: [{ name: 'a', type: 'text' }, { name: 'b', type: 'text', readonly: true }, { name: 'c', type: 'number' }] };
    expect(templateColumns(schema)).toEqual(['a', 'c']);
  });
});

describe('resolveTemplateProjection — the write projection, and the stated fallback', () => {
  const ctx = { userId: 'u1' };

  it('asks getWritableFields first, and does not consult the read projection when it answers', async () => {
    let readAsked = false;
    const answer = await resolveTemplateProjection({
      getWritableFields: async () => ['title'],
      getReadableFields: async () => { readAsked = true; return ['title', 'locked']; },
    }, 'proj', ctx);
    expect(answer).toEqual({ source: 'writable', permitted: new Set(['title']) });
    expect(readAsked).toBe(false);
  });

  it('a service without getWritableFields: the read projection, marked `readable` so the response states it', async () => {
    const answer = await resolveTemplateProjection({ getReadableFields: async () => ['title', 'locked'] }, 'proj', ctx);
    expect(answer).toEqual({ source: 'readable', permitted: new Set(['title', 'locked']) });
  });

  it('a write projection that gives no answer falls back the same way', async () => {
    const answer = await resolveTemplateProjection({
      getWritableFields: async () => undefined,
      getReadableFields: async () => ['title'],
    }, 'proj', ctx);
    expect(answer.source).toBe('readable');
  });

  it('`[]` from getWritableFields is a real answer — nothing writable — never a fallback', async () => {
    const answer = await resolveTemplateProjection({
      getWritableFields: async () => [],
      getReadableFields: async () => ['title'],
    }, 'proj', ctx);
    expect(answer).toEqual({ source: 'writable', permitted: new Set() });
  });

  it('no security service: no projection applies; a service that answers neither: unanswered', async () => {
    expect(await resolveTemplateProjection(undefined, 'proj', ctx)).toEqual({ source: 'none' });
    expect(await resolveTemplateProjection({ getReadableFields: async () => undefined }, 'proj', ctx))
      .toEqual({ source: 'unanswered' });
    expect(await resolveTemplateProjection({}, 'proj', ctx)).toEqual({ source: 'unanswered' });
  });
});

describe('isTemplateRequired — the `*` mark', () => {
  it('marks a required field with no default', () => {
    expect(isTemplateRequired({ required: true })).toBe(true);
  });
  it('does NOT mark a required field that declares a default — the engine fills it', () => {
    expect(isTemplateRequired({ required: true, defaultValue: 'standard' })).toBe(false);
  });
  it('does not mark an optional field', () => {
    expect(isTemplateRequired({ required: false })).toBe(false);
    expect(isTemplateRequired({})).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reading the request
// ─────────────────────────────────────────────────────────────────────────────

describe('readTemplateMode', () => {
  it('absent or false is the export; true (any case) is the template', () => {
    expect(readTemplateMode({})).toEqual({ kind: 'export' });
    expect(readTemplateMode({ template: 'false' })).toEqual({ kind: 'export' });
    expect(readTemplateMode({ template: 'FALSE' })).toEqual({ kind: 'export' });
    expect(readTemplateMode({ template: 'true' })).toEqual({ kind: 'template' });
    expect(readTemplateMode({ template: 'True', format: 'xlsx', fields: 'a,b', locale: 'zh-CN' })).toEqual({ kind: 'template' });
  });

  it('any other value is refused, never read as false', () => {
    for (const value of ['yes', '1', '', 'template', ['true']]) {
      const read = readTemplateMode({ template: value });
      expect(read.kind, JSON.stringify(value)).toBe('refused');
      expect(read.kind === 'refused' && read.message).toContain('"template" query parameter takes true or false');
    }
  });

  it('a row parameter on a template request is refused, and every one present is named', () => {
    for (const name of TEMPLATE_INAPPLICABLE_PARAMS) {
      const read = readTemplateMode({ template: 'true', [name]: 'x' });
      expect(read.kind, name).toBe('refused');
      expect(read.kind === 'refused' && read.message).toContain(`"${name}"`);
    }
    const two = readTemplateMode({ template: 'true', limit: '5', filter: '{}' });
    expect(two.kind === 'refused' && two.message).toContain('"limit", "filter"');
  });

  it('a non-xlsx format on a template request is refused', () => {
    const read = readTemplateMode({ template: 'true', format: 'csv' });
    expect(read.kind).toBe('refused');
    expect(read.kind === 'refused' && read.message).toContain('format "csv"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the instructions say is what the reader does
// ─────────────────────────────────────────────────────────────────────────────

describe('TEMPLATE_READER_CLAIMS — every quoted spelling, through the real reader', () => {
  const n = TEMPLATE_READER_CLAIMS.number;

  it('numbers: thousands groups, the decimal point, currency, percent and parentheses read as claimed', () => {
    for (const [cell, value] of n.thousands) expect(parseNumberCell(cell), cell).toBe(value);
    expect(parseNumberCell(n.decimalPoint[0])).toBe(n.decimalPoint[1]);
    for (const sym of n.currencySymbols) expect(parseNumberCell(`${sym}25`), sym).toBe(25);
    expect(parseNumberCell(n.percent[0])).toBe(n.percent[1]);
    expect(parseNumberCell(n.negative[0])).toBe(n.negative[1]);
  });

  it('numbers: the decimal comma is refused, as the text says', () => {
    expect(parseNumberCell(n.decimalCommaRefused)).toBeUndefined();
  });

  it('dates: the accepted spellings read as claimed, the refused ones are refused', () => {
    for (const [cell, day] of TEMPLATE_READER_CLAIMS.date.accepted) expect(parseDateCell(cell, 'date'), cell).toBe(day);
    for (const cell of TEMPLATE_READER_CLAIMS.date.refused) expect(parseDateCell(cell, 'date'), cell).toBeUndefined();
  });

  it('datetimes: the zone-naive spellings are read, the offset one as written', () => {
    for (const cell of TEMPLATE_READER_CLAIMS.datetime.naive) {
      expect(parseDateCell(cell, 'datetime', 'Asia/Shanghai'), cell).toBeDefined();
    }
    const [cell, instant] = TEMPLATE_READER_CLAIMS.datetime.offset;
    expect(parseDateCell(cell, 'datetime', 'America/New_York')).toBe(instant);
    // Zone-naive is read in the business timezone, UTC when none is set.
    expect(parseDateCell(TEMPLATE_READER_CLAIMS.datetime.naive[0], 'datetime')).toBe('2026-01-31T09:30:00.000Z');
    expect(parseDateCell(TEMPLATE_READER_CLAIMS.datetime.naive[0], 'datetime', 'Asia/Shanghai')).toBe('2026-01-31T01:30:00.000Z');
  });

  it('times: both spellings read as claimed', () => {
    for (const [cell, time] of TEMPLATE_READER_CLAIMS.time.accepted) expect(parseDateCell(cell, 'time'), cell).toBe(time);
  });

  it('multi-value cells: every named separator, and a line break, splits', () => {
    for (const sep of TEMPLATE_READER_CLAIMS.multiSeparators) expect(splitMulti(`a${sep}b`), sep).toEqual(['a', 'b']);
    expect(splitMulti('a\nb')).toEqual(['a', 'b']);
  });

  it('booleans: every token the text lists is one the reader takes, on the side it is listed', () => {
    for (const t of IMPORT_BOOLEAN_TRUE_TOKENS) expect(parseBooleanCell(t), t).toBe(true);
    for (const f of IMPORT_BOOLEAN_FALSE_TOKENS) expect(parseBooleanCell(f), f).toBe(false);
    for (const locale of ['en', 'zh-CN']) {
      const [yes, no] = templateText(locale).booleanWords;
      expect(parseBooleanCell(yes)).toBe(true);
      expect(parseBooleanCell(no)).toBe(false);
    }
  });

  it('the number and boolean sentences are BUILT from those claims — no spelling is typed twice', () => {
    for (const locale of ['en', 'zh-CN']) {
      const text = templateText(locale);
      for (const [cell] of n.thousands) expect(text.number).toContain(cell);
      expect(text.number).toContain(n.decimalCommaRefused);
      expect(text.number).toContain(n.percent[0]);
      expect(text.number).toContain(n.negative[0]);
      const sentence = text.boolean([...IMPORT_BOOLEAN_TRUE_TOKENS].join(' '), [...IMPORT_BOOLEAN_FALSE_TOKENS].join(' '));
      for (const t of [...IMPORT_BOOLEAN_TRUE_TOKENS, ...IMPORT_BOOLEAN_FALSE_TOKENS]) expect(sentence).toContain(t);
      for (const [cell] of TEMPLATE_READER_CLAIMS.date.accepted) expect(text.date).toContain(cell);
      for (const cell of TEMPLATE_READER_CLAIMS.date.refused) expect(text.date).toContain(cell);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Describing columns: headers, examples, dropdowns
// ─────────────────────────────────────────────────────────────────────────────

const KITCHEN_SINK = {
  name: 'deal',
  label: 'Deal',
  fields: {
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    tier: {
      name: 'tier', type: 'select', label: 'Tier', required: true, defaultValue: 'standard',
      options: [{ label: 'Standard', value: 'standard' }, { label: 'Gold', value: 'gold' }],
    },
    amount: { name: 'amount', type: 'currency', label: 'Amount', min: 5, max: 100 },
    won: { name: 'won', type: 'boolean', label: 'Won' },
    tags: {
      name: 'tags', type: 'multiselect', label: 'Tags',
      options: [{ label: 'Hot', value: 'hot' }, { label: 'New', value: 'new' }, { label: 'VIP', value: 'vip' }],
    },
    close_date: { name: 'close_date', type: 'date', label: 'Close date' },
    call_at: { name: 'call_at', type: 'datetime', label: 'Call at' },
    slot: { name: 'slot', type: 'time', label: 'Slot' },
    account: { name: 'account', type: 'lookup', label: 'Account', reference: 'account' },
    watchers: { name: 'watchers', type: 'lookup', label: 'Watchers', reference: 'sys_user', multiple: true },
  },
};

describe('describeTemplateColumns', () => {
  const fields = templateColumns(KITCHEN_SINK);
  const cols = describeTemplateColumns(KITCHEN_SINK, fields, {
    locale: 'en',
    referenceLabels: new Map([['account', 'Account'], ['sys_user', 'User']]),
  });
  const byField = new Map(cols.map((c) => [c.field, c]));

  it('headers are the labels, `*` only on a required field with no default', () => {
    expect(cols.map((c) => c.header)).toEqual([
      'Name *', 'Tier', 'Amount', 'Won', 'Tags', 'Close date', 'Call at', 'Slot', 'Account', 'Watchers',
    ]);
  });

  it('closed single-valued domains carry a dropdown; multi-valued and open ones do not', () => {
    expect(byField.get('tier')?.dropdown).toEqual(['Standard', 'Gold']);
    expect(byField.get('won')?.dropdown).toEqual(['yes', 'no']);
    expect(byField.get('tags')?.dropdown).toBeUndefined();
    expect(byField.get('name')?.dropdown).toBeUndefined();
    expect(byField.get('account')?.dropdown).toBeUndefined();
  });

  it('a radio field carries the same dropdown a select does; a select flagged multiple does not', () => {
    const schema = {
      fields: {
        size: { name: 'size', type: 'radio', options: [{ label: 'S', value: 's' }, { label: 'L', value: 'l' }] },
        colors: { name: 'colors', type: 'select', multiple: true, options: [{ label: 'Red', value: 'red' }] },
      },
    };
    const [size, colors] = describeTemplateColumns(schema, ['size', 'colors'], { locale: 'en' });
    expect(size.dropdown).toEqual(['S', 'L']);
    expect(colors.dropdown).toBeUndefined();
  });

  it('the multiselect example joins two real options', () => {
    expect(byField.get('tags')?.example).toBe('Hot, New');
    const zh = describeTemplateColumns(KITCHEN_SINK, ['tags'], { locale: 'zh-CN' });
    expect(zh[0].example).toBe('Hot、New');
  });

  it('a number example sits inside the declared range, and the range is stated', () => {
    expect(byField.get('amount')?.example).toBe(5);
    expect(byField.get('amount')?.howToFill).toContain('Between 5 and 100.');
  });

  it('a reference column names its target by label, and states the ambiguity refusal', () => {
    expect(byField.get('account')?.howToFill).toContain('Account record');
    expect(byField.get('account')?.howToFill).toContain('reference_ambiguous');
    expect(byField.get('watchers')?.howToFill).toContain('One or more User record names');
  });

  it('every example cell coerces through the import reader with no invalid_* error', async () => {
    const metaMap = buildFieldMetaMap(KITCHEN_SINK);
    for (const c of cols) {
      if (c.example === undefined) continue;
      const out = await coerceFieldValue(c.example, metaMap.get(c.field), { timezone: 'UTC' });
      expect('error' in out ? out.error : undefined, `${c.field} = ${JSON.stringify(c.example)}`).toBeUndefined();
    }
  });

  it('a name in ?fields= that is no field of the object is described as such', () => {
    const [unknown] = describeTemplateColumns(KITCHEN_SINK, ['nope'], { locale: 'en' });
    expect(unknown).toMatchObject({ header: 'nope', type: '', howToFill: 'Not a field of this object.' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The workbook, read back with exceljs
// ─────────────────────────────────────────────────────────────────────────────

describe('buildImportTemplateWorkbook — read back', () => {
  async function roundTrip(locale: string) {
    const fields = templateColumns(KITCHEN_SINK);
    const cols = describeTemplateColumns(KITCHEN_SINK, fields, { locale });
    const wb = await buildImportTemplateWorkbook(cols, { locale });
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    return { cols, wb: await loadXlsxWorkbook(bytes) };
  }

  it('sheet one is the template — header and example, and NO data rows', async () => {
    const { cols, wb } = await roundTrip('en');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Template', 'Instructions']);
    const sheet = wb.worksheets[0];
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual(cols.map((c) => c.header));
    expect(sheet.actualRowCount).toBe(2);
    // Nothing below the example row carries a value.
    let lastWithValue = 0;
    sheet.eachRow({ includeEmpty: false }, (_row, rowNumber) => { lastWithValue = rowNumber; });
    expect(lastWithValue).toBe(2);
  });

  it('a required column\'s header carries `*`', async () => {
    const { wb } = await roundTrip('en');
    expect(wb.worksheets[0].getCell('A1').value).toBe('Name *');
    expect(wb.worksheets[0].getCell('B1').value).toBe('Tier');
  });

  it('dropdown columns carry a list validation over the whole import range, sourced from the instructions sheet', async () => {
    const { cols, wb } = await roundTrip('en');
    const sheet = wb.worksheets[0];
    const guide = wb.worksheets[1];
    const withDropdown = cols.map((c, i) => ({ c, letter: columnLetter(i + 1) })).filter(({ c }) => c.dropdown);
    expect(withDropdown.map(({ c }) => c.field)).toEqual(['tier', 'won']);
    for (const { c, letter } of withDropdown) {
      for (const row of [2, TEMPLATE_VALIDATED_ROWS + 1]) {
        const dv = sheet.getCell(`${letter}${row}`).dataValidation;
        expect(dv?.type, `${letter}${row}`).toBe('list');
        const ref = /^'([^']+)'!\$([A-Z]+)\$(\d+):\$([A-Z]+)\$(\d+)$/.exec(String(dv?.formulae?.[0]));
        expect(ref, String(dv?.formulae?.[0])).not.toBeNull();
        const [, sheetName, col, from, , to] = ref!;
        expect(sheetName).toBe('Instructions');
        const listed: unknown[] = [];
        for (let r = Number(from); r <= Number(to); r++) listed.push(guide.getCell(`${col}${r}`).value);
        expect(listed).toEqual(c.dropdown);
      }
      expect(sheet.getCell(`${letter}${TEMPLATE_VALIDATED_ROWS + 2}`).dataValidation).toBeUndefined();
    }
    // A column without a dropdown carries no validation.
    expect(sheet.getCell('A2').dataValidation).toBeUndefined();
    expect(sheet.getCell('E2').dataValidation).toBeUndefined();
  });

  it('the instructions sheet has one row per column: header, field, type, required, how to fill', async () => {
    const { cols, wb } = await roundTrip('en');
    const guide = wb.worksheets[1];
    expect((guide.getRow(4).values as unknown[]).slice(1, 6)).toEqual(['Column', 'Field', 'Type', 'Required', 'How to fill it']);
    cols.forEach((c, i) => {
      const values = (guide.getRow(5 + i).values as unknown[]).slice(1, 6);
      expect(values).toEqual([c.header, c.field, c.type, c.required ? 'Yes' : 'No', c.howToFill]);
    });
    expect(String(guide.getCell('A1').value)).toContain('replace it or delete it before you import');
  });

  it('text-shaped columns are text-formatted so leading zeros survive; numeric and date ones are not', async () => {
    const { cols, wb } = await roundTrip('en');
    const sheet = wb.worksheets[0];
    cols.forEach((c, i) => {
      expect(sheet.getColumn(i + 1).numFmt === '@', c.field).toBe(c.textFormat);
    });
    expect(cols.find((c) => c.field === 'name')?.textFormat).toBe(true);
    expect(cols.find((c) => c.field === 'amount')?.textFormat).toBe(false);
  });

  it('the read-projection fallback is stated on the instructions sheet; the write projection adds no note', async () => {
    const cols = describeTemplateColumns(KITCHEN_SINK, templateColumns(KITCHEN_SINK), { locale: 'en' });
    const notesOf = async (projection: 'writable' | 'readable' | 'none', locale = 'en') => {
      const wb = await buildImportTemplateWorkbook(cols, { locale, projection });
      const guide = (await loadXlsxWorkbook(Buffer.from(await wb.xlsx.writeBuffer()))).worksheets[1];
      return [1, 2, 3].map((r) => guide.getCell(r, 1).value);
    };
    expect((await notesOf('readable'))[2]).toBe(templateText('en').readProjectionNote);
    expect((await notesOf('readable', 'zh-CN'))[2]).toBe(templateText('zh-CN').readProjectionNote);
    expect((await notesOf('writable'))[2]).toBeNull();
    expect((await notesOf('none'))[2]).toBeNull();
  });

  it('zh-CN: the sheets, headings and boolean dropdown are Chinese', async () => {
    const { wb } = await roundTrip('zh-CN');
    expect(wb.worksheets.map((w) => w.name)).toEqual(['模板', '填写说明']);
    expect((wb.worksheets[1].getRow(4).values as unknown[]).slice(1, 6)).toEqual(['列', '字段', '类型', '必填', '填写方式']);
    const won = wb.worksheets[0].getCell('D2');
    expect(won.value).toBe('是');
    expect(String(won.dataValidation?.formulae?.[0])).toMatch(/^'填写说明'!/);
  });
});

describe('columnLetter', () => {
  it('spells spreadsheet columns', () => {
    expect([1, 2, 26, 27, 52, 53, 702, 703].map(columnLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA']);
  });
});
