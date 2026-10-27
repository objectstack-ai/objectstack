// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The hole grammar both template dialects share (`judgeHoleFormatter`), read
 * through each dialect's own door: the in-app engine's compile/evaluate, and
 * the mail grammar (`parseMailHole` / `judgeMailHoleGrammar`) that the mail
 * renderer, the placement judge and the lint rule read.
 *
 * One formatter per hole: a second `|` used to be swallowed into the first
 * formatter's argument (`{{ x | default:0 | number:2 }}` printed `0 | number:2`).
 * The `currency` argument is a literal ISO 4217 code. A path is never read as
 * one: `Intl` refused it, and the formatter used to substitute USD.
 */
import { describe, expect, it } from 'vitest';

import { judgeMailHoleGrammar, parseMailHole } from './mail-hole-grammar';
import { formatValue, judgeHoleFormatter, templateEngine } from './template-engine';
import { validateExpression } from './validate';

const evaluate = (source: string, record: Record<string, unknown>) =>
  templateEngine.evaluate<string>({ dialect: 'template', source }, { record, locale: 'en-US' });

describe('one formatter per hole', () => {
  it.each([
    ['a second formatter after an argument', 'default:0 | number:2'],
    ['a second formatter after a bare one', 'upper | lower'],
    ['a second formatter after a closed quoted argument', "default:'N/A' | upper"],
    ['three formatters', 'trim | upper | lower'],
  ])('refuses %s, naming the one-formatter rule and the caller remedy', (_label, part) => {
    const refusal = judgeHoleFormatter(`{{ x | ${part} }}`, part, part.split(/[:|]/)[0].trim(), undefined);
    expect(refusal?.rule).toBe('one-formatter');
    expect(refusal?.message).toContain(`{{ x | ${part} }}`);
    expect(refusal?.message).toContain('a hole takes one formatter');
    expect(refusal?.message).toContain('in the caller that supplies the data');
  });

  it('a `|` inside a closed quoted argument is the argument\'s own text', () => {
    expect(judgeHoleFormatter("{{ x | default:'a | b' }}", "default:'a | b'", 'default', 'a | b')).toBeNull();
    expect(judgeHoleFormatter('{{ x | default:"a | b" }}', 'default:"a | b"', 'default', 'a | b')).toBeNull();
  });

  it('the in-app dialect refuses a chained hole at compile, with the rule — never the literal text', () => {
    for (const source of ['{{ record.n | default:0 | number:2 }}', '{{ record.n | upper | lower }}']) {
      const r = templateEngine.compile(source);
      expect(r.ok, source).toBe(false);
      if (r.ok) continue;
      expect(r.error.message).toContain('a hole takes one formatter');
      expect(evaluate(source, { n: null }).ok).toBe(false);
    }
    expect(validateExpression('template', { dialect: 'template', source: 'Paid {{ record.n | default:0 | number:2 }}' })
      .errors.map((e) => e.code)).toEqual(['invalid-template']);
  });

  it('the mail grammar parses a chained hole as a hole, carrying the refusal, in both shapes', () => {
    expect(parseMailHole(' actual_amount | default:0 | number:2 ')?.refusal?.rule).toBe('one-formatter');
    expect(parseMailHole(' actual_amount | upper | lower ')).toMatchObject({ path: 'actual_amount', refusal: { rule: 'one-formatter' } });
    const face = 'Paid {{ actual_amount | default:0 | number:2 }} of {{ planned_amount | number:2 }}';
    expect(judgeMailHoleGrammar(face).map((f) => [f.text, f.start, f.refusal.rule]))
      .toEqual([['{{ actual_amount | default:0 | number:2 }}', 5, 'one-formatter']]);
  });
});

