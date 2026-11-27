// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37833 — `useAiSurfaceEnabled` leaves its loading state when the
 * agent catalog is empty and the session cache answers it.
 *
 * The console reads the catalog on every open, so a surface that mounts later
 * (the app root's landing, the `ai:chat` page on a direct link) is answered by
 * `useAgents`' module cache: `isLoading` goes true and false before React
 * renders once. Read through a latch that only a render seeing `isLoading`
 * could set, a member with no AI seat stayed "loading" for ever; it reads
 * `useAgents`' `settled` now.
 *
 * Real `useAgents` (this is why the file is not a `describe` in
 * `useAiSurface.test.ts`, which mocks it) over a stubbed `apiFetch`, mounted
 * with `createRoot` and React's act environment OFF, as a browser schedules:
 * under `act` each queued update is flushed in turn and the loading render is
 * seen, which hides the defect.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { SchemaRendererContext, type ApiFetch } from '@object-ui/react';
import { __resetAgentsCatalog } from '../../../../plugin-chatbot/src/useAgents';
import { useAiSurfaceEnabled } from '../useAiSurface';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let savedActEnv: boolean | undefined;

function catalogFetch(agents: unknown[]): ApiFetch {
  return (async () => {
    await sleep(20);
    return { ok: true, status: 200, json: async () => ({ success: true, data: { agents } }) } as unknown as Response;
  }) as ApiFetch;
}

/** Mount `useAiSurfaceEnabled` outside `act`; every render's `enabled/isLoading` is recorded. */
function mount(apiFetch: ApiFetch) {
  const renders: string[] = [];
  function Probe() {
    const surface = useAiSurfaceEnabled();
    renders.push(`${surface.enabled}/${surface.isLoading}`);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  root.render(
    <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch } as never}>
      <Probe />
    </SchemaRendererContext.Provider>,
  );
  return { renders, unmount: () => root.unmount() };
}

beforeEach(() => {
  __resetAgentsCatalog();
  savedActEnv = actEnv.IS_REACT_ACT_ENVIRONMENT;
  actEnv.IS_REACT_ACT_ENVIRONMENT = false;
});

afterEach(() => {
  actEnv.IS_REACT_ACT_ENVIRONMENT = savedActEnv;
});

describe('useAiSurfaceEnabled on a catalog the session cache answers (objectstack#37833)', () => {
  it('an empty catalog: loading on the cold read, then disabled and not loading on the warm one', async () => {
    const apiFetch = catalogFetch([]);
    const cold = mount(apiFetch);
    await sleep(200);
    expect(cold.renders[0]).toBe('false/true');
    expect(cold.renders[cold.renders.length - 1]).toBe('false/false');
    cold.unmount();

    const warm = mount(apiFetch);
    await sleep(200);
    expect(warm.renders[0]).toBe('false/true');
    expect(warm.renders[warm.renders.length - 1]).toBe('false/false');
    warm.unmount();
  });

  it('CONTROL: a served catalog is enabled on the warm read', async () => {
    const apiFetch = catalogFetch([{ name: 'ask', label: 'Ask' }]);
    const cold = mount(apiFetch);
    await sleep(200);
    cold.unmount();
    const warm = mount(apiFetch);
    await sleep(200);
    expect(warm.renders[warm.renders.length - 1]).toBe('true/false');
    warm.unmount();
  });
});
