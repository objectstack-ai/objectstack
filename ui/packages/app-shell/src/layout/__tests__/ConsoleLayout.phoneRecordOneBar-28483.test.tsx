// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28483 (ruling letter A) — below 768 px a record route draws no
 * app bar: the record page's own top bar (「‹ <object plural>」, the stepper)
 * is the page's one bar, and the record's name shows once, as the header
 * title under it. The four doors (app menu, search, notifications, account)
 * stay on every other route, the object's list among them, one 「‹」 away.
 * From 768 px up no route draws the app bar (objectstack#36112).
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
// The layout's reach includes `import('@objectstack/lint')` (the draft
// preview bar's capability lint): pay that load during collection, not inside
// a clocked case (check:test-source-alias).
import '@objectstack/lint';

vi.mock('../../hooks/useAiSurface', () => ({
  useAiSurfaceEnabled: () => ({ enabled: false, isLoading: false }),
}));
vi.mock('../UnifiedSidebar', () => ({
  // `docsNav`: the body holds the docs' navigation instead of the app's menu
  // (objectstack#37150); the sidebar's own face is `UnifiedSidebar`'s suites'.
  UnifiedSidebar: ({ docsNav }: { docsNav?: boolean }) => (
    <nav aria-label="App menu" data-testid="sidebar-stub" data-docs-nav={docsNav ? 'true' : 'false'} />
  ),
}));
// The bar's own face is `PhoneAppNavBar.fixedTabs-35882`'s; here only where
// the layout mounts it, with the real route rule (`isPhoneTabRoute`).
vi.mock('../PhoneAppNavBar', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  PhoneAppNavBar: ({ basePath }: { basePath: string }) => (
    <nav data-testid="phone-app-nav-bar-stub" data-base-path={basePath} />
  ),
}));
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

