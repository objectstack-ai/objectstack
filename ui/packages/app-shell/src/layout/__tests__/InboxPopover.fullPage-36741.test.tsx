// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * From 768 px up the sidebar's bell opens the full-page inbox, not the
 * right-hand panel (objectstack#36741). What these pin:
 *  - at desktop width a bell that opens the page navigates to the current
 *    app's inbox (a push, so Back returns) and draws no panel;
 *  - the badge and the accessible name are the panel bell's, unchanged;
 *  - on the inbox page the bell is marked as the current page;
 *  - a page with unsaved edits asks first (the existing leave guard);
 *  - a phone keeps the panel, and so does a host that does not ask for the page.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { InboxPopover, type InboxNotification } from '../InboxPopover';
import { registerUnsavedEdits } from '../../chrome/unsavedEdits';

const notifications: InboxNotification[] = [
  { id: 'n1', type: 'task.assigned', title: 'Task assigned', is_read: false, created_at: '2026-10-01T10:00:00Z' },
];

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function bell(path: string, props: Partial<React.ComponentProps<typeof InboxPopover>> = {}) {
  const popover = (
    <InboxPopover
      notifications={notifications}
      unreadCount={1}
      pendingApprovalsCount={2}
      activity={{ value: [], status: 'ready', readable: true }}
      onMarkAllRead={() => {}}
      onMarkRead={() => {}}
      opensPageOnDesktop
      {...props}
    />
  );
  return (
    <MemoryRouter initialEntries={[path]}>
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <LocationProbe />
        <Routes>
          <Route path="/apps/:appName/*" element={popover} />
        </Routes>
      </I18nProvider>
    </MemoryRouter>
  );
}

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event('resize'));
}

const bellButton = () => screen.getByRole('button', { name: /^Notifications(,|$)/ });

beforeEach(() => setViewport(1280));
afterEach(() => {
  cleanup();
  setViewport(1024);
  vi.restoreAllMocks();
});

describe('InboxPopover — the desktop bell opens the full-page inbox (objectstack#36741)', () => {
  it('goes to the current app’s inbox page and opens no panel', () => {
    render(bell('/apps/crm/account'));
    expect(bellButton().getAttribute('data-testid')).toBe('inbox-bell-page-link');
    fireEvent.click(bellButton());
    expect(screen.getByTestId('location').textContent).toBe('/apps/crm/inbox');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByTestId('inbox-panel')).toBeNull();
  });

  it('keeps the badge and the name that spells it out', () => {
    render(bell('/apps/crm/account'));
    expect(screen.getByTestId('inbox-bell-badge').textContent).toBe('3');
    expect(bellButton().getAttribute('aria-label')).toBe('Notifications, 1 unread topic, 2 pending approvals');
  });

  it('is marked as the current page on the inbox, and stays there when pressed', () => {
    render(bell('/apps/crm/inbox/approvals?item=r1'));
    expect(bellButton().getAttribute('aria-current')).toBe('page');
    fireEvent.click(bellButton());
    expect(screen.getByTestId('location').textContent).toBe('/apps/crm/inbox/approvals?item=r1');
  });

  it('asks before leaving a page with unsaved edits, and stays on Cancel', () => {
    const release = registerUnsavedEdits('You have unsaved changes.');
    const confirm = vi.fn(() => false);
    Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirm });
    try {
      render(bell('/apps/crm/account/record/a1'));
      fireEvent.click(bellButton());
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('location').textContent).toBe('/apps/crm/account/record/a1');
    } finally {
      release();
    }
  });

  it('keeps the panel on a phone', () => {
    setViewport(375);
    render(bell('/apps/crm/account'));
    fireEvent.click(bellButton());
    expect(screen.getByTestId('inbox-panel')).toBeTruthy();
    expect(screen.getByTestId('location').textContent).toBe('/apps/crm/account');
  });

  it('keeps the panel at desktop width for a host that does not ask for the page', () => {
    render(bell('/apps/crm/account', { opensPageOnDesktop: false }));
    fireEvent.click(bellButton());
    expect(screen.getByTestId('inbox-panel')).toBeTruthy();
  });
});
