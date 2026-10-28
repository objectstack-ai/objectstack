// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `currency:@path` — a mail template reads the ISO 4217 code from the send's
 * data, so one template formats each record's amount in that record's
 * currency. The `@` mark keeps the form apart from the literal code
 * (`currency:EUR`) for every input; a bare path (`currency:currency_code`)
 * stays refused, pinned in `template-hole-grammar.test.ts`.
 *
 * The mail dialect admits the form; the in-app dialect refuses it by name
 * (`currency-code-path-mail-only`): its doors judge a hole's path against the
 * roots a slot binds and never read an argument.
 */
import { EmailTemplateDefinitionSchema, EmailTemplateDefinitionVariableSchema } from '@objectstack/spec/system';
import { describe, expect, it } from 'vitest';

import { judgeMailHoleGrammar, parseMailHole } from './mail-hole-grammar';
import {
  CURRENCY_ARGUMENT_RULE,
  currencyCodePath,
  currencyCodeValueRefusal,
  formatValue,
  judgeHoleFormatter,
  templateEngine,
} from './template-engine';
import { validateExpression } from './validate';

describe('the marked path form', () => {
  it.each([
    ['currency:@currency_code', 'currency_code'],
    ['currency: @contract.currency_code', 'contract.currency_code'],
    ['currency:@line_1.code', 'line_1.code'],
  ])('reads %s as the path %s', (part, path) => {
    expect(currencyCodePath(part)).toBe(path);
  });

  it.each([
    ['a bare path', 'currency:currency_code'],
    ['a literal code', 'currency:EUR'],
    ['a mark with no path', 'currency:@'],
    ['a space after the mark', 'currency:@ currency_code'],
    ['a quoted marked path', "currency:'@currency_code'"],
    ['an empty segment', 'currency:@a..b'],
    ['a trailing dot', 'currency:@a.'],
    ['a character outside a path', 'currency:@currency-code'],
    ['another formatter', 'default:@currency_code'],
    ['no argument', 'currency'],
  ])('reads %s as no path', (_label, part) => {
    expect(currencyCodePath(part)).toBeUndefined();
  });
});

describe('the mail dialect', () => {
  it('⭐ admits currency:@path and parses the path the renderer resolves', () => {
    expect(judgeHoleFormatter('{{ x | currency:@currency_code }}', 'currency:@currency_code', 'currency', '@currency_code', 'mail'))
      .toBeNull();
    expect(parseMailHole(' planned_amount | currency:@currency_code ')).toEqual({
      path: 'planned_amount',
      formatter: 'currency',
      arg: '@currency_code',
      codePath: 'currency_code',
    });
    expect(judgeMailHoleGrammar('Due {{ planned_amount | currency:@contract.currency_code }}')).toEqual([]);
    expect(judgeMailHoleGrammar('{{{ planned_amount | currency:@currency_code }}}')).toEqual([]);
  });

  it('a literal code carries no path', () => {
    expect(parseMailHole(' planned_amount | currency:EUR ')).toEqual({ path: 'planned_amount', formatter: 'currency', arg: 'EUR' });
  });

  it.each([
    ['a mark with no path', '@'],
    ['a space after the mark', '@ currency_code'],
    ['a quoted marked path', "'@currency_code'"],
    ['an empty segment', '@a..b'],
  ])('refuses %s as currency-code-literal, quoting the argument rule', (_label, arg) => {
    const [finding] = judgeMailHoleGrammar(`Due {{ amount | currency:${arg} }}`);
    expect(finding?.refusal.rule).toBe('currency-code-literal');
    expect(finding?.refusal.message).toContain(CURRENCY_ARGUMENT_RULE);
  });

  it('a bare path is still refused, and the mail refusal names the marked form', () => {
    const [finding] = judgeMailHoleGrammar('Due {{ amount | currency:currency_code }}');
    expect(finding?.refusal.rule).toBe('currency-code-literal');
    expect(finding?.refusal.message).toContain('never read as a path');
    expect(finding?.refusal.message).toContain('`currency:@currency_code`');
  });
});

