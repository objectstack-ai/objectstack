// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34827 — the AI drawer is titled with the top-bar button's own
 * name, in the rail, in the window-filling form and on the phone sheet, in
 * every language.
 *
 * ## Real subjects
 *
 * The real `AssistantTopBarButton`, `ChatDockPanel` and `ChatDockMobileSheet`
 * under the real `I18nProvider` and the real locale packs. The other ChatDock
 * harnesses mock `useObjectTranslation` with the inline defaults, so they
 * cannot see a pack value; that is why this pin is its own file. The body is
 * overridden through `children`: the title is the subject, not the chat.
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
import { AssistantTopBarButton } from '../AssistantTopBarButton';
import { ChatDockPanel, ChatDockMobileSheet, type ChatDockState } from '../ChatDock';

// The default body drags in the whole chat graph; every case overrides it.
vi.mock('../../console/ai/AiChatPage', () => ({
  ChatPane: () => null,
  resolveApiBase: (explicit?: string) => explicit ?? '/api/v1/ai',
}));
vi.mock('../ChatDockConversation', () => ({ ChatDockConversation: () => null }));
vi.mock('../AiUsageIndicator', () => ({ AiUsageIndicator: () => null }));

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

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('the AI drawer is titled with the top-bar button name (objectstack#34827)', () => {
  it.each([
    ['zh', 'AI 助手', '调整对话宽度'],
    ['en', 'AI Assistant', 'Resize chat'],
  ])('%s: the rail and the full window read the button name', async (lang, name, resizeControl) => {
    inLanguage(lang, (
      <>
        <AssistantTopBarButton />
        <ChatDockPanel dock={dockState()}>
          <div />
        </ChatDockPanel>
      </>
    ));
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).toHaveAccessibleName(name);
    // Control: the neighbouring dock string comes from the same pack.
    expect(screen.getByRole('separator')).toHaveAccessibleName(resizeControl);
    const rail = screen.getByTestId('chat-dock-panel');
    expect(within(rail).getByText(name)).toBeInTheDocument();

    cleanup();
    inLanguage(lang, (
      <ChatDockPanel dock={dockState({ fullWindow: true })}>
        <div />
      </ChatDockPanel>
    ));
    const full = await screen.findByTestId('chat-dock-panel');
    expect(full).toHaveAttribute('data-full-window', 'true');
    expect(within(full).getByText(name)).toBeInTheDocument();
  });

  it('zh: the phone sheet title reads the button name too', async () => {
    inLanguage('zh', (
      <ChatDockMobileSheet open onOpenChange={() => {}}>
        <div />
      </ChatDockMobileSheet>
    ));
    const sheet = await screen.findByTestId('chat-dock-mobile-sheet');
    expect(within(sheet).getByRole('heading', { name: 'AI 助手' })).toBeInTheDocument();
  });

  it('every built-in pack titles the drawer with its own top-bar button name', async () => {
    expect(BUILT_IN_LANGUAGE_CODES.length).toBeGreaterThan(1);
    for (const lang of BUILT_IN_LANGUAGE_CODES) {
      const pack = await loadBuiltInLocale(lang);
      const button = at(pack, 'topbar.aiAssistant');
      expect(typeof button, `${lang} topbar.aiAssistant`).toBe('string');
      expect(at(pack, 'console.ai.dock.title'), lang).toBe(button);
    }
  });
});
