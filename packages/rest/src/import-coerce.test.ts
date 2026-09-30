// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit tests for the import value-coercion module (`import-coerce.ts`) — the
 * inverse of `export-format.ts`. These are pure (no engine): scalar parsers plus
 * `coerceRow` driven by a fake reference resolver.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  parseBooleanCell,
  parseNumberCell,
  parseDateCell,
  matchOption,
  splitMulti,
  coerceRow,
} from './import-coerce';
import type { ExportFieldMeta } from './export-format';

describe('parseBooleanCell', () => {
  it('accepts common truthy spellings across languages', () => {
    for (const t of ['true', 'TRUE', 'yes', 'Y', '1', 'on', '是', '对', '✓', true, 1]) {
      expect(parseBooleanCell(t)).toBe(true);
    }
  });
  it('accepts common falsy spellings', () => {
    for (const f of ['false', 'No', 'n', '0', 'off', '否', '错', false, 0]) {
      expect(parseBooleanCell(f)).toBe(false);
    }
  });
  it('returns undefined for gibberish', () => {
    expect(parseBooleanCell('maybe')).toBeUndefined();
    expect(parseBooleanCell(2)).toBeUndefined();
  });
});

describe('parseNumberCell', () => {
  it('strips thousands separators, currency symbols, and percent signs', () => {
    expect(parseNumberCell('1,234.5')).toBe(1234.5);
    expect(parseNumberCell('$1,000')).toBe(1000);
    expect(parseNumberCell('¥2,500.75')).toBe(2500.75);
    expect(parseNumberCell('25%')).toBe(25);
  });
  it('handles accounting-style parenthesised negatives', () => {
    expect(parseNumberCell('(1,234)')).toBe(-1234);
  });
  it('rejects non-numeric residue', () => {
    expect(parseNumberCell('abc')).toBeUndefined();
    expect(parseNumberCell('12x3')).toBeUndefined();
    expect(parseNumberCell('')).toBeUndefined();
  });

  // [#20497] A comma is read only where it groups thousands: 1 to 3 leading
  // digits, then groups of exactly three, and only before any `.`.
  it.each([
    ['1,000', 1000],
    ['12,345.67', 12345.67],
    ['1,234,567.89', 1234567.89],
    ['-1,234', -1234],
    ['(1,234)', -1234],
    ['$1,000', 1000],
    ['1,234%', 1234],
    ['1,000e3', 1_000_000],
  ])('admits the well-formed thousands grouping %j as %s', (cell, n) => {
    expect(parseNumberCell(cell)).toBe(n);
  });

  it.each([
    // The card's four cells: stored as 314, 15, 1.0005 and 123 before.
    '3,14', '1,5', '1.000,5', '1,2,3',
    // A decimal comma, however it is dressed.
    '0,5', '(3,14)', '$1,5', '1,5%',
    // A group that is not exactly three digits, or a comma out of place.
    '1,23', '1,0000', '1234,567', ',123', '-,123', '1,000,', '.5,000',
    // A comma after the `.`.
    '12,345.6,7',
    // A grouping other than thousands — no locale is guessed.
    '12,34,567', '1,00,000',
  ])('refuses %j rather than reading it as some other number', (cell) => {
    expect(parseNumberCell(cell)).toBeUndefined();
  });
});

describe('parseDateCell', () => {
  it('normalises bare calendar dates without timezone drift', () => {
    expect(parseDateCell('2026-06-30', 'date')).toBe('2026-06-30');
    expect(parseDateCell('2026/6/3', 'date')).toBe('2026-06-03');
  });
  it('emits full ISO for datetime', () => {
    expect(parseDateCell('2026-06-30', 'datetime')).toBe('2026-06-30T00:00:00.000Z');
  });
  it('accepts and normalises time-of-day', () => {
    expect(parseDateCell('14:30', 'time')).toBe('14:30:00');
    expect(parseDateCell('09:05:07', 'time')).toBe('09:05:07');
  });
  it('rejects nonsense', () => {
    expect(parseDateCell('not-a-date', 'date')).toBeUndefined();
    expect(parseDateCell('2026-13-40', 'date')).toBeUndefined();
  });
});

