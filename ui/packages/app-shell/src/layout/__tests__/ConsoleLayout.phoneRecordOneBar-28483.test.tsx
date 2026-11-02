// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28483 (ruling letter A) — below 768 px a record route draws no
 * app bar: the record page's own top bar (「‹ <object plural>」, the stepper)
 * is the page's one bar, and the record's name shows once, as the header
 * title under it. The four doors (app menu, search, notifications, account)
 * stay on every other route, the object's list among them, one 「‹」 away.
 * From 768 px up every route keeps the app bar.
 *
 * Harness: the real `ConsoleLayout` with its real `@object-ui/layout`
 * `AppShell` (`ConsoleLayout.oneMainLandmark-13334`'s). `AppHeader` is a stub
 * that draws what its phone label draws on a record route, the record's name
 * (`AppHeader`'s own label is `AppHeader.phoneNoViewDropdown-27058`'s pin); the
 * route's page is a stub of the record page's phone face: its top bar and its
 * header title. The record page's own phone bar is `RecordDetailView.phoneFace-27058`'s.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({ UnifiedSidebar: () => <nav aria-label="App menu" /> }));
vi.mock('../AppHeader', () => ({
  AppHeader: () => (
    <div data-testid="app-bar">
      <button type="button">Search</button>
      <span>Mira Costa</span>
    </div>
  ),
}));
vi.mock('../ConsoleNotificationBanners', () => ({ ConsoleNotificationBanners: () => null }));
vi.mock('../../preview/DraftPreviewBar', () => ({ DraftPreviewBar: () => null }));
vi.mock('../../preview/UnpublishedAppBar', () => ({ UnpublishedAppBar: () => null }));

import { ConsoleLayout, isRecordPagePath } from '../ConsoleLayout';
import { NavigationProvider } from '../../context/NavigationContext';

const APP = { name: 'crm', label: 'CRM', active: true, navigation: [] };
const RECORD = '/apps/crm/crm_lead/record/r-1';

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

/** The record page's phone face, as far as this layout sees it: its bar and its title. */
function RecordPageStub() {
  return (
    <div data-record-page-root="">
      <div data-record-top-bar="">
        <a href="/apps/crm/crm_lead" data-record-crumb-back="">Leads</a>
      </div>
      <h1>Mira Costa</h1>
    </div>
  );
}

function mountAt(path: string, width: number) {
  setWidth(width);
  return render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationProvider>
          <ConsoleLayout activeAppName="crm" activeApp={APP} onAppChange={vi.fn()} objects={[]}>
            <RecordPageStub />
          </ConsoleLayout>
        </NavigationProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Every bar across the page's top: the shell's `<header>` and the record page's top bar. */
const bars = () => [...document.querySelectorAll('header, [data-record-top-bar]')];

afterEach(() => {
  cleanup();
  setWidth(1440);
});

describe('a phone record page draws one bar (objectstack#28483)', () => {
  it('at 390 px a record route has one bar, the record\'s own, and the record name once', () => {
    mountAt(RECORD, 390);
    expect(document.querySelectorAll('header')).toHaveLength(0);
    expect(screen.queryByTestId('app-bar')).toBeNull();
    expect(bars()).toHaveLength(1);
    expect(bars()[0]).toHaveAttribute('data-record-top-bar');
    expect(screen.getAllByText('Mira Costa')).toHaveLength(1);
    // The way to the four doors: the bar's 「‹」, to the object's list.
    expect(screen.getByRole('link', { name: 'Leads' })).toHaveAttribute('href', '/apps/crm/crm_lead');
  });

  it('at 390 px the same record on a named record page draws no app bar either', () => {
    mountAt(`${RECORD}/page/print_sheet`, 390);
    expect(document.querySelectorAll('header')).toHaveLength(0);
    expect(bars()).toHaveLength(1);
  });

  it('at 390 px the root routes keep the app bar, the four doors with it', () => {
    for (const path of ['/apps/crm', '/apps/crm/crm_lead', '/apps/crm/crm_lead/view/all', '/apps/crm/dashboard/sales']) {
      mountAt(path, 390);
      expect(document.querySelectorAll('header'), path).toHaveLength(1);
      expect(screen.getByTestId('app-bar'), path).toBeInTheDocument();
      cleanup();
    }
  });

  it('at 390 px the record\'s edit form is not the record page: it keeps the app bar', () => {
    mountAt(`${RECORD}/edit`, 390);
    expect(document.querySelectorAll('header')).toHaveLength(1);
    expect(screen.getByTestId('app-bar')).toBeInTheDocument();
  });

  it('control: at 768 px and 1440 px a record route keeps the app bar, as before', () => {
    for (const width of [768, 1440]) {
      mountAt(RECORD, width);
      const headers = document.querySelectorAll('header');
      expect(headers, `${width} px`).toHaveLength(1);
      expect(headers[0]).toContainElement(screen.getByTestId('app-bar'));
      cleanup();
    }
  });

  it('at 767 px, one pixel under the breakpoint, the record route is already on its phone face', () => {
    mountAt(RECORD, 767);
    expect(document.querySelectorAll('header')).toHaveLength(0);
  });
});

describe('isRecordPagePath (objectstack#28483)', () => {
  it('names the two routes the record page draws, and nothing else', () => {
    expect(isRecordPagePath(RECORD)).toBe(true);
    expect(isRecordPagePath(`${RECORD}/`)).toBe(true);
    expect(isRecordPagePath(`${RECORD}/page/print_sheet`)).toBe(true);
    for (const path of [
      '/apps/crm',
      '/apps/crm/crm_lead',
      '/apps/crm/crm_lead/view/all',
      `${RECORD}/edit`,
      '/apps/crm/crm_lead/new',
      '/apps/crm/crm_lead/record',
      '/apps/crm/page/home',
      '/organizations/acme',
    ]) {
      expect(isRecordPagePath(path), path).toBe(false);
    }
  });
});
