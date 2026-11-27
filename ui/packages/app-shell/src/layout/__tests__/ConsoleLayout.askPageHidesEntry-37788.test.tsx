// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37788 (ui ADR-0057 Amendment A4) — on an app's AI inquiry page
 * (`ai:chat`) the drawer is closed and the assistant's standing entry is not
 * drawn; on every other page both are as the user left them.
 *
 * The dock hook's own cases (`useConsoleChatDock.phoneCollapseOnNavigate-37556`)
 * tell the hook the route themselves; this file pins the one place the console
 * tells it: `ConsoleLayout` reading the address.
 *
 * ## Real subjects
 *
 * `ConsoleLayout` with its real `AppShell`, the real `useConsoleChatDock`
 * host, the real `useChatDockState` and the real `AssistantTopBarButton`,
 * drawn in the page as the page header's button group draws it from 768 px up.
 * The rail body is a stand-in: which chrome mounts is the subject here.
 */

import '@testing-library/jest-dom/vitest';
// The layout reaches `import('@objectstack/lint')` (the draft bar's publish
// preflight); pay its first load at collection, never inside a clocked case.
import '@objectstack/lint';
// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

vi.mock('../ChatDock', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChatDockPanel: () => <aside data-testid="chat-dock-panel" />,
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
const ASK_PAGE = '/apps/crm/component/ai/chat';

function Links() {
  const navigate = useNavigate();
  return (
    <>
      <button data-testid="to-ask-page" onClick={() => navigate(ASK_PAGE)} />
      <button data-testid="to-list" onClick={() => navigate(LIST)} />
    </>
  );
}

function mountConsole(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <NavigationProvider>
        <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
          <AssistantTopBarButton />
          <Links />
        </ConsoleLayout>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

const robot = () => screen.queryByTestId('topbar-ai-assistant');
const rail = () => screen.queryByTestId('chat-dock-panel');

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('ConsoleLayout tells the drawer it is on the AI inquiry page (objectstack#37788)', () => {
  it('on the ai:chat route the entry is not drawn; on another route it is back', () => {
    mountConsole(ASK_PAGE);
    expect(robot()).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('to-list'));
    expect(robot()).toBeInTheDocument();
  });

  it('a drawer open on another page is closed on the ai:chat route and comes back after it', () => {
    mountConsole(LIST);
    fireEvent.click(robot()!);
    expect(rail()).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('to-ask-page'));
    expect(rail()).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('to-list'));
    expect(rail()).toBeInTheDocument();
  });
});
