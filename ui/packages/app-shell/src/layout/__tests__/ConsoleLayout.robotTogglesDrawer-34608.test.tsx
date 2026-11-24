// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34608 (ui ADR-0057 as amended) — the top-bar robot is the AI
 * assistant's one standing entry: it opens and closes the right-side drawer in
 * place, without navigating, and the floating bottom-right button is gone.
 *
 * Acceptance 1 of the card: on a list page the robot shows the drawer and the
 * URL does not change. Also kept from objectui#10899: no floating button ever
 * sits on the open rail's composer — there is no floating button at all now.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell`, the real `useConsoleChatDock` host,
 * the real `useChatDockState` and the real `AssistantTopBarButton`, drawn in
 * the page as the page header's button group draws it from 768 px up
 * (objectstack#36111, objectstack#36112: a desktop app has no top bar). The
 * phone's top bar is a stand-in that draws nothing.
 * The rail body is a stand-in: which chrome mounts is the subject here, not the
 * chat inside the rail.
 */

import '@testing-library/jest-dom/vitest';
// The layout reaches `import('@objectstack/lint')` (the draft bar's publish
// preflight); pay its first load at collection, never inside a clocked case.
import '@objectstack/lint';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

vi.mock('../ChatDock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChatDockPanel: ({ dock }: { dock: { fullWindow: boolean } }) => (
    <aside data-testid="chat-dock-panel" data-full-window={String(dock.fullWindow)} />
  ),
  ChatDockMobileSheet: () => null,
}));

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
import { AssistantTopBarButton } from '../AssistantTopBarButton';
import { NavigationProvider } from '../../context/NavigationContext';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };
const LIST = '/apps/crm/opportunity';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function mountConsole() {
  return render(
    <MemoryRouter initialEntries={[LIST]}>
      <NavigationProvider>
        <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
          {/* From 768 px up the robot sits in the page header's button group
              (objectstack#36111), not in a top bar (objectstack#36112). */}
          <AssistantTopBarButton />
          <div data-testid="route-content">page</div>
          <LocationProbe />
        </ConsoleLayout>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe('the top-bar robot opens the assistant drawer in place (objectstack#34608)', () => {
  it('opens the drawer on the list page without changing the URL, and closes it again', () => {
    mountConsole();
    const robot = screen.getByTestId('topbar-ai-assistant');
    expect(robot).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('chat-dock-panel')).not.toBeInTheDocument();

    fireEvent.click(robot);
    expect(screen.getByTestId('chat-dock-panel')).toHaveAttribute('data-full-window', 'false');
    expect(robot).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('location')).toHaveTextContent(LIST);
    expect(screen.getByTestId('route-content')).toBeInTheDocument();

    fireEvent.click(robot);
    expect(screen.queryByTestId('chat-dock-panel')).not.toBeInTheDocument();
    expect(robot).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('location')).toHaveTextContent(LIST);
  });

  it('draws no floating bottom-right button, open or closed (objectui#10899 kept)', () => {
    mountConsole();
    expect(screen.queryByTestId('console-chatbot-fab')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('topbar-ai-assistant'));
    expect(screen.queryByTestId('console-chatbot-fab')).not.toBeInTheDocument();
  });
});
