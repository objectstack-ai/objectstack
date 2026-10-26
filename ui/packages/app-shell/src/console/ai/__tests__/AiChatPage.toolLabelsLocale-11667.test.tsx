// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11667 — the AI chat's tool-approval card and Builder handoff card
 * speak the session's language.
 *
 * `ChatPane` handed `ChatbotEnhanced` three literals for the inline HITL card
 * ("Approve & run", "Reject", and the deny reason "Operator rejected from
 * chat") and left the ADR-0057 P4 handoff card on the component's English
 * defaults ("Build this in the Builder", "Open in Builder →", and the
 * superseded card's tooltip "A newer request is available"). Every other label
 * on the same screen was already a `console.ai.*` key, so a zh-CN reader met
 * these six in English.
 *
 * Rendered as shipped: the REAL `ChatbotEnhanced` under a real `I18nProvider`,
 * with only the transport (`useObjectChat`) stubbed so the conversation is a
 * fixture — one tool call awaiting approval, and two handoff cards, so one of
 * them is the superseded card whose tooltip is the sixth string. The deny
 * reason is read where it is RECORDED: the body of the reject request the real
 * `useHitlInChat` sends.
 */
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/** The six strings the card names, as they used to reach every locale. */
const ENGLISH = [
  'Approve & run',
  'Reject',
  'Operator rejected from chat',
  'Build this in the Builder',
  'Open in Builder →',
  'A newer request is available',
] as const;

/**
 * The conversation: one destructive tool call held for approval (the shape
 * `mapMessages` lifts from a `pending_approval` result), then two
 * `suggest_builder` handoffs — the older one is superseded by the newer one.
 * Module-scoped so the stubbed hook hands back one stable array.
 */
const MESSAGES = [
  { id: 'u1', role: 'user', content: 'delete the task' },
  {
    id: 'a1',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 'call-approve',
        toolName: 'action_delete_task',
        args: { id: 't1' },
        state: 'approval-requested',
        pendingActionId: 'pa_11667',
      },
    ],
  },
  {
    id: 'a2',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 'call-handoff-old',
        toolName: 'suggest_builder',
        state: 'output-available',
        result: { handoff: 'build', prompt: 'Build a CRM' },
        builderHandoff: { prompt: 'Build a CRM' },
      },
    ],
  },
  {
    id: 'a3',
    role: 'assistant',
    content: '',
    toolInvocations: [
      {
        toolCallId: 'call-handoff-new',
        toolName: 'suggest_builder',
        state: 'output-available',
        result: { handoff: 'build', prompt: 'Build a CRM with deals' },
        builderHandoff: { prompt: 'Build a CRM with deals' },
      },
    ],
  },
];

const sendMessage = vi.fn();

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // `ChatbotEnhanced` stays REAL — the rendered card is the surface under test.
    useObjectChat: () => ({
      messages: MESSAGES,
      isLoading: false,
      error: undefined,
      sendMessage,
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

function renderPane(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter initialEntries={['/ai/ask/conv-1']}>
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
}

/**
 * Everything a reader can meet on the page: the text, and the attributes that
 * surface as tooltips or accessible names. The superseded card's string lives
 * ONLY in a `title`, so text alone would miss it.
 */
function readable(root: HTMLElement): string[] {
  const out = [root.textContent ?? ''];
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v) out.push(v);
    }
  }
  return out;
}

function englishFound(root: HTMLElement): string[] {
  const texts = readable(root);
  return ENGLISH.filter((s) => texts.some((t) => t.includes(s)));
}

/** The reject request `useHitlInChat` sends — where the deny reason is recorded. */
function rejectRequests(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/pending-actions/pa_11667/reject'));
}

/** The slice of `Response` the page's requests read here. */
interface FakeResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  sendMessage.mockReset();
  fetchMock = vi.fn(async (url: unknown): Promise<FakeResponse> => {
    if (String(url).endsWith('/pending-actions/pa_11667/reject')) {
      const body = JSON.stringify({ status: 'rejected', id: 'pa_11667' });
      return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
    }
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AI chat tool-approval and Builder handoff labels follow the UI locale (objectui#11667)', () => {
  it('zh-CN: none of the six English strings reaches the reader, and each surface renders in Chinese', async () => {
    const { container } = renderPane('zh-CN');

    // Each surface is on the page — so the absence below is a reading, not an
    // empty render.
    expect(await screen.findByRole('button', { name: '通过并执行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeInTheDocument();
    expect(screen.getAllByText('在构建器中搭建')).toHaveLength(2);
    expect(screen.getByTestId('builder-handoff-open')).toHaveTextContent('在构建器中打开 →');
    expect(screen.getByTestId('builder-handoff-superseded')).toHaveAttribute('title', '已有更新的请求');

    expect(englishFound(container)).toEqual([]);

    // The deny reason, where it is recorded: the reject request's body.
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(rejectRequests(fetchMock)).toHaveLength(1));
    const [, init] = rejectRequests(fetchMock)[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ reason: '操作员已在对话中拒绝' });
    // …and the model's next turn reads the same translated reason.
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(String(sendMessage.mock.calls[0][0])).toContain('操作员已在对话中拒绝');
    expect(String(sendMessage.mock.calls[0][0])).not.toContain('Operator rejected from chat');
  });

  it('en: the same fixture shows the English labels — the probe above can see them', async () => {
    // Control for the zh-CN reading: same fixture, same probe, English UI.
    // "Approve & run" is the one string English readers no longer see — the
    // card now borrows the AI Approvals inbox's wording for the same decision.
    const { container } = renderPane('en');
    expect(await screen.findByRole('button', { name: 'Approve & Execute' })).toBeInTheDocument();
    expect(englishFound(container)).toEqual(ENGLISH.filter((s) => s !== 'Approve & run' && s !== 'Operator rejected from chat'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    });
    await waitFor(() => expect(rejectRequests(fetchMock)).toHaveLength(1));
    const [, init] = rejectRequests(fetchMock)[0];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ reason: 'Operator rejected from chat' });
  });
});
