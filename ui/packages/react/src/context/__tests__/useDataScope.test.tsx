/**
 * Tests for the `useDataScope` hook — what it resolves a `bind` path against.
 *
 * ## objectui#9308 — the object it walks moved, the contract did not
 *
 * Maintainer ruling 2026-09-13 (option B, half b2): the hook reads the ambient
 * predicate scope a host publishes through `PredicateScopeProvider` — the
 * channel app-shell's `ExpressionProvider` already feeds — and no longer walks
 * `SchemaRendererContext.dataSource`.
 *
 * `dataSource` is the host's injected ADAPTER, declared as the published
 * `DataSource` contract (objectui#7912). An adapter answers none of the member
 * names a `bind` path spells, so the walk returned `undefined` for every
 * conformant host and the nine production readers have been running their
 * fallbacks throughout. The only hosts it answered were ones injecting a data
 * bag through the adapter key, which has been a compile error since #7912.
 *
 * Every case below is the SAME case it was, with the bag moved from the
 * adapter seam to the scope channel — plus two controls that did not exist,
 * which are the ones that would catch a revert: the adapter seam must now
 * answer NOTHING (`the adapter seam is not the data scope`), and a bag on the
 * scope must answer even while an adapter is injected beside it.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { SchemaRendererProvider, useDataScope } from '../SchemaRendererContext';
import { PredicateScopeProvider } from '../../hooks/useExpression';
import type { DataSource } from '@object-ui/types';

/** Mount the hook under a host-published scope. */
const inScope = (scope: Record<string, unknown>) =>
  ({ children }: { children: React.ReactNode }) => (
    <PredicateScopeProvider scope={scope}>{children}</PredicateScopeProvider>
  );

/**
 * Mount the hook under the ADAPTER seam only.
 *
 * The values injected here are deliberately NOT adapters, so each injection
 * crosses the published contract with an explicit `as unknown as DataSource`
 * (objectui#7912). That crossing is the point: it is the shape of the host
 * this card breaks.
 */
const underAdapter = (dataSource: unknown) =>
  ({ children }: { children: React.ReactNode }) => (
    <SchemaRendererProvider dataSource={dataSource as DataSource}>{children}</SchemaRendererProvider>
  );

describe('useDataScope', () => {
  it('returns undefined when no path is provided', () => {
    const { result } = renderHook(() => useDataScope(undefined), {
      wrapper: inScope({ users: [1, 2, 3] }),
    });
    expect(result.current).toBeUndefined();
  });

  it('returns undefined when path is empty string', () => {
    const { result } = renderHook(() => useDataScope(''), {
      wrapper: inScope({ users: [1, 2, 3] }),
    });
    expect(result.current).toBeUndefined();
  });

  it('returns scoped data when a valid path is given', () => {
    const { result } = renderHook(() => useDataScope('users'), {
      wrapper: inScope({ users: [{ name: 'Alice' }] }),
    });
    expect(result.current).toEqual([{ name: 'Alice' }]);
  });

  it('resolves nested paths', () => {
    const { result } = renderHook(() => useDataScope('app.settings.theme'), {
      wrapper: inScope({ app: { settings: { theme: 'dark' } } }),
    });
    expect(result.current).toBe('dark');
  });

  it('returns undefined for non-existent path', () => {
    const { result } = renderHook(() => useDataScope('nonexistent'), {
      wrapper: inScope({ users: [] }),
    });
    expect(result.current).toBeUndefined();
  });

  it('returns undefined when no provider is present at all', () => {
    // `usePredicateScope` defaults to `{}`, so this is a path miss rather than
    // a throw — the same answer the hook gave outside a
    // `SchemaRendererProvider` before this card.
    const { result } = renderHook(() => useDataScope('users'));
    expect(result.current).toBeUndefined();
  });

  it('does not return the scope object itself when no path is given', () => {
    const { result } = renderHook(() => useDataScope(undefined), {
      wrapper: inScope({ users: [1, 2, 3] }),
    });
    // Returning the whole bag would make every `bind`-less node "bound", which
    // is what prevented ObjectChart from fetching when this was last got wrong.
    expect(result.current).toBeUndefined();
  });
});

describe('useDataScope — objectui#9308 controls: the adapter seam is not the data scope', () => {
  it('a bag injected as `dataSource` answers NOTHING', () => {
    const { result } = renderHook(() => useDataScope('users'), {
      wrapper: underAdapter({ users: [{ name: 'Alice' }] }),
    });
    expect(result.current).toBeUndefined();
  });

  it('a real adapter answers nothing either — and never hands its own members back', () => {
    const adapter = { find: () => {}, create: () => {}, update: () => {} };
    expect(renderHook(() => useDataScope('find'), { wrapper: underAdapter(adapter) }).result.current)
      .toBeUndefined();
    expect(renderHook(() => useDataScope(undefined), { wrapper: underAdapter(adapter) }).result.current)
      .toBeUndefined();
  });

  it('the scope answers even with an adapter mounted beside it', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PredicateScopeProvider scope={{ users: [{ name: 'Alice' }] }}>
        <SchemaRendererProvider dataSource={{ users: [{ name: 'WRONG' }] } as unknown as DataSource}>
          {children}
        </SchemaRendererProvider>
      </PredicateScopeProvider>
    );
    const { result } = renderHook(() => useDataScope('users'), { wrapper });
    expect(result.current).toEqual([{ name: 'Alice' }]);
  });
});
