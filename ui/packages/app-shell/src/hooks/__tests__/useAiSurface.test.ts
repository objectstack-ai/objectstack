import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAgents } from '@object-ui/plugin-chatbot/core';
import { useAiSurfaceEnabled } from '../useAiSurface';

// The surface is gated on the live agent catalog, so we mock useAgents and
// assert the catalog → enabled/loading mapping (incl. the not-yet-fetched latch).
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: vi.fn(),
}));
const mockAgents = vi.mocked(useAgents);

function agentsResult(names: string[], isLoading: boolean) {
  return {
    agents: names.map((name) => ({ name, label: name })),
    isLoading,
    error: undefined,
    refetch: vi.fn(),
  };
}

afterEach(() => mockAgents.mockReset());

describe('useAiSurfaceEnabled', () => {
  it('is enabled when the catalog serves at least one agent (cloud / agents present)', () => {
    mockAgents.mockReturnValue(agentsResult(['ask'], false));
    const { result } = renderHook(() => useAiSurfaceEnabled());
    expect(result.current).toEqual({ enabled: true, isLoading: false });
  });

  it('reports loading on the first frame before the catalog fetch has started', () => {
    // useAgents starts isLoading=false with an empty list — that is "not fetched
    // yet", not "no agents", so the guard must keep waiting (not redirect).
    mockAgents.mockReturnValue(agentsResult([], false));
    const { result } = renderHook(() => useAiSurfaceEnabled());
    expect(result.current).toEqual({ enabled: false, isLoading: true });
  });

  it('reports loading while the catalog fetch is in flight', () => {
    mockAgents.mockReturnValue(agentsResult([], true));
    const { result } = renderHook(() => useAiSurfaceEnabled());
    expect(result.current).toEqual({ enabled: false, isLoading: true });
  });

  it('is disabled — not loading — once a fetch resolves empty (Community Edition: no agents)', () => {
    // Simulate the real lifecycle: fetch in flight → resolves with an empty
    // catalog. The latch records that a fetch ran, so the empty result is now
    // definitive and the guard redirects instead of spinning forever.
    mockAgents.mockReturnValue(agentsResult([], true));
    const { result, rerender } = renderHook(() => useAiSurfaceEnabled());
    expect(result.current.isLoading).toBe(true);

    mockAgents.mockReturnValue(agentsResult([], false));
    rerender();
    expect(result.current).toEqual({ enabled: false, isLoading: false });
  });
});
