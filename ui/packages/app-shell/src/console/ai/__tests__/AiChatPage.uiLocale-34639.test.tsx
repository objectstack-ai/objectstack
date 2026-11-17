// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34639 — the AI chat request carries the console's resolved UI
 * language as `context.uiLocale`.
 *
 * The server picks the words a reply uses for a card control (the plan card's
 * approve button) from this value; without it the server only sees the
 * browser's `Accept-Language`, so a Chinese reply under an English console
 * named a button the card never drew.
 *
 * The value is the language the pane's own translation hook resolves, sent as
 * is: the consumer validates it, so no normalisation happens here. The
 * expected value is read from a probe under the same provider rather than
 * written down, so the pin holds whatever tag the provider resolves.
 *
 * The pane is rendered for real with `ChatbotEnhanced` and `useObjectChat`
 * replaced by recorders, because the options ChatPane hands the chat hook ARE
 * the request body under assertion. The console dock mounts this same
 * `ChatPane`, so it is covered by the same seam.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/** Options of the last `useObjectChat` call — carries the request `body`. */
let chatOptions: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ChatbotEnhanced: () => null,
    useObjectChat: (options: Record<string, unknown>) => {
      chatOptions = options;
      return {
        messages: [],
        isLoading: false,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
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

import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import type { AgentDescriptor } from '@object-ui/plugin-chatbot';
import { ChatPane } from '../AiChatPage';
import type { HydratedUIMessage } from '../../../hooks/useChatConversation';

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

/**
 * The language the provider resolved, read the way ChatPane reads it, and
 * reported from an effect: the lint rule forbids writing an outer variable
 * during render, and `render()` flushes effects before it returns.
 */
function LanguageProbe({ onLanguage }: { onLanguage: (language: string | undefined) => void }) {
  const { language } = useObjectTranslation();
  React.useEffect(() => onLanguage(language), [language, onLanguage]);
  return null;
}

const ZH_THREAD = [
  { id: 'm1', role: 'user', parts: [{ type: 'text', text: '帮我做一个客户管理应用' }] },
] as HydratedUIMessage[];

function renderPane(uiLocale: string, initialMessages: HydratedUIMessage[] = []) {
  cleanup();
  chatOptions = {};
  let probedLanguage: string | undefined;
  const onLanguage = (language: string | undefined) => {
    probedLanguage = language;
  };
  render(
    <I18nProvider config={{ defaultLanguage: uiLocale, detectBrowserLanguage: false }}>
      <LanguageProbe onLanguage={onLanguage} />
      <MemoryRouter initialEntries={['/ai/build/conv-1']}>
        <ChatPane
          agents={[{ name: 'build', label: 'Builder' } as unknown as AgentDescriptor]}
          agentsLoading={false}
          agentsError={undefined}
          activeAgent="build"
          chatApi="/api/v1/ai/agents/build/chat"
          apiBase="/api/v1/ai"
          conversationId="conv-1"
          initialMessages={initialMessages}
          pendingFirstMessageRef={{ current: null }}
          onSent={vi.fn()}
          onShare={vi.fn()}
        />
      </MemoryRouter>
    </I18nProvider>,
  );
  const body = chatOptions.body as { context: Record<string, unknown> };
  return { context: body.context, language: probedLanguage };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('AI chat request carries the console UI language as context.uiLocale (objectstack#34639)', () => {
  it.each(['en', 'zh', 'de'])('%s console: context.uiLocale is the resolved UI language', (uiLocale) => {
    const { context, language } = renderPane(uiLocale);
    expect(typeof language).toBe('string');
    expect(language).not.toBe('');
    expect(context.uiLocale).toBe(language);
  });

  it('the value follows the console, not the conversation: a Chinese thread under an English console sends the English tag', () => {
    const english = renderPane('en', ZH_THREAD);
    const chinese = renderPane('zh', ZH_THREAD);
    expect(english.context.uiLocale).toBe(english.language);
    expect(chinese.context.uiLocale).toBe(chinese.language);
    // Discriminating half: the same thread, two consoles, two values.
    expect(english.context.uiLocale).not.toBe(chinese.context.uiLocale);
  });

  it('the rest of the context is unchanged beside it', () => {
    const { context } = renderPane('en');
    expect(context.agentName).toBe('build');
    expect(Object.keys(context).sort()).toEqual(['agentName', 'autoPublishAiBuilds', 'uiLocale']);
  });
});