describe('the currency argument is a literal ISO 4217 code', () => {
  it.each([
    ['a path', 'currency_code'],
    ['a dotted path', 'record.currency_code'],
    ['a lowercase code', 'eur'],
    ['a code of the wrong length', 'EURO'],
    ['an empty argument', ''],
  ])('refuses %s, naming the literal-only rule', (_label, arg) => {
    const refusal = judgeHoleFormatter(`{{ x | currency:${arg} }}`, `currency:${arg}`, 'currency', arg);
    expect(refusal?.rule).toBe('currency-code-literal');
    expect(refusal?.message).toContain('ISO 4217');
    expect(refusal?.message).toContain('never read as a path');
  });

  it('admits a capital three-letter code, quoted or bare, and no argument at all', () => {
    expect(judgeHoleFormatter('{{ x | currency:EUR }}', 'currency:EUR', 'currency', 'EUR')).toBeNull();
    expect(judgeHoleFormatter("{{ x | currency: 'USD' }}", "currency: 'USD'", 'currency', 'USD')).toBeNull();
    expect(judgeHoleFormatter('{{ x | currency }}', 'currency', 'currency', undefined)).toBeNull();
  });

  it('judges no other formatter\'s argument', () => {
    expect(judgeHoleFormatter('{{ x | number:2 }}', 'number:2', 'number', '2')).toBeNull();
    expect(judgeHoleFormatter('{{ x | default:currency_code }}', 'default:currency_code', 'default', 'currency_code')).toBeNull();
  });
});

describe('the in-app template dialect', () => {
  it('⭐ compile refuses a path argument to currency, naming the hole and the rule', () => {
    const r = templateEngine.compile('Due {{ record.amount | currency:currency_code }}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('parse');
    expect(r.error.message).toContain('{{ record.amount | currency:currency_code }}');
    expect(r.error.message).toContain('ISO 4217');
  });

  it('the authoring validator (`os validate`, the publish gate) refuses it as invalid-template', () => {
    const r = validateExpression('template', { dialect: 'template', source: 'Due {{ record.amount | currency:currency_code }}' });
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toEqual(['invalid-template']);
    expect(r.errors[0].message).toContain('ISO 4217');
  });

  it('evaluate refuses the same hole — it never formats the amount in USD', () => {
    const r = evaluate('{{ record.amount | currency:currency_code }}', { amount: 1234.5, currency_code: 'EUR' });
    expect(r.ok).toBe(false);
  });

  it('a literal code still formats in that currency, and no argument still formats in USD', () => {
    const eur = evaluate('{{ record.amount | currency:EUR }}', { amount: 1234.5 });
    expect(eur).toEqual({ ok: true, value: '€1,234.50' });
    const usd = evaluate('{{ record.amount | currency }}', { amount: 1234.5 });
    expect(usd).toEqual({ ok: true, value: '$1,234.50' });
  });
});

describe('the formatter itself never substitutes a currency', () => {
  it('⭐ throws on an argument that is not a code, instead of formatting in USD', () => {
    expect(() => formatValue('currency', 1234.5, 'currency_code', { locale: 'en-US' })).toThrow(RangeError);
    expect(() => formatValue('currency', 1234.5, 'currency_code', { locale: 'en-US' })).toThrow(/ISO 4217/);
    // …even for a value it would otherwise print empty, so the refusal does not depend on the data.
    expect(() => formatValue('currency', null, 'currency_code')).toThrow(RangeError);
  });

  it('formats a literal code, and the no-argument default, as before', () => {
    expect(formatValue('currency', 1234.5, 'EUR', { locale: 'en-US' })).toBe('€1,234.50');
    expect(formatValue('currency', 1234.5, undefined, { locale: 'en-US' })).toBe('$1,234.50');
  });
});

describe('the mail hole grammar', () => {
  it('parses a currency path argument as a hole, carrying the refusal', () => {
    const parsed = parseMailHole(' amount | currency:currency_code ');
    expect(parsed).toMatchObject({ path: 'amount', formatter: 'currency', arg: 'currency_code' });
    expect(parsed?.refusal?.rule).toBe('currency-code-literal');
    expect(parsed?.refusal?.message).toContain('{{ amount | currency:currency_code }}');
  });

  it('leaves text that is not a path unparsed — not a hole, nothing refused', () => {
    expect(parseMailHole(' not a path ')).toBeNull();
    expect(judgeMailHoleGrammar('{{ not a path | currency:x }}')).toEqual([]);
  });

  it('finds every refused hole of a face with its offset, and admits a literal code', () => {
    const face = 'Due {{ amount | currency:EUR }}, or {{ amount | currency:currency_code }}';
    const findings = judgeMailHoleGrammar(face);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ text: '{{ amount | currency:currency_code }}', start: face.indexOf('{{ amount | currency:currency_code') });
    expect(findings[0].refusal.rule).toBe('currency-code-literal');
  });

  it('a triple-braced hole is judged too', () => {
    expect(judgeMailHoleGrammar('{{{ amount | currency:currency_code }}}').map((f) => f.refusal.rule))
      .toEqual(['currency-code-literal']);
  });
});
