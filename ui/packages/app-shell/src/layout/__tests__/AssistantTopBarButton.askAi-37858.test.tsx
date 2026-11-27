// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37858 — the assistant's one standing entry is an outlined button
 * that says what it does, 「问 AI」, beside a chat-bubble icon.
 *
 * - With its words the words are its accessible name; no `aria-label`.
 * - Icon only (a header out of room asks for it; a phone always) it carries
 *   the same words as `aria-label`, and a phone draws the 44 px target.
 * - The tooltip names ⌘⇧I on a Mac, with `aria-keyshortcuts`; on any other
 *   platform no shortcut is advertised (Ctrl+Shift+I opens the developer
 *   tools there).
 * - The pressed style and the plan-pending marker stay; the marker's words
 *   describe the button and never join its name.
 * - Every built-in pack carries the words, and they are Home's 「Ask AI」.
 *
 * Real subjects: `AssistantTopBarButton` under the real `I18nProvider` and the
 * real packs, with a drawer handle stand-in.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, BUILT_IN_LANGUAGE_CODES, loadBuiltInLocale } from '@object-ui/i18n';
import { AssistantTopBarButton, ASK_AI_MAC_KEY_SHORTCUTS } from '../AssistantTopBarButton';
import { ChatDockControlProvider, type ChatDockControl } from '../chatDockControl';
import { publishPlanApprovalPending } from '../../assistant/assistantBus';

const setWidth = (value: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value });
const setPlatform = (value: string) => Object.defineProperty(window.navigator, 'platform', { configurable: true, value });

function control(overrides: Partial<ChatDockControl> = {}): ChatDockControl {
  return { expanded: false, fullWindow: false, toggle: vi.fn(), open: vi.fn(), ...overrides };
}

function mount(node: React.ReactNode, { lang = 'zh', dock = control() as ChatDockControl | null } = {}) {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }} persistLanguage={false}>
      <MemoryRouter>
        {dock ? <ChatDockControlProvider value={dock}>{node}</ChatDockControlProvider> : node}
      </MemoryRouter>
    </I18nProvider>,
  );
}

const ORIGINAL_PLATFORM = window.navigator.platform;

beforeEach(() => {
  setWidth(1280);
  setPlatform('Win32');
  window.localStorage.clear();
});

afterEach(() => {
  act(() => publishPlanApprovalPending({ userId: undefined, conversationId: 'conv-a', pending: false }));
  cleanup();
  setWidth(1024);
  setPlatform(ORIGINAL_PLATFORM);
  window.localStorage.clear();
});

describe('the Ask AI entry says what it does (objectstack#37858)', () => {
  it.each([
    ['zh', '问 AI'],
    ['en', 'Ask AI'],
  ])('%s: an outlined button with its words, which are its accessible name', async (lang, words) => {
    mount(<AssistantTopBarButton />, { lang });
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).toHaveAccessibleName(words);
    expect(button).not.toHaveAttribute('aria-label');
    expect(button).toHaveAttribute('data-icon-only', 'false');
    expect(screen.getByTestId('topbar-ai-assistant-text')).toHaveTextContent(words);
    // The outlined variant, at the 32 px header height.
    expect(button.className).toMatch(/\bborder\b/);
    expect(button.className.split(/\s+/)).toContain('h-8');
  });

  it('icon only, when a header asks for it: the same words as aria-label', async () => {
    mount(<AssistantTopBarButton iconOnly />);
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).toHaveAttribute('aria-label', '问 AI');
    expect(button).toHaveAccessibleName('问 AI');
    expect(button).toHaveAttribute('data-icon-only', 'true');
    expect(screen.queryByTestId('topbar-ai-assistant-text')).toBeNull();
    expect(button.className.split(/\s+/)).toContain('size-8');
  });

  it('on a phone: the icon alone, a 44 px target, whatever the header says', async () => {
    setWidth(375);
    mount(<AssistantTopBarButton />);
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).toHaveAttribute('data-icon-only', 'true');
    expect(button).toHaveAccessibleName('问 AI');
    expect(button.className.split(/\s+/)).toContain('size-11');
  });

  it('keeps the pressed style while the drawer is open, and toggles it closed', async () => {
    const dock = control({ expanded: true });
    mount(<AssistantTopBarButton />, { dock });
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button.className.split(/\s+/)).toContain('bg-accent');
    fireEvent.click(button);
    expect(dock.toggle).toHaveBeenCalledTimes(1);
    expect(dock.open).not.toHaveBeenCalled();
  });

  it('closed, a click opens the drawer the way its own toggle does', async () => {
    const dock = control();
    mount(<AssistantTopBarButton />, { dock });
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(button);
    expect(dock.toggle).toHaveBeenCalledTimes(1);
  });

  it('under no drawer host it is a link to the assistant, with the same words', async () => {
    mount(<AssistantTopBarButton />, { dock: null });
    const link = await screen.findByTestId('topbar-ai-assistant');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/ai');
    expect(link).toHaveAccessibleName('问 AI');
  });

  it('the plan-pending marker stays, describes the button and stays out of its name', async () => {
    mount(<AssistantTopBarButton />, { lang: 'en' });
    act(() => publishPlanApprovalPending({ userId: undefined, conversationId: 'conv-a', pending: true }));
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(screen.getByTestId('topbar-ai-assistant-plan-pending')).toBeInTheDocument();
    expect(button).toHaveAccessibleName('Ask AI');
    expect(button).toHaveAccessibleDescription('A proposed plan is waiting for your approval');
  });
});

