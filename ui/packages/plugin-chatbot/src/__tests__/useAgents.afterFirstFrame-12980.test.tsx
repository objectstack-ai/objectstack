// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12980, part 3 — the agent catalog (`GET /api/v1/ai/agents`) is read
 * after the first frame has painted, not in the mounting commit beside the
 * page's own reads.
 *
 * The catalog decides whether the AI entry points draw at all, and they stay
 * hidden while it loads, so nothing on the first paint is waiting for it. The
 * frame is held here by hand (a recorded `requestAnimationFrame`), so "not
 * before the frame" is a fact of this test, not of the machine's speed.
 *
 *   (a) mounted, effects flushed, tasks drained: no request;
 *   (b) the frame paints: the request goes out and the agents are returned;
 *   CONTROL: once a frame has painted, a surface that mounts later (the dock
 *   opening, a remount on navigation) reads at once, with no frame to wait for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAgents, __resetAgentsCatalog } from '../useAgents';

let frames: FrameRequestCallback[] = [];
const paintFrame = () =>
  act(async () => {
    const pending = frames;
    frames = [];
    for (const cb of pending) cb(performance.now());
    await new Promise<void>((r) => setTimeout(r, 0));
  });
const drainTasks = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetAgentsCatalog();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { agents: [{ name: 'ask', label: 'Ask' }] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAgents reads the catalog after the first frame (objectui#12980)', () => {
  it('(a) sends nothing in the mounting commit, (b) reads once the frame paints', async () => {
    const { result } = renderHook(() => useAgents({ apiBase: '/api/v1/ai' }));
    await drainTasks();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.agents).toEqual([]);

    await paintFrame();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/v1/ai/agents');
    await waitFor(() => expect(result.current.agents.map((a) => a.name)).toEqual(['ask']));
  });

  it('CONTROL: after a frame has painted, a surface mounting later reads at once', async () => {
    const first = renderHook(() => useAgents({ apiBase: '/api/v1/ai' }));
    await paintFrame();
    await waitFor(() => expect(first.result.current.agents).toHaveLength(1));
    first.unmount();

    const second = renderHook(() => useAgents({ apiBase: '/api/v1/ai-other' }));
    await drainTasks();
    expect(frames).toHaveLength(0);
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((c) => String(c[0]))).toContain('/api/v1/ai-other/agents'),
    );
    await waitFor(() => expect(second.result.current.agents).toHaveLength(1));
  });
});
