/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { FormulaFunctions } from '../FormulaFunctions';
import { ExpressionEvaluator, evaluateExpression as evalExprFn } from '../ExpressionEvaluator';

describe('FormulaFunctions', () => {
  describe('Registry', () => {
    it('should register and retrieve custom functions', () => {
      const formulas = new FormulaFunctions();
      formulas.register('DOUBLE', (x: number) => x * 2);
      expect(formulas.has('DOUBLE')).toBe(true);
      expect(formulas.get('DOUBLE')!(5)).toBe(10);
    });

    it('should be case-insensitive', () => {
      const formulas = new FormulaFunctions();
      expect(formulas.has('sum')).toBe(true);
      expect(formulas.has('SUM')).toBe(true);
      expect(formulas.has('Sum')).toBe(true);
    });

    it('should list all registered function names', () => {
      const formulas = new FormulaFunctions();
      const names = formulas.getNames();
      expect(names).toContain('SUM');
      expect(names).toContain('AVG');
      expect(names).toContain('IF');
      expect(names).toContain('TODAY');
      expect(names).toContain('CONCAT');
    });

    it('should export functions as an object', () => {
      const formulas = new FormulaFunctions();
      const obj = formulas.toObject();
      expect(typeof obj.SUM).toBe('function');
      expect(typeof obj.IF).toBe('function');
    });
  });

  describe('Aggregation Functions', () => {
    it('SUM should sum numeric values', () => {
      const formulas = new FormulaFunctions();
      const SUM = formulas.get('SUM')!;
      expect(SUM(1, 2, 3)).toBe(6);
      expect(SUM(10, 20)).toBe(30);
    });

    it('SUM should handle arrays', () => {
      const formulas = new FormulaFunctions();
      const SUM = formulas.get('SUM')!;
      expect(SUM([1, 2, 3])).toBe(6);
      expect(SUM([10], [20])).toBe(30);
    });

    it('SUM should handle empty args', () => {
      const formulas = new FormulaFunctions();
      const SUM = formulas.get('SUM')!;
      expect(SUM()).toBe(0);
    });

    it('AVG should calculate average', () => {
      const formulas = new FormulaFunctions();
      const AVG = formulas.get('AVG')!;
      expect(AVG(10, 20, 30)).toBe(20);
      expect(AVG([2, 4, 6])).toBe(4);
    });

    it('AVG should return 0 for empty args', () => {
      const formulas = new FormulaFunctions();
      const AVG = formulas.get('AVG')!;
      expect(AVG()).toBe(0);
    });

    it('COUNT should count non-null values', () => {
      const formulas = new FormulaFunctions();
      const COUNT = formulas.get('COUNT')!;
      expect(COUNT(1, 2, 3)).toBe(3);
      expect(COUNT(1, null, undefined, 4)).toBe(2);
      expect(COUNT([1, null, 3])).toBe(2);
    });

    it('MIN should return minimum value', () => {
      const formulas = new FormulaFunctions();
      const MIN = formulas.get('MIN')!;
      expect(MIN(5, 3, 8, 1)).toBe(1);
      expect(MIN([10, 2, 7])).toBe(2);
    });

    it('MIN should return 0 for empty args', () => {
      const formulas = new FormulaFunctions();
      const MIN = formulas.get('MIN')!;
      expect(MIN()).toBe(0);
    });

    it('MAX should return maximum value', () => {
      const formulas = new FormulaFunctions();
      const MAX = formulas.get('MAX')!;
      expect(MAX(5, 3, 8, 1)).toBe(8);
      expect(MAX([10, 2, 7])).toBe(10);
    });

    it('MAX should return 0 for empty args', () => {
      const formulas = new FormulaFunctions();
      const MAX = formulas.get('MAX')!;
      expect(MAX()).toBe(0);
    });
  });

  describe('Date Functions', () => {
    it('TODAY should return current date string', () => {
      const formulas = new FormulaFunctions();
      const TODAY = formulas.get('TODAY')!;
      const result = TODAY();
      // Should be YYYY-MM-DD format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('NOW should return ISO timestamp', () => {
      const formulas = new FormulaFunctions();
      const NOW = formulas.get('NOW')!;
      const result = NOW();
      // Should be a valid ISO 8601 date
      expect(new Date(result).toISOString()).toBe(result);
    });

    it('DATEADD should add days', () => {
      const formulas = new FormulaFunctions();
      const DATEADD = formulas.get('DATEADD')!;
      const result = DATEADD('2025-01-01T00:00:00.000Z', 5, 'days');
      expect(new Date(result).getUTCDate()).toBe(6);
    });

    it('DATEADD should add months', () => {
      const formulas = new FormulaFunctions();
      const DATEADD = formulas.get('DATEADD')!;
      const result = DATEADD('2025-01-15T00:00:00.000Z', 2, 'months');
      expect(new Date(result).getUTCMonth()).toBe(2); // March (0-indexed)
    });

    it('DATEADD should add years', () => {
      const formulas = new FormulaFunctions();
      const DATEADD = formulas.get('DATEADD')!;
      const result = DATEADD('2025-06-15T00:00:00.000Z', 3, 'years');
      expect(new Date(result).getUTCFullYear()).toBe(2028);
    });

    it('DATEADD should throw for invalid date', () => {
      const formulas = new FormulaFunctions();
      const DATEADD = formulas.get('DATEADD')!;
      expect(() => DATEADD('invalid', 1, 'days')).toThrow('Invalid date');
    });

    it('DATEADD should throw for unsupported unit', () => {
      const formulas = new FormulaFunctions();
      const DATEADD = formulas.get('DATEADD')!;
      expect(() => DATEADD('2025-01-01', 1, 'weeks')).toThrow('Unsupported unit');
    });

    it('DATEDIFF should calculate day difference', () => {
      const formulas = new FormulaFunctions();
      const DATEDIFF = formulas.get('DATEDIFF')!;
      expect(DATEDIFF('2025-01-01', '2025-01-11', 'days')).toBe(10);
    });

    it('DATEDIFF should calculate month difference', () => {
      const formulas = new FormulaFunctions();
      const DATEDIFF = formulas.get('DATEDIFF')!;
      expect(DATEDIFF('2025-01-15', '2025-04-15', 'months')).toBe(3);
    });

    it('DATEDIFF should calculate year difference', () => {
      const formulas = new FormulaFunctions();
      const DATEDIFF = formulas.get('DATEDIFF')!;
      expect(DATEDIFF('2020-06-01', '2025-06-01', 'years')).toBe(5);
    });

    it('DATEDIFF should throw for invalid date', () => {
      const formulas = new FormulaFunctions();
      const DATEDIFF = formulas.get('DATEDIFF')!;
      expect(() => DATEDIFF('invalid', '2025-01-01', 'days')).toThrow('Invalid date');
    });
  });

  describe('Logic Functions', () => {
    it('IF should return trueValue when condition is truthy', () => {
      const formulas = new FormulaFunctions();
      const IF = formulas.get('IF')!;
      expect(IF(true, 'yes', 'no')).toBe('yes');
      expect(IF(1, 'yes', 'no')).toBe('yes');
    });

    it('IF should return falseValue when condition is falsy', () => {
      const formulas = new FormulaFunctions();
      const IF = formulas.get('IF')!;
      expect(IF(false, 'yes', 'no')).toBe('no');
      expect(IF(0, 'yes', 'no')).toBe('no');
      expect(IF(null, 'yes', 'no')).toBe('no');
    });

    it('AND should return true only when all args are truthy', () => {
      const formulas = new FormulaFunctions();
      const AND = formulas.get('AND')!;
      expect(AND(true, true, true)).toBe(true);
      expect(AND(true, false, true)).toBe(false);
      expect(AND(1, 'hello', true)).toBe(true);
    });

    it('OR should return true when any arg is truthy', () => {
      const formulas = new FormulaFunctions();
      const OR = formulas.get('OR')!;
      expect(OR(false, false, true)).toBe(true);
      expect(OR(false, false, false)).toBe(false);
      expect(OR(0, '', null)).toBe(false);
    });

    it('NOT should negate a value', () => {
      const formulas = new FormulaFunctions();
      const NOT = formulas.get('NOT')!;
      expect(NOT(true)).toBe(false);
      expect(NOT(false)).toBe(true);
      expect(NOT(0)).toBe(true);
      expect(NOT(1)).toBe(false);
    });

    it('SWITCH should match cases and return result', () => {
      const formulas = new FormulaFunctions();
      const SWITCH = formulas.get('SWITCH')!;
      expect(SWITCH('a', 'a', 1, 'b', 2, 'c', 3)).toBe(1);
      expect(SWITCH('b', 'a', 1, 'b', 2, 'c', 3)).toBe(2);
    });

    it('SWITCH should return default when no match', () => {
      const formulas = new FormulaFunctions();
      const SWITCH = formulas.get('SWITCH')!;
      expect(SWITCH('x', 'a', 1, 'b', 2, 'default')).toBe('default');
    });

    it('SWITCH should return undefined when no match and no default', () => {
      const formulas = new FormulaFunctions();
      const SWITCH = formulas.get('SWITCH')!;
      expect(SWITCH('x', 'a', 1, 'b', 2)).toBeUndefined();
    });
  });

  describe('String Functions', () => {
    it('CONCAT should join strings', () => {
      const formulas = new FormulaFunctions();
      const CONCAT = formulas.get('CONCAT')!;
      expect(CONCAT('Hello', ' ', 'World')).toBe('Hello World');
      expect(CONCAT('a', 'b', 'c')).toBe('abc');
    });

    it('CONCAT should handle null/undefined', () => {
      const formulas = new FormulaFunctions();
      const CONCAT = formulas.get('CONCAT')!;
      expect(CONCAT('Hello', null, 'World')).toBe('HelloWorld');
    });

    it('LEFT should return leftmost characters', () => {
      const formulas = new FormulaFunctions();
      const LEFT = formulas.get('LEFT')!;
      expect(LEFT('Hello World', 5)).toBe('Hello');
      expect(LEFT('Hi', 10)).toBe('Hi');
    });

    it('RIGHT should return rightmost characters', () => {
      const formulas = new FormulaFunctions();
      const RIGHT = formulas.get('RIGHT')!;
      expect(RIGHT('Hello World', 5)).toBe('World');
      expect(RIGHT('Hi', 10)).toBe('Hi');
    });

    it('TRIM should remove whitespace', () => {
      const formulas = new FormulaFunctions();
      const TRIM = formulas.get('TRIM')!;
      expect(TRIM('  hello  ')).toBe('hello');
      expect(TRIM(' test ')).toBe('test');
    });

    it('UPPER should convert to uppercase', () => {
      const formulas = new FormulaFunctions();
      const UPPER = formulas.get('UPPER')!;
      expect(UPPER('hello')).toBe('HELLO');
    });

    it('LOWER should convert to lowercase', () => {
      const formulas = new FormulaFunctions();
      const LOWER = formulas.get('LOWER')!;
      expect(LOWER('HELLO')).toBe('hello');
    });
  });

  describe('String Search Functions', () => {
    const formulas = new FormulaFunctions();

    it('should find substring position with FIND', () => {
      const FIND = formulas.get('FIND')!;
      expect(FIND('world', 'hello world')).toBe(6);
      expect(FIND('xyz', 'hello world')).toBe(-1);
    });

    it('should find substring from start position', () => {
      const FIND = formulas.get('FIND')!;
      expect(FIND('l', 'hello world', 4)).toBe(9);
    });

    it('should replace all occurrences with REPLACE', () => {
      const REPLACE = formulas.get('REPLACE')!;
      expect(REPLACE('hello world', 'o', '0')).toBe('hell0 w0rld');
    });

    it('should extract substring with SUBSTRING', () => {
      const SUBSTRING = formulas.get('SUBSTRING')!;
      expect(SUBSTRING('hello world', 6)).toBe('world');
      expect(SUBSTRING('hello world', 0, 5)).toBe('hello');
    });

    it('should test regex pattern with REGEX', () => {
      const REGEX = formulas.get('REGEX')!;
      expect(REGEX('hello123', '\\d+')).toBe(true);
      expect(REGEX('hello', '\\d+')).toBe(false);
      expect(REGEX('Hello', '^hello$', 'i')).toBe(true);
    });

    it('should get string length with LEN', () => {
      const LEN = formulas.get('LEN')!;
      expect(LEN('hello')).toBe(5);
      expect(LEN('')).toBe(0);
    });
  });

  describe('Statistical Functions', () => {
    const formulas = new FormulaFunctions();

    it('should calculate MEDIAN for odd count', () => {
      const MEDIAN = formulas.get('MEDIAN')!;
      expect(MEDIAN(3, 1, 2)).toBe(2);
    });

    it('should calculate MEDIAN for even count', () => {
      const MEDIAN = formulas.get('MEDIAN')!;
      expect(MEDIAN(1, 2, 3, 4)).toBe(2.5);
    });

    it('should return 0 for empty MEDIAN', () => {
      const MEDIAN = formulas.get('MEDIAN')!;
      expect(MEDIAN()).toBe(0);
    });

    it('should calculate STDEV', () => {
      const STDEV = formulas.get('STDEV')!;
      const result = STDEV(2, 4, 4, 4, 5, 5, 7, 9);
      // Sample standard deviation (Bessel's correction, divides by n-1)
      expect(result).toBeCloseTo(2.138, 2);
    });

    it('should return 0 for STDEV with less than 2 values', () => {
      const STDEV = formulas.get('STDEV')!;
      expect(STDEV(5)).toBe(0);
      expect(STDEV()).toBe(0);
    });

    it('should calculate VARIANCE', () => {
      const VARIANCE = formulas.get('VARIANCE')!;
      const result = VARIANCE(2, 4, 4, 4, 5, 5, 7, 9);
      // Sample variance (Bessel's correction, divides by n-1)
      expect(result).toBeCloseTo(4.571, 2);
    });

    it('should calculate PERCENTILE', () => {
      const PERCENTILE = formulas.get('PERCENTILE')!;
      expect(PERCENTILE(0, 1, 2, 3, 4, 5)).toBe(1);
      expect(PERCENTILE(100, 1, 2, 3, 4, 5)).toBe(5);
      expect(PERCENTILE(50, 1, 2, 3, 4, 5)).toBe(3);
    });

    it('should handle PERCENTILE with empty values', () => {
      const PERCENTILE = formulas.get('PERCENTILE')!;
      expect(PERCENTILE(50)).toBe(0);
    });
  });

  describe('DATEFORMAT Function', () => {
    const formulas = new FormulaFunctions();

    it('should format date with DATEFORMAT', () => {
      const DATEFORMAT = formulas.get('DATEFORMAT')!;
      const result = DATEFORMAT('2026-02-10T00:00:00.000Z', 'YYYY-MM-DD');
      expect(result).toBe('2026-02-10');
    });

    it('should throw for invalid date in DATEFORMAT', () => {
      const DATEFORMAT = formulas.get('DATEFORMAT')!;
      expect(() => DATEFORMAT('invalid', 'YYYY')).toThrow('DATEFORMAT: Invalid date');
    });
  });
});

