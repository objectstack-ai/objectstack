// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36999 / objectstack#37861 — conversation focus, as framework
 * ADR-0160 D6 (seventh amendment, "The focus of a conversation") rules it:
 * state `{ focus, dismissed }`; before the first send the focus is the record
 * on the page unless dismissed, and follows the page; × removes it and nothing
 * adds it again; the first send fixes both; a conversation opened again
 * restores its own focus, from this tab or from its row's `metadata.focus`.
 * Only where the agent's catalog row declares `capabilities.focus`.
 *
 * ## Real subjects
 *
 * The console dock body (`ChatDockConversation`) and the full-page chat
 * (`AiChatPage` at `/ai/ask`), each with the REAL `ChatPane`, the REAL
 * `useChatConversation`, the REAL `useObjectChat` transport, the REAL focus
 * state (`useConversationFocus`) and the REAL chip (`ChatFocusRow`). What is
 * pinned is the JSON body of each POST to the agent's chat route (captured off
 * a `fetch` stub) and the chip the pane hands the composer's input frame. The
 * stand-ins: the agent catalog, the model allowlist, the conversation rows the
 * server returns, and `ChatbotEnhanced` (a recorder that renders the chip it
 * is handed inside a focusable frame and exposes the send).
 */

// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

const CAPS = { authoring: false, canvas: false, debug: false, resume: false };

