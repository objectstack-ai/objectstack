// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#2627 — the conversation history must survive the build→preview
 * transition, including when the re-key refetch that transition fires fails.
 *
 * The magic-moment sequence this drives is the reported one: a build turn
 * streams, `apply_blueprint`'s draft lands (Live Canvas opens — the full-screen
 * chat becomes the chat|preview split), the turn ends, and the A1.b bind-on-
 * create effect re-keys the conversation to `app:<pkg>:build` and puts
 * `?package=` on the URL. That scope flip re-resolves the SAME conversation —
 * one more GET, fired at the instant the server is still finishing the heaviest
 * turn of the session.
 *
 * What made that refetch load-bearing is the pane key: `AiChatPage` mounts
 * `<ChatPane key={`${chatApi}:${paneConversationId ?? 'pending'}`}>`, and the
 * thread itself lives inside the chat hook's instance (`useObjectChat` seeds
 * from `initialMessages` ONCE — `aiInitialMessages` has `[]` deps and useChat's
 * Chat object is created once per mount). So anything that makes
 * `conversationId` go momentarily `undefined` does not merely re-render the
 * pane, it REPLACES it, and every message goes with the old instance —
 * "blueprint card, summary and Publish button all gone, only the composer
 * left, until you switch threads and back".
 *
 * `useChatConversation` already refused to let an EMPTY re-read wipe hydrated
 * messages; a FAILED one still cleared the id. This pins both the happy path
 * and the failing-refetch path through the real page.
 *
 * The chat hook is faked, deliberately — but faked to the property that makes
 * this bug possible: messages live in the hook INSTANCE and are seeded once at
 * mount. A remount is therefore visible as lost history, exactly as in
 * production.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import React from 'react';

interface FakeMsg {
  id: string;
  role: string;
  content: string;
  toolInvocations?: unknown[];
}

/** One entry per `useObjectChat` MOUNT — a remount is what loses the thread. */
const paneMounts: string[] = [];
/** Drives the faked chat hook from the test body. */
const chat = {
  isLoading: true,
  /** Appends a live turn INSIDE the mounted instance (lost on a remount). */
  append: undefined as ((m: FakeMsg) => void) | undefined,
};
let capturedProps: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const React2 = await import('react');
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: (opts: { initialMessages?: FakeMsg[] }) => {
      // Seeded ONCE, like the real hook: the thread belongs to this instance.
      const [messages, setMessages] = React2.useState<FakeMsg[]>(
        () => (opts.initialMessages ?? []) as FakeMsg[],
      );
      React2.useEffect(() => {
        paneMounts.push('mount');
        return () => {
          paneMounts.push('unmount');
        };
      }, []);
      chat.append = (m: FakeMsg) => setMessages((prev) => [...prev, m]);
      return {
        messages,
        isLoading: chat.isLoading,
        error: undefined,
        sendMessage: vi.fn(),
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      capturedProps = props;
      const msgs = (props.messages ?? []) as FakeMsg[];
      return (
        <div data-testid="pane">
          <span data-testid="thread">{msgs.map((m) => m.id).join(',')}</span>
        </div>
      );
    },
  };
});
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({
    agents: [{ name: 'metadata_assistant', label: 'Build', capabilities: ['build'] }],
    loading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ user: { id: 'u1' } }) };
});
vi.mock('../../../providers/MetadataProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useMetadata: () => ({ apps: [] }) };
});
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => null };
});
// The rail runs its own listing fetch and is not part of this invariant.
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));
// The canvas is an IFRAME onto `/apps/:seg?preview=draft`; happy-dom really
// tries to load it and the rejected request fails the run. What this test needs
// from the canvas is only that the page switched INTO the split layout — the
// split handle (rendered by AiChatPage itself, not by the canvas) is the
// unmocked half of that assertion. The pane's own behaviour is LiveCanvas.test.
vi.mock('../LiveCanvas', () => ({
  LiveCanvas: () => <div data-testid="live-canvas" />,
}));

import { AiChatPage } from '../AiChatPage';

// happy-dom has no matchMedia — `useIsMobile` (mobile canvas overlay) needs it.
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

/** The persisted thread the page hydrates from (raw `ServerConversation`). */
const PERSISTED_TURNS = [
  { id: 'r1', role: 'user', content: [{ type: 'text', text: 'build me a CRM' }] },
  {
    id: 'r2',
    role: 'assistant',
    content: [
      { type: 'text', text: 'Here is the plan.' },
      { type: 'tool-call', toolCallId: 't1', toolName: 'propose_blueprint' },
    ],
  },
];

