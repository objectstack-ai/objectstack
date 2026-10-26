// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13253 — the AI entry (the dock's maximize to `/ai` or
 * `/ai/build?package=PKG`) asks before dropping a page's unsaved edits.
 *
 * Maximizing navigates from a dock button, which no page's link guard sees, so
 * it left a dirty page with no question. It now goes through the shell's seam,
 * `confirmUnsavedLeave`; on Cancel nothing is recorded as the place to return
 * to and the page stays.
 *
 * `ConsoleLayout` renders for real under the real `NavigationProvider` and
 * router, with the dock components as prop recorders and the chrome siblings
 * stubbed (the harness `ConsoleLayout.dockBinding-10926.test.tsx` uses). The
 * page's edit is a registration made the way a page makes it.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

type DockProps = { appPackageId?: string; onMaximize?: (boundPackageId?: string) => void };

const dock = { panel: undefined as DockProps | undefined };

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useIsMobile: () => false,
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
  ChatDockMobileSheet: () => null,
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
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';

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

const PAGE = '/apps/crm_app/deal?view=kanban';
const QUESTION = 'Leave this page and drop your edit?';
const CRM = { name: 'crm_app', label: 'Customer Desk', _packageId: 'app.crm' };

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function mount() {
  render(
    <MemoryRouter initialEntries={[PAGE]}>
      <NavigationProvider>
        <Routes>
          <Route
            path="/apps/*"
            element={
              <ConsoleLayout activeAppName="crm_app" activeApp={CRM} onAppChange={vi.fn()} objects={[]} userId="u1">
                <div data-testid="page" />
              </ConsoleLayout>
            }
          />
          <Route path="/ai/*" element={<Where />} />
        </Routes>
      </NavigationProvider>
    </MemoryRouter>,
  );
}

const confirmSpy = vi.fn((_message?: string) => false);
let release: (() => void) | undefined;

beforeEach(() => {
  dock.panel = undefined;
  window.sessionStorage.clear();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(false);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
});
afterEach(() => {
  release?.();
  release = undefined;
  cleanup();
});

describe('the AI entry asks before leaving a page with unsaved edits (objectui#13253)', () => {
  it.each([
    ['an app-less thread', undefined, '/ai'],
    ['a bound build thread', 'app.crm', '/ai/build?package=app.crm'],
  ])('a dirty page: maximizing %s asks; Cancel stays and records nothing, OK goes', (_name, pkg, target) => {
    release = registerUnsavedEdits(QUESTION);
    mount();

    act(() => dock.panel?.onMaximize?.(pkg));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    expect(screen.getByTestId('page')).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    expect(readDockReturnLocation()).toBeUndefined();

    confirmSpy.mockReturnValue(true);
    act(() => dock.panel?.onMaximize?.(pkg));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('where').textContent).toBe(target);
    expect(readDockReturnLocation()).toBe(PAGE);
  });

  it('CONTROL: on a clean page maximizing goes at once and nothing asks', () => {
    mount();
    act(() => dock.panel?.onMaximize?.(undefined));
    expect(screen.getByTestId('where').textContent).toBe('/ai');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
