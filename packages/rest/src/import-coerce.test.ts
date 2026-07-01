// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Unit tests for the import value-coercion module (`import-coerce.ts`) — the
 * inverse of `export-format.ts`. These are pure (no engine): scalar parsers plus
 * `coerceRow` driven by a fake reference resolver.
 */

import { describe, it, expect } from 'vitest';
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
