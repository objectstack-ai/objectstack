// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateActionParams,
  ACTION_PARAM_BUILTIN_KEYS,
  type ResolvedActionParam,
} from './action-params.zod';

const codes = (issues: ReturnType<typeof validateActionParams>) => issues.map((i) => i.code).sort();

describe('validateActionParams (ADR-0104 D2)', () => {
  it('accepts a conformant bag (no issues)', () => {
    const resolved: ResolvedActionParam[] = [
      { name: 'title', type: 'text', required: true },
      { name: 'amount', type: 'currency' },
      { name: 'assignee', type: 'lookup' },
      { name: 'labels', type: 'multiselect', options: [{ value: 'a' }, { value: 'b' }] },
    ];
    const bag = { title: 'Hi', amount: 12.5, assignee: 'usr_1', labels: ['a', 'b'] };
    expect(validateActionParams(resolved, bag)).toEqual([]);
  });

  it('flags a missing required param', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'title', type: 'text', required: true }];
    const issues = validateActionParams(resolved, {});
    expect(codes(issues)).toEqual(['required']);
    expect(issues[0].param).toBe('title');
  });

  it('does not flag a missing OPTIONAL param', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'note', type: 'text' }];
    expect(validateActionParams(resolved, {})).toEqual([]);
  });

  it('flags a bad option value and a wrong-typed value (invalid_shape)', () => {
    const resolved: ResolvedActionParam[] = [
      { name: 'priority', type: 'select', options: [{ value: 'high' }, { value: 'low' }] },
      { name: 'count', type: 'number' },
    ];
    const issues = validateActionParams(resolved, { priority: 'HIGH', count: 'not-a-number' });
    expect(codes(issues)).toEqual(['invalid_shape', 'invalid_shape']);
  });

  it('enforces reference id shape (expanded object rejected at the stored position)', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'account', type: 'lookup' }];
    const issues = validateActionParams(resolved, { account: { id: 'acc_1', name: 'Acme' } });
    expect(codes(issues)).toEqual(['invalid_shape']);
  });

  it('enforces multiple → array', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'watchers', type: 'user', multiple: true }];
    expect(validateActionParams(resolved, { watchers: ['u1', 'u2'] })).toEqual([]);
    expect(codes(validateActionParams(resolved, { watchers: 'u1' }))).toEqual(['invalid_shape']);
  });

  it('flags unknown params, but allows the dispatcher built-in keys', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'title', type: 'text' }];
    const issues = validateActionParams(resolved, { title: 'x', bogus: 1, recordId: 'r1', objectName: 'o' });
    // `unknown_param` folded into the catalog's `unknown_field` (ADR-0114 D2) —
    // the `param` key beside it already says what was addressed.
    expect(codes(issues)).toEqual(['unknown_field']);
    expect(issues[0].param).toBe('bogus');
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('recordId');
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('objectName');
  });

  it('allows the aggregate-dispatch key _selectedIds on a param-declaring action (objectui#3139)', () => {
    // The renderer's aggregate bulk dispatch injects `_selectedIds` next to
    // the user-collected params; strict mode must not 400 the whole call for
    // a key the author can never declare.
    const resolved: ResolvedActionParam[] = [{ name: 'format', type: 'text' }];
    const issues = validateActionParams(resolved, {
      format: 'png',
      _selectedIds: ['dev_1', 'dev_2'],
    });
    expect(issues).toEqual([]);
    expect(ACTION_PARAM_BUILTIN_KEYS).toContain('_selectedIds');
  });

  it('leaves the value shape OPEN when the resolved type is unknown (field-backed param whose field is gone)', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'freeform' /* no type */ }];
    expect(validateActionParams(resolved, { freeform: { anything: [1, 2, 3] } })).toEqual([]);
  });

  it('custom builtinKeys override the default allowlist', () => {
    const resolved: ResolvedActionParam[] = [{ name: 'title', type: 'text' }];
    const issues = validateActionParams(resolved, { title: 'x', ctxToken: 'z' }, { builtinKeys: ['ctxToken'] });
    expect(issues).toEqual([]);
  });
});
