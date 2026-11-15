// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33420 — on a new conversation the user's first message is drawn
 * in the thread the moment it is sent, not when `POST /conversations` answers.
 *
 * The first send is what creates the conversation, and the chat pane is keyed
 * on its id, so the message is held (`useDeferredFirstSend`) until the id lands
 * and the pane remounts. While it is held it shows as the user's bubble with
 * the assistant's thinking dots under it, and once the id lands it is drawn
 * exactly once. A message typed during the wait joins the held one and shows
 * with it. A create that fails takes the pending bubble away and runs the
 * composer's not-sent rollback: the text goes back in the box, with the
 * send-error notice.
 *
 * ## Real subjects
 *
 * The full-page `AiChatPage` at `/ai/build`, with the REAL `ChatPane`, the REAL
 * `useChatConversation`, the REAL `useObjectChat` transport and the REAL
 * `ChatbotEnhanced`, driven through its composer (type, then submit the form).
 * The stand-ins: the agent catalog (one `build` agent), the model allowlist,
 * the signed-in user, the metadata apps list, the side panels, and `fetch`,
 * whose `POST /conversations` is held open until the test answers it.
 *
 * Pins:
 *  - create held: the bubble is in the thread before it answers; answered:
 *    exactly one bubble after the remount, and the chat request carried it;
 *  - a second message typed during the wait shows too, after the first;
 *  - create fails: the bubble is gone and the text is back in the composer;
 *    likewise when the send was recorded during a still-running resolve and
 *    the create it later makes fails;
 *  - CONTROL: a send in an existing conversation draws and sends as before.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'build', label: 'Build', capabilities: ['build'] }],
    isLoading: false,
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => true }));
vi.mock('../../../layout/AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
vi.mock('../ConversationsSidebar', () => ({ ConversationsSidebar: () => null }));
vi.mock('../LiveCanvas', () => ({ LiveCanvas: () => null }));
vi.mock('../PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { AiChatPage } from '../AiChatPage';
import { ChatDockConversation } from '../../../layout/ChatDockConversation';

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

const CACHE_KEY = 'objectstack:ai-chat-conversation-id:u1:build';

interface Held {
  answer: (r: Response) => void;
}

const state = {
  /** `POST /conversations` calls still waiting for the test to answer them. */
  creates: [] as Held[],
  /** `GET /conversations/:id` calls held open (only when `holdGet` is set). */
  gets: [] as Held[],
  holdGet: false,
  /** The user text of every chat POST, in order. */
  sent: [] as string[],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A minimal, well-formed UI-message stream so a send completes. */
function dataStreamResponse(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

/** The text of the newest user message in a chat POST body. */
function lastUserText(body: string): string {
  const parsed = JSON.parse(body) as { messages?: Array<{ role: string; parts?: Array<{ type: string; text?: string }>; content?: string }> };
  const users = (parsed.messages ?? []).filter((m) => m.role === 'user');
  const last = users[users.length - 1];
  if (!last) return '';
  if (typeof last.content === 'string') return last.content;
  return (last.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text ?? '').join('');
}

beforeEach(() => {
  state.creates = [];
  state.gets = [];
  state.holdGet = false;
  state.sent = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (/\/agents\/[^/]+\/chat$/.test(url) && method === 'POST') {
        state.sent.push(lastUserText(String(init?.body ?? '{}')));
        return dataStreamResponse();
      }
      if (/\/conversations$/.test(url) && method === 'POST') {
        return new Promise<Response>((resolve) => state.creates.push({ answer: resolve }));
      }
      const one = /\/conversations\/([^/?]+)$/.exec(url);
      if (one && method === 'GET') {
        if (state.holdGet) return new Promise<Response>((resolve) => state.gets.push({ answer: resolve }));
        return json({ id: decodeURIComponent(one[1]), messages: [] });
      }
      return json({ success: true, data: [] });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountDock(): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm_app/account']}>
        <ChatDockConversation userId="u1" apiBase="/api/v1/ai" />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mount(path = '/ai/build'): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
          <Route path="/ai/:agent" element={<AiChatPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

async function composer(): Promise<HTMLTextAreaElement> {
  return (await screen.findByRole('textbox', {}, { timeout: 4000 })) as HTMLTextAreaElement;
}

/** Types `text` into the composer and submits its form, as Enter does. */
async function typeAndSend(text: string): Promise<void> {
  const box = await composer();
  fireEvent.change(box, { target: { value: text } });
  await act(async () => {
    fireEvent.submit(box.closest('form')!);
  });
  // The composer hands the message over on a microtask; let it and the
  // deferred-send bookkeeping settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** How many times `text` is drawn in the thread. */
function drawn(text: string): number {
  const log = screen.queryByRole('log');
  if (!log) return 0;
  return within(log).queryAllByText(text, { exact: false }).length;
}

async function answerCreate(response: Response): Promise<void> {
  await waitFor(() => expect(state.creates.length).toBeGreaterThan(0));
  const held = state.creates.shift()!;
  await act(async () => {
    held.answer(response);
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe.each([
  ['the full-page chat (/ai/build)', () => mount()],
  ['the console dock', mountDock],
])('%s — the first message of a new conversation is drawn at once (objectstack#33420)', (_host, mountHost) => {
  it('is drawn while the create is held, and exactly once after the id lands', async () => {
    mountHost();
    await typeAndSend('build me a library app');

    // The create is on the wire and has not answered: the message is in the thread.
    expect(state.creates).toHaveLength(1);
    expect(drawn('build me a library app')).toBe(1);
    expect(state.sent).toEqual([]);

    await answerCreate(json({ id: 'conv-1', messages: [] }));

    await waitFor(() => expect(state.sent).toEqual(['build me a library app']));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(drawn('build me a library app')).toBe(1);
  });

  it('a failed create takes the bubble away and puts the text back in the composer', async () => {
    mountHost();
    await typeAndSend('build me a library app');
    expect(drawn('build me a library app')).toBe(1);
    const box = await composer();
    expect(box.value).toBe('');

    await answerCreate(new Response('upstream busy', { status: 503 }));

    await waitFor(() => expect(drawn('build me a library app')).toBe(0));
    await waitFor(() => expect(box.value).toBe('build me a library app'));
    expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
    expect(state.sent).toEqual([]);

    // Sending again retries the create, and the message is sent once.
    await typeAndSend('build me a library app');
    expect(drawn('build me a library app')).toBe(1);
    await answerCreate(json({ id: 'conv-1', messages: [] }));
    await waitFor(() => expect(state.sent).toEqual(['build me a library app']));
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
  });
});

describe('the full-page chat — the held first message, more cases (objectstack#33420)', () => {
  it('a second message typed during the wait is drawn too, after the first', async () => {
    mount();
    await typeAndSend('first part');
    await typeAndSend('second part');

    expect(state.creates).toHaveLength(1);
    expect(drawn('first part')).toBe(1);
    expect(drawn('second part')).toBe(1);
    const text = screen.getByRole('log').textContent ?? '';
    expect(text.indexOf('first part')).toBeLessThan(text.indexOf('second part'));

    await answerCreate(json({ id: 'conv-1', messages: [] }));
    await waitFor(() => expect(state.sent).toEqual(['first part\n\nsecond part']));
    expect(drawn('first part')).toBe(1);
    expect(drawn('second part')).toBe(1);
  });

  it('a send recorded during a still-running resolve rolls back the same way when its create fails', async () => {
    // A cached conversation id whose GET is slow: the user sends while the
    // resolve runs, the id turns out to be gone, and the create it then makes fails.
    window.localStorage.setItem(CACHE_KEY, 'conv-dead');
    state.holdGet = true;
    mount();
    await waitFor(() => expect(state.gets.length).toBe(1));
    await typeAndSend('build me a library app');
    expect(drawn('build me a library app')).toBe(1);
    expect(state.creates).toHaveLength(0);

    await act(async () => {
      state.gets.shift()!.answer(new Response('gone', { status: 404 }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await answerCreate(new Response('upstream busy', { status: 503 }));

    const box = await composer();
    await waitFor(() => expect(drawn('build me a library app')).toBe(0));
    await waitFor(() => expect(box.value).toBe('build me a library app'));
    expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
    expect(state.sent).toEqual([]);
  });

  it('CONTROL: a send in an existing conversation draws and sends as before', async () => {
    mount('/ai/build/conv-7');
    // Typed once the conversation is open, as the user sees it.
    await composer();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await typeAndSend('add a due date field');

    expect(state.creates).toHaveLength(0);
    await waitFor(() => expect(state.sent).toEqual(['add a due date field']));
    expect(drawn('add a due date field')).toBe(1);
  });
});
