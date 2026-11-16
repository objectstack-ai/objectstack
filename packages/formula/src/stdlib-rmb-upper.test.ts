import { describe, expect, it } from 'vitest';

import { celEngine } from './cel-engine';
import { inferExpressionType, validateExpression } from './validate';

/**
 * `rmbUpper(amount)` — an amount as Chinese capital numerals (人民币大写), the
 * line a Chinese quote, contract or invoice prints under the total. The rules
 * are in `rmb-upper.ts`; every expectation here is evaluated through the
 * engine, the way a formula field reads it.
 */

function value(source: string, record: Record<string, unknown> = {}): unknown {
  const r = celEngine.evaluate({ dialect: 'cel', source }, { record });
  if (!r.ok) throw new Error(`${source}: ${r.error.kind}: ${r.error.message}`);
  return r.value;
}

/** The text of a record's `amount`, read the way a formula field over it reads it. */
const upper = (amount: unknown) => value('rmbUpper(record.amount)', { amount });

describe('rmbUpper — the amounts on the card', () => {
  it.each([
    [245000, '贰拾肆万伍仟元整'],
    [245000.0, '贰拾肆万伍仟元整'],
    [10500.5, '壹万零伍佰元伍角'],
  ])('%s → %s', (amount, text) => {
    expect(upper(amount)).toBe(text);
  });
});

describe('rmbUpper — places, groups and 零', () => {
  it.each([
    [1, '壹元整'],
    [10, '壹拾元整'],
    [15, '壹拾伍元整'],
    [100, '壹佰元整'],
    [101, '壹佰零壹元整'],
    [110, '壹佰壹拾元整'],
    [1005, '壹仟零伍元整'],
    [1050, '壹仟零伍拾元整'],
    [1500, '壹仟伍佰元整'],
    [10000, '壹万元整'],
    [10001, '壹万零壹元整'],
    [10010, '壹万零壹拾元整'],
    [10500, '壹万零伍佰元整'],
    [11000, '壹万壹仟元整'],
    [100000, '壹拾万元整'],
    [107000, '壹拾万柒仟元整'],
    [1000000, '壹佰万元整'],
    [1001000, '壹佰万壹仟元整'],
    [1000100, '壹佰万零壹佰元整'],
    [100000000, '壹亿元整'],
    [100000001, '壹亿零壹元整'],
    [100010000, '壹亿零壹万元整'],
    [110000000, '壹亿壹仟万元整'],
    [101000000, '壹亿零壹佰万元整'],
    [123456789, '壹亿贰仟叁佰肆拾伍万陆仟柒佰捌拾玖元整'],
    [1000000000000, '壹万亿元整'],
    [10000100000000, '壹拾万零壹亿元整'],
    // Beyond 2^53 as text: a double cannot hold it.
    ['9999999999999999', '玖仟玖佰玖拾玖万玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元整'],
  ])('%s → %s', (amount, text) => {
    expect(upper(amount)).toBe(text);
  });
});

describe('rmbUpper — 角, 分 and 整', () => {
  it.each([
    [0, '零元整'],
    [0.5, '伍角'],
    [0.05, '伍分'],
    [0.55, '伍角伍分'],
    [1.5, '壹元伍角'],
    [1.05, '壹元零伍分'],
    [1.55, '壹元伍角伍分'],
    [1680.32, '壹仟陆佰捌拾元叁角贰分'],
    [100.1, '壹佰元壹角'],
    [100.01, '壹佰元零壹分'],
  ])('%s → %s', (amount, text) => {
    expect(upper(amount)).toBe(text);
  });
});

describe('rmbUpper — rounding to 分, half away from zero, on the exact decimal', () => {
  it.each([
    // 1.005 is 1.00499999999999989… as a double; the decimal it spells rounds up.
    [1.005, '壹元零壹分'],
    [2.675, '贰元陆角捌分'],
    [0.004, '零元整'],
    [0.005, '壹分'],
    [9.995, '壹拾元整'],
    [-1.005, '负壹元零壹分'],
  ])('%s → %s', (amount, text) => {
    expect(upper(amount)).toBe(text);
  });
});

describe('rmbUpper — negatives', () => {
  it.each([
    [-1, '负壹元整'],
    [-1200, '负壹仟贰佰元整'],
    [-10500.5, '负壹万零伍佰元伍角'],
    [-0.05, '负伍分'],
    [-0.004, '零元整'],
  ])('%s → %s', (amount, text) => {
    expect(upper(amount)).toBe(text);
  });
});

