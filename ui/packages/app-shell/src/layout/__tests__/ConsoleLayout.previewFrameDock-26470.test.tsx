// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A console rendered inside a frame keeps its assistant dock to itself
 * (objectstack#26470).
 *
 * Measured on the 2026-10-27 desktop re-test at 1024 px: with the host page's
 * dock open, asking the assistant for a change opened the ADR-0037 Live Canvas,
 * an iframe of the full console. The frame shares the tab's sessionStorage, so
 * it read the host's `ai-chat-dock-expanded` flag and mounted a second dock;
 * two 420 px rails left the record list about 200 px.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell`, the real `useChatDockState` and the
 * real storage helpers in `chatDockState`. Only the rail BODY is a stand-in:
 * this card is about whether the rail mounts and which flag it writes, not the
 * chat inside it. "Framed" is `window.top` answering a different window, which
 * is what a browser reports inside an iframe.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

// The real dock state hook; only the rail's body and the mobile sheet are stubbed.
vi.mock('../ChatDock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChatDockPanel: () => <aside data-testid="chat-dock-panel" />,
  ChatDockMobileSheet: () => null,
}));

// The AI surface is ON — the dock's own gate — in every case here.
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: true, isLoading: false }),
}));

// Chrome this card does not touch.
vi.mock('../UnifiedSidebar', () => ({ UnifiedSidebar: () => null }));
vi.mock('../AppHeader', () => ({ AppHeader: () => <div data-testid="app-header-stub" /> }));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';
import { DOCK_EXPANDED_STORAGE_KEY } from '../chatDockState';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };

function mountConsole() {
  return render(
    <MemoryRouter initialEntries={['/apps/crm?preview=draft']}>
      <NavigationProvider>
        <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
          <div data-testid="route-content">page</div>
        </ConsoleLayout>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

/** ⌘/Ctrl+Shift+I — the dock's own toggle, wired by ConsoleLayout. */
function pressDockToggle() {
  fireEvent.keyDown(document, { key: 'I', ctrlKey: true, shiftKey: true });
}

const ownTop = Object.getOwnPropertyDescriptor(window, 'top');

/** Make `window.top` answer a different window, as it does inside an iframe. */
function renderInsideFrame() {
  Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
}

beforeEach(() => window.sessionStorage.clear());
afterEach(() => {
  cleanup();
  if (ownTop) Object.defineProperty(window, 'top', ownTop);
  window.sessionStorage.clear();
});

describe('a framed console keeps its assistant dock to itself (objectstack#26470)', () => {
  it('inside a frame, the host page’s EXPANDED flag does not mount a second dock', () => {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '1');
    renderInsideFrame();
    expect(window.self).not.toBe(window.top);
    mountConsole();
    expect(screen.getByTestId('route-content')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-dock-panel')).not.toBeInTheDocument();
    // Collapsed, so its launcher is there: the dock is still one click away.
    expect(screen.getByTestId('console-chatbot-fab')).toBeInTheDocument();
  });

  it('opening and closing the dock inside a frame leaves the host page’s flag as it was', () => {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '0');
    renderInsideFrame();
    mountConsole();

    fireEvent.click(screen.getByTestId('console-chatbot-fab'));
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBe('0');

    pressDockToggle();
    expect(screen.queryByTestId('chat-dock-panel')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBe('0');
  });

  it('inside a frame, an unset host flag stays unset after the dock is toggled', () => {
    renderInsideFrame();
    mountConsole();
    pressDockToggle();
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBeNull();
  });

  it('CONTROL — a top-level console still mounts the stored dock and round-trips the flag', () => {
    window.sessionStorage.setItem(DOCK_EXPANDED_STORAGE_KEY, '1');
    expect(window.self).toBe(window.top);
    mountConsole();
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();

    pressDockToggle();
    expect(screen.queryByTestId('chat-dock-panel')).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBe('0');

    pressDockToggle();
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    expect(window.sessionStorage.getItem(DOCK_EXPANDED_STORAGE_KEY)).toBe('1');
  });
});
