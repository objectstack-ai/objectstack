/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import { convertFiltersToAST, convertOperatorToAST, FilterOperatorError, type FilterNode } from '../filter-converter';

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

describe('the nested-relation node (objectstack#34990)', () => {
  /** The refusal a call throws, captured so its envelope can be asserted. */
  const refusalOf = (run: () => unknown): FilterOperatorError => {
    try {
      run();
    } catch (error) {
      return error as FilterOperatorError;
    }
    throw new Error('expected a refusal');
  };

  it('lowers a condition on the related record to one equality node the spec lowers back to the nested form', () => {
    const node = convertFiltersToAST({ account: { owner: 'u1' } });
    expect(node).toEqual(['account', '=', { owner: 'u1' }]);
    expect(parseFilterAST(node)).toEqual({ account: { owner: 'u1' } });
  });

  it('carries a deeper relation and the related condition\'s own operators verbatim', () => {
    const filter = { account: { parent: { kind: { $in: ['a', 'b'] } }, region: { $ne: 'x' } } };
    const node = convertFiltersToAST(filter);
    expect(node).toEqual(['account', '=', filter.account]);
    expect(parseFilterAST(node)).toEqual(filter);
  });

  it('sits beside plain conditions and inside a combinator like any other leaf', () => {
    expect(convertFiltersToAST({ status: 'open', account: { owner: 'u1' } }))
      .toEqual(['and', ['status', '=', 'open'], ['account', '=', { owner: 'u1' }]]);
    expect(convertFiltersToAST({ $or: [{ account: { owner: 'u1' } }, { status: 'won' }] }))
      .toEqual(['or', ['account', '=', { owner: 'u1' }], ['status', '=', 'won']]);
  });

  it('CONTROL: a map that mixes operators and plain keys is still an operator map, and is refused', () => {
    const refusal = refusalOf(() => convertFiltersToAST({ account: { $eq: 'a1', owner: 'u1' } }));
    expect(refusal).toBeInstanceOf(FilterOperatorError);
    expect({ code: refusal.code, status: refusal.httpStatus, operator: refusal.operator, field: refusal.field })
      .toEqual({ code: 'INVALID_FILTER', status: 400, operator: 'owner', field: 'account' });
  });

  it('CONTROL: an operator map and an empty map keep their answers', () => {
    expect(convertFiltersToAST({ age: { $gte: 18 } })).toEqual(['age', '>=', 18]);
    const refusal = refusalOf(() => convertFiltersToAST({ account: {} }));
    expect({ code: refusal.code, status: refusal.httpStatus, field: refusal.field })
      .toEqual({ code: 'INVALID_FILTER', status: 400, field: 'account' });
  });
});

/**
 * `$null` and `$exists` take a BOOLEAN flag, as `$empty` does.
 * `SpecialOperatorSchema` declares all three `z.boolean()`, and the spec's save
 * door and every query face refuse a non-boolean rather than read it for its
 * truthiness. The converter used to lower `{ f: { $null: 'no' } }` to
 * `['f', 'is_null', true]` (a truthy string read as IS NULL), so a server-backed
 * source answered rows its own door would have refused.
 */
describe('a `$null` / `$exists` flag that is not a boolean is refused, not read for truthiness', () => {
  const NON_BOOLEAN_FLAGS: unknown[] = ['no', 'true', 'false', 1, 0, null, { owner: 'u1' }, {}, []];

  const thrownBy = (run: () => unknown): unknown => {
    try {
      run();
    } catch (error) {
      return error;
    }
    return undefined;
  };

  describe.each(['$null', '$exists'] as const)('%s', (operator) => {
    it.each(NON_BOOLEAN_FLAGS.map((flag) => [JSON.stringify(flag), flag]))(
      'refuses the flag %s in the INVALID_FILTER envelope, naming the operator and the field',
      (_label, flag) => {
        const thrown = thrownBy(() => convertFiltersToAST({ f: { [operator]: flag } }));
        expect(thrown).toBeInstanceOf(FilterOperatorError);
        expect(thrown).toMatchObject({ code: 'INVALID_FILTER', httpStatus: 400, operator, field: 'f' });
        expect((thrown as Error).message.split('; ')[0])
          .toBe(`[ObjectUI] The '${operator}' filter operator on field 'f' takes a boolean flag (true or false)`);
      },
    );

    it('refuses it beside a key that lowers, so it cannot vanish from the filter', () => {
      const thrown = thrownBy(() => convertFiltersToAST({ status: 'a', f: { [operator]: 'no' } }));
      expect(thrown).toMatchObject({ code: 'INVALID_FILTER', operator, field: 'f' });
    });
  });

  it('CONTROL: `true` and `false` lower exactly as before, and round-trip through the spec', () => {
    const cases = [
      [{ f: { $null: true } }, ['f', 'is_null', true], { f: { $null: true } }],
      [{ f: { $null: false } }, ['f', 'is_not_null', true], { f: { $null: false } }],
      [{ f: { $exists: true } }, ['f', 'is_not_null', true], { f: { $null: false } }],
      [{ f: { $exists: false } }, ['f', 'is_null', true], { f: { $null: true } }],
    ] as const;
    for (const [filter, node, readBack] of cases) {
      expect(convertFiltersToAST(filter)).toEqual(node);
      expect(parseFilterAST(node as unknown as FilterNode)).toEqual(readBack);
    }
  });

  it('`$empty` refuses in the same sentence shape', () => {
    const thrown = thrownBy(() => convertFiltersToAST({ f: { $empty: 'yes' } }));
    expect(thrown).toMatchObject({ code: 'INVALID_FILTER', httpStatus: 400, operator: '$empty', field: 'f' });
    expect((thrown as Error).message.split('; ')[0])
      .toBe("[ObjectUI] The '$empty' filter operator on field 'f' takes a boolean flag (true or false)");
  });

  it.each([
    ['$null', 'a missing value', 'a present one'],
    ['$exists', 'a present value', 'a missing one'],
    ['$empty', 'an empty value', 'a non-empty one'],
  ] as const)('`%s` refuses in one full sentence: the received value and both directions', (operator, whenTrue, whenFalse) => {
    const thrown = thrownBy(() => convertFiltersToAST({ f: { [operator]: 'no' } }));
    expect((thrown as Error).message).toBe(
      `[ObjectUI] The '${operator}' filter operator on field 'f' takes a boolean flag (true or false); `
      + `received "no". Write { f: { ${operator}: true } } for ${whenTrue}, or `
      + `{ f: { ${operator}: false } } for ${whenFalse}.`,
    );
  });

  it('a flag that cannot be serialised is still refused in words, not by a second throw', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const thrown = thrownBy(() => convertFiltersToAST({ f: { $null: cyclic } }));
    expect(thrown).toMatchObject({ code: 'INVALID_FILTER', operator: '$null', field: 'f' });
  });
});
