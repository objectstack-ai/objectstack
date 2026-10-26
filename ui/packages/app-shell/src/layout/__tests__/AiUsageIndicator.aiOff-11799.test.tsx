/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#11799 — with AI off, the usage indicator never asks for usage.
 *
 * An open-edition server answers `GET /api/v1/ai/agents` with its empty-list
 * courtesy and every other `/ai/*` route with 501. The Studio dock is drawn
 * while the agent catalog loads, so its indicator mounted, read
 * `GET /api/v1/ai/usage` and logged a 501 on every mount. The indicator now
 * reads usage only while the catalog at its own base lists an agent, the signal
 * `useAiSurfaceEnabled` gates every AI entry point on.
 *
 * The REAL `useAgents` and the REAL `useAiUsage`, over a stubbed fetch that
 * records every URL. Each case uses its own base, because `useAgents` keeps a
 * catalog answer per base for a short while.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { AI_USAGE_REFRESH_EVENT } from '@object-ui/plugin-chatbot';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));
vi.mock('../../console/marketplace/marketplaceApi', () => ({
  cloudConsoleUrl: () => 'https://cloud.example',
}));

import { AiUsageIndicator } from '../AiUsageIndicator';

const POOL = {
  planType: 'free',
  fraction: 0.3,
  unmetered: false,
  resetKind: 'daily',
  resetsAt: null,
  upgrade: false,
  topUp: false,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A server whose catalog lists `agents`, recording every URL it is asked. */
function serverWith(agents: Array<{ name: string }>, hold?: Promise<void>) {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/agents')) {
        if (hold) await hold;
        return json(200, { success: true, data: { agents } });
      }
      if (url.endsWith('/usage')) return agents.length ? json(200, { pool: POOL }) : json(501, { error: { code: 'NOT_IMPLEMENTED' } });
      return json(404, {});
    }),
  );
  return { usageReads: () => urls.filter((u) => u.endsWith('/usage')).length, urls };
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** What the indicator re-reads on: the chat engine's nudge, and tab re-focus. */
async function nudge() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent(AI_USAGE_REFRESH_EVENT));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AiUsageIndicator — no usage read with AI off (objectui#11799)', () => {
  it('an empty agent catalog: /ai/usage is never requested, not on mount and not on a nudge', async () => {
    const server = serverWith([]);
    const { container } = render(<AiUsageIndicator apiBase="/api/v1/ai-off" />);
    await settle();
    await nudge();
    expect(server.usageReads()).toBe(0);
    expect(container).toBeEmptyDOMElement();
    // The "never" above is read after the catalog answered empty.
    expect(server.urls).toContain('/api/v1/ai-off/agents');
  });

  it('while the catalog is still loading, usage is not read yet', async () => {
    let release!: () => void;
    const server = serverWith([{ name: 'ask' }], new Promise<void>((r) => (release = r)));
    render(<AiUsageIndicator apiBase="/api/v1/ai-loading" />);
    await waitFor(() => expect(server.urls).toContain('/api/v1/ai-loading/agents'));
    await settle();
    expect(server.usageReads()).toBe(0);

    await act(async () => release());
    await waitFor(() => expect(server.usageReads()).toBe(1));
  });

  it('control: a catalog that lists an agent reads usage on mount and again on a nudge', async () => {
    const server = serverWith([{ name: 'ask' }]);
    render(<AiUsageIndicator apiBase="/api/v1/ai-on" />);
    expect(await screen.findByTestId('ai-usage-indicator')).toBeInTheDocument();
    expect(server.usageReads()).toBe(1);

    await nudge();
    expect(server.usageReads()).toBeGreaterThan(1);
  });
});
