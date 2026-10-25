/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * useCapabilityGate — the single ADR-0066 D4 rule shared by every surface that
 * filters its own actions (`page:header`, the grid row menu) instead of going
 * through `ActionEngine.getActionsForLocation` (framework#3923).
 *
 * The precedence and the fail-open boundary are the whole contract, so they are
 * pinned here rather than re-tested per consumer.
 */

import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ActionProvider } from '../context/ActionContext';
import { PredicateScopeProvider } from '../hooks/useExpression';
import { useCapabilityGate, useHeldCapabilities } from '../hooks/useCapabilityGate';

const wrap = (opts: { user?: unknown; scope?: Record<string, any> }) =>
  ({ children }: { children: React.ReactNode }) => {
    const inner =
      opts.user === undefined && !('user' in opts)
        ? <>{children}</>
        : <ActionProvider context={{ user: opts.user } as any}>{children}</ActionProvider>;
    return opts.scope
      ? <PredicateScopeProvider scope={opts.scope}>{inner}</PredicateScopeProvider>
      : inner;
  };

const gateWith = (opts: { user?: unknown; scope?: Record<string, any> }) =>
  renderHook(() => useCapabilityGate(), { wrapper: wrap(opts) }).result.current;

describe('useCapabilityGate', () => {
  it('passes actions that declare nothing', () => {
    const may = gateWith({ user: { id: 'u1', systemPermissions: [] } });
    expect(may(undefined)).toBe(true);
    expect(may([])).toBe(true);
  });

  it('requires every declared capability', () => {
    const may = gateWith({ user: { id: 'u1', systemPermissions: ['a'] } });
    expect(may(['a'])).toBe(true);
    expect(may(['a', 'b'])).toBe(false);
    expect(may(['b'])).toBe(false);
  });

  it('treats an empty held set as "holds nothing", not unknown', () => {
    expect(gateWith({ user: { id: 'u1', systemPermissions: [] } })(['a'])).toBe(false);
  });

  it('fails OPEN when nothing supplied capabilities', () => {
    expect(gateWith({ user: { id: 'u1' } })(['a'])).toBe(true);
    expect(gateWith({})(['a'])).toBe(true);
  });

  it('prefers the action runner user over the ambient predicate scope', () => {
    // The runner is what ActionEngine reads — the two must not diverge.
    const may = gateWith({
      user: { id: 'u1', systemPermissions: [] },
      scope: { user: { id: 'u1', systemPermissions: ['a'] } },
    });
    expect(may(['a'])).toBe(false);
  });

  it('falls back to the predicate scope when the runner user has none', () => {
    const may = gateWith({ user: { id: 'u1' }, scope: { user: { id: 'u1', systemPermissions: ['a'] } } });
    expect(may(['a'])).toBe(true);
    expect(may(['b'])).toBe(false);
  });

  it('exposes the resolved set (undefined when unknown)', () => {
    const held = renderHook(() => useHeldCapabilities(), {
      wrapper: wrap({ user: { id: 'u1', systemPermissions: ['a'] } }),
    }).result.current;
    expect(held).toEqual(['a']);
    const unknown = renderHook(() => useHeldCapabilities(), {
      wrapper: wrap({ user: { id: 'u1' } }),
    }).result.current;
    expect(unknown).toBeUndefined();
  });
});
