/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { SafeExpressionParser } from '../SafeExpressionParser';

/**
 * Security + correctness tests for the CSP-safe expression parser.
 *
 * The parser is the trust boundary between JSON-defined schemas and the
 * runtime — any sandbox escape here means a schema can call arbitrary
 * code. The security suite at the bottom is the most important part of
 * this file and should NEVER regress.
 */
const p = new SafeExpressionParser();
const ev = (expr: string, ctx: Record<string, unknown> = {}) => p.evaluate(expr, ctx);

describe('SafeExpressionParser — literals & arithmetic', () => {
  it('evaluates numeric literals (int, float, negative)', () => {
    expect(ev('42')).toBe(42);
    expect(ev('3.14')).toBe(3.14);
    expect(ev('-5')).toBe(-5);
  });

  it('evaluates string literals (single + double quotes)', () => {
    expect(ev("'hello'")).toBe('hello');
    expect(ev('"world"')).toBe('world');
  });

  it('evaluates boolean and null/undefined keywords', () => {
    expect(ev('true')).toBe(true);
    expect(ev('false')).toBe(false);
    expect(ev('null')).toBe(null);
    expect(ev('undefined')).toBe(undefined);
  });

  it('respects operator precedence', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('(1 + 2) * 3')).toBe(9);
    expect(ev('10 - 2 - 3')).toBe(5);
    expect(ev('10 / 2 / 5')).toBe(1);
  });

  it('supports modulo', () => {
    expect(ev('10 % 3')).toBe(1);
  });
});

describe('SafeExpressionParser — comparisons & logic', () => {
  it('strict vs loose equality', () => {
    expect(ev('1 === 1')).toBe(true);
    expect(ev("1 === '1'")).toBe(false);
    expect(ev("1 == '1'")).toBe(true);
    expect(ev('1 !== 2')).toBe(true);
  });

  it('relational operators', () => {
    expect(ev('5 > 3')).toBe(true);
    expect(ev('3 >= 3')).toBe(true);
    expect(ev('2 < 3')).toBe(true);
    expect(ev('2 <= 2')).toBe(true);
  });

  it('logical && short-circuits without evaluating RHS', () => {
    let touched = false;
    const sideEffect = () => {
      touched = true;
      return true;
    };
    expect(ev('false && side()', { side: sideEffect })).toBe(false);
    expect(touched).toBe(false);
  });

  it('logical || short-circuits without evaluating RHS', () => {
    let touched = false;
    const sideEffect = () => {
      touched = true;
      return false;
    };
    expect(ev('true || side()', { side: sideEffect })).toBe(true);
    expect(touched).toBe(false);
  });

  it('nullish coalescing (??) returns RHS only for null/undefined', () => {
    expect(ev('null ?? "fallback"')).toBe('fallback');
    expect(ev('undefined ?? 7')).toBe(7);
    expect(ev('0 ?? 99')).toBe(0); // 0 is NOT nullish
    expect(ev('"" ?? "fallback"')).toBe('');
  });

  it('typeof returns the JS type tag', () => {
    expect(ev('typeof 42')).toBe('number');
    expect(ev("typeof 'x'")).toBe('string');
    expect(ev('typeof undefined')).toBe('undefined');
    expect(ev('typeof null')).toBe('object');
  });

  it('unary negation and logical not', () => {
    expect(ev('!true')).toBe(false);
    expect(ev('!!1')).toBe(true);
    expect(ev('!0')).toBe(true);
  });
});

describe('SafeExpressionParser — ternary', () => {
  it('chooses the consequent or the alternate', () => {
    expect(ev('1 > 0 ? "yes" : "no"')).toBe('yes');
    expect(ev('1 < 0 ? "yes" : "no"')).toBe('no');
  });

  it('only evaluates the chosen branch', () => {
    let consequentRan = false;
    let alternateRan = false;
    ev('flag ? cons() : alt()', {
      flag: true,
      cons: () => {
        consequentRan = true;
        return 1;
      },
      alt: () => {
        alternateRan = true;
        return 2;
      },
    });
    expect(consequentRan).toBe(true);
    expect(alternateRan).toBe(false);
  });
});

describe('SafeExpressionParser — property access', () => {
  const ctx = {
    data: { name: 'Acme', address: { city: 'Beijing' }, tags: ['a', 'b'] },
  };

  it('dotted access', () => {
    expect(ev('data.name', ctx)).toBe('Acme');
    expect(ev('data.address.city', ctx)).toBe('Beijing');
  });

  it('bracket access with string keys', () => {
    expect(ev("data['name']", ctx)).toBe('Acme');
  });

  it('bracket access with numeric indices', () => {
    expect(ev('data.tags[0]', ctx)).toBe('a');
    expect(ev('data.tags[1]', ctx)).toBe('b');
  });

  it('optional chaining short-circuits on null/undefined', () => {
    expect(ev('data?.address?.city', ctx)).toBe('Beijing');
    expect(ev('data?.missing?.city', ctx)).toBe(undefined);
    expect(ev('missing?.x?.y', { ...ctx, missing: undefined })).toBe(undefined);
  });

  it('returns undefined for missing properties (no throw)', () => {
    expect(ev('data.missing', ctx)).toBe(undefined);
    expect(ev('data.missing.deeper', ctx)).toBe(undefined);
  });
});

