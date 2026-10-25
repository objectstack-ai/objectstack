/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { isPlainObject } from '../is-plain-object';
import { isPlainObject as fromIndex } from '../../index';

describe('isPlainObject (objectui#13458)', () => {
  it('accepts a key/value bag, with or without a prototype', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it('refuses null, arrays and every primitive', () => {
    for (const value of [null, undefined, [], [1], 0, 1, '', 'x', true, false, Symbol('s'), 10n, () => {}]) {
      expect(isPlainObject(value), String(typeof value)).toBe(false);
    }
  });

  it('is the typeof reading, not the prototype reading: a Date or a Map passes', () => {
    expect(isPlainObject(new Date())).toBe(true);
    expect(isPlainObject(new Map())).toBe(true);
  });

  it('is published from the package index', () => {
    expect(fromIndex).toBe(isPlainObject);
  });
});
