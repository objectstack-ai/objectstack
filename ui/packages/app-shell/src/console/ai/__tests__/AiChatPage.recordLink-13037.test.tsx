// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13037 — a record link in an assistant answer (`/record/OBJECT/ID`)
 * lands on that record's console page, in the same tab, with no dialog, under
 * a `/_console/` mount and under a root mount.
 *
 * The real `ChatPane` and the real `ChatbotEnhanced`: the click goes through
 * the page's `open_record` opener (`openRecord`), which resolves the app
 * segment from the object's owning package and navigates inside the router,
 * so the router's basename is the mount. Only the chat hook (the answer) and
 * the metadata read (the owning package) are faked. The renderer half — the
 * other links keep their dialog — is pinned in plugin-chatbot's
 * `chatRecordLink-13037.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

const ANSWER = 'Top customer: [Wayne Enterprises](/record/account/acc_42).';

/**
 * objectstack#31869 — the list case's own answer, so the record describe's
 * answer stays exactly as it was. `answerNow` is what the mocked chat hook
 * answers with; each describe sets it.
 */
const LIST_FILTER = { logic: 'and', conditions: [{ field: 'stage', operator: 'equals', value: 'open' }] };
const LIST_ANSWER = `There are [12 open opportunities](/list/opportunity?view=all&uf__filter=${encodeURIComponent(JSON.stringify(LIST_FILTER))}).`;
const answerNow = vi.hoisted(() => ({ content: '' }));

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useObjectChat: () => ({
      messages: [
        { id: 'u1', role: 'user', content: 'analyse my customers' },
        { id: 'a1', role: 'assistant', content: answerNow.content || ANSWER },
      ],
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

const AGENTS = [{ name: 'ask', label: 'Ask' }] as unknown as AgentDescriptor[];

function renderPane(basename: string) {
  window.history.replaceState(null, '', `${basename === '/' ? '' : basename}/ai/ask/conv-1`);
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <BrowserRouter basename={basename}>
        <ChatPane
          agents={AGENTS}
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
      </BrowserRouter>
    </I18nProvider>,
  );
}

let windowOpen: ReturnType<typeof vi.fn>;
beforeEach(() => {
  window.localStorage.clear();
  windowOpen = vi.fn();
  vi.stubGlobal('open', windowOpen);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input).endsWith('/api/v1/meta/object/account')
        ? { item: { name: 'account', _packageId: 'com.acme.crm' } }
        : String(input).endsWith('/api/v1/meta/object/opportunity')
          ? { item: { name: 'opportunity', _packageId: 'com.acme.crm' } }
          : { success: true, data: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
});
afterEach(() => {
  answerNow.content = '';
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('objectui#13037 — a record link in an answer opens the record in the console', () => {
  for (const [mount, basename, expected] of [
    ['a /_console/ mount', '/_console', '/_console/apps/com.acme.crm/account/record/acc_42'],
    ['a root mount', '/', '/apps/com.acme.crm/account/record/acc_42'],
  ] as const) {
    it(`under ${mount}: the record page, same tab, no dialog`, async () => {
      renderPane(basename);
      const link = await screen.findByRole('button', { name: 'Wayne Enterprises' });
      await act(async () => {
        fireEvent.click(link);
      });
      await waitFor(() => expect(window.location.pathname).toBe(expected));
      expect(document.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull();
      expect(windowOpen).not.toHaveBeenCalled();
    });
  }
});

describe('objectstack#31869 — a list link in an answer opens the filtered list in the console', () => {
  for (const [mount, basename, expected] of [
    ['a /_console/ mount', '/_console', '/_console/apps/com.acme.crm/opportunity'],
    ['a root mount', '/', '/apps/com.acme.crm/opportunity'],
  ] as const) {
    it(`under ${mount}: the list page with the view and the filter, same tab, no dialog`, async () => {
      answerNow.content = LIST_ANSWER;
      renderPane(basename);
      const link = await screen.findByRole('button', { name: '12 open opportunities' });
      await act(async () => {
        fireEvent.click(link);
      });
      await waitFor(() => expect(window.location.pathname).toBe(expected));
      const params = new URLSearchParams(window.location.search);
      // Built from the parsed values: exactly the two keys, the filter equal to the link's.
      expect([...params.keys()].sort()).toEqual(['uf__filter', 'view']);
      expect(params.get('view')).toBe('all');
      expect(JSON.parse(params.get('uf__filter')!)).toEqual(LIST_FILTER);
      expect(document.querySelector('[data-streamdown="link-safety-modal"]')).toBeNull();
      expect(windowOpen).not.toHaveBeenCalled();
    });
  }
});
