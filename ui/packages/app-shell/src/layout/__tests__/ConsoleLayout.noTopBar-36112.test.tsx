// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36112 — from 768 px up an app draws no top bar: the page starts
 * at the window's top, the standing banners and the connection notice sit at
 * the top of the content area, the page header carries the sidebar's expand
 * button while the sidebar is collapsed, and a route with no shell header gets
 * that button at the content's corner. A phone keeps its bar, and so does an
 * app's docs page, which mounts no sidebar.
 *
 * Harness: the real `ConsoleLayout` with its real `@object-ui/layout`
 * `AppShell` and the real `ShellPageActionsScope`; the sidebar, the app bar
 * and the preview bars are stubs (`ConsoleLayout.phoneRecordOneBar-28483`'s).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { useSidebar } from '@object-ui/components';
// The layout's reach includes `import('@objectstack/lint')` (the draft
// preview bar's capability lint): pay that load during collection.
import '@objectstack/lint';

vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({
  UnifiedSidebar: () => <nav aria-label="App menu" data-testid="sidebar-stub" />,
}));
vi.mock('../AppHeader', () => ({
  AppHeader: () => <div data-testid="app-bar" />,
}));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout } from '../ConsoleLayout';
import { ChromeBannerSlot } from '../chromeBannerHost';
import { PageHeader } from '../PageHeader';
import { NavigationProvider } from '../../context/NavigationContext';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

/** Collapses the sidebar from inside the provider, as the sidebar's own button does. */
function CollapseButton() {
  const { setOpen } = useSidebar();
  return (
    <button type="button" data-testid="collapse" onClick={() => setOpen(false)}>
      collapse
    </button>
  );
}

function mountAt(
  path: string,
  width: number,
  page: React.ReactNode,
  options: { connectionState?: 'connected' | 'disconnected' | 'error' } = {},
) {
  setWidth(width);
  return render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationProvider>
          {/* The shell's banners, mounted above the routes as `ConsoleShell` mounts them. */}
          <ChromeBannerSlot>
            <div data-testid="impersonation-banner-stub">Impersonating</div>
          </ChromeBannerSlot>
          <ConsoleLayout
            activeAppName="crm"
            activeApp={APP}
            onAppChange={vi.fn()}
            objects={[]}
            connectionState={options.connectionState}
          >
            <CollapseButton />
            {page}
          </ConsoleLayout>
        </NavigationProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  document.cookie = 'sidebar_state=; path=/; max-age=0';
  window.localStorage.clear();
  setWidth(1440);
});

describe('an app draws no top bar from 768 px up (objectstack#36112)', () => {
  it('at 768, 1024, 1280 and 1440 px there is no header element and no app bar', () => {
    for (const width of [768, 1024, 1280, 1440]) {
      mountAt('/apps/crm/crm_lead', width, <PageHeader title="Leads" />);
      expect(document.querySelectorAll('header'), `${width} px`).toHaveLength(0);
      expect(screen.queryByTestId('app-bar'), `${width} px`).toBeNull();
      cleanup();
    }
  });

  it('control: an app\'s docs pages, which mount no sidebar, keep the bar at every width', () => {
    mountAt('/apps/crm/docs/crm_manual', 1440, <div>Manual</div>);
    expect(screen.getByTestId('app-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar-stub')).toBeNull();
  });

  it('a phone keeps its app bar', () => {
    mountAt('/apps/crm/crm_lead', 390, <PageHeader title="Leads" />);
    expect(document.querySelectorAll('header')).toHaveLength(1);
    expect(screen.getByTestId('app-bar')).toBeInTheDocument();
  });

  it('the shell banners are drawn once, at the top of the content area, from 768 px up', () => {
    mountAt('/apps/crm/crm_lead', 1280, <PageHeader title="Leads" />);
    const banners = screen.getAllByTestId('impersonation-banner-stub');
    expect(banners).toHaveLength(1);
    expect(screen.getByTestId('console-banners')).toContainElement(banners[0]);
  });

  it('on a phone the shell banners stay where the shell mounts them', () => {
    mountAt('/apps/crm/crm_lead', 390, <PageHeader title="Leads" />);
    const banners = screen.getAllByTestId('impersonation-banner-stub');
    expect(banners).toHaveLength(1);
    expect(screen.getByTestId('console-banners')).not.toContainElement(banners[0]);
  });

  it('a lost connection is a notice at the top of the content area; a live one draws nothing', () => {
    mountAt('/apps/crm/crm_lead', 1280, <PageHeader title="Leads" />, { connectionState: 'disconnected' });
    const notice = screen.getByTestId('console-connection-banner');
    expect(screen.getByTestId('console-banners')).toContainElement(notice);
    expect(notice).toHaveTextContent('Disconnected');
    cleanup();
    mountAt('/apps/crm/crm_lead', 1280, <PageHeader title="Leads" />, { connectionState: 'connected' });
    expect(screen.queryByTestId('console-connection-banner')).toBeNull();
  });

  it('the page header draws the group, and the expand button once the sidebar is collapsed', () => {
    mountAt('/apps/crm/dashboard/sales', 1440, <PageHeader title="Sales" />);
    expect(screen.getByTestId('shell-page-actions')).toBeInTheDocument();
    expect(screen.queryByTestId('shell-sidebar-expand')).toBeNull();
    fireEvent.click(screen.getByTestId('collapse'));
    const header = screen.getByTestId('page-header');
    expect(header).toContainElement(screen.getByTestId('shell-sidebar-expand'));
    // The header draws it, so the corner fallback does not.
    expect(screen.queryByTestId('shell-sidebar-expand-fallback')).toBeNull();
    expect(screen.getAllByTestId('shell-sidebar-expand')).toHaveLength(1);
  });

  it('a route with no shell header gets the expand button at the content corner', () => {
    mountAt('/apps/crm/search', 1440, <div>Search results</div>);
    expect(screen.queryByTestId('shell-sidebar-expand-fallback')).toBeNull();
    fireEvent.click(screen.getByTestId('collapse'));
    const fallback = screen.getByTestId('shell-sidebar-expand-fallback');
    expect(screen.getByTestId('console-route')).toContainElement(fallback);
    expect(fallback).toContainElement(screen.getByTestId('shell-sidebar-expand'));
  });
});
