// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The assistant FAB is the dock's COLLAPSED affordance, so it is not on screen
 * while the dock is open (objectui#10899 item 1).
 *
 * Measured on the 2026-09-28 local E2E: inside an app, with the assistant rail
 * open via the FAB, the round `fixed bottom-6 right-6 z-50` button sat on top
 * of the rail's composer send button — only the Enter key could send. ADR-0057
 * ruled the FAB "the dock's collapsed affordance", and its sibling launcher
 * (`ChatDockLauncher`) already renders "only while collapsed, so it never
 * overlaps the expanded rail"; `ConsoleLayout` rendered the FAB in both states.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell` and the real `ConsoleChatbotFab`.
 * The dock STATE is supplied by a stubbed `useChatDockState` so each case can
 * name it, and the rail body is a stand-in: what this card is about is which
 * chrome is mounted for a given dock state, not the chat inside the rail.
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

const dock = vi.hoisted(() => ({ expanded: false, expand: (() => {}) as () => void }));
vi.mock('../ChatDock', () => ({
  useChatDockState: () => ({
    expanded: dock.expanded,
    width: 420,
    dragging: false,
    maximized: false,
    toggle: () => {},
    expand: dock.expand,
    collapse: () => {},
    maximize: () => {},
    restore: () => {},
    onResizePointerDown: () => {},
  }),
  ChatDockPanel: () => <aside data-testid="chat-dock-panel" />,
  ChatDockMobileSheet: () => null,
}));

// The AI surface is ON — the FAB's own gate — in every case here.
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

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };

function mountConsole() {
  return render(
    <MemoryRouter initialEntries={['/apps/crm']}>
      <NavigationProvider>
        <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
          <div data-testid="route-content">page</div>
        </ConsoleLayout>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  dock.expanded = false;
  dock.expand = vi.fn();
});
afterEach(() => cleanup());

describe('the assistant FAB and the open dock never share the screen (objectui#10899)', () => {
  it('with the dock OPEN, the rail is mounted and the FAB is not', () => {
    dock.expanded = true;
    mountConsole();
    expect(screen.getByTestId('route-content')).toBeInTheDocument();
    expect(screen.getByTestId('chat-dock-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('console-chatbot-fab')).not.toBeInTheDocument();
  });

  it('CONTROL — with the dock COLLAPSED, the FAB is the launcher and opens the dock', () => {
    dock.expanded = false;
    mountConsole();
    expect(screen.queryByTestId('chat-dock-panel')).not.toBeInTheDocument();
    const fab = screen.getByTestId('console-chatbot-fab');
    fireEvent.click(fab);
    expect(dock.expand).toHaveBeenCalledTimes(1);
  });
});
