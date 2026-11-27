/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#37863 — the drawer header's ☆ (ui ADR-0057 Amendment A5's
 * header: title, ☆, ＋, history, ⋯, ×).
 *
 * - Once the first send has created the thread, the header draws ☆ first
 *   among its buttons, in the rail, the full window and the phone sheet.
 *   Before it, there is nothing to keep and no ☆.
 * - ☆ adds the thread to the user's favourites as a `conversation` favourite
 *   (its id, its agent by route name, the header's label, its `/ai…` address)
 *   and is pressed while it is one; pressed again, it removes it.
 * - While the thread is a favourite, the stored label follows the label the
 *   header reads; a label still being read writes nothing, and a thread that
 *   is not a favourite is written nowhere.
 *
 * Harness: the chrome stand-ins of `ChatDock.test.tsx` (the default body
 * reports its actions and draws nothing) under the real `FavoritesProvider`,
 * signed out, so the store is the provider's local key.
 */
// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { ChatDockPanel, ChatDockMobileSheet, type ChatDockState } from '../ChatDock';
import type { ChatDockConversationActions } from '../chatDockTarget';
import { FavoritesProvider, type FavoriteItem } from '../../context/FavoritesProvider';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: null, activeOrganization: null }),
}));
vi.mock('../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: (explicit?: string) => explicit ?? '/api/v1/ai',
}));
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [], isLoading: false, error: undefined }),
}));
vi.mock('../../hooks', () => ({
  useChatConversation: () => ({ conversationId: undefined, initialMessages: [] }),
}));
vi.mock('../../hooks/useAiUsage', () => ({
  useAiUsage: () => ({ usage: null, isLoading: false, error: undefined, refetch: () => {} }),
}));

// What the default body reports to the chrome; `report` re-reports it.
const bodyState: { actions: ChatDockConversationActions | undefined; report?: (a: ChatDockConversationActions | undefined) => void } = {
  actions: undefined,
};
vi.mock('../ChatDockConversation', async () => {
  const ReactActual = await import('react');
  return {
    ChatDockConversation: (props: { onActionsChange?: (a: unknown) => void }) => {
      const { onActionsChange } = props;
      ReactActual.useEffect(() => {
        bodyState.report = (a) => onActionsChange?.(a);
        onActionsChange?.(bodyState.actions);
      }, [onActionsChange]);
      return <div data-testid="default-dock-body" />;
    },
  };
});

function dockState(overrides: Partial<ChatDockState> = {}): ChatDockState {
  return {
    expanded: true,
    width: 420,
    dragging: false,
    fullWindow: false,
    setFullWindow: vi.fn(),
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    onResizePointerDown: vi.fn(),
    ...overrides,
  };
}

/** The provider's local key for a signed-out session. */
const STORE_KEY = 'objectui-favorites';
const stored = (): FavoriteItem[] => JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');

const SENT: ChatDockConversationActions = {
  conversationId: 'c1',
  showDebug: false,
  label: 'Quarterly revenue',
  startNew: () => {},
  agent: 'ask',
};

function headerControls(): string[] {
  return Array.from(screen.getByTestId('chat-dock-header').querySelectorAll('button')).map(
    (b) => b.getAttribute('aria-label') ?? b.textContent ?? '',
  );
}

function renderRail(overrides: Partial<ChatDockState> = {}) {
  return render(
    <FavoritesProvider>
      <ChatDockPanel dock={dockState(overrides)} />
    </FavoritesProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  bodyState.actions = undefined;
  bodyState.report = undefined;
});