const state = {
  agents: [] as Array<{ name: string; label: string; capabilities?: Record<string, boolean> }>,
  /** The latest props `ChatPane` handed the composer. */
  pane: undefined as
    | {
        onSendMessage?: (text: string) => void;
        surfaceContextLabel?: string;
        promptHeaderSlot?: React.ReactNode;
        promptInputHeaderSlot?: React.ReactNode;
      }
    | undefined,
  /** The JSON body of every chat POST, in order. */
  sent: [] as Array<{ context?: Record<string, unknown> }>,
  minted: 0,
  /** Every POST that tries to create a conversation, failed ones included. */
  createAttempts: 0,
  /** The next creates fail (the server answers 500). */
  failCreate: false,
  /** The `metadata` each existing conversation's row is served with. */
  rows: {} as Record<string, Record<string, unknown> | undefined>,
};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    ChatbotEnhanced: (props: NonNullable<typeof state.pane>) => {
      state.pane = props;
      return (
        <div data-testid="pane">
          {props.promptHeaderSlot}
          <div data-testid="input-frame" className="group/input-group">
            {props.promptInputHeaderSlot ? (
              <div data-testid="frame-slot">{props.promptInputHeaderSlot}</div>
            ) : props.surfaceContextLabel ? (
              <span data-testid="frame-chip">{props.surfaceContextLabel}</span>
            ) : null}
            <textarea data-testid="composer-input" />
          </div>
        </div>
      );
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: state.agents, isLoading: false, error: undefined, refetch: vi.fn() }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../../providers/MetadataProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadata: () => ({ apps: [] }),
}));
vi.mock('../../providers/AdapterProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => null,
}));
vi.mock('../../hooks/useCanAuthorMetadata', () => ({ useCanAuthorMetadata: () => false }));
vi.mock('../../console/ai/ConversationsSidebar', () => ({ ConversationsSidebar: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { AiChatPage } from '../../console/ai/AiChatPage';
import { ChatDockConversation } from '../ChatDockConversation';
import {
  buildFocusContext,
  chatFocusFromMetadata,
  readStoredChatFocus,
  surfaceRecord,
  type ChatFocus,
} from '../chatFocus';
import type { ChatSurfaceContext } from '../chatSurfaceContext';
import type { ChatDockTarget } from '../chatDockTarget';

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

function dataStreamResponse(): Response {
  return new Response('data: {"type":"start"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
  });
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (/\/agents\/[^/]+\/chat$/.test(url) && method === 'POST') {
        state.sent.push(JSON.parse(String(init?.body ?? '{}')));
        return dataStreamResponse();
      }
      if (/\/conversations$/.test(url) && method === 'POST') {
        state.createAttempts += 1;
        if (state.failCreate) {
          return new Response(JSON.stringify({ error: 'down' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        state.minted += 1;
        return json({ id: `conv-${state.minted}`, messages: [] });
      }
      const one = /\/conversations\/([^/?]+)$/.exec(url);
      if (one && method === 'GET') {
        const id = decodeURIComponent(one[1]);
        const metadata = state.rows[id];
        return json({ id, messages: [], ...(metadata ? { metadata } : {}) });
      }
      return json({ success: true, data: [] });
    }),
  );
}

const record = (id: string): ChatSurfaceContext => ({
  artifact: { type: 'object', name: 'account' },
  selection: { kind: 'record', id },
});
const LIST: ChatSurfaceContext = { artifact: { type: 'object', name: 'account' } };

/** The dock's page in view, moved the way a navigation moves it. */
const page: {
  go: (surface: ChatSurfaceContext | undefined) => void;
  /** Opens a conversation in the drawer, the way a history row does. */
  open: (target: ChatDockTarget | undefined) => void;
} = { go: () => {}, open: () => {} };
function Dock({ initial }: { initial?: ChatSurfaceContext }) {
  const [surface, setSurface] = React.useState<ChatSurfaceContext | undefined>(initial);
  const [target, setTarget] = React.useState<ChatDockTarget | undefined>(undefined);
  page.go = (next) => act(() => setSurface(next));
  page.open = (next) => act(() => setTarget(next));
  return (
    <ChatDockConversation
      userId="u1"
      apiBase="/api/v1/ai"
      surfaceContext={surface}
      surfaceArtifactLabel="Account"
      target={target}
      onTargetChange={setTarget}
    />
  );
}

function mountDock(initial: ChatSurfaceContext | undefined = record('rec_1')): void {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/crm_app/account']}>
        <Dock initial={initial} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mountPage(path = '/ai/ask'): void {
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

async function composerReady(): Promise<void> {
  await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'), { timeout: 4000 });
}

/** Sends one message, and returns the `context` of the request that left. */
async function send(text: string): Promise<Record<string, unknown>> {
  const before = state.sent.length;
  await act(async () => {
    state.pane!.onSendMessage!(text);
  });
  await waitFor(() => expect(state.sent.length).toBe(before + 1), { timeout: 4000 });
  // Let the remount the first send causes, and the turn's stream, settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return state.sent[before].context ?? {};
}

const chip = () => screen.queryByTestId('chat-focus-chip');
const pageChip = () => screen.queryByTestId('surface-context-chip');
const removeButton = () => screen.queryByTestId('chat-focus-remove');

const ACCOUNT_1: ChatFocus = { object: 'account', id: 'rec_1' };
const ACCOUNT_9: ChatFocus = { object: 'account', id: 'rec_9' };

beforeEach(() => {
  state.agents = [{ name: 'ask', label: 'Ask', capabilities: { ...CAPS, focus: true } }];
  state.pane = undefined;
  state.sent = [];
  state.minted = 0;
  state.createAttempts = 0;
  state.failCreate = false;
  state.rows = {};
  window.localStorage.clear();
  window.sessionStorage.clear();
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the focus helpers (objectstack#36999, objectstack#37861)', () => {
  it('buildFocusContext: one record, honoured → `focus` is a one-entry array; anything else adds no key', () => {
    expect(buildFocusContext(ACCOUNT_1, true)).toEqual({ focus: [ACCOUNT_1] });
    expect(buildFocusContext(ACCOUNT_1, false)).toEqual({});
    expect(buildFocusContext(null, true)).toEqual({});
    expect(buildFocusContext(undefined, true)).toEqual({});
  });

  it('surfaceRecord: a record page or a record open in a list is a record; a list or a dashboard is none', () => {
    expect(surfaceRecord(record('rec_1'))).toEqual(ACCOUNT_1);
    expect(surfaceRecord(LIST)).toBeNull();
    expect(surfaceRecord({ artifact: { type: 'dashboard', name: 'sales' }, selection: { kind: 'record', id: 'x' } })).toBeNull();
    expect(surfaceRecord(undefined)).toBeNull();
  });

  it('chatFocusFromMetadata reads the first entry of the `focus` array the conversation stores, label included', () => {
    expect(chatFocusFromMetadata({ focus: [{ object: 'account', id: 'rec_9', label: '  Acme  ' }] })).toEqual({
      ...ACCOUNT_9,
      label: 'Acme',
    });
    expect(chatFocusFromMetadata({ focus: [ACCOUNT_9, ACCOUNT_1] })).toEqual(ACCOUNT_9);
    expect(chatFocusFromMetadata({ focus: [{ ...ACCOUNT_9, label: ' ' }] })).toEqual(ACCOUNT_9);
  });

  it('chatFocusFromMetadata: an absent key, a bare object and malformed entries read as no focus', () => {
    expect(chatFocusFromMetadata(undefined)).toBeNull();
    expect(chatFocusFromMetadata({})).toBeNull();
    expect(chatFocusFromMetadata({ focusPreRead: [ACCOUNT_9] })).toBeNull();
    expect(chatFocusFromMetadata({ focus: ACCOUNT_9 })).toBeNull();
    expect(chatFocusFromMetadata({ focus: [] })).toBeNull();
    expect(chatFocusFromMetadata({ focus: [{ object: 'account' }] })).toBeNull();
    expect(chatFocusFromMetadata({ focus: [{ object: 'account', id: 9 }] })).toBeNull();
    expect(chatFocusFromMetadata({ focus: [{ object: '', id: 'rec_9' }] })).toBeNull();
    expect(chatFocusFromMetadata({ focus: ['account:rec_9'] })).toBeNull();
  });
});

describe('the console dock — an unsent conversation is about the record on the page (objectstack#37861)', () => {
  it('opens with the record as its focus, in the input frame, and the first turn carries it', async () => {
    mountDock();
    await composerReady();
    // The chip sits inside the input's frame, before the input; the pane hands no row above it.
    expect(screen.getByTestId('frame-slot')).toContainElement(chip());
    expect(state.pane?.promptHeaderSlot).toBeUndefined();
    expect(screen.queryByTestId('frame-chip')).toBeNull();
    // No name can be read (no data source): the chip names the record by its pair.
    expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_1');
    expect(chip()).toHaveAttribute('aria-label', 'Asking about: account · rec_1');
    // No pin and no switch offer exist any more.
    expect(screen.queryByTestId('chat-focus-pin')).toBeNull();
    expect(screen.queryByTestId('chat-focus-switch')).toBeNull();

    const first = await send('who owns this?');
    expect(state.minted).toBe(1);
    expect(first.focus).toEqual([ACCOUNT_1]);
    expect(first.surface).toEqual(record('rec_1'));
    expect(readStoredChatFocus('conv-1')).toEqual({ focus: ACCOUNT_1, dismissed: false });
  });

  it('follows the page until the first send, with no prompt; after it the focus stays', async () => {
    mountDock();
    await composerReady();
    page.go(record('rec_2'));
    expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_2');
    // A list has no record: the page chip, with no ×.
    page.go(LIST);
    expect(chip()).toBeNull();
    expect(pageChip()).toHaveTextContent('Viewing: Account');
    expect(removeButton()).toBeNull();
    page.go(record('rec_3'));
    expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_3');

    expect((await send('this one')).focus).toEqual([{ object: 'account', id: 'rec_3' }]);
    // Sent: navigation no longer moves the focus.
    page.go(record('rec_4'));
    expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_3');
    page.go(LIST);
    expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_3');
    const second = await send('and its last order?');
    expect(second.focus).toEqual([{ object: 'account', id: 'rec_3' }]);
    expect(second.surface).toEqual(LIST);
  });

  it('× before the first send falls back to the page chip and nothing re-adds it, before or after the send', async () => {
    mountDock();
    await composerReady();
    fireEvent.click(removeButton()!);
    expect(chip()).toBeNull();
    expect(pageChip()).toHaveTextContent('Viewing: Account');
    expect(removeButton()).toBeNull();

    page.go(record('rec_2'));
    expect(chip()).toBeNull();
    expect(pageChip()).toBeInTheDocument();
    expect(await send('anything?')).not.toHaveProperty('focus');
    // The first send carried `dismissed` onto the conversation.
    expect(readStoredChatFocus('conv-1')).toEqual({ focus: null, dismissed: true });

    page.go(record('rec_3'));
    expect(chip()).toBeNull();
    expect(await send('and now?')).not.toHaveProperty('focus');
  });

  it('× after the first send stops the focus; the next turn has no key and the page chip stays', async () => {
    mountDock();
    await composerReady();
    expect((await send('first')).focus).toEqual([ACCOUNT_1]);

    fireEvent.click(removeButton()!);
    expect(chip()).toBeNull();
    expect(pageChip()).toBeInTheDocument();
    expect(await send('second')).not.toHaveProperty('focus');
    page.go(record('rec_2'));
    expect(chip()).toBeNull();
    expect(await send('third')).not.toHaveProperty('focus');
    expect(readStoredChatFocus('conv-1')).toEqual({ focus: null, dismissed: true });
  });

  it('a conversation started on a list has no focus, and does not take one on a record page after its first send', async () => {
    mountDock(LIST);
    await composerReady();
    expect(chip()).toBeNull();
    expect(pageChip()).toHaveTextContent('Viewing: Account');
    expect(await send('how many?')).not.toHaveProperty('focus');
    page.go(record('rec_2'));
    expect(chip()).toBeNull();
    expect(await send('and this one?')).not.toHaveProperty('focus');
  });

  it('another target while unsent is another conversation: × on the last one does not carry over', async () => {
    mountDock();
    await composerReady();
    fireEvent.click(removeButton()!);
    expect(chip()).toBeNull();

    page.open({ agent: 'ask', fresh: true });
    await composerReady();
    await waitFor(() => expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_1'));
    expect((await send('fresh')).focus).toEqual([ACCOUNT_1]);
  });
});

describe('the console dock — a conversation opened again restores its own focus (objectstack#37861)', () => {
  it('from this tab: a history row keeps its focus, and a sent one without a focus shows none', async () => {
    window.sessionStorage.setItem('ai-chat-focus:conv-old', JSON.stringify({ focus: ACCOUNT_9, dismissed: false }));
    mountDock();
    await composerReady();
    expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_1');

    page.open({ agent: 'ask', conversationId: 'conv-old' });
    await waitFor(() => expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_9'));
    await composerReady();
    expect((await send('and now?')).focus).toEqual([ACCOUNT_9]);

    // A sent conversation with no focus of its own shows the page chip, though the page shows a record.
    page.open({ agent: 'ask', conversationId: 'conv-bare' });
    await waitFor(() => expect(chip()).toBeNull());
    await composerReady();
    expect(pageChip()).toBeInTheDocument();
    expect(await send('anything?')).not.toHaveProperty('focus');
    expect(state.minted).toBe(0);
  });

  it('in a new tab, from the row\'s `metadata.focus`: the chip names the stored label and follow-ups send the focus', async () => {
    state.rows['conv-other-tab'] = { focus: [{ object: 'account', id: 'rec_9', label: 'Acme Corp' }] };
    mountDock(record('rec_1'));
    await composerReady();

    page.open({ agent: 'ask', conversationId: 'conv-other-tab' });
    await waitFor(() => expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('Acme Corp'));
    await composerReady();
    expect(chip()).toHaveAttribute('data-focus-id', 'rec_9');
    expect((await send('and its renewals?')).focus).toEqual([ACCOUNT_9]);
    // From here the tab holds its own copy.
    expect(readStoredChatFocus('conv-other-tab')).toEqual({ focus: ACCOUNT_9, dismissed: false });
  });

  it('a row with no `metadata.focus` (absent, or malformed) restores no focus', async () => {
    state.rows['conv-none'] = { activePackageId: 'crm' };
    state.rows['conv-bad'] = { focus: ACCOUNT_9 };
    mountDock(record('rec_1'));
    await composerReady();

    page.open({ agent: 'ask', conversationId: 'conv-none' });
    await waitFor(() => expect(chip()).toBeNull());
    await composerReady();
    expect(await send('one')).not.toHaveProperty('focus');

    page.open({ agent: 'ask', conversationId: 'conv-bad' });
    await waitFor(() => expect(chip()).toBeNull());
    await composerReady();
    expect(await send('two')).not.toHaveProperty('focus');
  });

  it('this tab\'s × outranks the row\'s metadata', async () => {
    window.sessionStorage.setItem('ai-chat-focus:conv-x', JSON.stringify({ focus: null, dismissed: true }));
    state.rows['conv-x'] = { focus: [ACCOUNT_9] };
    mountDock();
    await composerReady();
    page.open({ agent: 'ask', conversationId: 'conv-x' });
    await waitFor(() => expect(state.pane?.onSendMessage).toBeTypeOf('function'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(chip()).toBeNull();
    expect(await send('still none?')).not.toHaveProperty('focus');
  });

  it('a first send whose create fails hands its focus to no conversation opened after it', async () => {
    window.sessionStorage.setItem('ai-chat-focus:conv-old', JSON.stringify({ focus: ACCOUNT_9, dismissed: false }));
    mountDock();
    await composerReady();

    // The first send's create fails: no conversation, no turn.
    state.failCreate = true;
    await act(async () => {
      state.pane!.onSendMessage!('lost?');
    });
    await waitFor(() => expect(state.createAttempts).toBe(1), { timeout: 4000 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(state.minted).toBe(0);
    state.failCreate = false;

    // A history row opened next keeps ITS focus: the failed send minted nothing to carry onto.
    page.open({ agent: 'ask', conversationId: 'conv-old' });
    await waitFor(() => expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('account · rec_9'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(readStoredChatFocus('conv-old').focus).toEqual(ACCOUNT_9);
  });
});

describe('the focus chip — × is reachable (objectstack#37861)', () => {
  it('× is a labelled button with a 24px hit area, shown on hover, while the composer has focus, and on touch', async () => {
    mountDock();
    await composerReady();
    const button = removeButton()!;
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAccessibleName('Stop asking about this record');
    const classes = button.className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        'size-6',
        'group-hover/focus-chip:opacity-100',
        'group-focus-within/input-group:opacity-100',
        'focus-visible:opacity-100',
        'pointer-coarse:opacity-100',
      ]),
    );
    // Logical spacing only, so the chip mirrors with a right-to-left page.
    expect(chip()!.className).not.toMatch(/(^|\s)-?(ml|mr|pl|pr)-/);
    expect(button.className).not.toMatch(/(^|\s)-?(ml|mr|pl|pr)-/);
    // Keyboard: the button takes focus and Enter/Space activate it as any button does.
    button.focus();
    expect(document.activeElement).toBe(button);
  });
});

describe('the full-page chat — conversation focus behaves as in the dock (objectstack#37861)', () => {
  it('a new conversation here has no record, so no focus and no chip', async () => {
    mountPage();
    await composerReady();
    expect(chip()).toBeNull();
    expect(await send('first')).not.toHaveProperty('focus');
    expect(state.minted).toBe(1);
  });

  it('a conversation opened by its address in a new tab restores the row\'s focus; × stops it', async () => {
    state.rows['conv-77'] = { focus: [{ object: 'account', id: 'rec_9', label: 'Acme Corp' }] };
    mountPage('/ai/ask/conv-77');
    await waitFor(() => expect(screen.getByTestId('chat-focus-name')).toHaveTextContent('Acme Corp'));
    await composerReady();
    expect((await send('first')).focus).toEqual([ACCOUNT_9]);
    expect((await send('second')).focus).toEqual([ACCOUNT_9]);

    fireEvent.click(removeButton()!);
    expect(await send('third')).not.toHaveProperty('focus');
    expect(state.minted).toBe(0);
  });
});

describe.each([
  ['the console dock', () => mountDock()],
  ['the full-page chat', () => mountPage('/ai/ask/conv-77')],
])('%s — an agent that does not declare `capabilities.focus` (objectstack#36999)', (_surface, mount) => {
  it('draws no chip and no frame slot, and sends no `focus` key, whatever the page or the row says', async () => {
    state.agents = [{ name: 'ask', label: 'Ask', capabilities: { ...CAPS } }];
    state.rows['conv-77'] = { focus: [ACCOUNT_9] };
    mount();
    await composerReady();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(chip()).toBeNull();
    expect(state.pane?.promptHeaderSlot).toBeUndefined();
    expect(state.pane?.promptInputHeaderSlot).toBeUndefined();
    expect(await send('first')).not.toHaveProperty('focus');
  });
});

describe('the console dock — no flag leaves the page chip where it was (objectstack#36999)', () => {
  it('the composer frame draws the page chip, as before', async () => {
    state.agents = [{ name: 'ask', label: 'Ask' }];
    mountDock();
    await composerReady();
    expect(screen.getByTestId('frame-chip')).toHaveTextContent('Viewing: Account');
    expect(chip()).toBeNull();
  });
});
