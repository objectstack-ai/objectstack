/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { convertFiltersToAST, convertOperatorToAST, type FilterNode } from '../filter-converter';

describe('Filter Converter Utilities', () => {
  describe('convertOperatorToAST', () => {
    it('should convert known operators', () => {
      expect(convertOperatorToAST('$eq')).toBe('=');
      expect(convertOperatorToAST('$ne')).toBe('!=');
      expect(convertOperatorToAST('$gt')).toBe('>');
      expect(convertOperatorToAST('$gte')).toBe('>=');
      expect(convertOperatorToAST('$lt')).toBe('<');
      expect(convertOperatorToAST('$lte')).toBe('<=');
      expect(convertOperatorToAST('$in')).toBe('in');
      expect(convertOperatorToAST('$nin')).toBe('nin');
      expect(convertOperatorToAST('$contains')).toBe('contains');
      expect(convertOperatorToAST('$notContains')).toBe('notcontains');
      expect(convertOperatorToAST('$startsWith')).toBe('startswith');
      expect(convertOperatorToAST('$endsWith')).toBe('endswith');
      expect(convertOperatorToAST('$between')).toBe('between');
    });

    it('should return null for unknown operators', () => {
      expect(convertOperatorToAST('$unknown')).toBe(null);
      expect(convertOperatorToAST('$exists')).toBe(null);
    });

    // objectui#8568 retired the four lowercase aliases. They are answered by
    // name one layer up, in `convertFiltersToAST` — this function has no error
    // channel, so `null` is all it can say. The named refusal and the spec
    // derivation behind it are pinned in filter-alias-retirement-8568.test.ts.
    it('should return null for the retired lowercase aliases (objectui#8568)', () => {
      expect(convertOperatorToAST('$notin')).toBe(null);
      expect(convertOperatorToAST('$notcontains')).toBe(null);
      expect(convertOperatorToAST('$startswith')).toBe(null);
      expect(convertOperatorToAST('$endswith')).toBe(null);
    });
  });

  describe('convertFiltersToAST', () => {
    it('should convert simple equality filter', () => {
      const result = convertFiltersToAST({ status: 'active' });
      expect(result).toEqual(['status', '=', 'active']);
    });

    it('should convert single operator filter', () => {
      const result = convertFiltersToAST({ age: { $gte: 18 } });
      expect(result).toEqual(['age', '>=', 18]);
    });

    it('should convert multiple operators on same field', () => {
      const result = convertFiltersToAST({ age: { $gte: 18, $lte: 65 } }) as FilterNode;
      expect(result[0]).toBe('and');
      expect(result.slice(1)).toContainEqual(['age', '>=', 18]);
      expect(result.slice(1)).toContainEqual(['age', '<=', 65]);
    });

    it('should convert multiple fields with and logic', () => {
      const result = convertFiltersToAST({
        age: { $gte: 18 },
        status: 'active'
      }) as FilterNode;
      expect(result[0]).toBe('and');
      expect(result.slice(1)).toContainEqual(['age', '>=', 18]);
      expect(result.slice(1)).toContainEqual(['status', '=', 'active']);
    });

    it('should handle $in operator', () => {
      const result = convertFiltersToAST({
        status: { $in: ['active', 'pending'] }
      });
      expect(result).toEqual(['status', 'in', ['active', 'pending']]);
    });

    it('should handle $nin operator', () => {
      const result = convertFiltersToAST({
        status: { $nin: ['archived'] }
      });
      expect(result).toEqual(['status', 'nin', ['archived']]);
    });

    /**
     * This used to assert the opposite — `$regex` converted to `contains`
     * behind a `console.warn`. The example it used is the argument against it:
     * `$regex: '^John'` means "starts with John", while `contains '^John'`
     * looks for a literal caret, so "John Smith" does NOT match. The rewrite
     * answered a different question and returned a result that looks fine.
     *
     * A `console.warn` is not an error channel in a deployed app, the spec has
     * no `$regex` to translate into (`FILTER_OPERATORS`, data/filter.zod.ts),
     * and the neighbouring unknown-operator case already throws for exactly
     * this reason. So it is refused.
     */
    it('should refuse $regex rather than answer with a substring match', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => convertFiltersToAST({ name: { $regex: '^John' } }))
        .toThrow(/\$regex/);
      // Refused loudly, not warned about quietly.
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should tag both refusals as a rejected request, not a network fault', () => {
      // A bare `Error` reads as "check your connection" in the list error panel
      // (#3066) — the one thing a malformed filter definitely is not.
      for (const bad of [{ n: { $regex: 'x' } }, { n: { $unknown: 1 } }]) {
        expect(() => convertFiltersToAST(bad as any)).toThrow();
        try {
          convertFiltersToAST(bad as any);
        } catch (e: any) {
          expect(e.code).toBe('INVALID_FILTER');
          expect(e.httpStatus).toBe(400);
        }
      }
    });

    it('should throw error on unknown operator', () => {
      expect(() => {
        convertFiltersToAST({ age: { $unknown: 18 } });
      }).toThrow('[ObjectUI] Unknown filter operator');
    });

    it('should skip null and undefined values', () => {
      const result = convertFiltersToAST({
        name: 'John',
        age: null,
        email: undefined
      });
      expect(result).toEqual(['name', '=', 'John']);
    });

    it('should answer "no constraint" when every key was skipped', () => {
      // UPDATED by objectui#9020. This used to pin the caller's ORIGINAL OBJECT
      // coming back, which is what made one filter mean two things on the two
      // `find()` routes of `@object-ui/data-objectstack`: the plain route
      // dropped it (every row) while the `$expand` route shipped it as
      // `filter={"age":null}`, a real predicate. The skip itself is unchanged —
      // the case above still pins it — so the only thing this key can mean once
      // it is alone is what it already means beside a sibling: nothing.
      const result = convertFiltersToAST({
        age: null,
        email: undefined
      });
      expect(result).toBeUndefined();
    });
  });
});
