// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  parseAutonumberFormat,
  renderAutonumber,
  hasDynamicTokens,
  sequenceWidth,
  referencedFields,
  missingFieldValues,
} from './autonumber-format';

// A fixed instant: 2026-06-17 21:30 UTC. In Asia/Shanghai (UTC+8) this is
// already 2026-06-18, which is exactly what makes the timezone assertions bite.
const NOW = new Date('2026-06-17T21:30:00.000Z');

describe('parseAutonumberFormat', () => {
  it('splits literal, sequence, date and field tokens in order', () => {
    expect(parseAutonumberFormat('AD{YYYYMMDD}{0000}')).toEqual([
      { kind: 'literal', text: 'AD' },
      { kind: 'date', pattern: 'YYYYMMDD' },
      { kind: 'seq', width: 4 },
    ]);
    expect(parseAutonumberFormat('{section}{island_zone}{000}')).toEqual([
      { kind: 'field', field: 'section' },
      { kind: 'field', field: 'island_zone' },
      { kind: 'seq', width: 3 },
    ]);
  });

  it('treats a second {0..0} group as literal (only one counter)', () => {
    const tokens = parseAutonumberFormat('{0000}-{000}');
    expect(tokens).toEqual([
      { kind: 'seq', width: 4 },
      { kind: 'literal', text: '-' },
      { kind: 'literal', text: '{000}' },
    ]);
    expect(sequenceWidth(tokens)).toBe(4);
  });

  it('keeps unknown tokens as literal text', () => {
    expect(parseAutonumberFormat('X{not a token}{0}')).toEqual([
      { kind: 'literal', text: 'X' },
      { kind: 'literal', text: '{not a token}' },
      { kind: 'seq', width: 1 },
    ]);
  });

  it('reports dynamic tokens and referenced fields', () => {
    expect(hasDynamicTokens(parseAutonumberFormat('CASE-{0000}'))).toBe(false);
    expect(hasDynamicTokens(parseAutonumberFormat('AD{YYYYMMDD}{0000}'))).toBe(true);
    expect(referencedFields(parseAutonumberFormat('{section}{island_zone}{000}'))).toEqual([
      'section',
      'island_zone',
    ]);
  });
});

describe('missingFieldValues', () => {
  const tokens = parseAutonumberFormat('{section}{island_zone}{000}');

  it('lists {field} tokens with no value on the record (null/undefined/empty)', () => {
    expect(missingFieldValues(tokens, { section: 'JYG', island_zone: '1A' })).toEqual([]);
    expect(missingFieldValues(tokens, { section: 'JYG' })).toEqual(['island_zone']);
    expect(missingFieldValues(tokens, { section: '', island_zone: null })).toEqual([
      'section',
      'island_zone',
    ]);
    expect(missingFieldValues(tokens, undefined)).toEqual(['section', 'island_zone']);
  });

  it('treats 0 and false as present (only null/undefined/"" are missing)', () => {
    const t = parseAutonumberFormat('{n}{flag}{000}');
    expect(missingFieldValues(t, { n: 0, flag: false })).toEqual([]);
  });

  it('returns nothing for date-only / fixed-prefix formats (no {field} tokens)', () => {
    expect(missingFieldValues(parseAutonumberFormat('AD{YYYYMMDD}{0000}'), {})).toEqual([]);
    expect(missingFieldValues(parseAutonumberFormat('CASE-{0000}'), {})).toEqual([]);
  });
});

describe('renderAutonumber', () => {
  it('renders a fixed prefix with an empty scope (backward compatible)', () => {
    const tokens = parseAutonumberFormat('CASE-{0000}');
    const r = renderAutonumber({ tokens, seq: 42, now: NOW });
    expect(r.value).toBe('CASE-0042');
    expect(r.prefix).toBe('CASE-');
    expect(r.scope).toBe(''); // no date/field token → single global counter
  });

  it('appends the bare counter when there is no {0..0} slot', () => {
    const tokens = parseAutonumberFormat('NO-SLOT');
    expect(renderAutonumber({ tokens, seq: 7, now: NOW }).value).toBe('NO-SLOT7');
  });

  it('renders date tokens in the business timezone and scopes by the rendered prefix', () => {
    const tokens = parseAutonumberFormat('AD{YYYYMMDD}{0000}');
    const shanghai = renderAutonumber({ tokens, seq: 32, now: NOW, timezone: 'Asia/Shanghai' });
    expect(shanghai.value).toBe('AD202606180032'); // local day rolled to the 18th
    expect(shanghai.scope).toBe('AD20260618');

    const utc = renderAutonumber({ tokens, seq: 32, now: NOW, timezone: 'UTC' });
    expect(utc.value).toBe('AD202606170032'); // still the 17th in UTC
    expect(utc.scope).toBe('AD20260617');
  });

  it('supports the individual {YYYY}/{YY}/{MM}/{DD} date tokens', () => {
    const tokens = parseAutonumberFormat('WO-{YYYY}-{MM}-{DD}-{YY}-{000}');
    expect(renderAutonumber({ tokens, seq: 1, now: NOW, timezone: 'UTC' }).value).toBe(
      'WO-2026-06-17-26-001',
    );
  });

  it('interpolates {field} from the record and scopes per group', () => {
    const tokens = parseAutonumberFormat('{section}{island_zone}{000}');
    const a = renderAutonumber({ tokens, seq: 1, now: NOW, record: { section: 'JYG', island_zone: '1A' } });
    const b = renderAutonumber({ tokens, seq: 5, now: NOW, record: { section: 'JYG', island_zone: '2B' } });
    expect(a.value).toBe('JYG1A001');
    expect(a.scope).toBe('JYG1A');
    expect(b.scope).toBe('JYG2B'); // a different island → a different counter
  });

  it('places literal/field text after the sequence into the suffix', () => {
    const tokens = parseAutonumberFormat('{0000}-{section}');
    const r = renderAutonumber({ tokens, seq: 3, now: NOW, record: { section: 'X' } });
    expect(r.value).toBe('0003-X');
    expect(r.suffix).toBe('-X');
  });

  it('renders a missing field token as empty rather than throwing', () => {
    const tokens = parseAutonumberFormat('{missing}{000}');
    expect(renderAutonumber({ tokens, seq: 2, now: NOW, record: {} }).value).toBe('002');
  });
});
