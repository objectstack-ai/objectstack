// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bell's relative timestamps read the DISPLAY locale, never the UI
 * language (objectui#10668).
 *
 * `InboxPopover` handed `useObjectTranslation().language` to `timeAgo`, which
 * formats through `Intl.RelativeTimeFormat`, at all three of its timestamps: a
 * single notification row, a coalesced group's latest time, and an activity
 * row. So a regional display locale (`de-CH` under an English UI) never
 * reached them, while the relative-time faces beside them (the Marketplace's,
 * objectui#10331; Studio home's visit times, objectui#10232) already read
 * `useDisplayLocale()`. The popover now reads `useDisplayLocale()`.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control. Nothing is mocked: the popover, its tabs, the router and
 * the provider-safe navigation and metadata hooks are all the real ones.
 */

import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArguments } from '@object-ui/test-support';

import { InboxPopover, type InboxNotification } from '../InboxPopover';
import type { ActivityItem } from '../ActivityFeed';

afterEach(cleanup);

/** Three days ago: `timeAgo` rounds it to exactly -3 days. */
const threeDaysAgo = () => new Date(Date.now() - 3 * 86_400_000).toISOString();

function notifications(): InboxNotification[] {
  const at = threeDaysAgo();
  return [
    // A group of one renders as a plain row.
    { id: 'n1', type: 'collab.assignment', title: 'Assigned to you', is_read: false, created_at: at },
    // Two of one topic coalesce into a group row carrying its latest time.
    { id: 'n2', type: 'project.digest', title: 'Weekly digest', is_read: false, created_at: at },
    { id: 'n3', type: 'project.digest', title: 'Weekly digest', is_read: false, created_at: at },
  ];
}

function activities(): ActivityItem[] {
  return [
    {
      id: 'a1',
      type: 'update',
      objectName: 'account',
      user: 'Priya',
      description: 'updated Northwind',
      timestamp: threeDaysAgo(),
    },
  ];
}

function popoverUnder(locale: string) {
  return (
    <MemoryRouter>
      <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
        <LocalizationProvider value={{ locale }}>
          <InboxPopover
            notifications={notifications()}
            unreadCount={3}
            pendingApprovalsCount={0}
            activity={{ value: activities(), status: 'ready', readable: true }}
            onMarkAllRead={() => {}}
            onMarkRead={() => {}}
          />
        </LocalizationProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

/** Open the bell, then read the Notifications tab and the Activity tab. */
function openAndRead(): { notificationsTab: string; activityTab: string } {
  const [bell] = screen.getAllByRole('button');
  fireEvent.click(bell);
  // Radix tabs activate on a primary-button mouse down. Both tabs are selected
  // explicitly: the tab the bell opens on follows the counts and the user's
  // last pick in this browser-tab session (objectui#11698), and an earlier
  // case's pick of Activity is still in sessionStorage.
  const select = (name: RegExp) =>
    act(() => {
      fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0, ctrlKey: false });
    });
  select(/notifications/i);
  const notificationsTab = screen.getByRole('dialog').textContent ?? '';
  select(/activity/i);
  const activityTab = screen.getByRole('dialog').textContent ?? '';
  return { notificationsTab, activityTab };
}

/** The RAW text of each tab: expectations are built by the cases, never in here. */
function facesUnder(locale: string) {
  render(popoverUnder(locale));
  const faces = openAndRead();
  cleanup();
  return faces;
}

const threeDaysIn = (locale: string) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-3, 'day');

describe('InboxPopover — relative timestamps follow the display locale (objectui#10668)', () => {
  it('reads de-CH under an English UI with a de-CH display locale, at all three timestamps', () => {
    expect(threeDaysIn('de-CH')).toBe('vor 3 Tagen');
    const faces = facesUnder('de-CH');
    // The single row and the group row.
    expect(count(faces.notificationsTab, 'vor 3 Tagen'), `got: ${faces.notificationsTab}`).toBe(2);
    // The activity row.
    expect(count(faces.activityTab, 'vor 3 Tagen'), `got: ${faces.activityTab}`).toBe(1);
  });

  it('control: reads en-US under an en-US display locale', () => {
    expect(threeDaysIn('en-US')).toBe('3 days ago');
    const faces = facesUnder('en-US');
    expect(count(faces.notificationsTab, '3 days ago'), `got: ${faces.notificationsTab}`).toBe(2);
    expect(count(faces.activityTab, '3 days ago'), `got: ${faces.activityTab}`).toBe(1);
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', () => {
    const de = facesUnder('de-CH');
    const en = facesUnder('en-US');
    expect(de.notificationsTab).not.toBe(en.notificationsTab);
    expect(de.activityTab).not.toBe(en.activityTab);
  });

  it('every locale-taking call receives the declared tag', () => {
    render(popoverUnder('de-CH'));
    const calls = recordLocaleArguments(() => {
      openAndRead();
    });
    cleanup();
    expect(calls.some((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(calls)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
    expect(calls.filter((c) => c.locale === 'en'), 'these call sites formatted in the UI language').toEqual([]);
  });
});