describe('ExpressionEvaluator with Formula Functions', () => {
  it('should use SUM in expressions', () => {
    const evaluator = new ExpressionEvaluator({ values: [10, 20, 30] });
    expect(evaluator.evaluateExpression('SUM(values)')).toBe(60);
  });

  it('should use AVG in expressions', () => {
    const evaluator = new ExpressionEvaluator({ values: [10, 20, 30] });
    expect(evaluator.evaluateExpression('AVG(values)')).toBe(20);
  });

  it('should use IF in expressions', () => {
    const evaluator = new ExpressionEvaluator({ data: { age: 25 } });
    expect(evaluator.evaluateExpression('IF(data.age >= 18, "adult", "minor")')).toBe('adult');
  });

  it('should use CONCAT in template expressions', () => {
    const evaluator = new ExpressionEvaluator({ first: 'John', last: 'Doe' });
    expect(evaluator.evaluate('${CONCAT(first, " ", last)}')).toBe('John Doe');
  });

  it('should use UPPER in expressions', () => {
    const evaluator = new ExpressionEvaluator({ name: 'hello' });
    expect(evaluator.evaluateExpression('UPPER(name)')).toBe('HELLO');
  });

  it('should support nested formula calls', () => {
    const evaluator = new ExpressionEvaluator({ items: [10, 20, 30] });
    expect(evaluator.evaluateExpression('IF(SUM(items) > 50, "high", "low")')).toBe('high');
  });

  it('should support registering custom functions', () => {
    const evaluator = new ExpressionEvaluator({ x: 5 });
    evaluator.registerFunction('DOUBLE', (n: number) => n * 2);
    expect(evaluator.evaluateExpression('DOUBLE(x)')).toBe(10);
  });

  it('should use convenience function with formulas', () => {
    expect(evalExprFn('${SUM(1, 2, 3)}')).toBe(6);
    expect(evalExprFn('${IF(true, "yes", "no")}')).toBe('yes');
  });
});