describe('rmbUpper — what it reads', () => {
  it('an int literal and a double literal', () => {
    expect(value('rmbUpper(10500)')).toBe('壹万零伍佰元整');
    expect(value('rmbUpper(10500.5)')).toBe('壹万零伍佰元伍角');
  });

  it('the decimal text a currency column is answered with', () => {
    expect(upper('245000.00')).toBe('贰拾肆万伍仟元整');
    expect(upper(' 10500.50 ')).toBe('壹万零伍佰元伍角');
    expect(upper('1e4')).toBe('壹万元整');
  });

  it('arithmetic on the record, the shape of a total', () => {
    expect(value('rmbUpper(record.qty * record.price)', { qty: 2, price: 5250.25 })).toBe('壹万零伍佰元伍角');
    // 3 × 0.1 is 0.30000000000000004 as a double: the 分 rounding absorbs it.
    expect(value('rmbUpper(record.qty * record.price)', { qty: 3, price: 0.1 })).toBe('叁角');
  });

  it('null reads the empty string, so an empty total prints an empty line', () => {
    expect(upper(null)).toBe('');
  });
});

describe('rmbUpper — what it refuses', () => {
  it.each([
    ['text that spells no decimal', 'abc'],
    ['a currency symbol', '¥100'],
    ['a boolean', true],
    ['a list', [1]],
  ])('%s is a runtime error, never some amount', (_label, amount) => {
    const r = celEngine.evaluate({ dialect: 'cel', source: 'rmbUpper(record.amount)' }, { record: { amount } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('rmbUpper(amount)');
  });

  it('10^16 yuan and above is refused, not written as 亿亿', () => {
    const r = celEngine.evaluate({ dialect: 'cel', source: 'rmbUpper(record.amount)' }, { record: { amount: '10000000000000000' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('too large');
    // CONTROL — one 分 below the limit is written.
    expect(upper('9999999999999999.99')).toBe(
      '玖仟玖佰玖拾玖万玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分',
    );
  });
});

describe('rmbUpper — an exponent spelling is judged before it is converted', () => {
  /** Evaluate and time one call; every row must answer well inside a second. */
  function timed(amount: string) {
    const started = performance.now();
    const r = celEngine.evaluate({ dialect: 'cel', source: 'rmbUpper(record.amount)' }, { record: { amount } });
    return { r, ms: performance.now() - started };
  }

  it.each([
    ['1e3', '壹仟元整'],
    ['1.05e2', '壹佰零伍元整'],
    ['10500.5e0', '壹万零伍佰元伍角'],
    ['1050050e-2', '壹万零伍佰元伍角'],
    ['9.999999999999999e15', '玖仟玖佰玖拾玖万玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元整'],
    ['5e-3', '壹分'],
    ['4.99e-3', '零元整'],
  ])('%s → %s', (amount, text) => {
    expect(upper(amount)).toBe(text);
  });

  it.each(['1e16', '1e400', '1e200000000', '9'.repeat(400), '1e' + '9'.repeat(400)])(
    '%s is refused as too large, promptly',
    (amount) => {
      const { r, ms } = timed(amount);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain('too large');
      expect(ms).toBeLessThan(1000);
    },
  );

  it.each(['1e-400', '1e-999999999', '-1e-999999999', '0e-999999999', '0e999999999', '0.' + '0'.repeat(100_000) + '1'])(
    'an amount below 0.001 (here %#) is 零元整, promptly',
    (amount) => {
      const { r, ms } = timed(amount);
      expect(r).toEqual({ ok: true, value: '零元整' });
      expect(ms).toBeLessThan(1000);
    },
  );

  it.each(['9999999999999999.995', '-9999999999999999.995', '9.9999999999999999995e15'])(
    '%s rounds up to 10^16 yuan and is refused as too large, never written as 亿亿',
    (amount) => {
      const { r } = timed(amount);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toContain('too large');
    },
  );

  it('CONTROL — one 0.001 below that rounds down and is written', () => {
    expect(upper('9999999999999999.994')).toBe(
      '玖仟玖佰玖拾玖万玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分',
    );
    expect(upper('-9999999999999999.994')).toBe(
      '负玖仟玖佰玖拾玖万玖仟玖佰玖拾玖亿玖仟玖佰玖拾玖万玖仟玖佰玖拾玖元玖角玖分',
    );
  });

  it('digits below the 0.001 place never move the rounding', () => {
    expect(upper('1.0049' + '9'.repeat(1000))).toBe('壹元整');
    expect(upper('1.005' + '0'.repeat(1000))).toBe('壹元零壹分');
  });
});

describe('rmbUpper — authoring', () => {
  it('a formula over a currency field validates, and is typed text', () => {
    const schema = { fields: ['total'], fieldTypes: { total: 'currency' }, scope: 'record' as const };
    const r = validateExpression('value', 'rmbUpper(record.total)', schema);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(inferExpressionType('rmbUpper(record.total)', schema)).toBe('text');
  });
});
