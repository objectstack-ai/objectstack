// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ConsoleLayout — on a window below the fold width the console sidebar's
 * first frame is already the icon rail (objectstack#28077).
 *
 * The sidebar provider takes its first open state from the `sidebar_state`
 * cookie the last page wrote. Before, a narrow window drew that state (the
 * expanded sidebar) once and then folded it, with the primitive's width
 * transition in between. The probe stands in for the sidebar and records the
 * state of every render, the first one included.
 *
 * Three ways in, all at 1280 px: a first visit (no cookie), a load after the
 * sidebar was expanded on a wide window, and a reload while the overlay was
 * shown (both leave the cookie expanded). At 1440 px nothing changes.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { useSidebar } from '@object-ui/components';

const renders: string[] = [];

vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({
  UnifiedSidebar: function SidebarProbe() {
    renders.push(useSidebar().state);
    return null;
  },
}));
vi.mock('../AppHeader', () => ({ AppHeader: () => null }));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';
import { CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE } from '../consoleSidebarRail';
import { writeWorkspacePreference } from '../../utils/workspacePreference';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };

function setViewportWidth(width: number) {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number; height: number }) => void } }).happyDOM.setViewport({
    width,
    height: 900,
  });
}

function load(width: number) {
  setViewportWidth(width);
  renders.length = 0;
  return render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/crm/contact']}>
        <NavigationProvider>
          <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
            <div />
          </ConsoleLayout>
        </NavigationProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const clearCookie = () => {
  document.cookie = 'sidebar_state=; path=/; max-age=0';
};

beforeEach(() => {
  localStorage.clear();
  clearCookie();
});

afterEach(() => {
  cleanup();
  setViewportWidth(1024);
  localStorage.clear();
  clearCookie();
});

describe('the narrow window’s first frame is the rail (objectstack#28077)', () => {
  it('a first visit at 1280 px: every render, the first included, is the rail', () => {
    load(1280);
    expect(renders[0]).toBe('collapsed');
    expect(new Set(renders)).toEqual(new Set(['collapsed']));
  });

  it('a 1280 px load after the sidebar was expanded on a wide window', () => {
    load(1440);
    expect(renders.at(-1)).toBe('expanded');
    cleanup();

    load(1280);
    expect(renders[0]).toBe('collapsed');
    expect(new Set(renders)).toEqual(new Set(['collapsed']));
  });

  it('a 1280 px reload while the overlay was shown (the cookie says expanded)', () => {
    document.cookie = 'sidebar_state=true; path=/';
    load(1280);
    expect(renders[0]).toBe('collapsed');
    expect(new Set(renders)).toEqual(new Set(['collapsed']));
  });

  it('at 1440 px nothing changes: expanded from the first render', () => {
    load(1440);
    expect(new Set(renders)).toEqual(new Set(['expanded']));
  });

  it('a sidebar kept open on a narrow window keeps the state it had', () => {
    writeWorkspacePreference(CONSOLE_SIDEBAR_KEEP_OPEN_PREFERENCE, 'user', 'on');
    document.cookie = 'sidebar_state=true; path=/';
    load(1280);
    expect(new Set(renders)).toEqual(new Set(['expanded']));
  });
});
