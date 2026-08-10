// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import { translateFilter } from './mongodb-filter.js';

describe('MongoDB Filter Translator', () => {
  describe('basic equality', () => {
    it('translates implicit equality', () => {
      expect(translateFilter({ name: 'Alice', age: 30 })).toEqual({ name: 'Alice', age: 30 });
    });

    it('translates null/undefined input to empty filter', () => {
      expect(translateFilter(null)).toEqual({});
      expect(translateFilter(undefined)).toEqual({});
      expect(translateFilter({})).toEqual({});
    });
  });

  describe('comparison operators', () => {
    it('translates $eq', () => {
      expect(translateFilter({ status: { $eq: 'active' } })).toEqual({ status: { $eq: 'active' } });
    });

    it('translates $ne', () => {
      expect(translateFilter({ status: { $ne: 'deleted' } })).toEqual({ status: { $ne: 'deleted' } });
    });

    it('translates $gt, $gte, $lt, $lte', () => {
      expect(translateFilter({ age: { $gt: 18 } })).toEqual({ age: { $gt: 18 } });
      expect(translateFilter({ age: { $gte: 18 } })).toEqual({ age: { $gte: 18 } });
      expect(translateFilter({ age: { $lt: 65 } })).toEqual({ age: { $lt: 65 } });
      expect(translateFilter({ score: { $lte: 100 } })).toEqual({ score: { $lte: 100 } });
    });

    it('translates $in and $nin', () => {
      expect(translateFilter({ status: { $in: ['active', 'pending'] } })).toEqual({
        status: { $in: ['active', 'pending'] },
      });
      expect(translateFilter({ role: { $nin: ['admin'] } })).toEqual({
        role: { $nin: ['admin'] },
      });
    });
  });

  describe('calendar-day upper bounds (#4042; the SQL twin is #3777)', () => {
    it('a bare-day $lte compiles half-open — through the whole day', () => {
      expect(translateFilter({ created_at: { $lte: '2026-07-28' } })).toEqual({
        created_at: { $lt: '2026-07-29' },
      });
    });

    it('a full-ISO $lte keeps instant semantics — only the bare day is widened', () => {
      expect(translateFilter({ created_at: { $lte: '2026-07-28T12:00:00.000Z' } })).toEqual({
        created_at: { $lte: '2026-07-28T12:00:00.000Z' },
      });
    });

    it('bare-day $gte / $gt / $lt keep their midnight anchoring', () => {
      expect(translateFilter({ created_at: { $gte: '2026-07-28' } })).toEqual({
        created_at: { $gte: '2026-07-28' },
      });
      expect(translateFilter({ created_at: { $lt: '2026-07-28' } })).toEqual({
        created_at: { $lt: '2026-07-28' },
      });
    });

    it('$between with a bare-day max decomposes half-open, rolling the month', () => {
      expect(translateFilter({ created_at: { $between: ['2026-04-29', '2026-07-31'] } })).toEqual({
        created_at: { $gte: '2026-04-29', $lt: '2026-08-01' },
      });
    });

    it('the authored array `<=` takes the same rule, once lowered (#5158)', () => {
      // `translateFilter` no longer compiles the array spelling; the authored
      // shape reaches it through `parseFilterAST`, which is what both doors do.
      expect(translateFilter(parseFilterAST([['created_at', '<=', '2026-07-28']]))).toEqual({
        created_at: { $lt: '2026-07-29' },
      });
      expect(
        translateFilter(parseFilterAST([['created_at', '<=', '2026-07-28T12:00:00.000Z']])),
      ).toEqual({
        created_at: { $lte: '2026-07-28T12:00:00.000Z' },
      });
    });
  });

  describe('string operators', () => {
    it('translates $contains to $regex', () => {
      const result = translateFilter({ name: { $contains: 'test' } });
      expect(result).toEqual({ name: { $regex: 'test', $options: 'i' } });
    });

    it('translates $startsWith to ^prefix regex', () => {
      const result = translateFilter({ name: { $startsWith: 'Pre' } });
      expect(result).toEqual({ name: { $regex: '^Pre', $options: 'i' } });
    });

    it('translates $endsWith to suffix$ regex', () => {
      const result = translateFilter({ email: { $endsWith: '.com' } });
      expect(result).toEqual({ email: { $regex: '\\.com$', $options: 'i' } });
    });

    it('escapes special regex characters', () => {
      const result = translateFilter({ name: { $contains: 'a.b+c' } });
      expect(result).toEqual({ name: { $regex: 'a\\.b\\+c', $options: 'i' } });
    });

    it('translates $notContains', () => {
      const result = translateFilter({ name: { $notContains: 'spam' } });
      expect(result).toEqual({ name: { $not: { $regex: 'spam', $options: 'i' } } });
    });
  });

  describe('special operators', () => {
    it('translates $null: true to field: null', () => {
      expect(translateFilter({ deleted_at: { $null: true } })).toEqual({
        deleted_at: { $eq: null },
      });
    });

    it('translates $null: false to field != null', () => {
      expect(translateFilter({ name: { $null: false } })).toEqual({
        name: { $ne: null },
      });
    });

    it('translates $exists', () => {
      expect(translateFilter({ avatar: { $exists: true } })).toEqual({
        avatar: { $exists: true },
      });
    });

    it('translates $between to $gte + $lte', () => {
      expect(translateFilter({ age: { $between: [18, 65] } })).toEqual({
        age: { $gte: 18, $lte: 65 },
      });
    });
  });

  describe('logical operators', () => {
    it('translates $and', () => {
      const result = translateFilter({
        $and: [{ status: 'active' }, { age: { $gte: 18 } }],
      });
      expect(result).toEqual({
        $and: [{ status: 'active' }, { age: { $gte: 18 } }],
      });
    });

    it('translates $or', () => {
      const result = translateFilter({
        $or: [{ role: 'admin' }, { role: 'manager' }],
      });
      expect(result).toEqual({
        $or: [{ role: 'admin' }, { role: 'manager' }],
      });
    });

    it('translates $not using $nor', () => {
      const result = translateFilter({ $not: { status: 'deleted' } });
      expect(result).toEqual({ $nor: [{ status: 'deleted' }] });
    });

    it('combines field filters with logical operators', () => {
      const result = translateFilter({
        name: 'Alice',
        $or: [{ role: 'admin' }, { role: 'manager' }],
      });
      expect(result).toEqual({
        $and: [
          { name: 'Alice' },
          { $or: [{ role: 'admin' }, { role: 'manager' }] },
        ],
      });
    });
  });

  describe('the array dialect is refused, not compiled (#5158)', () => {
    /**
     * `translateFilter` used to carry a second compiler for the array
     * spelling, including an INFIX join (`[condA, 'or', condB]`) no schema
     * declared and `parseFilterAST` cannot express. `FilterArray` is
     * input-only authoring sugar (spec `data/filter.zod.ts`, #5285); both
     * doors into the runtime lower it before a driver is reached, so a second
     * implementation here is the ADR-0053 D-A1 divergence — the same one
     * cloud's `RemoteTransport.buildWhereSQL` closed from its side (cloud#1075).
     *
     * The authored shapes are unchanged and still land on the same filter
     * document; they simply travel `parseFilterAST` to get here, which is what
     * the left column below asserts.
     */
    it.each([
      ['single comparison tuple', ['name', '=', 'Alice'], { name: 'Alice' }],
      ['!= operator', ['status', '!=', 'deleted'], { status: { $ne: 'deleted' } }],
      ['>', ['age', '>', 18], { age: { $gt: 18 } }],
      ['>=', ['age', '>=', 18], { age: { $gte: 18 } }],
      ['<', ['age', '<', 65], { age: { $lt: 65 } }],
      ['<=', ['score', '<=', 100], { score: { $lte: 100 } }],
      ['in', ['status', 'in', ['active', 'pending']], { status: { $in: ['active', 'pending'] } }],
      ['contains', ['name', 'contains', 'test'], { name: { $regex: 'test', $options: 'i' } }],
      ['implicit AND list', [['name', '=', 'Alice'], ['age', '>', 18]],
        { $and: [{ name: 'Alice' }, { age: { $gt: 18 } }] }],
      // PREFIX is the declared spelling of a logical join. The infix form this
      // module used to accept has no lowering at all — pinned as a refusal
      // below rather than translated.
      ['prefix OR group', ['or', ['role', '=', 'admin'], ['role', '=', 'manager']],
        { $or: [{ role: 'admin' }, { role: 'manager' }] }],
    ])('the authored %s still lands on the same filter document, via parseFilterAST', (
      _label, authored, expected,
    ) => {
      expect(translateFilter(parseFilterAST(authored))).toEqual(expected);
    });

    it.each([
      ['comparison tuple', ['name', '=', 'Alice']],
      ['condition list', [['name', '=', 'Alice'], ['age', '>', 18]]],
      ['infix join (the undeclared dialect)', [['role', '=', 'admin'], 'or', ['role', '=', 'manager']]],
    ])('refuses a raw array %s', (_label, where) => {
      expect(() => translateFilter(where)).toThrow(/A filter ARRAY reached the driver/);
    });

    it('an empty array is still "no filter", not a refusal', () => {
      expect(translateFilter([])).toEqual({});
    });

    it('the `createdAt` -> `created_at` alias went with the dialect', () => {
      // It only ever existed on the array path (`mapFieldName`, called solely
      // from the deleted `translateComparison`); the object path never applied
      // it. A consumer-side alias is debt by AGENTS.md PD #12, so it is not
      // re-added here — `created_at` is the declared field name.
      expect(translateFilter({ createdAt: { $gt: '2024-01-01' } })).toEqual({
        createdAt: { $gt: '2024-01-01' },
      });
      expect(translateFilter(parseFilterAST([['created_at', '>', '2024-01-01']]))).toEqual({
        created_at: { $gt: '2024-01-01' },
      });
    });
  });

  describe('operator allowlist (P0-4)', () => {
    /**
     * [#5702] These three used to match `/unsupported filter operator '\$x'/` —
     * the bare `new Error` the `default:` arm threw, with no `code` and no
     * `status`. The verdict has not changed (they were always refused); the
     * ENVELOPE has, so the assertion moved with it and now pins the two fields
     * that decide whether a client sees a 400-class mistake or a 500-shaped
     * body. Matching on the message alone is what let the bare error live three
     * lines from this file's own `INVALID_FILTER` helper for two releases.
     */
    const refusalOf = (filter: Parameters<typeof translateFilter>[0]) => {
      try {
        translateFilter(filter);
      } catch (e) {
        return e as Error & { code?: string; status?: number };
      }
      throw new Error('expected the translator to refuse this filter, but it returned');
    };

    for (const [label, filter, op] of [
      ['$where (server-side JS execution)', { name: { $where: 'this.x == 1' } }, '$where'],
      ['$function', { name: { $function: { body: 'fn', args: [], lang: 'js' } } }, '$function'],
      ['an unknown $-operator rather than passing it through', { name: { $expr: 1 } }, '$expr'],
    ] as const) {
      it(`rejects ${label}, in the ADR-0112 envelope`, () => {
        const err = refusalOf(filter);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`Unsupported filter operator "${op}"`);
        // The field is named — a refusal that says only "some operator" makes
        // the author search a filter tree by hand.
        expect(err.message).toContain('on field "name"');
      });
    }

    /**
     * [#5702] The retired spellings take the OTHER branch of that arm: they were
     * refused here before this change too (mongo was the one backend already
     * satisfying #4706's requirement 3), but with the generic sentence. An
     * author who wrote `$regex` needs `$icontains`, not a list.
     */
    for (const [label, filter, mustMention] of [
      ['$regex', { name: { $regex: 'ac.*' } }, ['$regex', '$icontains']],
      ['$options on its own', { name: { $options: 'i' } }, ['$options', '$icontains']],
      [
        '$regex with $options — one mistake, one fix',
        { name: { $regex: '^acme', $options: 'i' } },
        ['$regex', '$options', '$icontains'],
      ],
    ] as const) {
      it(`refuses the retired ${label}, naming the replacement`, () => {
        const err = refusalOf(filter);
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain('RETIRED');
        for (const mention of mustMention) expect(err.message).toContain(mention);
      });
    }

    it('still accepts every allowlisted field operator', () => {
      expect(() => translateFilter({ a: { $eq: 1 }, b: { $in: [1, 2] }, c: { $contains: 'x' }, d: { $exists: true } })).not.toThrow();
    });
  });
});
