// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37788 — an app's AI inquiry page (ui ADR-0057 Amendment A4).
 *
 * ## Real subjects
 *
 * The real `AppAskPage`, the real `useChatConversation` over a stubbed
 * `fetch` (so the create body and the `?c=` check are the wire's), the real
 * router, and the real registry entry. Stand-ins: the agent catalog and the
 * AI-surface gate (their answers are the input), the app metadata, and the
 * two heavy children — `ChatPane` (it records the props it is mounted with:
 * which agent, which package, which conversation, the held first message)
 * and `AiUnavailable` (the page's job is to render it, not what it draws).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AI_CHAT_COMPONENT_REF } from '@objectstack/spec/ui';

const PKG = 'com.acme.policy';

let surface = { enabled: true, isLoading: false, buildServed: true, focusServed: false };
let agents: Array<{ name: string; label?: string }> = [{ name: 'ask' }, { name: 'build' }];
let apps: unknown[] = [];

vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAgents: () => ({ agents, isLoading: false, error: undefined, refetch: () => {} }),
}));
vi.mock('../../../hooks/useAiSurface', () => ({ useAiSurfaceEnabled: () => surface }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ apps }) }));
vi.mock('../../../hooks/useHomePath', () => ({ useHomePath: () => '/home' }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' } }),
}));
vi.mock('../AiUnavailable', () => ({ AiUnavailable: () => <div data-testid="ai-unavailable" /> }));
vi.mock('../AiChatPage', () => ({
  ChatPane: (props: {
    activeAgent?: string;
    activeAppPackageId?: string;
    conversationId?: string;
    hideHeader?: boolean;
    pendingFirstMessageRef: { current: { content: string } | null };
    ensureConversation?: () => unknown;
  }) => {
    // The real pane's replay: a held first message asks for its conversation.
    const held = React.useRef(props.pendingFirstMessageRef.current?.content ?? '');
    React.useEffect(() => {
      if (props.pendingFirstMessageRef.current && !props.conversationId) void props.ensureConversation?.();
    }, [props.conversationId, props.ensureConversation, props.pendingFirstMessageRef]);
    return (
      <div
        data-testid="chat-pane"
        data-agent={props.activeAgent ?? ''}
        data-package={props.activeAppPackageId ?? ''}
        data-conversation={props.conversationId ?? ''}
        data-hide-header={String(Boolean(props.hideHeader))}
        data-held={held.current}
      />
    );
  },
}));

import { AppAskPage } from '../AppAskPage';
import { getAppComponent } from '../../../services/componentRegistry';

