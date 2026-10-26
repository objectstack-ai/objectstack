/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { ExpressionEvaluator, evaluatePlainCondition } from '../ExpressionEvaluator';
import { ExpressionContext } from '../ExpressionContext';
import { SafeExpressionParser } from '../SafeExpressionParser';

describe('ExpressionContext', () => {
  it('should create context with initial data', () => {
    const ctx = new ExpressionContext({ name: 'John', age: 30 });
    expect(ctx.get('name')).toBe('John');
    expect(ctx.get('age')).toBe(30);
  });

  it('should support nested property access', () => {
    const ctx = new ExpressionContext({
      user: {
        name: 'John',
        profile: {
          email: 'john@example.com'
        }
      }
    });
    
    expect(ctx.get('user.name')).toBe('John');
    expect(ctx.get('user.profile.email')).toBe('john@example.com');
  });

  it('should support scope stacking', () => {
    const ctx = new ExpressionContext({ x: 10 });
    expect(ctx.get('x')).toBe(10);
    
    ctx.pushScope({ x: 20, y: 30 });
    expect(ctx.get('x')).toBe(20);
    expect(ctx.get('y')).toBe(30);
    
    ctx.popScope();
    expect(ctx.get('x')).toBe(10);
    expect(ctx.get('y')).toBeUndefined();
  });
});

