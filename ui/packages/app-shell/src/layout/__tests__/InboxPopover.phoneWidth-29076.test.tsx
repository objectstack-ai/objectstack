// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inbox fits a phone and its controls are tappable there (objectstack#29076).
 *
 * The mobile app hosts the Console, so below `md` this popover is a phone UI.
 * Measured on a 375 px viewport, the popover was `w-96` (384 px) and lost its
 * right 9 px, and its own controls were 16–36 px tall. These pin the two
 * rules: the popover is capped at the viewport less a gutter, and every
 * control the popover draws besides the rows (which are tall by content)
 * carries the phone tap floor.
 *
 * jsdom has no layout, so these read the classes that carry the rule; the
 * pixel reading is the run record on the card.
 *
 * Nothing is mocked: the real Radix popover and tabs, router and i18n pack.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

import { InboxPopover, type InboxNotification } from '../InboxPopover';
import type { ActivityItem } from '../ActivityFeed';

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const PHONE_TAP = 'max-md:min-h-11';

const notifications: InboxNotification[] = [
  { id: 'n1', type: 'task.assigned', title: 'Task assigned', is_read: false, created_at: '2026-10-01T10:00:00Z' },
  { id: 'n2', type: 'task.assigned', title: 'Task assigned', is_read: false, created_at: '2026-10-01T10:01:00Z' },
  { id: 'n3', type: 'lead.assigned', title: 'Lead assigned', is_read: false, created_at: '2026-10-01T10:02:00Z' },
];

const activities: ActivityItem[] = [
  { id: 'a1', type: 'update', objectName: 'account', user: 'Priya', description: 'updated a record', timestamp: '2026-10-01T10:00:00Z' },
];

function bell(pendingApprovalsCount: number) {
  return (
    <MemoryRouter>
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <InboxPopover
          notifications={notifications}
          unreadCount={notifications.length}
          pendingApprovalsCount={pendingApprovalsCount}
          activity={{ value: activities, status: 'ready', readable: true }}
          onMarkAllRead={() => {}}
          onMarkRead={() => {}}
        />
      </I18nProvider>
    </MemoryRouter>
  );
}

function openInbox() {
  fireEvent.click(screen.getByRole('button', { name: 'Open inbox' }));
  return screen.getByRole('dialog');
}

function choose(dialog: HTMLElement, name: RegExp) {
  act(() => {
    fireEvent.mouseDown(within(dialog).getByRole('tab', { name }), { button: 0, ctrlKey: false });
  });
}

describe('InboxPopover at phone width (objectstack#29076)', () => {
  it('is never wider than the viewport less a 0.5 rem gutter on each side', () => {
    render(bell(0));
    const dialog = openInbox();
    expect(dialog.className).toContain('max-w-[calc(100vw-1rem)]');
    // the desktop width stays
    expect(dialog.className).toContain('w-96');
  });

  it('gives the Notifications tab controls the 44 px phone floor', () => {
    render(bell(0));
    const dialog = openInbox();
    for (const name of [/^Mark all read$/, /^Unread/, /^All$/, /^View all notifications$/]) {
      expect(within(dialog).getByRole('button', { name }).className, String(name)).toContain(PHONE_TAP);
    }
    // "All" is one short word: it is 44 px wide only because of its own floor
    expect(within(dialog).getByRole('button', { name: /^All$/ }).className).toContain('max-md:min-w-11');
  });

  it('gives all three tabs the floor and drops their icons below md so they share the strip', () => {
    render(bell(2));
    const dialog = openInbox();
    const tabs = within(dialog).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    for (const tab of tabs) {
      expect(tab.className).toContain(PHONE_TAP);
      const icon = tab.querySelector('svg');
      expect(icon?.getAttribute('class')).toContain('max-md:hidden');
    }
  });

  it('gives the Approvals tab button, in both of its states, the floor', () => {
    render(bell(2));
    let dialog = openInbox();
    choose(dialog, /Approvals/);
    expect(within(dialog).getByRole('button', { name: 'View approvals' }).className).toContain(PHONE_TAP);
    cleanup();

    render(bell(0));
    dialog = openInbox();
    choose(dialog, /Approvals/);
    expect(within(dialog).getByRole('button', { name: 'Open Approvals Inbox' }).className).toContain(PHONE_TAP);
  });

  it('gives the Activity footer the floor', () => {
    render(bell(0));
    const dialog = openInbox();
    choose(dialog, /Activity/);
    expect(within(dialog).getByRole('button', { name: 'View all activity' }).className).toContain(PHONE_TAP);
  });
});
