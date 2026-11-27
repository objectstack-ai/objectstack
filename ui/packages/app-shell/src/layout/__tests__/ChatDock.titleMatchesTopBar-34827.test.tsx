// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34827, as ui ADR-0057 Amendment A5 redrew the header
 * (objectstack#37860) — the AI drawer is titled with the conversation it
 * shows: the label its history row carries, and "New conversation" (the
 * history list's own words for an unnamed row) before the first send. In the
 * rail, in the window-filling form and on the phone sheet, in every language.
 * The standing entry beside it reads 「Ask AI」 (objectstack#37858): an action,
 * never the drawer's title.
 *
 * ## Real subjects
 *
 * The real `AssistantTopBarButton`, `ChatDockPanel` and `ChatDockMobileSheet`
 * under the real `I18nProvider` and the real locale packs. The other ChatDock
 * harnesses mock `useObjectTranslation` with the inline defaults, so they
 * cannot see a pack value; that is why this pin is its own file. The body is a
 * stand-in that reports what the real one reports to the chrome
 * (`onActionsChange`): the title is the subject, not the chat.
 *
 * ## Control
 *
 * Each rendered case also reads one neighbouring dock string from the same
 * pack (the resize handle's name), so a run where the requested pack never
 * loaded, and both surfaces fell back to their English defaults, is told
 * apart from a pass.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, BUILT_IN_LANGUAGE_CODES, loadBuiltInLocale } from '@object-ui/i18n';
// The drawer's chat body reaches `import('@object-ui/plugin-grid')`; pay its
// first load at collection, never inside a clocked case (`check:test-source-alias`).
import '@object-ui/plugin-grid';
import type { ChatDockConversationActions } from '../chatDockTarget';

/** What the stand-in body reports for its thread, set per case. */
let reported: ChatDockConversationActions | undefined;

// The default body drags in the whole chat graph; a stand-in reports instead.
vi.mock('../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: (explicit?: string) => explicit ?? '/api/v1/ai',
}));
vi.mock('../ChatDockConversation', () => ({
  ChatDockConversation: ({ onActionsChange }: { onActionsChange?: (a: ChatDockConversationActions | undefined) => void }) => {
    React.useEffect(() => {
      onActionsChange?.(reported);
    }, [onActionsChange]);
    return null;
  },
}));
vi.mock('../AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));
// The 「···」 menu reads the agent catalog; no catalog, no request.
vi.mock('@object-ui/plugin-chatbot/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-chatbot/core')>()),
  useAgents: () => ({ agents: [], isLoading: false, error: undefined }),
}));

import { AssistantTopBarButton } from '../AssistantTopBarButton';
import { ChatDockPanel, ChatDockMobileSheet, type ChatDockState } from '../ChatDock';

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

function inLanguage(lang: string, node: React.ReactNode) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nProvider>,
  );
}

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

const UNSENT: ChatDockConversationActions = { showDebug: false, startNew: () => {} };
const NAMED: ChatDockConversationActions = {
  conversationId: 'c1',
  showDebug: false,
  label: 'Quarterly revenue by region',
  startNew: () => {},
};

beforeEach(() => {
  window.localStorage.clear();
  reported = undefined;
});
afterEach(() => cleanup());

describe('the AI drawer is titled with the conversation it shows (objectstack#34827, ui ADR-0057 A5)', () => {
  it.each([
    ['zh', '新对话', '问 AI', '调整对话宽度'],
    ['en', 'New conversation', 'Ask AI', 'Resize chat'],
  ])('%s: before the first send the rail and the full window read "New conversation"; the entry asks', async (lang, fresh, entry, resizeControl) => {
    reported = UNSENT;
    inLanguage(lang, (
      <>
        <AssistantTopBarButton />
        <ChatDockPanel dock={dockState()} />
      </>
    ));
    const button = await screen.findByTestId('topbar-ai-assistant');
    // objectstack#37858 — the standing entry says what it does.
    expect(button).toHaveAccessibleName(entry);
    // Control: the neighbouring dock string comes from the same pack.
    expect(screen.getByRole('separator')).toHaveAccessibleName(resizeControl);
    const rail = screen.getByTestId('chat-dock-panel');
    expect(await within(rail).findByRole('heading', { name: fresh })).toBeInTheDocument();

    cleanup();
    inLanguage(lang, <ChatDockPanel dock={dockState({ fullWindow: true })} />);
    const full = await screen.findByTestId('chat-dock-panel');
    expect(full).toHaveAttribute('data-full-window', 'true');
    expect(await within(full).findByRole('heading', { name: fresh })).toBeInTheDocument();
  });

  it('after the first send the title is the label the history row carries, in the rail and on the phone sheet', async () => {
    reported = NAMED;
    inLanguage('zh', <ChatDockPanel dock={dockState()} />);
    expect(await screen.findByRole('heading', { name: NAMED.label })).toBeInTheDocument();
    // The entry's words never title the drawer.
    expect(screen.queryByRole('heading', { name: '问 AI' })).not.toBeInTheDocument();

    cleanup();
    inLanguage('zh', <ChatDockMobileSheet open onOpenChange={() => {}} />);
    const sheet = await screen.findByTestId('chat-dock-mobile-sheet');
    expect(await within(sheet).findByRole('heading', { name: NAMED.label })).toBeInTheDocument();
  });

  it('zh: the phone sheet reads 「新对话」 before the first send', async () => {
    reported = UNSENT;
    inLanguage('zh', <ChatDockMobileSheet open onOpenChange={() => {}} />);
    const sheet = await screen.findByTestId('chat-dock-mobile-sheet');
    expect(await within(sheet).findByRole('heading', { name: '新对话' })).toBeInTheDocument();
  });

  it('every built-in pack names an unsent conversation, and names the entry apart from it', async () => {
    expect(BUILT_IN_LANGUAGE_CODES.length).toBeGreaterThan(1);
    for (const lang of BUILT_IN_LANGUAGE_CODES) {
      const pack = await loadBuiltInLocale(lang);
      const fresh = at(pack, 'console.ai.newConversation');
      expect(typeof fresh, `${lang} console.ai.newConversation`).toBe('string');
      // objectstack#37858 — the standing entry's words are their own string.
      const entry = at(pack, 'home.askAI');
      expect(typeof entry, `${lang} home.askAI`).toBe('string');
      expect(entry, lang).not.toBe(fresh);
    }
  });
});