describe('the drawer header ☆ (objectstack#37863)', () => {
  it('the rail: ☆ leads the buttons once the thread exists', async () => {
    bodyState.actions = SENT;
    renderRail();
    await screen.findByTestId('default-dock-body');
    expect(headerControls()).toEqual(['Add to favorites', 'New conversation', 'History', 'More actions', 'Close']);
    const star = screen.getByTestId('chat-dock-favorite');
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(star.querySelector('svg.lucide-star')).not.toBeNull();
  });

  it('before the first send there is no ☆', async () => {
    bodyState.actions = { showDebug: false, startNew: () => {}, agent: 'ask' };
    renderRail();
    await screen.findByTestId('default-dock-body');
    expect(screen.queryByTestId('chat-dock-favorite')).toBeNull();
    expect(headerControls()).toEqual(['New conversation', 'History', 'More actions', 'Close']);
  });

  it('☆ stores the thread as a conversation favourite, pressed while it is one; pressed again, removes it', async () => {
    bodyState.actions = { ...SENT, agent: 'data_chat' };
    renderRail();
    await screen.findByTestId('default-dock-body');
    fireEvent.click(screen.getByTestId('chat-dock-favorite'));
    expect(stored()).toEqual([
      expect.objectContaining({
        id: 'conversation:c1',
        type: 'conversation',
        conversationId: 'c1',
        agent: 'ask',
        label: 'Quarterly revenue',
        href: '/ai/ask/c1',
      }),
    ]);
    const star = screen.getByTestId('chat-dock-favorite');
    expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(star).toHaveAccessibleName('Remove from favorites');

    fireEvent.click(star);
    expect(stored()).toEqual([]);
    expect(screen.getByTestId('chat-dock-favorite')).toHaveAttribute('aria-pressed', 'false');
  });

  it('starred while the label is still read, it is stored as "New conversation" and then takes the label', async () => {
    bodyState.actions = { ...SENT, label: undefined, labelPending: true };
    renderRail();
    await screen.findByTestId('default-dock-body');
    fireEvent.click(screen.getByTestId('chat-dock-favorite'));
    expect(stored()[0].label).toBe('New conversation');
    act(() => bodyState.report?.({ ...SENT, label: 'Quarterly revenue' }));
    await waitFor(() => expect(stored()[0].label).toBe('Quarterly revenue'));
  });

  it('a favourite thread\'s stored label follows the header; a label still being read writes nothing', async () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([
        { id: 'conversation:c1', label: 'old words', href: '/ai/ask/c1', type: 'conversation', conversationId: 'c1', agent: 'ask', favoritedAt: '2026-11-27T00:00:00.000Z' },
      ]),
    );
    bodyState.actions = { ...SENT, label: undefined, labelPending: true };
    renderRail();
    await screen.findByTestId('default-dock-body');
    expect(screen.getByTestId('chat-dock-favorite')).toHaveAttribute('aria-pressed', 'true');
    expect(stored()[0].label).toBe('old words');
    act(() => bodyState.report?.(SENT));
    await waitFor(() => expect(stored()[0].label).toBe('Quarterly revenue'));
  });

  it('control: a thread that is not a favourite is written nowhere', async () => {
    bodyState.actions = SENT;
    renderRail();
    await screen.findByTestId('default-dock-body');
    act(() => bodyState.report?.({ ...SENT, label: 'Renamed' }));
    expect(stored()).toEqual([]);
  });

  it('the full window draws ☆ too', async () => {
    bodyState.actions = SENT;
    renderRail({ fullWindow: true });
    await screen.findByTestId('default-dock-body');
    expect(headerControls()).toEqual(['Add to favorites', 'New conversation', 'More actions', 'Close']);
  });

  it('the phone sheet: ☆ first, finger-sized', async () => {
    bodyState.actions = SENT;
    render(
      <FavoritesProvider>
        <ChatDockMobileSheet open onOpenChange={() => {}} />
      </FavoritesProvider>,
    );
    await screen.findByTestId('default-dock-body');
    const sheet = screen.getByTestId('chat-dock-mobile-sheet');
    const names = Array.from(sheet.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '');
    expect(names.slice(0, 4)).toEqual(['Add to favorites', 'New conversation', 'History', 'More actions']);
    const star = within(sheet).getByTestId('chat-dock-mobile-favorite');
    expect(star).toHaveClass('h-9', 'w-9');
    fireEvent.click(star);
    expect(stored().map((f) => f.id)).toEqual(['conversation:c1']);
  });
});