describe('SafeExpressionParser — calls & arrow functions', () => {
  it('calls a function from the context', () => {
    expect(ev('greet(name)', { greet: (n: string) => `Hi ${n}`, name: 'Ada' })).toBe('Hi Ada');
  });

  it('calls a method on a value', () => {
    expect(ev('data.tags.includes("a")', { data: { tags: ['a', 'b'] } })).toBe(true);
  });

  it('arrow function in array filter', () => {
    const out = ev('items.filter(i => i.active).length', {
      items: [{ active: true }, { active: false }, { active: true }],
    });
    expect(out).toBe(2);
  });

  it('arrow function in array map', () => {
    const out = ev('nums.map(n => n * 2)', { nums: [1, 2, 3] });
    expect(out).toEqual([2, 4, 6]);
  });

  it('Math.max via SAFE_GLOBALS', () => {
    expect(ev('Math.max(1, 5, 3)')).toBe(5);
  });

  it('parseInt/parseFloat via SAFE_GLOBALS', () => {
    expect(ev("parseInt('42', 10)")).toBe(42);
    expect(ev("parseFloat('3.14')")).toBe(3.14);
  });
});

describe('SafeExpressionParser — SECURITY: sandbox escapes are blocked', () => {
  it('blocks `constructor` access (canonical Function reach)', () => {
    expect(() => ev('o.constructor', { o: {} })).toThrow(/constructor/);
    expect(() => ev('s.constructor', { s: '' })).toThrow(/constructor/);
    // Bracket form too:
    expect(() => ev("o['constructor']", { o: {} })).toThrow(/constructor/);
  });

  it('blocks __proto__ access (prototype pollution path)', () => {
    expect(() => ev('o.__proto__', { o: {} })).toThrow(/__proto__/);
    expect(() => ev("o['__proto__']", { o: {} })).toThrow(/__proto__/);
  });

  it('blocks `prototype` access', () => {
    expect(() => ev('arr.prototype', { arr: [] })).toThrow(/prototype/);
  });

  it('blocks legacy __defineGetter__/__defineSetter__', () => {
    expect(() => ev('o.__defineGetter__', { o: {} })).toThrow(/__defineGetter__/);
    expect(() => ev('o.__defineSetter__', { o: {} })).toThrow(/__defineSetter__/);
  });

  it('does NOT leak eval / Function / window / process from globals', () => {
    expect(() => ev('eval("1+1")')).toThrow();
    expect(() => ev('Function("return 1")()')).toThrow();
    expect(() => ev('window.alert("xss")')).toThrow();
    expect(() => ev('process.env')).toThrow();
  });

  it('rejects assignment-like syntax (no mutation through expressions)', () => {
    // The grammar doesn't include `=`. Anything that smells like assignment
    // should fail to parse as an unexpected token.
    expect(() => ev('x = 1', { x: 0 })).toThrow();
  });

  it('SAFE_GLOBALS does not include Array/String/Number constructors', () => {
    // Calling them would create instances and expose their .constructor.
    expect(() => ev('Array(1, 2, 3)')).toThrow();
    expect(() => ev("String('x')")).toThrow();
    expect(() => ev('Number(1)')).toThrow();
    expect(() => ev('Boolean(1)')).toThrow();
  });

  it('does not allow indirect constructor access via filter callback', () => {
    expect(() => ev('items.filter(i => i.constructor)', { items: [{}] })).toThrow(/constructor/);
  });
});

describe('SafeExpressionParser — error handling', () => {
  it('throws SyntaxError on trailing garbage', () => {
    expect(() => ev('1 + 1 garbage')).toThrow(SyntaxError);
  });

  it('throws SyntaxError on unbalanced parens', () => {
    expect(() => ev('(1 + 2')).toThrow();
  });

  it('throws on calling a non-function', () => {
    expect(() => ev('x()', { x: 42 })).toThrow();
  });

  it('throws ReferenceError on undefined identifiers in evaluated branches', () => {
    expect(() => ev('missing')).toThrow();
  });

  it('does NOT throw for undefined identifiers in dead branches', () => {
    // Short-circuit means `missing` is never resolved.
    expect(() => ev('true || missing')).not.toThrow();
    expect(() => ev('false && missing')).not.toThrow();
    expect(() => ev('null ?? "ok"')).not.toThrow();
  });
});

describe('SafeExpressionParser — common ObjectUI patterns', () => {
  it('visibility expressions over data context', () => {
    expect(ev('data.amount > 1000', { data: { amount: 1500 } })).toBe(true);
    expect(ev('data.amount > 1000', { data: { amount: 500 } })).toBe(false);
  });

  it('null-safe role checks', () => {
    expect(ev("user?.role === 'admin'", { user: { role: 'admin' } })).toBe(true);
    expect(ev("user?.role === 'admin'", { user: null })).toBe(false);
    expect(ev("user?.role === 'admin'", { user: undefined })).toBe(false);
  });

  it('stage gating with enum lists', () => {
    const ctx = { stage: 'closed_won' };
    expect(ev("['closed_won', 'closed_lost'].includes(stage)", ctx)).toBe(true);
  });

  it('count of related records', () => {
    expect(ev('data.related.length > 0', { data: { related: [1, 2] } })).toBe(true);
    expect(ev('data.related.length > 0', { data: { related: [] } })).toBe(false);
  });
});