describe('ExpressionEvaluator', () => {
  describe('evaluate', () => {
    it('should evaluate simple template expressions', () => {
      const evaluator = new ExpressionEvaluator({ name: 'John' });
      expect(evaluator.evaluate('Hello ${name}!')).toBe('Hello John!');
    });

    it('should evaluate nested property access', () => {
      const evaluator = new ExpressionEvaluator({
        data: { amount: 1500 }
      });
      expect(evaluator.evaluate('Amount: ${data.amount}')).toBe('Amount: 1500');
    });

    it('should handle non-string values', () => {
      const evaluator = new ExpressionEvaluator({});
      expect(evaluator.evaluate(true)).toBe(true);
      expect(evaluator.evaluate(42)).toBe(42);
      expect(evaluator.evaluate(null)).toBe(null);
    });
  });

  describe('evaluateExpression', () => {
    it('should evaluate comparison operators', () => {
      const evaluator = new ExpressionEvaluator({ data: { amount: 1500 } });
      
      expect(evaluator.evaluateExpression('data.amount > 1000')).toBe(true);
      expect(evaluator.evaluateExpression('data.amount < 1000')).toBe(false);
    });

    it('should block dangerous expressions', () => {
      const evaluator = new ExpressionEvaluator({});
      
      expect(() => evaluator.evaluateExpression('eval("malicious")')).toThrow();
      expect(() => evaluator.evaluateExpression('process.exit()')).toThrow();
    });
  });

  describe('evaluateCondition', () => {
    it('should return boolean for condition expressions', () => {
      const evaluator = new ExpressionEvaluator({ data: { age: 25 } });
      
      expect(evaluator.evaluateCondition('${data.age >= 18}')).toBe(true);
      expect(evaluator.evaluateCondition('${data.age < 18}')).toBe(false);
    });

    it('should handle boolean values directly', () => {
      const evaluator = new ExpressionEvaluator({});

      expect(evaluator.evaluateCondition(true)).toBe(true);
      expect(evaluator.evaluateCondition(false)).toBe(false);
    });
  });

  // #2661 — a `{ dialect: 'cel' }` predicate must route to the canonical
  // @objectstack/formula engine (like fieldRules / list conditionals), NOT the
  // legacy JS evaluator, so component/action `visible`/`disabled` verdicts match
  // the server. Bare strings and `${…}` templates stay on the legacy path.
  describe('evaluateCondition — CEL dialect routing (#2661)', () => {
    const cel = (source: string) => ({ dialect: 'cel' as const, source });

    it('evaluates a CEL envelope on the canonical engine (CEL `in`, not JS `in`)', () => {
      // CEL: `x in list` is list membership → true. Legacy JS `in` checks object
      // keys/array indices → false. The divergence proves the canonical route.
      const evaluator = new ExpressionEvaluator({ record: { roles: ['admin'] } });
      expect(evaluator.evaluateCondition(cel("'admin' in record.roles"))).toBe(true);
      expect(evaluator.evaluateCondition(cel("'editor' in record.roles"))).toBe(false);
    });

    it('binds record.* and the host scope (features.*) for a CEL envelope', () => {
      const evaluator = new ExpressionEvaluator({
        record: { status: 'open' },
        features: { beta: true },
      });
      expect(evaluator.evaluateCondition(cel('record.status == "open" && features.beta'))).toBe(true);
      expect(evaluator.evaluateCondition(cel('record.status == "closed"'))).toBe(false);
    });

    it('resolves an ISO date field against today() with an ordering comparison', () => {
      // today() is a canonical stdlib fn absent from the legacy evaluator; the
      // string date field hydrates on the CEL ordering path (framework #1530).
      const iso = new Date().toISOString().slice(0, 10);
      const evaluator = new ExpressionEvaluator({ record: { due: iso } });
      expect(evaluator.evaluateCondition(cel('record.due <= today()'))).toBe(true);
      expect(evaluator.evaluateCondition(cel('record.due >= today()'))).toBe(true);
    });

    it('fails soft to visible/enabled on a faulting CEL predicate (legacy parity)', () => {
      const evaluator = new ExpressionEvaluator({ record: {} });
      // `record.nope.deep` faults; default (no throwOnError) → true.
      expect(evaluator.evaluateCondition(cel('record.nope.deep == 1'))).toBe(true);
    });

    it('throws on a faulting CEL predicate when throwOnError is set (fail-closed)', () => {
      const evaluator = new ExpressionEvaluator({ record: { x: 2 } });
      // Missing-key deep access faults in CEL → throws under throwOnError.
      expect(() => evaluator.evaluateCondition(cel('record.a.b.c == 1'), { throwOnError: true })).toThrow();
      // A genuine `false` (field present, predicate simply false) must NOT throw.
      expect(evaluator.evaluateCondition(cel('record.x == 1'), { throwOnError: true })).toBe(false);
    });

    it('an empty CEL source is "no predicate" → visible/enabled', () => {
      const evaluator = new ExpressionEvaluator({ record: { x: 1 } });
      expect(evaluator.evaluateCondition(cel('   '))).toBe(true);
    });

    it('leaves bare strings and `${…}` templates on the legacy JS path (back-compat)', () => {
      const evaluator = new ExpressionEvaluator({ data: { age: 25 }, record: { roles: ['admin'] } });
      // `${…}` template — legacy JS.
      expect(evaluator.evaluateCondition('${data.age >= 18}')).toBe(true);
      // A `{ dialect: 'template' }` envelope is NOT rerouted — unwrapped to source
      // and run on the legacy path (here a bare non-`${}` string → its own value).
      expect(evaluator.evaluateCondition({ dialect: 'template', source: '${data.age < 18}' })).toBe(false);
    });
  });
});

describe('evaluatePlainCondition', () => {
  it('should evaluate a plain condition with direct field references', () => {
    expect(evaluatePlainCondition("status == 'overdue'", { status: 'overdue' })).toBe(true);
    expect(evaluatePlainCondition("status == 'overdue'", { status: 'active' })).toBe(false);
  });

  it('should evaluate numeric comparisons', () => {
    expect(evaluatePlainCondition('amount > 1000', { amount: 2500 })).toBe(true);
    expect(evaluatePlainCondition('amount > 1000', { amount: 500 })).toBe(false);
  });

  it('should evaluate compound conditions', () => {
    expect(evaluatePlainCondition("amount > 1000 && status === 'urgent'", { amount: 2000, status: 'urgent' })).toBe(true);
    expect(evaluatePlainCondition("amount > 1000 && status === 'urgent'", { amount: 2000, status: 'normal' })).toBe(false);
  });

  it('should support data.field references in template expressions', () => {
    expect(evaluatePlainCondition('${data.amount > 1000}', { amount: 2000 })).toBe(true);
    expect(evaluatePlainCondition('${data.amount > 1000}', { amount: 500 })).toBe(false);
  });

  it('should return false for invalid expressions', () => {
    expect(evaluatePlainCondition('!!!invalidSyntax', { status: 'ok' })).toBe(false);
  });

  it('should return false for non-boolean results', () => {
    expect(evaluatePlainCondition('status', { status: 'active' })).toBe(false);
  });
});

