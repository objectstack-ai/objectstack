/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7297 — `useFilterScope()` hands `{record_id}` the MOUNTED record.
 *
 * The scope every data node resolves its filter against is the session scope
 * `FilterScopeProvider` publishes plus `recordId`, read from the nearest
 * `RecordContextProvider` (the provider whose row a component's `visibleWhen`
 * binds as `record`) and from nothing else. Outside one there is no `recordId`,
 * so the resolver refuses the token by name. `useResolvedFilter` holds on
 * `recordId` like every other scope member, so moving to another record resolves
 * again without a remount.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import { FilterScopeProvider, useFilterScope } from '../useFilterScope';
import { useResolvedFilter } from '../useResolvedFilter';
import { RecordContextProvider } from '../../context/RecordContext';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Mount = { recordId?: string | number | null; withRecord: boolean };

/** Session provider always; a record provider only when `withRecord`. */
function wrapperFor(props: Mount) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const inner = props.withRecord ? (
      <RecordContextProvider objectName="person" recordId={props.recordId}>
        {children}
      </RecordContextProvider>
    ) : (
      children
    );
    return (
      <FilterScopeProvider currentUserId="usr_42" currentOrgId="org_7">
        {inner}
      </FilterScopeProvider>
    );
  };
}

describe('useFilterScope reads the mounted record context (objectui#7297)', () => {
  it('outside a record context: the session scope, with no recordId', () => {
    const { result } = renderHook(() => useFilterScope(), { wrapper: wrapperFor({ withRecord: false }) });
    expect(result.current).toEqual({ currentUserId: 'usr_42', currentOrgId: 'org_7' });
    expect('recordId' in result.current).toBe(false);
  });

  it('inside one: the session scope plus the mounted record id', () => {
    const { result } = renderHook(() => useFilterScope(), {
      wrapper: wrapperFor({ withRecord: true, recordId: 'rec_A' }),
    });
    expect(result.current).toEqual({ currentUserId: 'usr_42', currentOrgId: 'org_7', recordId: 'rec_A' });
  });

  it('takes the id as the record provider narrowed it (a numeric key arrives as a string)', () => {
    const { result } = renderHook(() => useFilterScope(), {
      wrapper: wrapperFor({ withRecord: true, recordId: 7 }),
    });
    expect(result.current.recordId).toBe('7');
  });

  it('a record provider with no record bound adds nothing', () => {
    const { result } = renderHook(() => useFilterScope(), {
      wrapper: wrapperFor({ withRecord: true, recordId: null }),
    });
    expect(result.current).toEqual({ currentUserId: 'usr_42', currentOrgId: 'org_7' });
  });

  it('with no session provider at all, the record id still arrives on its own', () => {
    const { result } = renderHook(() => useFilterScope(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <RecordContextProvider objectName="person" recordId="rec_A">
          {children}
        </RecordContextProvider>
      ),
    });
    expect(result.current).toEqual({ recordId: 'rec_A' });
  });
});

describe('useResolvedFilter follows the mounted record (objectui#7297)', () => {
  function useScopedFilter(filter: unknown) {
    return useResolvedFilter(filter, useFilterScope());
  }

  it('resolves {record_id} to the record in view, and again when the record changes', () => {
    const mount: Mount = { withRecord: true, recordId: 'rec_A' };
    const filter = { assignee: '{record_id}' };
    // One wrapper whose record id is read at render time, so the SAME hook
    // instance sees the record change: no remount, the way a record page
    // moves from one record to the next.
    const Wrapper = ({ children }: { children: React.ReactNode }) => wrapperFor(mount)({ children });
    const { result, rerender } = renderHook(() => useScopedFilter(filter), { wrapper: Wrapper });
    expect(result.current).toEqual({ assignee: 'rec_A' });
    const first = result.current;

    rerender();
    expect(result.current).toBe(first); // same record, same held value

    mount.recordId = 'rec_B';
    rerender();
    expect(result.current).toEqual({ assignee: 'rec_B' });
  });

  it('outside a record context the token is left as written and named in a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => useScopedFilter({ assignee: '{record_id}' }), {
      wrapper: wrapperFor({ withRecord: false }),
    });
    expect(result.current).toEqual({ assignee: '{record_id}' });
    const named = warn.mock.calls.filter((c) => String(c[0]).includes('"{record_id}"'));
    expect(named.length).toBeGreaterThan(0);
    expect(String(named[0][0])).toContain('no record in context');
  });
});
