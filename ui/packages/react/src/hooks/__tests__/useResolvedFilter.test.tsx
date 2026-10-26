/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10666 — `useResolvedFilter`, the ONE hold every data node resolves
 * its own authored `filter` through. It resolves with `@object-ui/core`'s
 * shared `resolveFilterPlaceholders` and HOLDS the result: the value keeps its
 * reference while the authored filter (compared by structure) and the scope's
 * three members are unchanged, and is resolved again when any of them moves.
 * The node-level pins (every directly authored data node, through the real
 * `SchemaRenderer`) are `apps/console/src/__tests__/filterContextTokensSweep-10666.test.tsx`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { FilterTokenScope } from '@object-ui/core';
import { useResolvedFilter } from '../useResolvedFilter';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SCOPE: FilterTokenScope = { currentUserId: 'usr_42', currentOrgId: 'org_7' };

function hold(initial: { filter: unknown; scope: FilterTokenScope }) {
  return renderHook(({ filter, scope }) => useResolvedFilter(filter, scope), { initialProps: initial });
}

describe('useResolvedFilter (objectui#10666)', () => {
  it('resolves {current_user_id} and {current_org_id} against the scope', () => {
    const { result } = hold({
      filter: [['owner', '=', '{current_user_id}'], ['org', '=', '{current_org_id}']],
      scope: SCOPE,
    });
    expect(result.current).toEqual([['owner', '=', 'usr_42'], ['org', '=', 'org_7']]);
  });

  it('keeps the same reference across re-renders with the same filter', () => {
    const filter = [['owner', '=', '{current_user_id}']];
    const { result, rerender } = hold({ filter, scope: SCOPE });
    const first = result.current;
    rerender({ filter, scope: SCOPE });
    rerender({ filter, scope: { ...SCOPE } });
    expect(result.current).toBe(first);
  });

  it('keeps the same reference when an EQUAL filter is rebuilt on every render', () => {
    const { result, rerender } = hold({ filter: [['owner', '=', '{current_user_id}']], scope: SCOPE });
    const first = result.current;
    rerender({ filter: [['owner', '=', '{current_user_id}']], scope: SCOPE });
    rerender({ filter: [['owner', '=', '{current_user_id}']], scope: SCOPE });
    expect(result.current).toBe(first);
  });

  it('holds a date macro: {now} does not resolve to a new value on every render', () => {
    const { result, rerender } = hold({ filter: [['created', '<', '{now}']], scope: SCOPE });
    const first = result.current;
    const sent = JSON.stringify(first);
    expect(sent).not.toContain('{now}');
    rerender({ filter: [['created', '<', '{now}']], scope: SCOPE });
    expect(result.current).toBe(first);
  });

  it('resolves again when the filter changes by structure', () => {
    const { result, rerender } = hold({ filter: [['owner', '=', '{current_user_id}']], scope: SCOPE });
    const first = result.current;
    rerender({ filter: [['owner', '!=', '{current_user_id}']], scope: SCOPE });
    expect(result.current).not.toBe(first);
    expect(result.current).toEqual([['owner', '!=', 'usr_42']]);
  });

  it('resolves again when a scope member changes', () => {
    const { result, rerender } = hold({ filter: [['owner', '=', '{current_user_id}']], scope: SCOPE });
    rerender({ filter: [['owner', '=', '{current_user_id}']], scope: { ...SCOPE, currentUserId: 'usr_99' } });
    expect(result.current).toEqual([['owner', '=', 'usr_99']]);
    rerender({ filter: [['org', '=', '{current_org_id}']], scope: { ...SCOPE, currentOrgId: 'org_8' } });
    expect(result.current).toEqual([['org', '=', 'org_8']]);
  });

  it('CONTROL: a token-free filter comes back as the authored value itself', () => {
    const filter = [['owner', '=', 'usr_literal']];
    const { result, rerender } = hold({ filter, scope: SCOPE });
    expect(result.current).toBe(filter);
    // An equal rebuild keeps handing out the value first held.
    rerender({ filter: [['owner', '=', 'usr_literal']], scope: SCOPE });
    expect(result.current).toBe(filter);
  });

  it('a filter the resolver changes comes back as a new value, not the authored one', () => {
    const filter = [['owner', '=', '{current_user_id}']];
    const { result } = hold({ filter, scope: SCOPE });
    expect(result.current).not.toBe(filter);
    expect(filter).toEqual([['owner', '=', '{current_user_id}']]);
  });

  it('passes an absent filter through', () => {
    const { result } = hold({ filter: undefined, scope: SCOPE });
    expect(result.current).toBeUndefined();
  });

  it('leaves a token the scope cannot resolve intact, and the shared resolver names it (no fallback)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = hold({ filter: [['owner', '=', '{current_user_id}']], scope: {} });
    expect(result.current).toEqual([['owner', '=', '{current_user_id}']]);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('{current_user_id}'))).toBe(true);
  });
});
