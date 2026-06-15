// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #1872 — `{var.path.N}` numeric segments index into arrays, so a multi-value
 * lookup (array column) can be referenced positionally in flow interpolation.
 */
import { describe, it, expect } from 'vitest';
import { interpolateString } from './template.js';

const ctx = {} as any;
const vars = new Map<string, unknown>([
  ['record', { items: ['a', 'b', 'c'], target_channels: ['ch_1', 'ch_2'] }],
  ['list', ['x', 'y']],
]);

describe('interpolate array-index segments (#1872)', () => {
  it('resolves a single-token array index, preserving type', () => {
    expect(interpolateString('{record.items.0}', vars, ctx)).toBe('a');
    expect(interpolateString('{record.items.2}', vars, ctx)).toBe('c');
    expect(interpolateString('{record.target_channels.0}', vars, ctx)).toBe('ch_1');
    expect(interpolateString('{list.1}', vars, ctx)).toBe('y');
  });

  it('resolves an array index embedded in a larger string', () => {
    expect(interpolateString('first={record.items.0};second={record.items.1}', vars, ctx)).toBe('first=a;second=b');
  });

  it('out-of-range index yields undefined (single) / empty (embedded)', () => {
    expect(interpolateString('{record.items.9}', vars, ctx)).toBeUndefined();
    expect(interpolateString('x={record.items.9}', vars, ctx)).toBe('x=');
  });
});
