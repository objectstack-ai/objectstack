// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10926 — `ConsoleLayout` hands the dock the current app's package and
 * maximizes a bound build thread to that app's build surface.
 *
 * The binding decision itself (build only, authorable only) lives in the dock
 * and is pinned in `ChatDock.appBinding-10926.test.tsx`. This file pins the two
 * seams the layout owns: the active app's `_packageId` reaches both dock
 * presentations, and the maximize callback routes a bound package to
 * `/ai/build?package=PKG` while an app-less thread keeps opening `/ai`.
 *
 * `ConsoleLayout` renders for real under the real `NavigationProvider` and
 * router; the dock components are prop recorders, and the chrome siblings this
 * card does not touch are stubbed.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

type DockProps = { appPackageId?: string; onMaximize?: (boundPackageId?: string) => void };

const dock = {
  isMobile: false,
  panel: undefined as DockProps | undefined,
  sheet: undefined as DockProps | undefined,
};

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIsMobile: () => dock.isMobile,
}));
vi.mock('../ChatDock', () => ({
  useChatDockState: () => ({
    expanded: true,
    width: 420,
    dragging: false,
    maximized: false,
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    maximize: vi.fn(),
    restore: vi.fn(),
    onResizePointerDown: vi.fn(),
  }),
  ChatDockPanel: (props: DockProps) => {
    dock.panel = props;
    return null;
  },
  ChatDockMobileSheet: (props: DockProps) => {
    dock.sheet = props;
    return null;
  },
}));
vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: true, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({ UnifiedSidebar: () => null }));
vi.mock('../AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../ConsoleChatbotFab', () => ({ ConsoleChatbotFab: () => null }));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';
import { readDockReturnLocation } from '../chatDockState';

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

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function mount(activeApp: Record<string, unknown>) {
  render(
    <MemoryRouter initialEntries={['/apps/crm_app/deal?view=kanban']}>
      <NavigationProvider>
        <Routes>
          <Route
            path="/apps/*"
            element={
              <ConsoleLayout activeAppName="crm_app" activeApp={activeApp} onAppChange={vi.fn()} objects={[]} userId="u1">
                <div />
              </ConsoleLayout>
            }
          />
          <Route path="/ai/*" element={<Where />} />
        </Routes>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

const CRM = { name: 'crm_app', label: 'Customer Desk', _packageId: 'app.crm' };

beforeEach(() => {
  dock.isMobile = false;
  dock.panel = undefined;
  dock.sheet = undefined;
  window.sessionStorage.clear();
});
afterEach(() => cleanup());

describe('ConsoleLayout — the dock learns the current app and maximizes a bound thread to it (objectui#10926)', () => {
  it('hands the active app\'s package to the desktop rail and to the mobile sheet', () => {
    mount(CRM);
    expect(dock.panel?.appPackageId).toBe('app.crm');
    cleanup();
    dock.isMobile = true;
    mount(CRM);
    expect(dock.sheet?.appPackageId).toBe('app.crm');
  });

  it('a bound build thread maximizes to /ai/build?package=PKG', () => {
    mount(CRM);
    act(() => dock.panel?.onMaximize?.('app.crm'));
    expect(screen.getByTestId('where')).toHaveTextContent('/ai/build?package=app.crm');
    expect(readDockReturnLocation()).toBe('/apps/crm_app/deal?view=kanban');
  });

  it('an app-less thread maximizes to /ai exactly as before', () => {
    mount(CRM);
    act(() => dock.panel?.onMaximize?.(undefined));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/ai$/);
    expect(readDockReturnLocation()).toBe('/apps/crm_app/deal?view=kanban');
  });
});
