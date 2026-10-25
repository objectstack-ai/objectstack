// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12493 — a URL parameter never sends a message on the user's behalf.
 *
 * The build surface sends its seeded first message with no further user
 * action. The ADR-0057 P4 Builder handoff ("Open in Builder →" on the `ask`
 * surface) used to carry that seed as `?handoffPrompt=`, so any link a
 * signed-in user opened could put a first message in their mouth. The handoff
 * now rides react-router navigation state, which only the app's own in-app
 * `navigate()` can set, and the page no longer reads the parameter at all.
 *
 * Pins:
 *  - a page loaded with `?handoffPrompt=` sends nothing;
 *  - the in-app handoff (the real `openBuilder` producer, reached through the
 *    pane's `onOpenBuilder`) still lands its text on the build pane, once;
 *  - a reload of that history entry (state survives a reload) does not send it
 *    again;
 *  - CONTROL: a user-typed first message sends.
 *
 * The chat hook is faked to record every `sendMessage` call — that is the
 * transport boundary this invariant is about.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, type Location } from 'react-router-dom';
import React from 'react';

/** Every message that reached the (faked) chat transport. */
const sent: string[] = [];
/** The `parentConversationId` the chat hook held when each message was sent. */
const sentParent: Array<unknown> = [];
let capturedProps: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-chatbot', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiModels: () => ({ models: [], defaultModelId: undefined }),
    useHitlInChat: () => ({ decide: vi.fn(), decisions: {} }),
    useObjectChat: (opts: Record<string, unknown>) => {
      return {
        messages: [],
        isLoading: false,
        error: undefined,
        sendMessage: (text: string) => {
          sent.push(text);
          sentParent.push(opts.parentConversationId);
        },
        stop: vi.fn(),
        reload: vi.fn(),
        clear: vi.fn(),
        setMessages: vi.fn(),
      };
    },
    ChatbotEnhanced: (props: Record<string, unknown>) => {
      capturedProps = props;
      return <div data-testid="pane" />;
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
vi.mock('../ConversationsSidebar', () => ({
  ConversationsSidebar: () => <div data-testid="sidebar" />,
}));
vi.mock('../LiveCanvas', () => ({
  LiveCanvas: () => <div data-testid="live-canvas" />,
}));

import { AiChatPage } from '../AiChatPage';

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

let minted = 0;

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      if (/\/conversations$/.test(url) && method === 'POST') {
        minted += 1;
        return json({ id: `conv-${minted}`, messages: [] });
      }
      const one = /\/conversations\/([^/?]+)$/.exec(url);
      if (one && method === 'GET') return json({ id: decodeURIComponent(one[1]), messages: [] });
      return json({ success: true, data: [] });
    }),
  );
}

/** The router's live location, read from inside the tree. */
const probe: { location?: Location } = {};
function LocationProbe(): null {
  const location = useLocation();
  React.useEffect(() => {
    probe.location = location;
  }, [location]);
  return null;
}

type Entry = string | { pathname: string; search?: string; state?: unknown };

function mount(entry: Entry) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <Routes>
        <Route path="/ai/:agent/:conversationId" element={<AiChatPage />} />
        <Route path="/ai/:agent" element={<AiChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Let the conversation mint, the URL mirror land and any deferred replay fire. */
async function settle(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument());
  await waitFor(() => expect(probe.location?.pathname).toMatch(/^\/ai\/build\/conv-\d+$/));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

describe('AiChatPage — a URL parameter never sends a message (objectui#12493)', () => {
  beforeEach(() => {
    sent.length = 0;
    sentParent.length = 0;
    capturedProps = {};
    probe.location = undefined;
    minted = 0;
    localStorage.clear();
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('a page loaded with ?handoffPrompt= sends nothing', async () => {
    mount('/ai/build?handoffPrompt=create%20an%20object%20named%20probe');
    await settle();

    expect(sent).toEqual([]);
  });

  it('the in-app "Open in Builder" handoff lands its text once, by navigation state', async () => {
    mount('/ai/build');
    await settle();
    const askThread = probe.location?.pathname.split('/').pop();
    expect(sent).toEqual([]);

    // The real producer: the pane's handoff card calls `onOpenBuilder`.
    await act(async () => {
      (capturedProps.onOpenBuilder as (h: { prompt: string }) => void)({
        prompt: 'build a vendor tracker',
      });
    });
    await waitFor(() => expect(sent).toEqual(['build a vendor tracker']));
    // The prompt never touched the URL.
    expect(probe.location?.search ?? '').not.toContain('handoffPrompt');
    // The source thread rides the same state into the build agent's first turn.
    expect(sentParent).toEqual([askThread]);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(sent).toEqual(['build a vendor tracker']);
  });

  it('a reload of the handoff history entry does not send the prompt again', async () => {
    mount({ pathname: '/ai/build', state: { handoffPrompt: 'build a vendor tracker' } });
    await waitFor(() => expect(sent).toEqual(['build a vendor tracker']));
    await settle();
    expect(sent).toEqual(['build a vendor tracker']);

    // The entry's state no longer carries the prompt (it was consumed as seeded).
    const entry = probe.location!;
    expect((entry.state as { handoffPrompt?: string } | null)?.handoffPrompt).toBeUndefined();

    // Reload: browser history keeps an entry's state, so remount on exactly it.
    cleanup();
    sent.length = 0;
    mount({ pathname: entry.pathname, search: entry.search, state: entry.state });
    await waitFor(() => expect(screen.getByTestId('pane')).toBeInTheDocument());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(sent).toEqual([]);
  });

  it('CONTROL: a user-typed first message sends', async () => {
    mount('/ai/build');
    await settle();

    await act(async () => {
      (capturedProps.onSendMessage as (text: string) => void)('hello builder');
    });
    await waitFor(() => expect(sent).toEqual(['hello builder']));
  });
});
