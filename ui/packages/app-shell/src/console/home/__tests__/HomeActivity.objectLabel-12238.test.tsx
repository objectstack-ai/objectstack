/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Home's activity card names each row's object by its LABEL in the reader's
 * language, not by its API name (objectui#12238).
 *
 * The row's second line printed `sys_activity.object_name` as stored, so a lead
 * row read `3 hours ago · crm_lead` beside a summary that already used the
 * object's label. objectui#12212 fixed the same rendering in the bell's
 * Activity tab with `ActivityObjectLabel`; Home now renders that one component
 * for the same row, so the two surfaces resolve the name one way: the cached
 * object definitions (`useMetadata().objects`), then the object translation
 * bundle (`{ns}.objects.<name>.label`), and the API name only when neither
 * names the object. The row's summary is server text and is rendered as it came.
 *
 * Real `HomeActivity`, real `I18nProvider`; the metadata is a fixed
 * `MetadataCtx` value whose `objects` read is counted — the shape of the bell's
 * pin, `InboxPopover.activityObjectLabel-12212.test.tsx`.
 *
 * Direction, written before the run: with the row put back on
 * `{a.objectName}`, the two label cells and the "read once a row is on screen"
 * cell go RED (the API name shows; `objects` is never read); the fallback, the
 * summary and the "no row reads nothing" cells stay GREEN.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MetadataCtx } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

import { HomeActivity } from '../HomeRail';
import type { ActivityFeedReading } from '../../../hooks/sharedUserFeeds';

type Lang = 'en' | 'zh-CN';

const AT = '2026-10-12T08:00:00.000Z';

/** The summaries are what plugin-audit writes: server text, already in the object's label. */
const LEAD_SUMMARY = 'Updated Lead "Acme"';
const GONE_SUMMARY = 'Deleted Archive "2025"';

const t = (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key);

function rows(): ActivityFeedReading['value'] {
  return [
    { id: 'a1', type: 'update', objectName: 'crm_lead', user: 'Priya', description: LEAD_SUMMARY, timestamp: AT },
    // An object the cached list does not hold and no bundle names.
    { id: 'a2', type: 'delete', objectName: 'crm_gone', user: 'Priya', description: GONE_SUMMARY, timestamp: AT },
  ];
}

/** How many times the card read `objects` — reading it is what loads the type. */
let objectReads = 0;

function metadata() {
  return {
    apps: [],
    get objects() {
      objectReads += 1;
      return [{ name: 'crm_lead', label: 'Lead' }];
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

function renderCard(lang: Lang, value: ActivityFeedReading['value'] = rows()) {
  const i18n = createI18n({
    defaultLanguage: lang,
    detectBrowserLanguage: false,
    resources: { 'zh-CN': { crm: { objects: { crm_lead: { label: '线索' } } } } },
  });
  // The instance really booted in the language under test.
  expect(i18n.language).toBe(lang);
  render(
    <I18nProvider instance={i18n} persistLanguage={false}>
      <MetadataCtx.Provider value={metadata() as never}>
        <HomeActivity activity={{ value, status: 'ready', readable: true }} onViewAll={vi.fn()} t={t} />
      </MetadataCtx.Provider>
    </I18nProvider>,
  );
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
});

afterEach(cleanup);

describe("Home's activity card names a row's object by its label (objectui#12238)", () => {
  it('en: a business object is named by its label, not its API name', () => {
    renderCard('en');
    expect(objectShownFor(LEAD_SUMMARY)).toBe('Lead');
  });

  it('zh-CN: the label comes from the object translation bundle', () => {
    renderCard('zh-CN');
    expect(objectShownFor(LEAD_SUMMARY)).toBe('线索');
  });

  it('fallback: an object no definition or bundle names shows its API name', () => {
    renderCard('en');
    expect(objectShownFor(GONE_SUMMARY)).toBe('crm_gone');
  });

  it('the summary is rendered as the server wrote it, in either language', () => {
    for (const lang of ['en', 'zh-CN'] as const) {
      renderCard(lang);
      for (const summary of [LEAD_SUMMARY, GONE_SUMMARY]) {
        expect(screen.getByText(summary).textContent, `${lang}: ${summary}`).toBe(summary);
      }
      cleanup();
    }
  });

  it('a card with no row reads no object list; a card with rows reads it', () => {
    renderCard('en', []);
    expect(screen.getByText('No recent activity')).toBeInTheDocument();
    expect(objectReads, 'read with no row on screen').toBe(0);
    cleanup();
    renderCard('en');
    expect(objectReads, 'never read with rows on screen').toBeGreaterThan(0);
  });
});
