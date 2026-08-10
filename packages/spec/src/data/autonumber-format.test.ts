// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  parseAutonumberFormat,
  renderAutonumber,
  hasDynamicTokens,
  sequenceWidth,
  referencedFields,
  missingFieldValues,
  readAutonumberCounter,
  resolveAutonumberFormat,
  DEFAULT_AUTONUMBER_FORMAT,
} from './autonumber-format';

// A fixed instant: 2026-06-17 21:30 UTC. In Asia/Shanghai (UTC+8) this is
// already 2026-06-18, which is exactly what makes the timezone assertions bite.
const NOW = new Date('2026-06-17T21:30:00.000Z');

// #6555 — the contract default for a format-less autonumber field. Before it,
// the SQL driver and the engine's in-memory fallback each substituted their own
// answer and the two disagreed (`0001` vs `1`) for the very same metadata.
describe('DEFAULT_AUTONUMBER_FORMAT / resolveAutonumberFormat (#6555)', () => {
  it('fixes the contract default at `{0000}` — four-digit zero padding', () => {
    expect(DEFAULT_AUTONUMBER_FORMAT).toBe('{0000}');
  });

  it('resolves a format-less field to the declared default', () => {
    // The exact metadata from the bug report: `{ type: 'autonumber' }`, no format.
    expect(resolveAutonumberFormat({})).toBe(DEFAULT_AUTONUMBER_FORMAT);
    expect(resolveAutonumberFormat(undefined)).toBe(DEFAULT_AUTONUMBER_FORMAT);
    expect(resolveAutonumberFormat(null)).toBe(DEFAULT_AUTONUMBER_FORMAT);
    expect(resolveAutonumberFormat({ autonumberFormat: undefined })).toBe(DEFAULT_AUTONUMBER_FORMAT);
  });

  it('prefers the canonical `autonumberFormat` over the `format` shorthand (#1603)', () => {
    expect(resolveAutonumberFormat({ autonumberFormat: 'INV-{0000}' })).toBe('INV-{0000}');
    expect(resolveAutonumberFormat({ format: 'TK-{00000}' })).toBe('TK-{00000}');
    expect(resolveAutonumberFormat({ autonumberFormat: 'A-{000}', format: 'B-{000}' })).toBe('A-{000}');
  });

  it('treats a non-string or empty value as undeclared — the SQL driver\'s truthiness rule', () => {
    // The engine used `??`, the driver used `||`; they disagreed on `''` too.
    // Resolving `''` to the default is the direction that leaves already-stored
    // driver-sql numbers unchanged.
    expect(resolveAutonumberFormat({ autonumberFormat: '' })).toBe(DEFAULT_AUTONUMBER_FORMAT);
    expect(resolveAutonumberFormat({ format: '' })).toBe(DEFAULT_AUTONUMBER_FORMAT);
    expect(resolveAutonumberFormat({ autonumberFormat: '', format: 'B-{000}' })).toBe('B-{000}');
    expect(resolveAutonumberFormat({ autonumberFormat: 42 })).toBe(DEFAULT_AUTONUMBER_FORMAT);
    expect(resolveAutonumberFormat({ autonumberFormat: {} })).toBe(DEFAULT_AUTONUMBER_FORMAT);
  });

  it('renders the resolved default as `0001`, not the bare counter', () => {
    // The end-to-end shape the ruling settles: one metadata document, one
    // number shape, whichever side generates it.
    const tokens = parseAutonumberFormat(resolveAutonumberFormat({}));
    expect(renderAutonumber({ tokens, seq: 1, now: NOW }).value).toBe('0001');
    expect(renderAutonumber({ tokens, seq: 11, now: NOW }).value).toBe('0011');
    // …and the counter is untouched by the width — #6468's territory, pinned
    // here only so a future widening of the default cannot be read as a reset.
    expect(renderAutonumber({ tokens, seq: 12345, now: NOW }).value).toBe('12345');
  });

  it('leaves the bare-counter branch reachable for a declared slot-less format', () => {
    // `width === null` is no longer what a format-LESS field renders through;
    // it is what a format carrying no `{0..0}` slot renders through.
    const tokens = parseAutonumberFormat(resolveAutonumberFormat({ autonumberFormat: 'CASE-' }));
    expect(renderAutonumber({ tokens, seq: 1, now: NOW }).value).toBe('CASE-1');
  });
});

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

  it('gives adjacent {field} tokens a shared scope when their concat collides', () => {
    // ('AB','C') and ('A','BC') render the SAME prefix "ABC" and therefore the
    // same visible number — so they must share one scope/counter to stay unique;
    // splitting them would mint duplicate record numbers. (Distinct groups need
    // an unambiguous format with a delimiter literal; the compile lint nudges.)
    const tokens = parseAutonumberFormat('{a}{b}{000}');
    const ab_c = renderAutonumber({ tokens, seq: 1, now: NOW, record: { a: 'AB', b: 'C' } });
    const a_bc = renderAutonumber({ tokens, seq: 1, now: NOW, record: { a: 'A', b: 'BC' } });
    expect(ab_c.scope).toBe('ABC');
    expect(a_bc.scope).toBe('ABC');
    expect(ab_c.scope).toBe(a_bc.scope);
  });

  it('places literal/field text after the sequence into the suffix', () => {
    const tokens = parseAutonumberFormat('{0000}-{section}');
    const r = renderAutonumber({ tokens, seq: 3, now: NOW, record: { section: 'X' } });
    expect(r.value).toBe('0003-X');
    expect(r.suffix).toBe('-X');
  });

  it('treats the pad width as a MINIMUM — the counter grows past it, never wraps', () => {
    const tokens = parseAutonumberFormat('CASE-{000}');
    expect(renderAutonumber({ tokens, seq: 7, now: NOW }).value).toBe('CASE-007');
    expect(renderAutonumber({ tokens, seq: 999, now: NOW }).value).toBe('CASE-999');
    // Past the pad width the number simply widens (it does not reset or error),
    // matching mainstream autonumber semantics — uniqueness is preserved.
    expect(renderAutonumber({ tokens, seq: 1000, now: NOW }).value).toBe('CASE-1000');
    expect(renderAutonumber({ tokens, seq: 12345, now: NOW }).value).toBe('CASE-12345');
  });

  it('renders a missing field token as empty rather than throwing', () => {
    const tokens = parseAutonumberFormat('{missing}{000}');
    expect(renderAutonumber({ tokens, seq: 2, now: NOW, record: {} }).value).toBe('002');
  });
});