// ─── CSP Safety Tests ──────────────────────────────────────────────────────
//
// These tests verify that expression evaluation does NOT rely on eval() or
// new Function() and therefore works under strict Content Security Policy
// headers that forbid 'unsafe-eval'.
//
// The SafeExpressionParser is the CSP-safe backend used by ExpressionCache.
// All tests below exercise it directly as well as through ExpressionEvaluator.

describe('SafeExpressionParser — CSP-safe evaluation', () => {
  const parser = new SafeExpressionParser();

  describe('does not use eval() or new Function()', () => {
    it('evaluates comparison operators without dynamic code execution', () => {
      // This is the exact expression from the bug report.
      expect(
        parser.evaluate(
          "stage !== 'closed_won' && stage !== 'closed_lost'",
          { stage: 'open' }
        )
      ).toBe(true);

      expect(
        parser.evaluate(
          "stage !== 'closed_won' && stage !== 'closed_lost'",
          { stage: 'closed_won' }
        )
      ).toBe(false);

      expect(
        parser.evaluate(
          "stage !== 'closed_won' && stage !== 'closed_lost'",
          { stage: 'closed_lost' }
        )
      ).toBe(false);
    });

    it('evaluates strict equality operators (===, !==)', () => {
      expect(parser.evaluate("status === 'active'", { status: 'active' })).toBe(true);
      expect(parser.evaluate("status === 'active'", { status: 'inactive' })).toBe(false);
      expect(parser.evaluate("status !== 'active'", { status: 'inactive' })).toBe(true);
    });

    it('evaluates loose equality operators (==, !=)', () => {
      expect(parser.evaluate('count == 0', { count: 0 })).toBe(true);
      expect(parser.evaluate('count != 0', { count: 1 })).toBe(true);
    });

    it('evaluates relational operators (>, <, >=, <=)', () => {
      expect(parser.evaluate('score >= 90', { score: 95 })).toBe(true);
      expect(parser.evaluate('score >= 90', { score: 85 })).toBe(false);
      expect(parser.evaluate('score <= 90', { score: 85 })).toBe(true);
      expect(parser.evaluate('score > 50 && score < 100', { score: 75 })).toBe(true);
    });

    it('evaluates logical operators (&&, ||, !)', () => {
      expect(parser.evaluate('isAdmin && isActive', { isAdmin: true, isActive: true })).toBe(true);
      expect(parser.evaluate('isAdmin && isActive', { isAdmin: true, isActive: false })).toBe(false);
      expect(parser.evaluate('isAdmin || isGuest', { isAdmin: false, isGuest: true })).toBe(true);
      expect(parser.evaluate('!isSuspended', { isSuspended: false })).toBe(true);
      expect(parser.evaluate('!isSuspended', { isSuspended: true })).toBe(false);
    });

    it('evaluates ternary expressions', () => {
      expect(parser.evaluate("score >= 90 ? 'A' : 'B'", { score: 95 })).toBe('A');
      expect(parser.evaluate("score >= 90 ? 'A' : 'B'", { score: 75 })).toBe('B');
    });

    it('evaluates nested ternary expressions', () => {
      const expr = "status === 'active' ? 'success' : status === 'pending' ? 'warning' : 'default'";
      expect(parser.evaluate(expr, { status: 'active' })).toBe('success');
      expect(parser.evaluate(expr, { status: 'pending' })).toBe('warning');
      expect(parser.evaluate(expr, { status: 'closed' })).toBe('default');
    });

    it('evaluates arithmetic operators', () => {
      expect(parser.evaluate('price * quantity', { price: 10, quantity: 5 })).toBe(50);
      expect(parser.evaluate('total - discount', { total: 100, discount: 15 })).toBe(85);
      expect(parser.evaluate('total / count', { total: 60, count: 3 })).toBe(20);
      expect(parser.evaluate('value % 3', { value: 10 })).toBe(1);
    });

    it('evaluates parenthesized expressions', () => {
      expect(parser.evaluate('(a + b) * c', { a: 2, b: 3, c: 4 })).toBe(20);
    });

    it('evaluates unary operators', () => {
      expect(parser.evaluate('-amount', { amount: 5 })).toBe(-5);
      expect(parser.evaluate('+amount', { amount: '42' })).toBe(42);
      expect(parser.evaluate('!flag', { flag: false })).toBe(true);
    });

    it('evaluates typeof operator', () => {
      expect(parser.evaluate('typeof name', { name: 'Alice' })).toBe('string');
      expect(parser.evaluate('typeof count', { count: 42 })).toBe('number');
    });
  });

  describe('property and method access', () => {
    it('evaluates dot notation property access', () => {
      expect(parser.evaluate('user.name', { user: { name: 'Alice' } })).toBe('Alice');
      expect(parser.evaluate('user.address.city', {
        user: { address: { city: 'London' } }
      })).toBe('London');
    });

    it('evaluates bracket notation property access', () => {
      expect(parser.evaluate("record['status']", { record: { status: 'active' } })).toBe('active');
      expect(parser.evaluate('arr[0]', { arr: ['first', 'second'] })).toBe('first');
    });

    it('evaluates optional chaining (?.) gracefully', () => {
      expect(parser.evaluate('user?.address?.city', { user: null })).toBeUndefined();
      expect(parser.evaluate('user?.address?.city', { user: { address: { city: 'NYC' } } })).toBe('NYC');
    });

    it('evaluates string method calls', () => {
      expect(parser.evaluate('name.toUpperCase()', { name: 'hello' })).toBe('HELLO');
      expect(parser.evaluate('name.toLowerCase()', { name: 'WORLD' })).toBe('world');
      expect(parser.evaluate('name.trim()', { name: '  hi  ' })).toBe('hi');
      expect(parser.evaluate("name.includes('ell')", { name: 'hello' })).toBe(true);
    });

    it('evaluates array methods with arrow functions', () => {
      const items = [
        { name: 'apple', price: 1.5, active: true },
        { name: 'banana', price: 0.75, active: false },
        { name: 'cherry', price: 3.0, active: true },
      ];
      expect(
        parser.evaluate('items.filter(i => i.active).length', { items })
      ).toBe(2);
      expect(
        parser.evaluate('items.map(i => i.name).join(", ")', { items })
      ).toBe('apple, banana, cherry');
      expect(
        parser.evaluate('items.filter(i => i.price > 1).length', { items })
      ).toBe(2);
    });

    it('evaluates chained array method calls', () => {
      const users = [
        { name: 'Alice', isActive: true },
        { name: 'Bob', isActive: false },
        { name: 'Carol', isActive: true },
      ];
      expect(
        parser.evaluate('users.filter(u => u.isActive).map(u => u.name).join(", ")', { users })
      ).toBe('Alice, Carol');
    });

    it('evaluates array .length property', () => {
      expect(parser.evaluate('items.length === 0', { items: [] })).toBe(true);
      expect(parser.evaluate('items.length', { items: [1, 2, 3] })).toBe(3);
    });

    it('evaluates number method calls', () => {
      expect(parser.evaluate('price.toFixed(2)', { price: 3.14159 })).toBe('3.14');
    });

    it('evaluates Math global functions', () => {
      expect(parser.evaluate('Math.round(value)', { value: 3.7 })).toBe(4);
      expect(parser.evaluate('Math.floor(value)', { value: 3.9 })).toBe(3);
      expect(parser.evaluate('Math.abs(value)', { value: -5 })).toBe(5);
      expect(parser.evaluate('Math.max(a, b)', { a: 10, b: 7 })).toBe(10);
    });
  });

  describe('literals', () => {
    it('evaluates boolean literals', () => {
      expect(parser.evaluate('true', {})).toBe(true);
      expect(parser.evaluate('false', {})).toBe(false);
    });

    it('evaluates null and undefined literals', () => {
      expect(parser.evaluate('null', {})).toBeNull();
      expect(parser.evaluate('undefined', {})).toBeUndefined();
    });

    it('evaluates numeric literals', () => {
      expect(parser.evaluate('42', {})).toBe(42);
      expect(parser.evaluate('3.14', {})).toBeCloseTo(3.14);
      expect(parser.evaluate('1e3', {})).toBe(1000);
    });

    it('evaluates string literals with single and double quotes', () => {
      expect(parser.evaluate("'hello'", {})).toBe('hello');
      expect(parser.evaluate('"world"', {})).toBe('world');
    });

    it('evaluates string escape sequences', () => {
      expect(parser.evaluate("'line1\\nline2'", {})).toBe('line1\nline2');
      expect(parser.evaluate("'tab\\there'", {})).toBe('tab\there');
    });

    it('evaluates array literals', () => {
      expect(parser.evaluate('[1, 2, 3]', {})).toEqual([1, 2, 3]);
      expect(parser.evaluate("['a', 'b']", {})).toEqual(['a', 'b']);
    });

    it('evaluates NaN and Infinity literals', () => {
      expect(parser.evaluate('Infinity', {})).toBe(Infinity);
      expect(Number.isNaN(parser.evaluate('NaN', {}) as number)).toBe(true);
    });
  });

  describe('nullish coalescing', () => {
    it('evaluates ?? operator', () => {
      expect(parser.evaluate('value ?? "default"', { value: null })).toBe('default');
      expect(parser.evaluate('value ?? "default"', { value: undefined })).toBe('default');
      expect(parser.evaluate('value ?? "default"', { value: 0 })).toBe(0);
      expect(parser.evaluate('value ?? "default"', { value: '' })).toBe('');
    });
  });

  describe('short-circuit evaluation', () => {
    it('|| does not evaluate RHS when LHS is truthy', () => {
      // 'missingVar' is not in context — would throw ReferenceError without short-circuit.
      expect(parser.evaluate('true || missingVar', {})).toBe(true);
    });

    it('&& does not evaluate RHS when LHS is falsy', () => {
      expect(parser.evaluate('false && missingVar', {})).toBe(false);
    });

    it('?? does not evaluate RHS when LHS is not nullish', () => {
      expect(parser.evaluate('"present" ?? missingVar', {})).toBe('present');
      expect(parser.evaluate('0 ?? missingVar', {})).toBe(0);
      expect(parser.evaluate('"" ?? missingVar', {})).toBe('');
    });

    it('?? DOES evaluate RHS when LHS is null/undefined', () => {
      expect(parser.evaluate('null ?? "fallback"', {})).toBe('fallback');
      expect(parser.evaluate('undefined ?? "fallback"', {})).toBe('fallback');
    });

    it('ternary true branch: does not evaluate false branch', () => {
      expect(parser.evaluate("true ? 'yes' : missingVar", {})).toBe('yes');
    });

    it('ternary false branch: does not evaluate true branch', () => {
      expect(parser.evaluate("false ? missingVar : 'no'", {})).toBe('no');
    });

    it('nested ternary short-circuits correctly', () => {
      const expr = "status === 'a' ? 'alpha' : status === 'b' ? 'beta' : 'other'";
      expect(parser.evaluate(expr, { status: 'a' })).toBe('alpha');
      expect(parser.evaluate(expr, { status: 'b' })).toBe('beta');
      expect(parser.evaluate(expr, { status: 'c' })).toBe('other');
    });
  });

  describe('sandbox security', () => {
    it('blocks constructor property access via dot notation', () => {
      expect(() =>
        parser.evaluate('name.constructor', { name: 'hello' })
      ).toThrow(TypeError);
    });

    it('blocks constructor property access via bracket notation', () => {
      expect(() =>
        parser.evaluate("name['constructor']", { name: 'hello' })
      ).toThrow(TypeError);
    });

    it('blocks __proto__ access', () => {
      expect(() =>
        parser.evaluate('obj.__proto__', { obj: {} })
      ).toThrow(TypeError);
    });

    it('blocks prototype access', () => {
      expect(() =>
        parser.evaluate('fn.prototype', { fn: () => {} })
      ).toThrow(TypeError);
    });

    it('blocks constructor method calls', () => {
      expect(() =>
        parser.evaluate("name['constructor']('return 1')()", { name: 'hello' })
      ).toThrow(TypeError);
    });

    it('does not expose String/Number/Boolean/Array globals (removed to prevent .constructor escape)', () => {
      expect(() => parser.evaluate('String', {})).toThrow(ReferenceError);
      expect(() => parser.evaluate('Number', {})).toThrow(ReferenceError);
      expect(() => parser.evaluate('Boolean', {})).toThrow(ReferenceError);
      expect(() => parser.evaluate('Array', {})).toThrow(ReferenceError);
    });
  });

  describe('error handling', () => {
    it('throws ReferenceError for undefined identifiers', () => {
      expect(() => parser.evaluate('nonExistentVar', {})).toThrow(ReferenceError);
    });

    it('returns undefined gracefully for missing property access (no throw)', () => {
      expect(parser.evaluate('user.missingProp', { user: {} })).toBeUndefined();
      expect(parser.evaluate('user.address.city', { user: {} })).toBeUndefined();
    });

    it('throws SyntaxError for unclosed parentheses', () => {
      // Use a valid inner expression so the error is about the missing ')' not the content.
      expect(() => parser.evaluate('(1 + 2', {})).toThrow(SyntaxError);
    });

    it('throws SyntaxError for unclosed array literal', () => {
      expect(() => parser.evaluate('[1, 2', {})).toThrow(SyntaxError);
    });

    it('throws SyntaxError for malformed numeric exponent (e.g. 1e)', () => {
      // '1e' has no exponent digits — the stricter parser rejects it.
      expect(() => parser.evaluate('1e', {})).toThrow(SyntaxError);
    });
  });
});

