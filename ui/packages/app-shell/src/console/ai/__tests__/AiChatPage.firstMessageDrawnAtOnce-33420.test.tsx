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
 *
 * objectstack#33562 — two sends during one held create, then a failed create:
 * the box gets both parts back, first part first, and the retry sends the
 * joined text once (the single-send rollback above is the CONTROL).
 *
 * objectstack#33567 — on a link to an existing conversation, a message sent
 * before that conversation's GET answers is held, drawn, and sent once into it
 * when the GET answers; no conversation is created (the existing-conversation
 * send above is the CONTROL).
 *
 * objectstack#33674 — text typed into the composer but not sent, before the
 * pane knows its conversation, is still in the box after the pane remounts on
 * the id (a link's GET answering; a new conversation's create answering), with
 * the cursor at its end and nothing sent. CONTROLS: a draft in an open
 * conversation stays put; opening another conversation leaves a draft behind.
 *
 * objectstack#33685 — a send held while a linked conversation loads is given
 * back with the not-sent notice when that load fails (5xx or network), joined
 * parts included, and the next send loads the conversation again and sends
 * once. CONTROLS: a load that answers sends once; a 404 creates a new one.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
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

vi.mock('../PendingDraftsBar', () => ({ PendingDraftsBar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { AiChatPage, useComposerDraftHandoff } from '../AiChatPage';
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
  /** Fails the request as a network error does (held GETs only). */
  fail?: (e: Error) => void;
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
        if (state.holdGet) {
          return new Promise<Response>((resolve, reject) => state.gets.push({ answer: resolve, fail: reject }));
        }
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

describe.each([
  ['the full-page chat (/ai/build)', () => mount()],
  ['the console dock', mountDock],
])('%s — two sends during a held create, then a failed create (objectstack#33562)', (_host, mountHost) => {
  it('gives both parts back, first part first, and the retry sends the joined text once', async () => {
    mountHost();
    await typeAndSend('first part');
    await typeAndSend('second part');
    expect(state.creates).toHaveLength(1);

    await answerCreate(new Response('upstream busy', { status: 503 }));

    const box = await composer();
    await waitFor(() => expect(box.value).toBe('first part\n\nsecond part'));
    expect(drawn('first part')).toBe(0);
    expect(drawn('second part')).toBe(0);
    expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
    expect(state.sent).toEqual([]);

    // Sending what the box holds retries the create and sends it once.
    await typeAndSend(box.value);
    await answerCreate(json({ id: 'conv-1', messages: [] }));
    await waitFor(() => expect(state.sent).toEqual(['first part\n\nsecond part']));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(state.sent).toHaveLength(1);
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
  });
});

describe('the full-page chat — a send before a linked conversation opens (objectstack#33567)', () => {
  it('is held and drawn while the GET is open, and sent once into that conversation when it answers', async () => {
    state.holdGet = true;
    mount('/ai/build/conv-7');
    await waitFor(() => expect(state.gets.length).toBe(1));
    await typeAndSend('add a due date field');

    // Not lost: drawn at once, not sent yet, and no conversation is created for it.
    expect(drawn('add a due date field')).toBe(1);
    expect(state.sent).toEqual([]);
    expect(state.creates).toHaveLength(0);

    await act(async () => {
      state.gets.shift()!.answer(json({ id: 'conv-7', messages: [] }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(state.sent).toEqual(['add a due date field']));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(state.sent).toHaveLength(1);
    expect(state.creates).toHaveLength(0);
    expect(drawn('add a due date field')).toBe(1);
    expect((await composer()).value).toBe('');
  });
});

/** Types `text` into the composer without sending it, the box focused as a typing user leaves it. */
async function typeOnly(text: string): Promise<HTMLTextAreaElement> {
  const box = await composer();
  box.focus();
  fireEvent.change(box, { target: { value: text } });
  box.setSelectionRange(text.length, text.length);
  return box;
}

/** Lets the remount and every effect after it settle. */
async function settle(ms = 50): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Navigates the mounted page, as a click on another conversation does. */
let navigateTo: ((path: string) => void) | undefined;
function Navigator(): null {
  const navigate = useNavigate();
  React.useEffect(() => {
    navigateTo = navigate;
  }, [navigate]);
  return null;
}

function mountNavigable(path: string): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[path]}>
        <Navigator />
        <Routes>
          <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
          <Route path="/ai/:agent" element={<AiChatPage />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The composer holds `text` after the pane was replaced: same text, cursor at the end, focused, nothing sent. */
async function expectDraftCarried(old: HTMLTextAreaElement, text: string): Promise<void> {
  await waitFor(() => expect(old.isConnected).toBe(false));
  const box = await composer();
  expect(box).not.toBe(old);
  expect(box.value).toBe(text);
  expect(box.selectionStart).toBe(text.length);
  expect(box.selectionEnd).toBe(text.length);
  expect(document.activeElement).toBe(box);
}

describe.each([
  [
    'the full-page chat',
    () => mount('/ai/build/conv-7'),
    () => mount(),
  ],
  [
    'the console dock',
    () => {
      // The dock resumes the conversation it last used, read with the same GET.
      window.localStorage.setItem(CACHE_KEY, 'conv-7');
      mountDock();
    },
    mountDock,
  ],
])('%s — a draft typed before the pane knows its conversation survives the remount (objectstack#33674)', (_host, mountExisting, mountNew) => {
  it('path (a): text typed while the conversation GET is open is still in the box when it answers', async () => {
    state.holdGet = true;
    mountExisting();
    await waitFor(() => expect(state.gets.length).toBe(1));
    const old = await typeOnly('add a due date field');

    await act(async () => {
      state.gets.shift()!.answer(json({ id: 'conv-7', messages: [] }));
    });
    await settle();

    await expectDraftCarried(old, 'add a due date field');
    expect(state.sent).toEqual([]);
    expect(state.creates).toHaveLength(0);
  });

  it('path (b): a second message typed while the create runs is still in the box when it answers; the first is sent once', async () => {
    mountNew();
    await typeAndSend('build me a library app');
    const old = await typeOnly('and add a due date');
    expect(state.creates).toHaveLength(1);

    await answerCreate(json({ id: 'conv-1', messages: [] }));
    await waitFor(() => expect(state.sent).toEqual(['build me a library app']));
    await settle();

    await expectDraftCarried(old, 'and add a due date');
    expect(state.sent).toEqual(['build me a library app']);
    expect(drawn('build me a library app')).toBe(1);
    expect(drawn('and add a due date')).toBe(0);
  });

  it('CONTROL: a draft in a conversation that is already open stays in the same box, unsent', async () => {
    mountExisting();
    await composer();
    await settle(100);
    const box = await typeOnly('add a due date field');
    await settle(100);

    expect(box.isConnected).toBe(true);
    expect((await composer()).value).toBe('add a due date field');
    expect(state.sent).toEqual([]);
    expect(state.creates).toHaveLength(0);
  });
});

describe('the full-page chat — switching to another conversation does not carry a draft (objectstack#33674)', () => {
  it('a draft typed in a new conversation stays behind when the user opens another one', async () => {
    mountNavigable('/ai/build');
    const old = await typeOnly('a draft for the new chat');

    state.holdGet = true;
    await act(async () => {
      navigateTo!('/ai/build/conv-9');
    });
    await waitFor(() => expect(state.gets.length).toBe(1));
    await act(async () => {
      state.gets.shift()!.answer(json({ id: 'conv-9', messages: [] }));
    });
    await settle();

    await waitFor(() => expect(old.isConnected).toBe(false));
    expect((await composer()).value).toBe('');
    expect(state.sent).toEqual([]);
    expect(state.creates).toHaveLength(0);
  });

  it('a draft typed in an open conversation stays behind when the user opens another one', async () => {
    mountNavigable('/ai/build/conv-7');
    await composer();
    await settle(100);
    const old = await typeOnly('a draft for conv-7');

    await act(async () => {
      navigateTo!('/ai/build/conv-9');
    });
    await settle(100);

    await waitFor(() => expect(old.isConnected).toBe(false));
    expect((await composer()).value).toBe('');
    expect(state.sent).toEqual([]);
  });
});

describe('useComposerDraftHandoff — which remount carries the composer text (objectstack#33674)', () => {
  function Pane(props: { conversationId?: string; chatApi: string; stash: object }): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    const onInput = useComposerDraftHandoff({
      hostStash: props.stash,
      containerRef: ref,
      chatApi: props.chatApi,
      conversationId: props.conversationId,
      requestedConversationId: undefined,
    });
    return (
      <div ref={ref}>
        <textarea name="message" aria-label="message" onChange={onInput} />
      </div>
    );
  }
  function Host(props: { conversationId?: string; chatApi?: string; shown?: boolean }): React.ReactElement | null {
    const stash = React.useRef(null);
    const chatApi = props.chatApi ?? '/api/v1/ai/agents/build/chat';
    if (props.shown === false) return null;
    return <Pane key={`${chatApi}:${props.conversationId ?? 'pending'}`} {...props} chatApi={chatApi} stash={stash} />;
  }
  const box = () => screen.getByRole('textbox', { name: 'message' }) as HTMLTextAreaElement;
  const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

  it('a pending pane hands its text to the pane that gets the id', () => {
    const { rerender } = render(<Host />);
    type('a draft');
    rerender(<Host conversationId="conv-1" />);
    expect(box().value).toBe('a draft');
  });

  it('a pane that already had a conversation hands nothing on', () => {
    const { rerender } = render(<Host conversationId="conv-7" />);
    type('a draft for conv-7');
    rerender(<Host conversationId="conv-9" />);
    expect(box().value).toBe('');
  });

  it('a pane on another chat endpoint takes nothing', () => {
    const { rerender } = render(<Host chatApi="/api/v1/ai/agents/ask/chat" />);
    type('a draft for ask');
    rerender(<Host chatApi="/api/v1/ai/agents/build/chat" conversationId="conv-1" />);
    expect(box().value).toBe('');
  });

  it('a hand-off no pane took in the same commit is dropped', async () => {
    const { rerender } = render(<Host />);
    type('a draft');
    rerender(<Host shown={false} />);
    await act(async () => {
      await Promise.resolve();
    });
    rerender(<Host conversationId="conv-1" />);
    expect(box().value).toBe('');
  });
});

/** Fails the oldest held `GET /conversations/:id`: an HTTP status, or a network error. */
async function failGet(how: number | 'network'): Promise<void> {
  await waitFor(() => expect(state.gets.length).toBeGreaterThan(0));
  const held = state.gets.shift()!;
  await act(async () => {
    if (how === 'network') held.fail!(new TypeError('Failed to fetch'));
    else held.answer(new Response('upstream busy', { status: how }));
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe.each([
  ['the full-page chat (/ai/build/conv-7)', () => mount('/ai/build/conv-7')],
  [
    'the console dock (resuming conv-7)',
    () => {
      window.localStorage.setItem(CACHE_KEY, 'conv-7');
      mountDock();
    },
  ],
])('%s — a send held while the conversation loads, when the load fails (objectstack#33685)', (_host, mountLinked) => {
  it.each([[503 as const], ['network' as const]])('GET %s: the held message is given back with the notice, nothing is sent', async (how) => {
    state.holdGet = true;
    mountLinked();
    await waitFor(() => expect(state.gets.length).toBe(1));
    await typeAndSend('add a due date field');
    expect(drawn('add a due date field')).toBe(1);

    await failGet(how);

    const box = await composer();
    await waitFor(() => expect(drawn('add a due date field')).toBe(0));
    await waitFor(() => expect(box.value).toBe('add a due date field'));
    expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
    expect(state.sent).toEqual([]);
    expect(state.creates).toHaveLength(0);
  });

  it('two sends while it loads, then a failed load: both parts come back, first part first', async () => {
    state.holdGet = true;
    mountLinked();
    await waitFor(() => expect(state.gets.length).toBe(1));
    await typeAndSend('first part');
    await typeAndSend('second part');

    await failGet(503);

    const box = await composer();
    await waitFor(() => expect(box.value).toBe('first part\n\nsecond part'));
    expect(drawn('first part')).toBe(0);
    expect(screen.getByTestId('chat-send-error')).toBeInTheDocument();
    expect(state.sent).toEqual([]);
  });

  it('a retry after the failed load loads the conversation again and sends once into it', async () => {
    state.holdGet = true;
    mountLinked();
    await waitFor(() => expect(state.gets.length).toBe(1));
    await typeAndSend('add a due date field');
    await failGet(503);
    const box = await composer();
    await waitFor(() => expect(box.value).toBe('add a due date field'));

    await typeAndSend(box.value);
    expect(drawn('add a due date field')).toBe(1);
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
    await waitFor(() => expect(state.gets.length).toBe(1));
    await act(async () => {
      state.gets.shift()!.answer(json({ id: 'conv-7', messages: [] }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(state.sent).toEqual(['add a due date field']));
    await settle();
    expect(state.sent).toHaveLength(1);
    expect(state.creates).toHaveLength(0);
    expect(drawn('add a due date field')).toBe(1);
  });

  it('CONTROL: a load that answers sends the held message once into the conversation', async () => {
    state.holdGet = true;
    mountLinked();
    await waitFor(() => expect(state.gets.length).toBe(1));
    await typeAndSend('add a due date field');
    await act(async () => {
      state.gets.shift()!.answer(json({ id: 'conv-7', messages: [] }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    await waitFor(() => expect(state.sent).toEqual(['add a due date field']));
    await settle();
    expect(state.sent).toHaveLength(1);
    expect(state.creates).toHaveLength(0);
  });

  it('CONTROL: a 404 on the load (the conversation is gone) creates a new one and sends the held message once into it, as before', async () => {
    state.holdGet = true;
    mountLinked();
    await waitFor(() => expect(state.gets.length).toBe(1));
    await typeAndSend('add a due date field');

    await failGet(404);
    expect(state.creates).toHaveLength(1);
    await answerCreate(json({ id: 'conv-1', messages: [] }));

    await waitFor(() => expect(state.sent).toEqual(['add a due date field']));
    await settle();
    expect(state.sent).toHaveLength(1);
    expect(screen.queryByTestId('chat-send-error')).not.toBeInTheDocument();
  });
});