describe('the keyboard hint is a Mac-only one (objectstack#37858)', () => {
  it('on a Mac: aria-keyshortcuts, and the tooltip shows ⌘⇧I', async () => {
    setPlatform('MacIntel');
    mount(<AssistantTopBarButton />);
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).toHaveAttribute('aria-keyshortcuts', ASK_AI_MAC_KEY_SHORTCUTS);
    expect(ASK_AI_MAC_KEY_SHORTCUTS).toBe('Meta+Shift+I');
    fireEvent.focus(button);
    const [shortcut] = await screen.findAllByTestId('topbar-ai-assistant-shortcut');
    expect(shortcut).toHaveTextContent('⌘⇧I');
  });

  it('elsewhere: no aria-keyshortcuts and, with the words shown, no tooltip at all', async () => {
    setPlatform('Win32');
    mount(<AssistantTopBarButton />);
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).not.toHaveAttribute('aria-keyshortcuts');
    fireEvent.focus(button);
    expect(screen.queryByTestId('topbar-ai-assistant-tooltip')).toBeNull();
    expect(screen.queryByTestId('topbar-ai-assistant-shortcut')).toBeNull();
  });

  it('elsewhere, icon only: the tooltip names the entry and still shows no shortcut', async () => {
    setPlatform('Linux x86_64');
    mount(<AssistantTopBarButton iconOnly />);
    const button = await screen.findByTestId('topbar-ai-assistant');
    expect(button).not.toHaveAttribute('aria-keyshortcuts');
    fireEvent.focus(button);
    const [tooltip] = await screen.findAllByTestId('topbar-ai-assistant-tooltip');
    expect(tooltip).toHaveTextContent('问 AI');
    expect(screen.queryByTestId('topbar-ai-assistant-shortcut')).toBeNull();
  });
});

describe('every built-in pack carries the words (objectstack#37858)', () => {
  it('each pack names the entry with its own Home 「Ask AI」 string', async () => {
    expect(BUILT_IN_LANGUAGE_CODES.length).toBeGreaterThanOrEqual(11);
    const english = (await loadBuiltInLocale('en')) as { home?: { askAI?: unknown } };
    for (const lang of BUILT_IN_LANGUAGE_CODES) {
      const pack = (await loadBuiltInLocale(lang)) as { home?: { askAI?: unknown } };
      const words = pack.home?.askAI;
      expect(typeof words, lang).toBe('string');
      expect((words as string).trim(), lang).not.toBe('');
      // No interpolation hole a translator could have invented.
      expect(words as string, lang).not.toMatch(/\{\{?\w+\}?\}/);
      if (lang !== 'en') expect(words, lang).not.toBe(english.home?.askAI);
    }
  });
});