describe('readAutonumberCounter — the inverse of renderAutonumber (#6560)', () => {
  // The rule moved here out of two hand-written copies (engine + driver-sql)
  // that PR #6553 left behind; these cases mirror what that PR's own tests pin
  // on each side, so a change here fails in spec before it can diverge there.

  describe('round-trips renderAutonumber', () => {
    it.each([
      ['{000}-{YYYY}', 3],
      ['CASE-{000}-{YYYY}', 42],
      ['D-{0000}', 1],
      ['AD{YYYYMMDD}{0000}', 999],
      ['{section}{000}', 7],
    ])('%s reads back the seq it rendered', (format, seq) => {
      const tokens = parseAutonumberFormat(format);
      const r = renderAutonumber({ tokens, seq, now: NOW, record: { section: 'X' } });
      expect(readAutonumberCounter(r.value, r.prefix, r.suffix)).toBe(seq);
    });

    it('reads back a counter that has grown past the pad width', () => {
      const tokens = parseAutonumberFormat('{000}-{YYYY}');
      const r = renderAutonumber({ tokens, seq: 12345, now: NOW });
      expect(r.value).toBe('12345-2026');
      expect(readAutonumberCounter(r.value, r.prefix, r.suffix)).toBe(12345);
    });
  });

  describe('the counter is located by the declared pair, not by "the trailing digits"', () => {
    it('takes the counter, not the year, from a value the year trails', () => {
      // The #6468 defect verbatim: the last digit run of `003-2026` is the YEAR.
      expect(readAutonumberCounter('003-2026', '', '-2026')).toBe(3);
      expect(readAutonumberCounter('003-2026', '', '-2026')).not.toBe(2026);
    });

    it('reads between the prefix and the suffix when both are declared', () => {
      expect(readAutonumberCounter('CASE-003-2026', 'CASE-', '-2026')).toBe(3);
    });

    it('does not concatenate the digit runs it finds', () => {
      // The driver-sql half of the defect read this as 12026.
      expect(readAutonumberCounter('001-2026', '', '-2026')).toBe(1);
    });

    it('strips a matching suffix but never requires one', () => {
      // `{000}-{YYYY}` scopes its counter to the rendered PREFIX (''), so ONE
      // counter spans the years: last year's row still holds counter 7 and must
      // be read, or seeding lands BELOW the real max (#6249's harm).
      expect(readAutonumberCounter('007-2025', '', '-2026')).toBe(7);
    });

    it('strips the suffix before reading when the suffix itself starts with a digit', () => {
      // `{0000}{YYYY}` is ambiguous by construction (the compile lint nudges
      // authors to a delimiter); the strip is what adds precision here.
      expect(readAutonumberCounter('00072026', '', '2026')).toBe(7);
    });

    it('reads leading zeros as the padded counter they are', () => {
      expect(readAutonumberCounter('D-0000', 'D-', '')).toBe(0);
      expect(readAutonumberCounter('D-0004', 'D-', '')).toBe(4);
    });
  });

  describe('values that teach this counter nothing read as undefined', () => {
    it('an unanchored slot — neither prefix nor suffix declared', () => {
      // Deliberately NOT answered here: the engine reads the LAST digit run and
      // the SQL driver concatenates every digit, both preserved byte-for-byte by
      // PR #6553. Spec refuses rather than picking one of the two.
      expect(readAutonumberCounter('SO-2024-0007', '', '')).toBeUndefined();
      expect(readAutonumberCounter('10', '', '')).toBeUndefined();
    });

    it('a value from another scope', () => {
      expect(readAutonumberCounter('OTHER-900-2026', 'CASE-', '-2026')).toBeUndefined();
    });

    it('a value shorter than the affixes it is read against', () => {
      expect(readAutonumberCounter('CA', 'CASE-', '-2026')).toBeUndefined();
      expect(readAutonumberCounter('', 'CASE-', '')).toBeUndefined();
      expect(readAutonumberCounter('', '', '-2026')).toBeUndefined();
    });

    it('a non-numeric tail after the prefix', () => {
      expect(readAutonumberCounter('CASE-DRAFT', 'CASE-', '')).toBeUndefined();
      expect(readAutonumberCounter('CASE-', 'CASE-', '')).toBeUndefined();
      // The digits are there but not where the format puts them.
      expect(readAutonumberCounter('CASE-X-0007', 'CASE-', '')).toBeUndefined();
    });

    it('a value whose whole content IS the suffix', () => {
      expect(readAutonumberCounter('-2026', '', '-2026')).toBeUndefined();
    });

    it('a counter too long to parse to a finite number', () => {
      // `parseInt` of a ~400-digit run overflows to Infinity; an Infinite max
      // would poison the counter, so it reads as "nothing" instead.
      expect(readAutonumberCounter(`D-${'9'.repeat(400)}`, 'D-', '')).toBeUndefined();
    });
  });

  it('is prefix-exact — a longer prefix does not match a shorter scope', () => {
    expect(readAutonumberCounter('CASE-001', 'CASE-2026-', '')).toBeUndefined();
    expect(readAutonumberCounter('case-001', 'CASE-', '')).toBeUndefined();
  });
});
