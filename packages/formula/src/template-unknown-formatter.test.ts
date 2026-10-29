// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A hole's formatter is one the whitelist names (`known-formatter`), judged by
 * `judgeHoleFormatter` for the mail grammar (`parseMailHole` /
 * `judgeMailHoleGrammar`), which the mail renderer, the lint rule and the
 * publish door read. The mail renderer used to print the raw value for any
 * other name (`{{ amount | curency:EUR }}` sent `1234.5`); the in-app dialect
 * already refused such a hole in its own parse, and keeps doing so.
 */
import { describe, expect, it } from 'vitest';

import { judgeMailHoleGrammar, parseMailHole } from './mail-hole-grammar';
import { judgeHoleFormatter, TEMPLATE_FORMATTERS, templateEngine } from './template-engine';

describe('a formatter the whitelist does not name', () => {
  it('⭐ is refused by name, the refusal naming the hole and listing every known formatter', () => {
    const refusal = judgeHoleFormatter('{{ amount | curency:EUR }}', 'curency:EUR', 'curency', 'EUR');
    expect(refusal?.rule).toBe('known-formatter');
    expect(refusal?.message).toContain('{{ amount | curency:EUR }}');
    expect(refusal?.message).toContain("the formatter 'curency'");
    expect(refusal?.message).toContain(`Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}.`);
  });

  it('every whitelisted formatter passes the rule', () => {
    expect(TEMPLATE_FORMATTERS.length).toBeGreaterThan(0);
    for (const name of TEMPLATE_FORMATTERS) {
      const arg = name === 'currency' ? 'EUR' : undefined;
      expect(judgeHoleFormatter(`{{ x | ${name} }}`, name, name, arg), name).toBeNull();
    }
  });

  it('an inherited object key is not a formatter', () => {
    for (const name of ['toString', 'constructor', 'hasOwnProperty']) {
      expect(judgeHoleFormatter(`{{ x | ${name} }}`, name, name, undefined)?.rule, name).toBe('known-formatter');
    }
  });

  it('a chained hole is refused by the one-formatter rule first', () => {
    expect(judgeHoleFormatter('{{ x | curency | upper }}', 'curency | upper', 'curency', undefined)?.rule)
      .toBe('one-formatter');
  });

  it('text after the `|` that is not a word is refused by the formatter-shape rule, never left verbatim', () => {
    expect(judgeHoleFormatter('{{ x | two words }}', 'two words', 'two words', undefined)?.rule).toBe('formatter-shape');
    expect(parseMailHole(' x | two words ')?.refusal?.rule).toBe('formatter-shape');
  });
});

describe('the mail grammar', () => {
  it('⭐ parses the hole as a hole carrying the refusal', () => {
    expect(parseMailHole(' amount | curency:EUR ')).toMatchObject({
      path: 'amount',
      formatter: 'curency',
      arg: 'EUR',
      refusal: { rule: 'known-formatter' },
    });
    expect(parseMailHole(' due | dat:long ')?.refusal?.rule).toBe('known-formatter');
    expect(parseMailHole(' due | Date ')?.refusal?.rule).toBe('known-formatter');
  });

  it('locates each refused hole of a face, triple-braced included, and passes the known ones', () => {
    const face = 'Due {{ amount | currency:EUR }} on {{ due | dat:long }} at {{{ link | lowr }}}';
    expect(judgeMailHoleGrammar(face).map((f) => [f.text, f.start, f.refusal.rule])).toEqual([
      ['{{ due | dat:long }}', 35, 'known-formatter'],
      ['{{{ link | lowr }}}', 59, 'known-formatter'],
    ]);
    expect(judgeMailHoleGrammar('Due {{ amount | currency:EUR }} on {{ due | date:long }}')).toEqual([]);
  });
});

describe('the in-app dialect', () => {
  it('still refuses an unknown formatter at compile with its own sentence', () => {
    const r = templateEngine.compile('{{ record.amount | curency:EUR }}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('invalid template hole');
    expect(r.error.message).toContain(`Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}.`);
  });

  it('refuses an inherited object key it used to call as a formatter', () => {
    const r = templateEngine.compile('{{ record.amount | toString }}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain("the formatter 'toString'");
  });
});
