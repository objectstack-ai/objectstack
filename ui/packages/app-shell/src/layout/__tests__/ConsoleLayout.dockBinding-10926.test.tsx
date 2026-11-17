// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#10926 — `ConsoleLayout` hands the dock the current app's package.
 * objectstack#34608 — and holds what the drawer shows (its thread target), per
 * tab, so a thread opened in the drawer is still the one it shows after the
 * layout remounts (Home ↔ an app). Maximizing no longer leaves the page: it is
 * the panel's own full-window mode, pinned in `ChatDock.test.tsx`.
 *
 * The binding decision itself (build only, authorable only) lives in the dock
 * and is pinned in `ChatDock.appBinding-10926.test.tsx`.
 *
 * `ConsoleLayout` renders for real under the real `NavigationProvider` and
 * router; the dock components are prop recorders, and the chrome siblings this
 * card does not touch are stubbed.
 */

import '@testing-library/jest-dom/vitest';
// The layout reaches `import('@objectstack/lint')` (the draft bar's publish
// preflight); pay its first load at collection, never inside a clocked case.
import '@objectstack/lint';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

type Target = { agent?: string; conversationId?: string; packageId?: string; fresh?: boolean };
type DockProps = { appPackageId?: string; target?: Target; onTargetChange?: (next: Target | undefined) => void };

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
    fullWindow: false,
    setFullWindow: vi.fn(),
    toggle: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
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
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';

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

describe('ConsoleLayout — the dock learns the current app and holds the drawer\'s thread (objectui#10926, objectstack#34608)', () => {
  it('hands the active app\'s package to the desktop rail and to the mobile sheet', () => {
    mount(CRM);
    expect(dock.panel?.appPackageId).toBe('app.crm');
    cleanup();
    dock.isMobile = true;
    mount(CRM);
    expect(dock.sheet?.appPackageId).toBe('app.crm');
  });

  it('a thread the drawer moves to is held per tab and survives a remount', () => {
    mount(CRM);
    expect(dock.panel?.target).toBeUndefined();
    act(() => dock.panel?.onTargetChange?.({ agent: 'build', conversationId: 'c1', packageId: 'app.crm' }));
    expect(dock.panel?.target).toEqual({ agent: 'build', conversationId: 'c1', packageId: 'app.crm' });
    cleanup();
    mount(CRM);
    expect(dock.panel?.target).toEqual({ agent: 'build', conversationId: 'c1', packageId: 'app.crm' });
  });

  it('back to the ambient thread clears the held target', () => {
    mount(CRM);
    act(() => dock.panel?.onTargetChange?.({ agent: 'ask', conversationId: 'c2' }));
    act(() => dock.panel?.onTargetChange?.(undefined));
    expect(dock.panel?.target).toBeUndefined();
    cleanup();
    mount(CRM);
    expect(dock.panel?.target).toBeUndefined();
  });
});