let serverTurns: unknown[] = [];
let conversationGets = 0;
/** 1-based index of the conversation GET that should fail (0 = none fail). */
let failGetNumber = 0;

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (/\/conversations\/conv-1$/.test(url) && method === 'GET') {
        conversationGets += 1;
        if (conversationGets === failGetNumber) {
          return new Response('upstream busy', { status: 502 });
        }
        return new Response(JSON.stringify({ id: 'conv-1', messages: serverTurns }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

function thread(): string {
  return screen.getByTestId('thread').textContent ?? '';
}

function mountCount(): number {
  return paneMounts.filter((m) => m === 'mount').length;
}

/**
 * Drive the reported sequence and return the pane-mount count at the moment
 * the preview opened, so the caller can assert nothing remounted after it.
 */
async function driveBuildToPreview(): Promise<number> {
  render(
    <MemoryRouter initialEntries={['/ai/build/conv-1']}>
      <Routes>
        <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
        <Route path="/ai/:agent" element={<AiChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument());
  // Hydrated: the plan card and the turn that proposed it are on screen.
  await waitFor(() => expect(thread()).toBe('r1,r2'));

  // The build turn is now streaming. The server persists a turn at COMPLETION,
  // so a read taken right now returns nothing — that is the race window.
  serverTurns = [];

  // `apply_blueprint`'s draft lands mid-stream: the Live Canvas opens (the
  // layout switches from full-screen chat to the chat|preview split) and the
  // thread starts carrying the package the build just minted.
  await act(async () => {
    chat.append?.({
      id: 'live-build',
      role: 'assistant',
      content: '',
      toolInvocations: [
        { toolCallId: 't2', toolName: 'apply_blueprint', draftReview: { packageId: 'app.crm' } },
      ],
    });
    (capturedProps.onDraftArtifacts as (a: unknown[], seg?: string) => void)(
      [{ type: 'app', name: 'crm' }],
      'app.crm',
    );
  });
  // The layout switch actually happened — this is the transition under test.
  // The split handle only exists in the desktop chat|preview layout.
  expect(screen.getByTestId('live-canvas')).toBeInTheDocument();
  expect(screen.getByTestId('ai-chat-split-handle')).toBeInTheDocument();
  const mountsAtPreview = mountCount();

  // The turn ends. A1.b bind-on-create waits for exactly this edge, then
  // re-keys the conversation and navigates to `?package=app.crm` — the scope
  // flip that fires the re-resolve of the conversation we already hold.
  await act(async () => {
    chat.isLoading = false;
    chat.append?.({ id: 'live-summary', role: 'assistant', content: 'Your CRM is ready.' });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  return mountsAtPreview;
}

describe('AiChatPage — the thread survives the build→preview transition (#2627)', () => {
  beforeEach(() => {
    paneMounts.length = 0;
    conversationGets = 0;
    failGetNumber = 0;
    chat.isLoading = true;
    chat.append = undefined;
    serverTurns = PERSISTED_TURNS;
    localStorage.clear();
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('keeps the whole thread when the A1.b re-key refetch succeeds', async () => {
    const mountsAtPreview = await driveBuildToPreview();

    // The re-key DID re-resolve the same conversation (this is the GET the
    // failing case below breaks) — otherwise the next test proves nothing.
    expect(conversationGets).toBeGreaterThan(1);
    expect(mountCount()).toBe(mountsAtPreview);
    expect(thread()).toBe('r1,r2,live-build,live-summary');
  });

  it('keeps the whole thread when that refetch FAILS (the blanked-pane report)', async () => {
    // Fail the SECOND conversation GET: the first is the page's hydration, the
    // second is the re-key's re-resolve fired as the build turn lands.
    failGetNumber = 2;

    const mountsAtPreview = await driveBuildToPreview();

    expect(conversationGets).toBe(2);
    // Before the fix this remounted the pane with an empty seed: the hook
    // cleared `conversationId` on the failure, the key fell back to `pending`,
    // and the thread went with the discarded instance.
    expect(mountCount()).toBe(mountsAtPreview);
    expect(thread()).toBe('r1,r2,live-build,live-summary');
    // The plan card / summary / publish affordances all derive from these
    // messages, so an empty thread is the reported "everything disappeared".
    expect(thread()).not.toBe('');
  });
});
