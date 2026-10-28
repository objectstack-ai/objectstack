// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The text after a hole's `|` is split into a formatter name and an argument by
 * one tokenizer (`splitHoleFormatter`) and judged by one function
 * (`judgeHoleFormatter`) in both template dialects, so a formatter part one
 * dialect accepts is never one the other refuses or prints. A name that is not
 * one word (`{{ due | date-long }}`, `{{ x | two words }}`) is refused by the
 * `formatter-shape` rule: the mail grammar used to answer `null` for it, and
 * the mail renderer printed the hole to the reader as written.
 */
import { describe, expect, it } from 'vitest';

import { judgeMailHoleGrammar, parseMailHole } from './mail-hole-grammar';
import { judgeHoleFormatter, splitHoleFormatter, TEMPLATE_FORMATTERS, templateEngine } from './template-engine';

/** Formatter parts on both sides of the grammar, each with its verdict in both dialects. */
const PARTS: ReadonlyArray<readonly [part: string, accepted: boolean]> = [
  ['upper', true],
  ['currency:EUR', true],
  ['currency :EUR', true],
  ["currency : 'USD'", true],
  ['date :long', true],
  ["default:it's", true],
  ["default:'n/a'", true],
  ['default:"n/a"', true],
  ['number: 2', true],
  ['upper:', true],
  ['date-long', false],
  ['two words', false],
  ['', false],
  [': EUR', false],
  ['date-long:x', false],
  ['curency:EUR', false],
  ['curency :EUR', false],
  ['upper | lower', false],
  ['currency:eur', false],
];

describe('splitHoleFormatter', () => {
  it('splits at the first colon, trims both sides and removes one enclosing quote mark at each end', () => {
    expect(splitHoleFormatter('upper')).toEqual({ name: 'upper' });
    expect(splitHoleFormatter('currency :EUR')).toEqual({ name: 'currency', arg: 'EUR' });
    expect(splitHoleFormatter("default: 'n/a' ")).toEqual({ name: 'default', arg: 'n/a' });
    expect(splitHoleFormatter('default:"n/a"')).toEqual({ name: 'default', arg: 'n/a' });
    expect(splitHoleFormatter("default:it's")).toEqual({ name: 'default', arg: "it's" });
    expect(splitHoleFormatter('date-long')).toEqual({ name: 'date-long' });
    expect(splitHoleFormatter('')).toEqual({ name: '' });
  });
});

describe('the formatter-shape rule', () => {
  it('⭐ refuses a name that is not one word, naming the hole and the shape and listing every known formatter', () => {
    const refusal = judgeHoleFormatter('{{ due | date-long }}', 'date-long', 'date-long', undefined);
    expect(refusal?.rule).toBe('formatter-shape');
    expect(refusal?.message).toContain('{{ due | date-long }}');
    expect(refusal?.message).toContain("writes 'date-long' where the formatter name goes");
    expect(refusal?.message).toContain('`{{ path | formatter[:arg] }}`');
    expect(refusal?.message).toContain(`Known formatters: ${TEMPLATE_FORMATTERS.join(', ')}.`);
  });

  it('says so when nothing follows the `|`', () => {
    expect(judgeHoleFormatter('{{ x | }}', '', '', undefined)?.message).toContain('writes no formatter name after the `|`');
  });

  it('leaves a chained hole to the one-formatter rule', () => {
    expect(judgeHoleFormatter('{{ x | date-long | upper }}', 'date-long | upper', 'date-long | upper', undefined)?.rule)
      .toBe('one-formatter');
  });
});

describe('the mail grammar', () => {
  it('⭐ parses a path followed by `|` as a hole, carrying the refusal of a formatter part that is not a formatter', () => {
    expect(parseMailHole(' due | date-long ')).toMatchObject({
      path: 'due',
      formatter: 'date-long',
      refusal: { rule: 'formatter-shape' },
    });
    expect(parseMailHole(' x | two words ')?.refusal?.rule).toBe('formatter-shape');
    expect(parseMailHole(' x | ')?.refusal?.rule).toBe('formatter-shape');
    expect(parseMailHole(' x | date-long:x ')?.refusal?.rule).toBe('formatter-shape');
  });

  it('reads the parts the in-app dialect accepts the way it reads them', () => {
    expect(parseMailHole(' amount | currency :EUR ')).toEqual({ path: 'amount', formatter: 'currency', arg: 'EUR' });
    expect(parseMailHole(" note | default:it's ")).toEqual({ path: 'note', formatter: 'default', arg: "it's" });
    expect(parseMailHole(' note | default:"n/a" ')).toEqual({ path: 'note', formatter: 'default', arg: 'n/a' });
    expect(parseMailHole(' amount | currency :@currency_code ')).toEqual({
      path: 'amount',
      formatter: 'currency',
      arg: '@currency_code',
      codePath: 'currency_code',
    });
  });

  it('leaves text whose part before any `|` is not a path verbatim: it is not a hole', () => {
    for (const inner of [' not a path ', '', ' | upper ', ' a b | upper ', ' | date-long ', ' <b ']) {
      expect(parseMailHole(inner), inner).toBeNull();
    }
  });

  it('locates each refused hole of a face, triple-braced included', () => {
    const face = 'Due {{ due | date-long }}, {{ amount | currency :EUR }} for {{{ who | two words }}}';
    expect(judgeMailHoleGrammar(face).map((f) => [f.text, f.start, f.refusal.rule])).toEqual([
      ['{{ due | date-long }}', 4, 'formatter-shape'],
      ['{{{ who | two words }}}', 60, 'formatter-shape'],
    ]);
  });
});

describe('the two dialects', () => {
  it('⭐ accept exactly the same formatter parts', () => {
    for (const [part, accepted] of PARTS) {
      const inApp = templateEngine.compile(`{{ record.x | ${part} }}`).ok;
      const mail = parseMailHole(` x | ${part} `);
      expect(inApp, `in-app: ${part}`).toBe(accepted);
      expect(mail !== null && mail.refusal === undefined, `mail: ${part}`).toBe(accepted);
    }
  });

  it('the in-app dialect keeps its own sentence for a name that is not one word', () => {
    const r = templateEngine.compile('{{ record.due | date-long }}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.message).toContain('invalid template hole');
    expect(r.error.message).not.toContain('formatter name goes');
  });
});