/**
 * [#20534] A text cell is read only in ISO 8601, the export's own
 * `YYYY-MM-DD HH:mm:ss` or a year-first date (`2026/7/15`, `2026/7/15 9:00`,
 * by the maintainer ruling on the card), on a calendar day that exists;
 * everything else is refused (`undefined`, so the row's `invalid_date`, a `time` cell's `invalid_time`), never rolled over, never
 * read in the host's zone and never read month-first. A `date`'s year keeps
 * four digits. Every case runs under two host zones that disagree by twelve
 * hours, and must answer the same under both — the host-zone reading this
 * removes answered differently (`07/15/2026 10:00` was `…T14:00Z` in New York
 * and `…T02:00Z` in Shanghai).
 */
describe('[#20534] parseDateCell — ISO 8601, the export shape or a year-first date, on a real day', () => {
  const HOST_ZONES = ['America/New_York', 'Asia/Shanghai'];
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  /** Run `fn` under each host zone; the answers must agree. */
  function onBothHosts(fn: () => string | undefined): string | undefined {
    const answers = HOST_ZONES.map((tz) => {
      process.env.TZ = tz;
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(tz);
      return fn();
    });
    expect(answers[1]).toBe(answers[0]);
    return answers[0];
  }

  type Kind = 'date' | 'datetime' | 'time';

  const REFUSED: ReadonlyArray<readonly [cell: unknown, kind: Kind]> = [
    // An impossible day, in every shape and on every branch — was rolled over.
    ['2026-02-30', 'date'], ['2026-02-30', 'datetime'], ['2026-02-30', 'time'],
    ['2026-02-29', 'datetime'], ['2026-04-31', 'datetime'],
    ['2026-02-30 10:00', 'datetime'], ['2026-02-30 10:00', 'date'], ['2026-02-30 10:00', 'time'],
    ['2026-02-30T10:00:00Z', 'datetime'], ['2026-02-30T10:00:00Z', 'date'], ['2026-02-30T10:00:00Z', 'time'],
    // Locale and prose spellings — were read in the host zone, and month-first.
    ['07/15/2026 10:00', 'datetime'], ['07/15/2026 10:00', 'date'], ['07/15/2026 10:00', 'time'],
    ['07/08/2026', 'datetime'], ['07/08/2026', 'date'],
    ['07/15/2026', 'date'], ['15 July 2026', 'date'], ['15 July 2026', 'datetime'],
    ['Jul 15 2026 10:00', 'time'], ['Wed, 15 Jul 2026 10:00:00 GMT', 'datetime'],
    // Year-first, outside its one form: an impossible day, a mixed separator,
    // a clock out of range, a `T`, a zone, a fraction, a two-digit year.
    ['2026/2/30', 'date'], ['2026/2/30', 'datetime'], ['2026/7-15', 'date'],
    ['2026/7/15 24:00', 'datetime'], ['2026/7/15 9:60', 'datetime'],
    ['2026/7/15T9:00', 'datetime'], ['2026/7/15 9:00Z', 'datetime'],
    ['2026/7/15 9:00:00.5', 'datetime'], ['26/7/15', 'date'], ['07/15/2026', 'datetime'],
    // Reduced / expanded forms, a zone after a space, lower-case `t` / `z`.
    ['2026', 'date'], ['2026-07', 'datetime'], ['+002026-07-15', 'date'],
    ['2026-07-15 10:00Z', 'datetime'], ['2026-07-15 10:00:00+08:00', 'datetime'],
    ['2026-07-15t10:00:00z', 'datetime'],
    // A zone-naive 24:00 — was handed to `new Date(s)`, in the host zone.
    ['2026-07-15 24:00', 'datetime'], ['2026-07-15T24:00:00', 'date'],
    // A number — `new Date(String(n))` read it as a year, in the host zone.
    [2026, 'date'], [45000, 'datetime'], [45000, 'time'],
  ];

  it.each(REFUSED)('refuses %j as a %s cell on every host', (cell, kind) => {
    expect(onBothHosts(() => parseDateCell(cell, kind))).toBeUndefined();
  });

  const ADMITTED: ReadonlyArray<readonly [cell: unknown, kind: Kind, stored: string]> = [
    // ISO 8601 and the export shape keep their readings.
    ['2026-07-15', 'date', '2026-07-15'],
    ['2026-07-15', 'datetime', '2026-07-15T00:00:00.000Z'],
    ['2028-02-29', 'date', '2028-02-29'],
    ['2028-02-29T10:00:00Z', 'datetime', '2028-02-29T10:00:00.000Z'],
    ['2026-07-15 10:00:00', 'datetime', '2026-07-15T10:00:00.000Z'],
    ['2026-07-15 10:00:00', 'date', '2026-07-15'],
    ['2026-07-15 10:00:00', 'time', '10:00:00'],
    ['2026-07-15T10:00', 'datetime', '2026-07-15T10:00:00.000Z'],
    ['2026-07-15 10:00:00.123', 'datetime', '2026-07-15T10:00:00.123Z'],
    ['2026-07-15T10:00:00Z', 'datetime', '2026-07-15T10:00:00.000Z'],
    ['2026-07-15T10:00:00+08:00', 'datetime', '2026-07-15T02:00:00.000Z'],
    ['2026-07-15T10:00:00+0800', 'datetime', '2026-07-15T02:00:00.000Z'],
    ['2026-07-15T02:00:00+08:00', 'date', '2026-07-14'],
    ['2026-07-15T10:00:00+08:00', 'time', '02:00:00'],
    ['2026-07-15T24:00:00Z', 'datetime', '2026-07-16T00:00:00.000Z'],
    ['  2026-07-15  ', 'date', '2026-07-15'],
    ['10:00', 'time', '10:00:00'],
    // A year-first date (Excel's zh-CN / ja-JP short date): the padded ISO day,
    // and a clock read as a wall clock exactly as the export shape's is.
    ['2026/6/3', 'date', '2026-06-03'],
    ['2026/07/15', 'date', '2026-07-15'],
    ['2026-7-15', 'date', '2026-07-15'],
    ['2026/7/15', 'datetime', '2026-07-15T00:00:00.000Z'],
    ['2026/7/15 9:00', 'datetime', '2026-07-15T09:00:00.000Z'],
    ['2026/7/15 9:00', 'date', '2026-07-15'],
    ['2026/7/15 9:00', 'time', '09:00:00'],
    ['2026/08/01 06:00:00', 'datetime', '2026-08-01T06:00:00.000Z'],
    ['2026-07-15 9:00', 'datetime', '2026-07-15T09:00:00.000Z'],
    ['2028/2/29', 'date', '2028-02-29'],
    ['0500/1/1', 'date', '0500-01-01'],
    // The year keeps four digits on every `date` branch.
    ['0500-01-01', 'date', '0500-01-01'],
    ['0001-01-01', 'date', '0001-01-01'],
    ['0999-12-31 10:00:00', 'date', '0999-12-31'],
    ['0050-01-01T10:00:00Z', 'date', '0050-01-01'],
    [new Date('0500-01-01T00:00:00Z'), 'date', '0500-01-01'],
    // A bare day into a `datetime` is spelled from the day, never `Date.UTC(y, …)`,
    // which read years 0..99 as 1900..1999 (`0001-01-01` was stored as 1901).
    ['0001-01-01', 'datetime', '0001-01-01T00:00:00.000Z'],
    ['0050-01-01', 'datetime', '0050-01-01T00:00:00.000Z'],
    ['0500-01-01', 'datetime', '0500-01-01T00:00:00.000Z'],
  ];

  it.each(ADMITTED)('reads %j as a %s cell as %j on every host', (cell, kind, stored) => {
    expect(onBothHosts(() => parseDateCell(cell, kind))).toBe(stored);
  });
});