function appWith(params?: Record<string, unknown>) {
  return {
    name: 'brightrule',
    _packageId: PKG,
    navigation: [
      { id: 'nav_ask', type: 'component', label: 'Ask', componentRef: AI_CHAT_COMPONENT_REF, ...(params ? { params } : {}) },
      { id: 'nav_policy', type: 'object', objectName: 'policy' },
    ],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function mount(entry = '/apps/brightrule/component/ai/chat') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/apps/:appName/component/ai/chat" element={<AppAskPage />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let fetchMock: ReturnType<typeof vi.fn>;
const creates = () =>
  fetchMock.mock.calls.filter(
    (c) => String(c[0]).endsWith('/conversations') && (c[1] as RequestInit | undefined)?.method === 'POST',
  );

beforeEach(() => {
  localStorage.clear();
  surface = { enabled: true, isLoading: false, buildServed: true, focusServed: false };
  agents = [{ name: 'ask' }, { name: 'build' }];
  apps = [appWith({ title: 'Ask about our policies', subtitle: 'Rules, forms and deadlines.', placeholder: 'Type a question', suggestions: ['How do I apply?', 'What is the deadline?'] })];
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AppAskPage (objectstack#37788)', () => {
  it('is the registry entry for ai:chat', async () => {
    await import('../../../services/builtinComponents');
    expect(getAppComponent(AI_CHAT_COMPONENT_REF)?.component).toBeDefined();
  });

  it('draws the copy the entry declares', () => {
    mount();
    expect(screen.getByTestId('app-ask-title')).toHaveTextContent('Ask about our policies');
    expect(screen.getByTestId('app-ask-subtitle')).toHaveTextContent('Rules, forms and deadlines.');
    expect(screen.getByTestId('app-ask-input')).toHaveAttribute('placeholder', 'Type a question');
    expect(screen.getByTestId('app-ask-scope')).toHaveTextContent('Answers prefer this app');
    expect(screen.getByRole('button', { name: 'How do I apply?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is the deadline?' })).toBeInTheDocument();
    expect(screen.queryByTestId('chat-pane')).not.toBeInTheDocument();
  });

  it('falls back to the neutral copy for every key the entry omits', () => {
    apps = [appWith()];
    mount();
    expect(screen.getByTestId('app-ask-title')).toHaveTextContent('Ask your data');
    expect(screen.getByTestId('app-ask-input')).toHaveAttribute('placeholder', 'Ask anything…');
    expect(screen.queryByTestId('app-ask-suggestions')).not.toBeInTheDocument();
  });

  it('never reads its copy from the URL', () => {
    mount('/apps/brightrule/component/ai/chat?title=Injected');
    expect(screen.getByTestId('app-ask-title')).toHaveTextContent('Ask about our policies');
  });

  it('a suggestion asks it: the pane mounts on ask, bound to the package, and the create records the app', async () => {
    fetchMock.mockImplementation(async () =>
 jsonResponse({ id: 'conv-1', messages: [], metadata: { activePackageId: PKG } }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'How do I apply?' }));
    const pane = await screen.findByTestId('chat-pane');
    expect(pane).toHaveAttribute('data-agent', 'ask');
    expect(pane).toHaveAttribute('data-package', PKG);
    expect(pane).toHaveAttribute('data-hide-header', 'true');
    expect(pane).toHaveAttribute('data-held', 'How do I apply?');
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(JSON.parse(String((creates()[0][1] as RequestInit).body))).toEqual({ metadata: { activePackageId: PKG } });
    // The address names the conversation once it exists.
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?c=conv-1'));
  });

  it('a maker gets ask here too, even with build served', async () => {
    fetchMock.mockImplementation(async () =>
 jsonResponse({ id: 'conv-1', messages: [] }));
    mount();
    fireEvent.change(screen.getByTestId('app-ask-input'), { target: { value: 'Count my policies' } });
    fireEvent.click(screen.getByTestId('app-ask-send'));
    expect(await screen.findByTestId('chat-pane')).toHaveAttribute('data-agent', 'ask');
  });

  it('a reload restores this app\'s conversation from ?c=', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: 'conv-9', messages: [{ id: 'm1', role: 'user', content: 'hi' }], metadata: { activePackageId: PKG } }),
    );
    mount('/apps/brightrule/component/ai/chat?c=conv-9');
    await waitFor(() => expect(screen.getByTestId('chat-pane')).toHaveAttribute('data-conversation', 'conv-9'));
    expect(screen.queryByTestId('app-ask-home')).not.toBeInTheDocument();
  });

  it('another app\'s conversation opens the home state and leaves the address', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse({ id: 'conv-x', messages: [{ id: 'm1', role: 'user', content: 'secret' }], metadata: { activePackageId: 'com.other' } }),
    );
    mount('/apps/brightrule/component/ai/chat?c=conv-x');
    expect(await screen.findByTestId('app-ask-home')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('location')).not.toHaveTextContent('c=conv-x'));
    expect(screen.queryByTestId('chat-pane')).not.toBeInTheDocument();
  });

  it('a conversation that is not the caller\'s (403) opens the home state', async () => {
    fetchMock.mockImplementation(async () =>
 jsonResponse({ error: 'forbidden' }, 403));
    mount('/apps/brightrule/component/ai/chat?c=conv-other-user');
    expect(await screen.findByTestId('app-ask-home')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-pane')).not.toBeInTheDocument();
  });

  it('New conversation returns to the home state', async () => {
    fetchMock.mockImplementation(async () =>
 jsonResponse({ id: 'conv-1', messages: [], metadata: { activePackageId: PKG } }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'How do I apply?' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('?c=conv-1'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('app-ask-page-new'));
    });
    expect(await screen.findByTestId('app-ask-home')).toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('c=');
  });

  it('renders the unavailable state where this person has no AI', () => {
    surface = { enabled: false, isLoading: false, buildServed: false, focusServed: false };
    agents = [];
    mount();
    expect(screen.getByTestId('ai-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('app-ask-home')).not.toBeInTheDocument();
  });
});