import { ConsoleLayout, isAppDocsPath, isRecordPagePath } from '../ConsoleLayout';
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

  it('from 768 px up no route draws the app bar at all (objectstack#36112)', () => {
    for (const width of [768, 1440]) {
      mountAt(RECORD, width);
      expect(document.querySelectorAll('header'), `${width} px`).toHaveLength(0);
      expect(screen.queryByTestId('app-bar'), `${width} px`).toBeNull();
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

/**
 * objectstack#35882 — the phone's bottom bar (Home, Notifications, Approvals,
 * search) is mounted on the three pages it opens, the app's home, the inbox
 * list and the approvals inbox, and on no page below them: a list, a view, a
 * dashboard, a page, a record and a record form have the page to themselves.
 * While it is drawn the inset keeps its height free at the bottom. It replaces
 * objectstack#34594's bar of menu entries, which every app route but a record
 * and its forms drew.
 */
describe('the phone bottom bar is drawn on its three pages only (objectstack#35882)', () => {
  const bar = () => screen.queryByTestId('phone-app-nav-bar-stub');
  const insetKeepsBarFree = () =>
    screen.getByTestId('console-route').parentElement!.className.includes('!pb-[calc(3.5rem+env(safe-area-inset-bottom))]');

  it('at 375 px the app root, the inbox list and the approvals inbox draw it, and the inset keeps it free', () => {
    for (const path of ['/apps/crm', '/apps/crm/sys_inbox_message', '/apps/crm/system/approvals']) {
      mountAt(path, 375);
      expect(bar(), path).not.toBeNull();
      expect(insetKeepsBarFree(), path).toBe(true);
      cleanup();
    }
  });

  it('Home goes to this app\'s home', () => {
    mountAt('/apps/crm', 375);
    expect(bar()).toHaveAttribute('data-base-path', '/apps/crm');
  });

  it('at 375 px a list, a view, a dashboard, a page, a record page and both record forms draw none', () => {
    for (const path of [
      '/apps/crm/crm_lead',
      '/apps/crm/crm_lead/view/all',
      '/apps/crm/dashboard/sales',
      '/apps/crm/page/home',
      RECORD,
      `${RECORD}/page/print_sheet`,
      `${RECORD}/edit`,
      '/apps/crm/crm_lead/new',
    ]) {
      mountAt(path, 375);
      expect(bar(), path).toBeNull();
      expect(insetKeepsBarFree(), path).toBe(false);
      cleanup();
    }
  });

  it('CONTROL — at 768 px and 1440 px no route draws it, the app root included', () => {
    for (const width of [768, 1440]) {
      for (const path of ['/apps/crm', '/apps/crm/crm_lead']) {
        mountAt(path, width);
        expect(bar(), `${width} px ${path}`).toBeNull();
        expect(insetKeepsBarFree(), `${width} px ${path}`).toBe(false);
        cleanup();
      }
    }
  });
});

/**
 * objectstack#36792 — a scroll container's end padding scrolls only after its
 * in-flow content. While the bar is drawn the inset (the element that scrolls)
 * keeps the bar's height as end padding, so on the bar's home and approvals
 * pages, which grow with their content, the route slot grows with its page
 * (a one-track grid at least the inset's height): the slot is the inset's
 * in-flow content and the padding lands after the page's last row. A fixed
 * `h-full` slot there let a tall page overflow it, and the scroll ended at the
 * page's bottom, under the bar. The inbox list, an object list page that
 * bounds itself, keeps the fixed slot; so does every route without the bar.
 */
describe('a phone bar page\'s end inset scrolls with its content (objectstack#36792)', () => {
  const slot = () => screen.getByTestId('console-route');
  const slotGrows = () => {
    const c = slot().classList;
    return c.contains('grid') && c.contains('min-h-full') && c.contains('h-auto') && !c.contains('h-full');
  };
  const slotFixed = () => {
    const c = slot().classList;
    return c.contains('h-full') && !c.contains('min-h-full') && !c.contains('grid');
  };
  const scrollerPadsEnd = () => {
    const scroller = slot().parentElement!;
    return (
      scroller.classList.contains('overflow-y-auto') &&
      scroller.classList.contains('!pb-[calc(3.5rem+env(safe-area-inset-bottom))]')
    );
  };

  it('at 375 px the app home and the approvals inbox grow the slot inside the padded scroller', () => {
    for (const path of ['/apps/crm', '/apps/crm/', '/apps/crm/system/approvals']) {
      mountAt(path, 375);
      expect(slotGrows(), path).toBe(true);
      expect(scrollerPadsEnd(), path).toBe(true);
      // The track never widens the slot past the inset.
      expect(slot().classList.contains('grid-cols-[minmax(0,1fr)]'), path).toBe(true);
      cleanup();
    }
  });

  it('at 375 px the inbox list keeps the fixed slot: it bounds itself above the bar', () => {
    mountAt('/apps/crm/sys_inbox_message', 375);
    expect(slotFixed()).toBe(true);
    expect(scrollerPadsEnd()).toBe(true);
  });

  it('CONTROL — routes without the bar, and every route from 768 px up, keep the fixed slot', () => {
    for (const [path, width] of [
      ['/apps/crm/crm_lead', 375],
      [RECORD, 375],
      ['/apps/crm/page/home', 375],
      ['/apps/crm', 768],
      ['/apps/crm/system/approvals', 1440],
    ] as const) {
      mountAt(path, width);
      expect(slotFixed(), `${width} px ${path}`).toBe(true);
      cleanup();
    }
  });
});

describe('an app\'s docs pages draw in the app shell from 768 px up (objectstack#37150), and no app menu (objectstack#35424)', () => {
  const sidebar = () => screen.queryByTestId('sidebar-stub');
  const DOCS_PATHS = [
    '/apps/crm/docs',
    '/apps/crm/docs/',
    '/apps/crm/docs/crm_manual',
    '/apps/crm/docs/crm_quotes',
    '/apps/crm/docs/crm_manual/crm_quotes',
  ];

  it('at 768 px and 1440 px a docs index, a book, a flat permalink and an article draw the sidebar, its body the docs\' navigation, and no top bar', () => {
    for (const width of [768, 1440]) {
      for (const path of DOCS_PATHS) {
        mountAt(path, width);
        expect(sidebar(), `${width} px ${path}`).not.toBeNull();
        expect(sidebar(), `${width} px ${path}`).toHaveAttribute('data-docs-nav', 'true');
        expect(document.querySelectorAll('header'), `${width} px ${path}`).toHaveLength(0);
        expect(screen.queryByTestId('app-bar'), `${width} px ${path}`).toBeNull();
        cleanup();
      }
    }
  });

  it('PHONE CONTROL — at 390 px a docs page is unchanged: no sidebar, and the app bar', () => {
    for (const path of DOCS_PATHS) {
      mountAt(path, 390);
      expect(sidebar(), path).toBeNull();
      expect(document.querySelectorAll('header'), path).toHaveLength(1);
      expect(screen.getByTestId('app-bar'), path).toBeInTheDocument();
      cleanup();
    }
  });

  it('control: every other app route keeps the app menu in the sidebar\'s body', () => {
    for (const width of [390, 1440]) {
      for (const path of ['/apps/crm', '/apps/crm/crm_lead', '/apps/crm/dashboard/sales', '/apps/crm/docsearch']) {
        mountAt(path, width);
        expect(sidebar(), `${width} px ${path}`).toHaveAttribute('data-docs-nav', 'false');
        cleanup();
      }
    }
  });

  it('isAppDocsPath names the docs tree under an app and nothing else', () => {
    for (const path of ['/apps/crm/docs', '/apps/crm/docs/', '/apps/crm/docs/manual/intro']) {
      expect(isAppDocsPath(path), path).toBe(true);
    }
    for (const path of ['/docs', '/docs/manual/intro', '/apps/crm', '/apps/crm/docsearch', '/apps/crm/crm_lead/docs']) {
      expect(isAppDocsPath(path), path).toBe(false);
    }
  });
});