describe('matchOption', () => {
  const options = [{ label: '高', value: 'high' }, { label: '低', value: 'low' }];
  it('matches by option value (code)', () => {
    expect(matchOption('high', options)).toBe('high');
  });
  it('matches by human label, case-insensitively', () => {
    expect(matchOption('高', options)).toBe('high');
    expect(matchOption('LOW', [{ label: 'Low', value: 'low' }])).toBe('low');
  });
  it('returns undefined when nothing matches', () => {
    expect(matchOption('medium', options)).toBeUndefined();
  });
});

describe('splitMulti', () => {
  it('splits on commas, semicolons, Chinese comma, and newlines', () => {
    expect(splitMulti('a, b;c、d\ne')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('passes arrays through, trimming blanks', () => {
    expect(splitMulti([' x ', '', 'y'])).toEqual(['x', 'y']);
  });
});

describe('coerceRow', () => {
  const meta = (defs: Record<string, Partial<ExportFieldMeta>>): Map<string, ExportFieldMeta> => {
    const m = new Map<string, ExportFieldMeta>();
    for (const [name, d] of Object.entries(defs)) m.set(name, { name, ...d });
    return m;
  };

  it('coerces every special value type to its storage shape', async () => {
    const metaMap = meta({
      done: { type: 'boolean' },
      amount: { type: 'currency' },
      priority: { type: 'select', options: [{ label: '高', value: 'high' }] },
      tags: { type: 'multiselect', options: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] },
      due: { type: 'date' },
      note: { type: 'text' },
    });
    const { data, errors } = await coerceRow(
      { done: '是', amount: '$1,200.50', priority: '高', tags: 'A, B', due: '2026/07/01', note: '  hi  ' },
      metaMap,
      {},
    );
    expect(errors).toEqual([]);
    expect(data).toEqual({
      done: true,
      amount: 1200.5,
      priority: 'high',
      tags: ['a', 'b'],
      due: '2026-07-01',
      note: 'hi',
    });
  });

  it('resolves reference fields via the async resolver (name → id)', async () => {
    const metaMap = meta({ owner: { type: 'lookup', reference: 'user', displayField: 'name' } });
    const seen: string[] = [];
    const resolveRef = async (obj: string, display: string) => {
      seen.push(`${obj}:${display}`);
      return display === '张三' ? 'u1' : undefined;
    };
    const ok = await coerceRow({ owner: '张三' }, metaMap, { resolveRef });
    expect(ok.data).toEqual({ owner: 'u1' });
    expect(seen).toEqual(['user:张三']);

    const bad = await coerceRow({ owner: '王五' }, metaMap, { resolveRef });
    expect(bad.data.owner).toBeUndefined();
    expect(bad.errors[0]).toMatchObject({ field: 'owner', code: 'reference_not_found' });
  });

  it('accepts a structured resolver result and flags ambiguous matches', async () => {
    const metaMap = meta({ owner: { type: 'lookup', reference: 'user', displayField: 'name' } });
    const resolveRef = async (_obj: string, display: string) => {
      if (display === '张三') return { id: 'u1', matchedField: 'name' };
      if (display === '李四') return { ambiguous: true, matchedField: 'name' };
      return {};
    };
    const ok = await coerceRow({ owner: '张三' }, metaMap, { resolveRef });
    expect(ok.data).toEqual({ owner: 'u1' });

    const dup = await coerceRow({ owner: '李四' }, metaMap, { resolveRef });
    expect(dup.data.owner).toBeUndefined();
    expect(dup.errors[0]).toMatchObject({ field: 'owner', code: 'reference_ambiguous' });

    const none = await coerceRow({ owner: '无名' }, metaMap, { resolveRef });
    expect(none.errors[0]).toMatchObject({ field: 'owner', code: 'reference_not_found' });
  });

  it('splits a multi-value lookup cell and resolves each token to an id', async () => {
    const metaMap = meta({
      members: { type: 'lookup', reference: 'sys_user', displayField: 'name', multiple: true },
    });
    const ids: Record<string, string> = { 张焊工: 'u1', 李质检: 'u2' };
    const seen: string[] = [];
    const resolveRef = async (_obj: string, display: string) => {
      seen.push(display);
      return ids[display];
    };
    // Semicolon-separated (issue's CSV) and comma-separated (export round-trip).
    const semi = await coerceRow({ members: '张焊工;李质检' }, metaMap, { resolveRef });
    expect(semi.errors).toEqual([]);
    expect(semi.data).toEqual({ members: ['u1', 'u2'] });
    const comma = await coerceRow({ members: '张焊工, 李质检' }, metaMap, { resolveRef });
    expect(comma.data).toEqual({ members: ['u1', 'u2'] });
    expect(seen).toEqual(['张焊工', '李质检', '张焊工', '李质检']);
  });

  it('names the specific unmatched token in a multi-value lookup', async () => {
    const metaMap = meta({
      members: { type: 'lookup', reference: 'sys_user', displayField: 'name', multiple: true },
    });
    const resolveRef = async (_obj: string, display: string) =>
      display === '张焊工' ? 'u1' : undefined;
    const { data, errors } = await coerceRow({ members: '张焊工;查无此人' }, metaMap, { resolveRef });
    expect(data.members).toBeUndefined();
    expect(errors[0]).toMatchObject({ field: 'members', code: 'reference_not_found' });
    expect(errors[0].message).toContain('查无此人');
    expect(errors[0].message).not.toContain('张焊工');
  });

  it('keeps raw multi-value lookup tokens when no resolver is supplied', async () => {
    const metaMap = meta({
      members: { type: 'lookup', reference: 'sys_user', multiple: true },
    });
    const { data } = await coerceRow({ members: 'u1;u2' }, metaMap, {});
    expect(data).toEqual({ members: ['u1', 'u2'] });
  });

  it('splits a select flagged multiple:true into an array of option values', async () => {
    const metaMap = meta({
      skills: {
        type: 'select', multiple: true,
        options: [{ label: '焊接', value: 'weld' }, { label: '质检', value: 'qc' }],
      },
    });
    const { data, errors } = await coerceRow({ skills: '焊接;质检' }, metaMap, {});
    expect(errors).toEqual([]);
    expect(data).toEqual({ skills: ['weld', 'qc'] });
    // A single-value select (no multiple flag) still stores one scalar.
    const single = meta({ s: { type: 'select', options: [{ label: '焊接', value: 'weld' }] } });
    const one = await coerceRow({ s: '焊接' }, single, {});
    expect(one.data).toEqual({ s: 'weld' });
  });

  it('names the specific unmatched token in a multiple:true select', async () => {
    const metaMap = meta({
      skills: { type: 'select', multiple: true, options: [{ label: '焊接', value: 'weld' }] },
    });
    const { errors } = await coerceRow({ skills: '焊接,搬砖' }, metaMap, {});
    expect(errors[0]).toMatchObject({ field: 'skills', code: 'invalid_option' });
    expect(errors[0].message).toContain('搬砖');
    expect(errors[0].message).not.toContain('焊接');
  });

  it('splits a file/image flagged multiple:true into an array of ids/urls', async () => {
    const metaMap = meta({ photos: { type: 'image', multiple: true } });
    const { data } = await coerceRow({ photos: 'a.png;b.png' }, metaMap, {});
    expect(data).toEqual({ photos: ['a.png', 'b.png'] });
    // A single-value file passes through untouched.
    const single = meta({ f: { type: 'file' } });
    const one = await coerceRow({ f: 'a.png' }, single, {});
    expect(one.data).toEqual({ f: 'a.png' });
  });

  it('ignores multiple:true on types the spec does not make multi (master_detail)', async () => {
    // master_detail is not multi-capable per the spec — a stray multiple flag
    // must not split it; it stays a single resolved reference (engine parity).
    const metaMap = meta({
      parent: { type: 'master_detail', reference: 'order', displayField: 'name', multiple: true },
    });
    const resolveRef = async (_obj: string, display: string) => (display === 'A;B' ? 'o1' : undefined);
    const { data } = await coerceRow({ parent: 'A;B' }, metaMap, { resolveRef });
    expect(data).toEqual({ parent: 'o1' });
  });

  it('reports coercion errors per field instead of throwing', async () => {
    const metaMap = meta({ n: { type: 'number' }, b: { type: 'boolean' } });
    const { data, errors } = await coerceRow({ n: 'abc', b: 'maybe' }, metaMap, {});
    expect(data).toEqual({});
    expect(errors.map((e) => e.code).sort()).toEqual(['invalid_boolean', 'invalid_number']);
  });

  it('drops blank cells so schema defaults / existing values win', async () => {
    const metaMap = meta({ a: { type: 'text' }, b: { type: 'number' } });
    const { data } = await coerceRow({ a: '', b: '  ' }, metaMap, {});
    expect(data).toEqual({});
  });

  it('honours createMissingOptions by keeping the raw select value', async () => {
    const metaMap = meta({ s: { type: 'select', options: [{ label: 'A', value: 'a' }] } });
    const strict = await coerceRow({ s: 'zzz' }, metaMap, {});
    expect(strict.errors[0]?.code).toBe('invalid_option');
    const lax = await coerceRow({ s: 'zzz' }, metaMap, { createMissingOptions: true });
    expect(lax.errors).toEqual([]);
    expect(lax.data).toEqual({ s: 'zzz' });
  });

  it('passes unknown columns through untouched', async () => {
    const { data } = await coerceRow({ mystery: 'raw' }, new Map(), {});
    expect(data).toEqual({ mystery: 'raw' });
  });
});

// ── the retired constraint mirror (framework#3956) ────────────────────
//
// `firstConstraintViolation` used to be pinned here with eight unit cases. It
// is gone: the import dry run asks the engine for its verdict through
// `DataProtocol.validateData` instead of re-deriving one (#4633 ruling D), so
// there is no longer a copy of the engine's numeric-range / string-length
// rules in this file to keep in step.
//
// Its VERDICTS did not retire with it — `import-dryrun-parity.test.ts` asserts
// every one of them (min_value, max_value, min_length, max_length, an omitted
// bounded field, boundary values) against a live engine, and asserts the dry
// run and the real write agree on each. Two of the eight cases have no
// successor by design: "skips system / readonly columns" and "bound-checks
// only the types the engine bound-checks" existed because a hand-maintained
// copy could disagree with the engine about WHICH fields and types are in
// scope. With no copy, there is no second opinion to police — that question is
// `record-validator.ts`'s alone, and pinned in objectql's own tests.

/**
 * #3957 — the importer's row report is where a user meets these messages, and
 * it used to be hardcoded English naming the API column
 * (`penalty_amount: "abc" is not a number`). The engine's validation errors in
 * the SAME report are localized, so these must be too, from the same catalog.
 */
describe('coerceRow — cell-coercion messages are localized (#3957)', () => {
  const meta = new Map<string, ExportFieldMeta>([
    ['penalty_amount', { name: 'penalty_amount', type: 'currency', label: '处罚金额' }],
    ['is_active', { name: 'is_active', type: 'boolean', label: '启用' }],
    ['due_at', { name: 'due_at', type: 'datetime', label: '截止时间' }],
    ['stage', { name: 'stage', type: 'select', label: '阶段', options: [{ label: '草稿', value: 'draft' }] }],
    ['owner', { name: 'owner', type: 'lookup', label: '负责人', reference: 'sys_user' }],
  ]);

  const firstError = async (row: Record<string, unknown>, locale?: string) => {
    const { errors } = await coerceRow(row, meta, {
      locale,
      resolveRef: async () => undefined, // nothing ever matches
    });
    expect(errors).toHaveLength(1);
    return errors[0];
  };

  it('names the column by its label and keeps the machine code', async () => {
    const err = await firstError({ penalty_amount: 'abc' }, 'zh-CN');
    expect(err.message).toBe('处罚金额:“abc”不是有效的数字');
    expect(err).toMatchObject({ field: 'penalty_amount', code: 'invalid_number' });
  });

  it('localizes every coercion failure kind', async () => {
    expect((await firstError({ is_active: 'maybe' }, 'zh-CN')).message)
      .toBe('启用:“maybe”不是有效的布尔值');
    expect((await firstError({ due_at: 'not-a-date' }, 'zh-CN')).message)
      .toBe('截止时间:“not-a-date”不是有效的日期时间');
    expect((await firstError({ stage: '归档' }, 'zh-CN')).message)
      .toBe('阶段:“归档”不是可选值之一');
    expect((await firstError({ owner: '查无此人' }, 'zh-CN')).message)
      .toBe('负责人:未找到与“查无此人”匹配的记录');
  });

  it('renders English against the label when no locale is supplied', async () => {
    const err = await firstError({ penalty_amount: 'abc' });
    expect(err.message).toBe('处罚金额: "abc" is not a number');
  });

  /**
   * The reference message no longer leaks the target object's API name
   * (`no sys_user matches "…"`) — naming internal identifiers is the defect this
   * issue is about, and the column plus the offending value are what an importer
   * can act on.
   */
  it('does not leak the referenced object’s API name', async () => {
    const err = await firstError({ owner: '查无此人' }, 'zh-CN');
    expect(err.message).not.toContain('sys_user');
    expect(err.message).toContain('查无此人');
  });

  it('falls back to the column name when no label is declared', async () => {
    const bare = new Map<string, ExportFieldMeta>([['qty', { name: 'qty', type: 'number' }]]);
    const { errors } = await coerceRow({ qty: 'abc' }, bare, { locale: 'zh-CN' });
    expect(errors[0].message).toBe('qty:“abc”不是有效的数字');
  });
});