describe('declared variables', () => {
  const face = 'Due {{ planned_amount | currency:@contract.currency_code }}';

  it('⭐ refuses a marked path no declared variable names, naming the hole, the path and the declarations', () => {
    const findings = judgeMailHoleGrammar(face, { variables: ['planned_amount', 'currency'] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ text: '{{ planned_amount | currency:@contract.currency_code }}', start: 4 });
    expect(findings[0].refusal.rule).toBe('currency-code-path-undeclared');
    expect(findings[0].refusal.message).toContain('`contract.currency_code`');
    expect(findings[0].refusal.message).toContain('`planned_amount`, `currency`');
    expect(findings[0].refusal.message).toContain(CURRENCY_ARGUMENT_RULE);
  });

  it('admits the path itself, or a root it lies under', () => {
    expect(judgeMailHoleGrammar(face, { variables: ['contract.currency_code'] })).toEqual([]);
    expect(judgeMailHoleGrammar(face, { variables: ['contract'] })).toEqual([]);
  });

  it('a template that declares none has its path judged at render instead', () => {
    expect(judgeMailHoleGrammar(face, { variables: [] })).toEqual([]);
    expect(judgeMailHoleGrammar(face)).toEqual([]);
  });

  it('a literal code is never judged against the declarations', () => {
    expect(judgeMailHoleGrammar('Due {{ amount | currency:EUR }}', { variables: ['other'] })).toEqual([]);
  });
});

describe('the value the path holds', () => {
  const hole = '{{ amount | currency:@currency_code }}';

  it('admits an ISO 4217 code in three capital letters, exactly as stored', () => {
    expect(currencyCodeValueRefusal(hole, 'currency_code', 'EUR')).toBeNull();
    expect(currencyCodeValueRefusal(hole, 'currency_code', 'CNY')).toBeNull();
  });

  it.each([
    ['missing', undefined, 'missing'],
    ['null', null, 'null'],
    ['a lowercase code', 'eur', "'eur'"],
    ['a padded code', ' EUR', "' EUR'"],
    ['a number', 978, 'number 978'],
    ['an object', { code: 'EUR' }, 'object {"code":"EUR"}'],
  ])('⭐ refuses %s, naming the hole, the path and the value', (_label, value, shown) => {
    const message = currencyCodeValueRefusal(hole, 'currency_code', value);
    expect(message).toContain(hole);
    expect(message).toContain('`currency_code`');
    expect(message).toContain(`is ${shown},`);
    expect(message).toContain(CURRENCY_ARGUMENT_RULE);
  });
});

describe('the in-app dialect refuses the marked form by name', () => {
  it('the judge refuses it by default', () => {
    const refusal = judgeHoleFormatter('{{ x | currency:@currency_code }}', 'currency:@currency_code', 'currency', '@currency_code');
    expect(refusal?.rule).toBe('currency-code-path-mail-only');
    expect(refusal?.message).toContain('only a mail template reads');
  });

  it('⭐ compile, the authoring validator and evaluate all refuse it — never a formatted amount', () => {
    const source = 'Due {{ record.amount | currency:@record.currency_code }}';
    const compiled = templateEngine.compile(source);
    expect(compiled.ok).toBe(false);
    if (!compiled.ok) {
      expect(compiled.error.kind).toBe('parse');
      expect(compiled.error.message).toContain('{{ record.amount | currency:@record.currency_code }}');
      expect(compiled.error.message).toContain('only a mail template reads');
    }
    const validated = validateExpression('template', { dialect: 'template', source });
    expect(validated.errors.map((e) => e.code)).toEqual(['invalid-template']);
    const evaluated = templateEngine.evaluate<string>(
      { dialect: 'template', source },
      { record: { amount: 1234.5, currency_code: 'EUR' }, locale: 'en-US' },
    );
    expect(evaluated.ok).toBe(false);
  });
});

describe('the formatter never reads a path', () => {
  it('throws for the marked form handed to it unresolved, instead of formatting in USD', () => {
    expect(() => formatValue('currency', 1234.5, '@currency_code', { locale: 'en-US' })).toThrow(RangeError);
  });
});

describe('the spec states the same rule', () => {
  it.each(['subject', 'bodyHtml', 'bodyText'] as const)('the email_template %s description quotes CURRENCY_ARGUMENT_RULE', (face) => {
    expect(EmailTemplateDefinitionSchema.shape[face].description).toContain(CURRENCY_ARGUMENT_RULE);
  });

  it('the variables description names the declared-path check', () => {
    expect(EmailTemplateDefinitionVariableSchema.shape.name.description).toContain('`currency:@path`');
  });
});
