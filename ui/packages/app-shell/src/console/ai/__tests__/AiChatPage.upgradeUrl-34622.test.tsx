// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34622 — the AI chat's quota exit (`onUpgrade`, the paywall
 * button `ChatbotEnhanced` draws) opens the control plane's declared
 * `upgradeUrl` when this runtime serves one: a deep address, which the Cloud
 * console root's landing never redirects back into the environment.
 *
 * Absent, it is today's exit unchanged: the Cloud origin from
 * `cloudConsoleUrl()`, and NO button (`onUpgrade` undefined) on a runtime that
 * names no upstream cloud (objectui#7253).
 *
 * The pane is rendered for real with `ChatbotEnhanced` replaced by a prop
 * recorder, because the `onUpgrade` prop ChatPane hands down is the contract
 * under assertion. The runtime config is the REAL reader, fed one payload
 * through a replaced `fetch`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/** Props of the last `ChatbotEnhanced` render. */
let captured: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      captured = props;
      return null;
    },
    useObjectChat: () => ({
      messages: [],
      isLoading: false,
      error: undefined,
      sendMessage: vi.fn(),
      stop: vi.fn(),
      reload: vi.fn(),
      clear: vi.fn(),
      setMessages: vi.fn(),
    }),
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
  };
});

vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});
vi.mock('../../marketplace/marketplaceApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  cloudConsoleUrl: vi.fn(),
}));

import { I18nProvider } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';
import { cloudConsoleUrl } from '../../marketplace/marketplaceApi';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const CLOUD = 'https://cloud.example.test';
const UPGRADE = 'https://cloud.example.test/_console/billing?org=acme';
const cloudMock = cloudConsoleUrl as unknown as ReturnType<typeof vi.fn>;
const openMock = vi.fn();

async function serveRuntimeConfig(payload: Record<string, unknown>) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => payload })) as unknown as typeof fetch;
  try {
    await initRuntimeConfig();
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Render the pane and hand back the `onUpgrade` prop it gave the chatbot. */
function renderOnUpgrade(): (() => void) | undefined {
  cleanup();
  captured = {};
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/ai']}>
        <ChatPane
          agents={[{ name: 'ask', label: 'Ask' } as unknown as AgentDescriptor]}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent="ask"
          chatApi="/api/v1/ai/agents/ask/chat"
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  expect('onUpgrade' in captured).toBe(true);
  return captured.onUpgrade as (() => void) | undefined;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal('open', openMock);
  resetRuntimeConfigForTesting();
  cloudMock.mockReturnValue(CLOUD);
});
afterEach(() => {
  cleanup();
  resetRuntimeConfigForTesting();
  vi.unstubAllGlobals();
});

describe('AI chat quota exit — declared upgradeUrl (objectstack#34622)', () => {
  it('declared: the exit opens the declared address, not the Cloud origin', async () => {
    await serveRuntimeConfig({ cloudUrl: CLOUD, upgradeUrl: UPGRADE });
    const onUpgrade = renderOnUpgrade();
    expect(onUpgrade).toBeTypeOf('function');
    onUpgrade!();
    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith(UPGRADE, '_blank', 'noopener,noreferrer');
  });

  it('declared on a runtime that names no upstream cloud: the exit is wired, to the declared address', async () => {
    cloudMock.mockReturnValue('');
    await serveRuntimeConfig({ upgradeUrl: UPGRADE });
    const onUpgrade = renderOnUpgrade();
    expect(onUpgrade).toBeTypeOf('function');
    onUpgrade!();
    expect(openMock).toHaveBeenCalledWith(UPGRADE, '_blank', 'noopener,noreferrer');
  });

  // CONTROL — absent, today's exit: the Cloud origin, or no button at all.
  it('absent: the exit opens the Cloud origin, as before', async () => {
    await serveRuntimeConfig({ cloudUrl: CLOUD });
    const onUpgrade = renderOnUpgrade();
    expect(onUpgrade).toBeTypeOf('function');
    onUpgrade!();
    expect(openMock).toHaveBeenCalledWith(CLOUD, '_blank', 'noopener,noreferrer');
  });

  it('absent on a runtime that names no upstream cloud: no exit (no upgrade button), as before', async () => {
    cloudMock.mockReturnValue('');
    await serveRuntimeConfig({ singleEnvironment: true });
    expect(renderOnUpgrade()).toBeUndefined();
    expect(openMock).not.toHaveBeenCalled();
  });
});
