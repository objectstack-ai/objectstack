// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
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

    it('array-style `<=` takes the same rule', () => {
      expect(translateFilter([['created_at', '<=', '2026-07-28']])).toEqual({
        created_at: { $lt: '2026-07-29' },
      });
      expect(translateFilter([['created_at', '<=', '2026-07-28T12:00:00.000Z']])).toEqual({
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

  describe('legacy array-style filters', () => {
    it('translates single comparison tuple', () => {
      expect(translateFilter(['name', '=', 'Alice'])).toEqual({ name: 'Alice' });
    });

    it('translates != operator', () => {
      expect(translateFilter(['status', '!=', 'deleted'])).toEqual({ status: { $ne: 'deleted' } });
    });

    it('translates comparison operators', () => {
      expect(translateFilter(['age', '>', 18])).toEqual({ age: { $gt: 18 } });
      expect(translateFilter(['age', '>=', 18])).toEqual({ age: { $gte: 18 } });
      expect(translateFilter(['age', '<', 65])).toEqual({ age: { $lt: 65 } });
      expect(translateFilter(['score', '<=', 100])).toEqual({ score: { $lte: 100 } });
    });

    it('translates in/nin operators', () => {
      expect(translateFilter(['status', 'in', ['active', 'pending']])).toEqual({
        status: { $in: ['active', 'pending'] },
      });
    });

    it('translates contains operator', () => {
      const result = translateFilter(['name', 'contains', 'test']);
      expect(result).toEqual({ name: { $regex: 'test', $options: 'i' } });
    });

    it('translates multiple conditions with AND', () => {
      const result = translateFilter([['name', '=', 'Alice'], ['age', '>', 18]]);
      expect(result).toEqual({
        $and: [{ name: 'Alice' }, { age: { $gt: 18 } }],
      });
    });

    it('translates conditions with OR connector', () => {
      const result = translateFilter([['role', '=', 'admin'], 'or', ['role', '=', 'manager']]);
      expect(result).toEqual({
        $or: [{ role: 'admin' }, { role: 'manager' }],
      });
    });

    it('maps createdAt to created_at', () => {
      expect(translateFilter(['createdAt', '>', '2024-01-01'])).toEqual({
        created_at: { $gt: '2024-01-01' },
      });
    });
  });

  describe('operator allowlist (P0-4)', () => {
    it('rejects $where (server-side JS execution)', () => {
      expect(() => translateFilter({ name: { $where: 'this.x == 1' } })).toThrow(/unsupported filter operator '\$where'/);
    });

    it('rejects $function', () => {
      expect(() => translateFilter({ name: { $function: { body: 'fn', args: [], lang: 'js' } } })).toThrow(/unsupported filter operator/);
    });

    it('rejects unknown $-operators rather than passing them through', () => {
      expect(() => translateFilter({ name: { $expr: 1 } })).toThrow(/unsupported filter operator '\$expr'/);
    });

    it('still accepts every allowlisted field operator', () => {
      expect(() => translateFilter({ a: { $eq: 1 }, b: { $in: [1, 2] }, c: { $contains: 'x' }, d: { $exists: true } })).not.toThrow();
    });
  });
});
