// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useFlowScope — the `extraRefs` merge (#2670 Phase 3). A nested node anchors its
 * scope on its container; the container's own loop `iteratorVariable` is
 * excluded from the graph walk at its id, so the inspector injects it via
 * `extraRefs`. Verify the injected ref lands in the "Loop item" group and that
 * the global token de-dup still holds.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { useFlowScope } from './useFlowScope';
import type { ScopeRef } from './flow-scope';

afterEach(cleanup);

const draft = {
  variables: [{ name: 'daysBefore', type: 'number' }],
  nodes: [
    { id: 'start', type: 'start' },
    { id: 'each', type: 'loop', config: { iteratorVariable: 'contract' } },
  ],
  edges: [{ source: 'start', target: 'each' }],
};

describe('useFlowScope — extraRefs', () => {
  it('merges an injected loop ref into the "Loop item" group', () => {
    const extra: ScopeRef[] = [{ token: 'contract', label: 'contract', detail: 'Loop item', group: 'loop' }];
    const { result } = renderHook(() => useFlowScope(draft, 'each', extra));
    const loop = result.current.groups.find((g) => g.id === 'loop');
    expect(loop?.label).toBe('Loop item');
    expect(loop?.refs.map((r) => r.token)).toContain('contract');
    // The declared flow variable is still there, in its own group.
    expect(result.current.groups.find((g) => g.id === 'variables')?.refs.map((r) => r.token)).toContain('daysBefore');
  });

  it('de-dups by token — an extra ref that collides with a variable appears once', () => {
    const extra: ScopeRef[] = [{ token: 'daysBefore', label: 'daysBefore', group: 'loop' }];
    const { result } = renderHook(() => useFlowScope(draft, 'each', extra));
    expect(result.current.refs.filter((r) => r.token === 'daysBefore')).toHaveLength(1);
    // First occurrence (the variable) wins, so no phantom 'Loop item' group.
    expect(result.current.groups.find((g) => g.id === 'loop')).toBeUndefined();
  });

  it('is a no-op when no extraRefs are passed (unchanged top-level behavior)', () => {
    const { result } = renderHook(() => useFlowScope(draft, 'each'));
    expect(result.current.groups.find((g) => g.id === 'loop')).toBeUndefined();
    expect(result.current.refs.map((r) => r.token)).toContain('daysBefore');
  });
});
