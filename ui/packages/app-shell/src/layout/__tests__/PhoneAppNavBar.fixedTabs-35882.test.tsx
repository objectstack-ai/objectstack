// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35882 — the phone's bottom bar is three fixed cells, Home,
 * Notifications and Approvals, and a round search button. They do not follow
 * the app and are not configured: Home opens the app's home (its menu,
 * objectstack#35881), Notifications the full-page inbox the bell's 「View all」
 * opens, Approvals the approvals inbox, both under the app the bell hosts them
 * under, and search the command palette. The badges are the bell's two
 * addends. `phoneTabOf` names the three pages, the only ones that draw the bar
 * (`ConsoleLayout.phoneRecordOneBar-28483` pins the mount).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
    language: 'en',
  }),
}));

const feeds = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
  pendingApprovalsCount: 0,
}));
vi.mock('../../hooks/useInboxBell', () => ({
  useInboxBell: () => ({
    notifications: feeds.notifications,
    pendingApprovalsCount: feeds.pendingApprovalsCount,
  }),
}));

const APPS = [
  { name: 'sales', _packageId: 'com.acme.sales', active: true },
  { name: 'service', _packageId: 'com.acme.service', active: true },
];
vi.mock('../../providers/MetadataProvider', () => ({ useMetadata: () => ({ apps: APPS }) }));

const openCommandPalette = vi.fn();
vi.mock('../../context/CommandPaletteProvider', () => ({
  useCommandPalette: () => ({ openCommandPalette }),
}));

import { PhoneAppNavBar, isPhoneTabRoute, phoneTabOf } from '../PhoneAppNavBar';

function renderBar(path: string, basePath = '/apps/com.acme.sales', activeAppName = 'sales') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PhoneAppNavBar basePath={basePath} activeAppName={activeAppName} />
    </MemoryRouter>,
  );
}

function cells() {
  return within(screen.getByTestId('phone-app-nav-bar')).getAllByTestId('phone-app-nav-cell');
}

afterEach(() => {
  cleanup();
  feeds.notifications = [];
  feeds.pendingApprovalsCount = 0;
  openCommandPalette.mockReset();
});

describe('phoneTabOf names the three pages the bar opens, and nothing else', () => {
  it('the app root, the inbox list and the approvals inbox', () => {
    expect(phoneTabOf('/apps/com.acme.sales')).toBe('home');
    expect(phoneTabOf('/apps/com.acme.sales/')).toBe('home');
    expect(phoneTabOf('/apps/com.acme.sales/sys_inbox_message')).toBe('notifications');
    expect(phoneTabOf('/apps/com.acme.sales/system/approvals')).toBe('approvals');
  });

  it('CONTROL — a list, a view, a record, a form, a dashboard, a page and every non-app route are none of them', () => {
    for (const path of [
      '/apps/com.acme.sales/account',
      '/apps/com.acme.sales/account/view/all',
      '/apps/com.acme.sales/account/record/a1b2c3d4',
      '/apps/com.acme.sales/account/new',
      '/apps/com.acme.sales/sys_inbox_message/record/m1m2m3m4',
      '/apps/com.acme.sales/dashboard/pipeline',
      '/apps/com.acme.sales/page/home',
      '/apps/com.acme.sales/system/settings',
      '/home',
      '/apps',
    ]) {
      expect(phoneTabOf(path), path).toBeNull();
      expect(isPhoneTabRoute(path), path).toBe(false);
    }
  });
});

describe('the bar is Home, Notifications, Approvals and search (objectstack#35882)', () => {
  it('three cells in that order, each to its page, and no menu entry or 「More」', () => {
    renderBar('/apps/com.acme.sales');
    expect(cells().map((cell) => cell.textContent)).toEqual(['Home', 'Notifications', 'Approvals']);
    expect(cells().map((cell) => cell.getAttribute('href'))).toEqual([
      '/apps/com.acme.sales',
      '/apps/com.acme.sales/sys_inbox_message?view=mine',
      '/apps/com.acme.sales/system/approvals',
    ]);
    expect(screen.queryByTestId('phone-app-nav-more')).toBeNull();
  });

  it('the cell for the page in view is lit, and only it', () => {
    for (const [path, tab] of [
      ['/apps/com.acme.sales', 'home'],
      ['/apps/com.acme.sales/sys_inbox_message', 'notifications'],
      ['/apps/com.acme.sales/system/approvals', 'approvals'],
    ] as const) {
      renderBar(path);
      const lit = cells().filter((cell) => cell.getAttribute('aria-current') === 'page');
      expect(lit.map((cell) => cell.dataset.tab), path).toEqual([tab]);
      cleanup();
    }
  });

  it('another app keeps the same three cells; only Home follows it', () => {
    renderBar('/apps/com.acme.service', '/apps/com.acme.service', 'service');
    expect(cells().map((cell) => cell.textContent)).toEqual(['Home', 'Notifications', 'Approvals']);
    expect(cells()[0]).toHaveAttribute('href', '/apps/com.acme.service');
    expect(cells()[2]).toHaveAttribute('href', '/apps/com.acme.service/system/approvals');
  });

  it('search opens the command palette', () => {
    renderBar('/apps/com.acme.sales');
    fireEvent.click(screen.getByTestId('phone-app-nav-search'));
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('badges: unread topics on Notifications, pending approvals on Approvals, capped at 9+', () => {
    feeds.notifications = [
      // Two rows of one topic and title are one topic: the bell counts 2.
      { id: 'n1', type: 'mention', title: 'A', is_read: false },
      { id: 'n2', type: 'mention', title: 'A', is_read: false },
      { id: 'n3', type: 'digest', title: 'B', is_read: false },
      { id: 'n4', type: 'digest', title: 'C', is_read: true },
    ];
    feeds.pendingApprovalsCount = 12;
    renderBar('/apps/com.acme.sales');
    const [home, notifications, approvals] = cells();
    expect(within(home).queryByTestId('phone-app-nav-badge')).toBeNull();
    expect(within(approvals).getByTestId('phone-app-nav-badge')).toHaveTextContent('9+');
    expect(within(notifications).getByTestId('phone-app-nav-badge')).toHaveTextContent(/^2$/);
  });

  it('CONTROL — nothing waiting draws no badge', () => {
    renderBar('/apps/com.acme.sales');
    expect(screen.queryByTestId('phone-app-nav-badge')).toBeNull();
  });
});
