// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bell's Activity rows name their object by its LABEL in the reader's
 * language, not by its API name (objectui#12212).
 *
 * The row's second line printed `sys_activity.object_name` as stored, so the
 * 2026-10-12 staging walk read `Updated User Preference "ui.recent"` over
 * `… · sys_user_preference`, and a lead row `… · crm_lead`. The console now
 * resolves the name against the object definitions it already caches
 * (`useMetadata().objects`) and the object translation bundle
 * (`{ns}.objects.<name>.label`); the API name is shown only when neither names
 * the object. The row's summary is server text and is rendered as it came.
 *
 * Real `InboxPopover`, real Radix popover and tabs, real `I18nProvider`; the
 * metadata is a fixed `MetadataCtx` value whose `objects` read is counted.
 *
 * Direction, written before the run: with the row put back on
 * `{a.objectName}`, the three label cells and the "read once a row is on
 * screen" cell go RED (the API name shows; `objects` is never read); the
 * fallback, the summary and the "closed bell reads nothing" cells stay GREEN.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

import { InboxPopover } from '../InboxPopover';
import type { ActivityItem } from '../ActivityFeed';

type Lang = 'en' | 'zh-CN';

const AT = '2026-10-12T08:00:00.000Z';

/** The summaries are what plugin-audit writes: server text, already in the object's label. */
const LEAD_SUMMARY = 'Updated Lead "Acme"';
const PREF_SUMMARY = 'Updated User Preference "ui.recent"';
const GONE_SUMMARY = 'Deleted Archive "2025"';

function activities(): ActivityItem[] {
  return [
    { id: 'a1', type: 'update', objectName: 'crm_lead', user: 'Priya', description: LEAD_SUMMARY, timestamp: AT },
    { id: 'a2', type: 'update', objectName: 'sys_user_preference', user: 'Priya', description: PREF_SUMMARY, timestamp: AT },
    // An object the cached list does not hold and no bundle names.
    { id: 'a3', type: 'delete', objectName: 'crm_gone', user: 'Priya', description: GONE_SUMMARY, timestamp: AT },
  ];
}

/** How many times the popover tree read `objects` — reading it is what loads the type. */
let objectReads = 0;

function metadata() {
  return {
    apps: [],
    get objects() {
      objectReads += 1;
      return [
        { name: 'crm_lead', label: 'Lead' },
        { name: 'sys_user_preference', label: 'User Preference' },
      ];
    },
    dashboards: [],
    reports: [],
    pages: [],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

function renderBell(lang: Lang) {
  const i18n = createI18n({
    defaultLanguage: lang,
    detectBrowserLanguage: false,
    resources: { 'zh-CN': { crm: { objects: { crm_lead: { label: '线索' } } } } },
  });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  render(
    <MemoryRouter>
      <I18nProvider instance={i18n} persistLanguage={false}>
        <MetadataCtx.Provider value={metadata() as never}>
          <InboxPopover
            notifications={[]}
            unreadCount={0}
            pendingApprovalsCount={0}
            activity={{ value: activities(), status: 'ready', readable: true }}
            onMarkAllRead={() => {}}
            onMarkRead={() => {}}
          />
        </MetadataCtx.Provider>
      </I18nProvider>
    </MemoryRouter>,
  );
}

/** Open the bell and select the Activity tab — the last trigger, in either language. */
function openActivity() {
  fireEvent.click(screen.getAllByRole('button')[0]);
  const tabs = screen.getAllByRole('tab');
  // Radix tabs activate on a primary-button mouse down.
  act(() => {
    fireEvent.mouseDown(tabs[tabs.length - 1], { button: 0, ctrlKey: false });
  });
}

/** What a row's second line names after the relative time, found by the row's summary. */
function objectShownFor(summary: string): string {
  const row = screen.getByText(summary).closest('li');
  const subtitle = row?.lastElementChild?.textContent ?? '';
  const at = subtitle.indexOf(' · ');
  expect(at, `no " · " in the subtitle: ${subtitle}`).toBeGreaterThan(-1);
  return subtitle.slice(at + 3);
}

beforeEach(() => {
  objectReads = 0;
  window.sessionStorage.clear();
});

afterEach(cleanup);

describe('InboxPopover — an Activity row names its object by its label (objectui#12212)', () => {
  it('en: a business object is named by its label, not its API name', () => {
    renderBell('en');
    openActivity();
    expect(objectShownFor(LEAD_SUMMARY)).toBe('Lead');
  });

  it('en: a system object is named by its label (the staging row)', () => {
    renderBell('en');
    openActivity();
    expect(objectShownFor(PREF_SUMMARY)).toBe('User Preference');
  });

  it('zh-CN: the label comes from the object translation bundle', () => {
    renderBell('zh-CN');
    openActivity();
    expect(objectShownFor(LEAD_SUMMARY)).toBe('线索');
  });

  it('fallback: an object no definition or bundle names shows its API name', () => {
    renderBell('en');
    openActivity();
    expect(objectShownFor(GONE_SUMMARY)).toBe('crm_gone');
  });

  it('the summary is rendered as the server wrote it, in either language', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      renderBell(lang);
      openActivity();
      for (const summary of [LEAD_SUMMARY, PREF_SUMMARY, GONE_SUMMARY]) {
        expect(screen.getByText(summary).textContent, `${lang}: ${summary}`).toBe(summary);
      }
      cleanup();
    }
  });

  it('a closed bell reads no object list; the Activity rows read it once they are on screen', () => {
    renderBell('en');
    expect(objectReads, 'read while the bell is closed').toBe(0);
    openActivity();
    expect(objectReads, 'never read with the Activity rows on screen').toBeGreaterThan(0);
  });
});