describe('ExpressionEvaluator — CSP safety integration', () => {
  it('evaluates the bug-report expression without CSP violation', () => {
    // Exact expression from the bug report that was blocked by CSP in production.
    const evaluator = new ExpressionEvaluator({ stage: 'open' });
    expect(
      evaluator.evaluate("${stage !== 'closed_won' && stage !== 'closed_lost'}")
    ).toBe(true);

    const evaluator2 = new ExpressionEvaluator({ stage: 'closed_won' });
    expect(
      evaluator2.evaluate("${stage !== 'closed_won' && stage !== 'closed_lost'}")
    ).toBe(false);
  });

  it('supports all comparison operators via the safe parser', () => {
    const e = new ExpressionEvaluator({ a: 10, b: 10, c: 5 });
    expect(e.evaluateExpression('a === b')).toBe(true);
    expect(e.evaluateExpression('a !== c')).toBe(true);
    expect(e.evaluateExpression('a > c')).toBe(true);
    expect(e.evaluateExpression('c < a')).toBe(true);
    expect(e.evaluateExpression('a >= b')).toBe(true);
    expect(e.evaluateExpression('c <= a')).toBe(true);
  });

  it('supports logical operators via the safe parser', () => {
    const e = new ExpressionEvaluator({ x: true, y: false });
    expect(e.evaluateExpression('x && !y')).toBe(true);
    expect(e.evaluateExpression('x || y')).toBe(true);
    expect(e.evaluateExpression('!x || !y')).toBe(true);
  });

  it('supports ternary expressions via the safe parser', () => {
    const e = new ExpressionEvaluator({ score: 95 });
    expect(e.evaluateExpression("score >= 90 ? 'A' : 'B'")).toBe('A');
  });

  it('supports property access via the safe parser', () => {
    const e = new ExpressionEvaluator({ user: { role: 'admin', isActive: true } });
    expect(e.evaluateExpression("user.role === 'admin'")).toBe(true);
    expect(e.evaluateExpression('user.isActive')).toBe(true);
  });

  it('supports arithmetic via the safe parser', () => {
    const e = new ExpressionEvaluator({ price: 10, qty: 5 });
    expect(e.evaluateExpression('price * qty')).toBe(50);
  });

  it('supports arrow-function array methods via the safe parser', () => {
    const e = new ExpressionEvaluator({
      items: [{ price: 50 }, { price: 150 }, { price: 200 }],
    });
    expect(e.evaluateExpression('items.filter(item => item.price > 100).length')).toBe(2);
  });

  it('supports formula functions via the safe parser', () => {
    const e = new ExpressionEvaluator({ values: [10, 20, 30] });
    expect(e.evaluateExpression('SUM(values)')).toBe(60);
    expect(e.evaluateExpression('AVG(values)')).toBe(20);
  });

  it('supports Math global via the safe parser', () => {
    const e = new ExpressionEvaluator({ value: 3.7 });
    expect(e.evaluateExpression('Math.round(value)')).toBe(4);
  });

  it('does not use eval() or new Function() during evaluation', () => {
    // Spy on both to ensure they are NEVER called (via construct OR apply).
    const originalEval = globalThis.eval;
    const originalFunction = Function;
    const evalCalls: string[] = [];
    const functionCalls: string[] = [];

    globalThis.eval = (...args: Parameters<typeof eval>) => {
      evalCalls.push(String(args[0]));
      return originalEval(...args);
    };

    const FunctionProxy = new Proxy(Function, {
      construct(target, args) {
        functionCalls.push(`new Function(${String(args)})`);
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        // Catches indirect calls like: Function('return 1')() or String['constructor']('...')
        functionCalls.push(`Function(${String(args)})`);
        return Reflect.apply(target, thisArg, args);
      },
    });
    (globalThis as any).Function = FunctionProxy;

    try {
      const e = new ExpressionEvaluator({
        stage: 'open',
        data: { amount: 1500 },
        items: [{ active: true }, { active: false }],
      });
      e.evaluate("${stage !== 'closed_won' && stage !== 'closed_lost'}");
      e.evaluateExpression('data.amount > 1000');
      e.evaluateExpression('items.filter(i => i.active).length');

      expect(evalCalls).toHaveLength(0);
      expect(functionCalls).toHaveLength(0);
    } finally {
      globalThis.eval = originalEval;
      (globalThis as any).Function = originalFunction;
    }
  });
});

