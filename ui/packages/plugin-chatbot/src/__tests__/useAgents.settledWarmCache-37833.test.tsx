// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37833 — `useAgents` says when a catalog read has answered
 * (`settled`), and says it on a read the module cache answers too.
 *
 * A cache hit resolves in microtasks, so `isLoading` goes true and false
 * before React renders once: no render ever sees it loading. A caller that
 * told "not fetched yet" from "fetched, empty" by having seen `isLoading`
 * (`useAiSurfaceEnabled`, for a member with no AI seat) waited for ever.
 *
 * The cases mount with `createRoot` and React's act environment OFF, as a
 * browser schedules: under `act` each queued update is flushed in turn and
 * the loading render is seen, which hides the defect.
 *
 *   (a) cold read over the network: settled once it answers;
 *   (b) a second mount the cache answers (empty catalog): settled, never
 *       having rendered loading;
 *   (c) a failed read: settled, with its error;
 *   (d) disabled: never settled, nothing asked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAgents, __resetAgentsCatalog, type UseAgentsReturn } from '../useAgents';

const API_BASE = '/api/v1/ai';
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let fetchMock: ReturnType<typeof vi.fn>;
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedActEnv: boolean | undefined;

function answering(status: number, agents: unknown[]) {
  return vi.fn(async () => {
    await sleep(20);
    return new Response(JSON.stringify({ success: true, data: { agents } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/** Mount `useAgents` outside `act`; every render's `{ isLoading, settled }` is recorded. */
function mount(options: { enabled?: boolean } = {}) {
  const renders: Array<Pick<UseAgentsReturn, 'isLoading' | 'settled'> & { error: boolean }> = [];
  function Probe() {
    const result = useAgents({ apiBase: API_BASE, ...options });
    renders.push({ isLoading: result.isLoading, settled: result.settled, error: Boolean(result.error) });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  root.render(<Probe />);
  return { renders, unmount: () => root.unmount() };
}

beforeEach(() => {
  __resetAgentsCatalog();
  savedActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
});

afterEach(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = savedActEnv;
  vi.unstubAllGlobals();
});

describe('useAgents reports a settled read (objectstack#37833)', () => {
  it('(a) a cold read: not settled until the network answers, settled after', async () => {
    fetchMock = answering(200, []);
    vi.stubGlobal('fetch', fetchMock);
    const cold = mount();
    await sleep(200);
    expect(cold.renders[0]).toEqual({ isLoading: false, settled: false, error: false });
    expect(cold.renders.some((r) => r.isLoading && !r.settled)).toBe(true);
    expect(cold.renders[cold.renders.length - 1]).toEqual({ isLoading: false, settled: true, error: false });
    cold.unmount();
  });

  it('(b) a read the cache answers with an empty catalog: settled, though no render saw it loading', async () => {
    fetchMock = answering(200, []);
    vi.stubGlobal('fetch', fetchMock);
    const cold = mount();
    await sleep(200);
    cold.unmount();

    const warm = mount();
    await sleep(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warm.renders.some((r) => r.isLoading)).toBe(false);
    expect(warm.renders[warm.renders.length - 1]).toEqual({ isLoading: false, settled: true, error: false });
    warm.unmount();
  });

  it('(c) a failed read is settled, with its error', async () => {
    fetchMock = answering(404, []);
    vi.stubGlobal('fetch', fetchMock);
    const failed = mount();
    await sleep(200);
    expect(failed.renders[failed.renders.length - 1]).toEqual({ isLoading: false, settled: true, error: true });
    failed.unmount();
  });

  it('(d) disabled: never settled, and nothing is asked', async () => {
    fetchMock = answering(200, []);
    vi.stubGlobal('fetch', fetchMock);
    const off = mount({ enabled: false });
    await sleep(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(off.renders.every((r) => !r.settled)).toBe(true);
    off.unmount();
  });
});
