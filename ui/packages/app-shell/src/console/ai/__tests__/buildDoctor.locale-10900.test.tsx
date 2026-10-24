// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10900 — the build conversation's Build Doctor button and the drawer
 * it opens speak the session's language.
 *
 * The 2026-09-28 cloud E2E, browser in zh-CN, read `Build Doctor` in the
 * build conversation header: the button's accessible name and both of its
 * tooltips were English literals beside a Share button that already read
 * `console.ai.*` keys, and the drawer's title was a literal too. Rendered here
 * as shipped under a real `I18nProvider` — `ChatPane` with `useObjectChat`
 * stubbed and `ChatbotEnhanced` reduced to the `headerSlot` ChatPane hands it
 * (the way the sibling ChatPane suites stub them), and the drawer with its one
 * request answered.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // The header the pane builds reaches the chat surface as `headerSlot`;
    // render just that, so the button is in the DOM as ChatPane made it.
    ChatbotEnhanced: (props: { headerSlot?: React.ReactNode }) => <div>{props.headerSlot}</div>,
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

import { I18nProvider } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';
import { BuildDebugDrawer } from '../BuildDebugDrawer';

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

const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

function renderPane(config: typeof ZH | typeof EN, conversationId: string | undefined) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <MemoryRouter initialEntries={['/ai/build']}>
        <ChatPane
          agents={[{ name: 'build', label: 'Builder' } as unknown as AgentDescriptor]}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent="build"
          chatApi="/api/v1/ai/agents/build/chat"
          apiBase="/api/v1/ai"
          conversationId={conversationId}
          initialMessages={[]}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
          onDebug={vi.fn()}
          showDebug
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function renderDrawer(config: typeof ZH | typeof EN) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <BuildDebugDrawer apiBase="/api/v1/ai" conversationId="conv_x" open onOpenChange={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // The drawer's one request; an unreadable answer is enough — the title is
  // drawn before and regardless of the report.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Build Doctor button (objectui#10900)', () => {
  it('zh: accessible name and tooltip are Chinese', () => {
    renderPane(ZH, 'conv-1');
    const button = screen.getByTestId('ai-chat-debug-button');
    expect(button).toHaveAttribute('aria-label', '构建诊断');
    expect(button).toHaveAttribute('title', '构建诊断 — 实际生效了哪些变更？');
  });

  it('zh: the tooltip before the first message is Chinese', () => {
    renderPane(ZH, undefined);
    expect(screen.getByTestId('ai-chat-debug-button')).toHaveAttribute('title', '请先发送一条消息');
  });

  it('en: unchanged English', () => {
    renderPane(EN, 'conv-1');
    const button = screen.getByTestId('ai-chat-debug-button');
    expect(button).toHaveAttribute('aria-label', 'Build Doctor');
    expect(button).toHaveAttribute('title', 'Build Doctor — what actually landed?');
  });

  it('en: the tooltip before the first message is unchanged English', () => {
    renderPane(EN, undefined);
    expect(screen.getByTestId('ai-chat-debug-button')).toHaveAttribute('title', 'Send a message first');
  });
});

describe('Build Doctor drawer title (objectui#10900)', () => {
  it('zh: the title is Chinese', () => {
    renderDrawer(ZH);
    expect(screen.getByRole('dialog', { name: '构建诊断' })).toBeInTheDocument();
  });

  it('en: the title is unchanged English', () => {
    renderDrawer(EN);
    expect(screen.getByRole('dialog', { name: 'Build Doctor' })).toBeInTheDocument();
  });
});