/**
 * The case-fold contract stated in `ExpressionEvaluator.registerFunction`'s
 * JSDoc. These pin the half that is NOT self-evident: the spelling handed to
 * `registerFunction` is not the spelling an expression can call, and getting it
 * wrong is silent rather than loud. Registering `'DOUBLE'` and then calling
 * `DOUBLE(...)` would prove none of that — every assertion below is one that a
 * case-preserving `registerFunction` (objectui#5363 direction 2) would turn
 * red, which is precisely the wanted signal if that behaviour is ever changed:
 * the JSDoc on the method would have silently become wrong.
 */
describe('ExpressionEvaluator.registerFunction - documented case-fold', () => {
  const evaluatorWithDouble = () => {
    const evaluator = new ExpressionEvaluator({ x: 5 });
    evaluator.registerFunction('double', (n: number) => n * 2);
    return evaluator;
  };

  it('stores under the upper-cased name, so only that spelling resolves in an expression', () => {
    const evaluator = evaluatorWithDouble();

    expect(evaluator.evaluateExpression('DOUBLE(x)')).toBe(10);
    expect(() => evaluator.evaluateExpression('double(x)')).toThrow(/"double" is not a function/);
  });

  it('renders the raw template source, not an error, when the call site uses the registered spelling', () => {
    const evaluator = evaluatorWithDouble();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(evaluator.evaluate('${DOUBLE(x)}')).toBe(10);
      // Not a throw, not an empty string: the template's own source, verbatim.
      // This soft-fail is what makes the fold easy to miss on screen.
      expect(evaluator.evaluate('${double(x)}')).toBe('${double(x)}');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the registry API case-insensitive, which is why the fold stays invisible until an expression runs', () => {
    const evaluator = evaluatorWithDouble();

    expect(evaluator.getFormulas().has('double')).toBe(true);
    expect(typeof evaluator.getFormulas().get('double')).toBe('function');
    // ...but the key the expression scope is built from is the folded one.
    expect(evaluator.getFormulas().getNames()).toContain('DOUBLE');
    expect(evaluator.getFormulas().getNames()).not.toContain('double');
  });
});
