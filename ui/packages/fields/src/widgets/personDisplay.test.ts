/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import {
  resolvePath,
  getPersonName,
  getPersonInitials,
  getPersonSubtitle,
  getPersonAvatarUrl,
  getPersonId,
  matchRanges,
} from './personDisplay';

describe('personDisplay helpers', () => {
  describe('resolvePath', () => {
    it('reads flat and dotted paths', () => {
      const rec = { name: 'Amy', primary_business_unit_id: { name: 'Sales' } };
      expect(resolvePath(rec, 'name')).toBe('Amy');
      expect(resolvePath(rec, 'primary_business_unit_id.name')).toBe('Sales');
    });
    it('returns undefined for missing paths or nullish records', () => {
      expect(resolvePath({ a: {} }, 'a.b.c')).toBeUndefined();
      expect(resolvePath(null, 'x')).toBeUndefined();
      expect(resolvePath({ a: 1 }, '')).toBeUndefined();
    });
  });

  describe('getPersonName', () => {
    it('prefers the display field, then common fallbacks', () => {
      expect(getPersonName({ name: 'Amy' })).toBe('Amy');
      expect(getPersonName({ full_name: 'Amy Lin' }, 'full_name')).toBe('Amy Lin');
      expect(getPersonName({ username: 'amy' })).toBe('amy');
      expect(getPersonName('raw-id')).toBe('raw-id');
      expect(getPersonName(null)).toBe('');
    });
  });

  describe('getPersonInitials', () => {
    it('takes first+last initial for multi-word latin names', () => {
      expect(getPersonInitials('John Doe')).toBe('JD');
      expect(getPersonInitials('mary jane watson')).toBe('MW');
    });
    it('takes first two letters for a single latin token', () => {
      expect(getPersonInitials('John')).toBe('JO');
    });
    it('takes the given-name chars for CJK names', () => {
      expect(getPersonInitials('张三')).toBe('张三');
      expect(getPersonInitials('王小明')).toBe('小明');
    });
    it('falls back to "?" for empty', () => {
      expect(getPersonInitials('')).toBe('?');
      expect(getPersonInitials('   ')).toBe('?');
    });
  });

  describe('getPersonSubtitle', () => {
    it('joins non-empty resolved fields with a middot', () => {
      const rec = { email: 'amy@x.io', primary_business_unit_id: { name: 'Sales' } };
      expect(getPersonSubtitle(rec, ['primary_business_unit_id.name', 'email'])).toBe(
        'Sales · amy@x.io',
      );
    });
    it('drops empty segments and returns "" when nothing resolves', () => {
      expect(getPersonSubtitle({ email: 'amy@x.io' }, ['primary_business_unit_id.name', 'email'])).toBe(
        'amy@x.io',
      );
      expect(getPersonSubtitle({}, ['a', 'b'])).toBe('');
      expect(getPersonSubtitle({ a: 1 }, undefined)).toBe('');
    });
  });

  describe('getPersonAvatarUrl', () => {
    it('reads the avatar field, undefined when absent', () => {
      expect(getPersonAvatarUrl({ image: 'http://x/y.png' })).toBe('http://x/y.png');
      expect(getPersonAvatarUrl({})).toBeUndefined();
      expect(getPersonAvatarUrl({ photo: 'p' }, 'photo')).toBe('p');
    });
  });

  describe('getPersonId', () => {
    it('tolerates id / _id / custom / primitive', () => {
      expect(getPersonId({ id: 1 })).toBe(1);
      expect(getPersonId({ _id: 'a' })).toBe('a');
      expect(getPersonId({ user_id: 9 }, 'user_id')).toBe(9);
      expect(getPersonId('plain')).toBe('plain');
    });
  });
});

describe('matchRanges', () => {
  it('returns no ranges for an empty query or empty text', () => {
    expect(matchRanges('Amy Lin', '')).toEqual([]);
    expect(matchRanges('', 'amy')).toEqual([]);
  });

  it('finds case-insensitive substring ranges', () => {
    expect(matchRanges('Amy Lin', 'am')).toEqual([[0, 2]]);
    expect(matchRanges('Sales · amy@x.io', 'amy')).toEqual([[8, 11]]);
  });

  it('finds every non-overlapping occurrence', () => {
    expect(matchRanges('banana', 'an')).toEqual([
      [1, 3],
      [3, 5],
    ]);
  });
});
