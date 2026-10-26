/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The approvals inbox's past-30-days date reads the DISPLAY locale, never the
 * UI language (objectui#10375).
 *
 * `formatRelative` answers in words up to 30 days ("3d ago") and with a date
 * past that. The date was `new Date(s).toLocaleDateString(language)`, with
 * `language` from `useObjectTranslation()`, so a regional display locale
 * (`de-CH` under an English UI) never reached it. It now takes the page's
 * `useDisplayLocale()` tag.
 *
 * The real `I18nProvider` runs with an ENGLISH UI in every case, and the
 * display locale is declared through `LocalizationProvider`, so the display
 * locale is the only thing that differs between the `de-CH` pin and the
 * `en-US` control. A page that still passed `language` renders the English
 * form under `de-CH` and goes red. `consoleFaces.displayLocale-9909.test.tsx`
 * could not see this: it stubs `useObjectTranslation` to `'en'` and declares
 * `en` as its control locale, so its two readings of this cell were equal.
 *
 * Each row is read from its queue cell, found by the cell's `title` tooltip:
 * that is `formatDate` in the display locale, a face this card does not touch.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

/** Noon UTC, so the calendar date is the same in every zone (the suite pins `TZ=UTC`). */
const { OLD, RECENT, approvalsApiStub, ADAPTER, AUTH } = vi.hoisted(() => {
  const OLD = '2020-03-04T12:00:00.000Z';
  // Three days before the page's clock, which it reads at mount: squarely in
  // the "Nd ago" bucket, far from both of its edges.
  const RECENT = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const row = (id: string, submittedAt: string): Record<string, unknown> => ({
    id,
    process_name: 'purchase_approval',
    process_label: 'Purchase Approval',
    object_name: 'showcase_purchase',
    object_label: 'Purchase',
    record_id: `po_${id}`,
    record_title: `PO ${id}`,
    status: 'pending',
    pending_approvers: ['u_1'],
    submitter_id: 'u_2',
    submitter_name: 'Sam Submitter',
    submitted_at: submittedAt,
  });
  const ROWS = [row('old', OLD), row('recent', RECENT)];
  const approvalsApiStub = {
    listRequests: async () => ({ data: ROWS, total: ROWS.length }),
    getRequest: async () => ({ data: ROWS[0] }),
    listActions: async () => ({ data: [] }),
    approve: async () => ({ data: ROWS[0], finalized: true }),
    reject: async () => ({ data: ROWS[0], finalized: true }),
  };
  const ADAPTER = {
    find: async () => ({ data: [{ id: 'po_old' }, { id: 'po_recent' }] }),
    getObjectSchema: async () => ({ fields: {} }),
  };
  const AUTH = { user: { id: 'u_1', email: 'approver@example.com' } };
  return { OLD, RECENT, approvalsApiStub, ADAPTER, AUTH };
});

vi.mock('@object-ui/auth', async (importOriginal) => {
  const authFetch = async () => new Response('{}', { status: 200 });
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    useAuth: () => AUTH,
    createAuthenticatedFetch: () => authFetch,
    TokenStorage: { get: () => null },
  };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  useMetadata: () => ({ objects: [] }),
  DeclaredActionsBar: () => null,
  isViaOverrideRow: () => false,
}));

vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { ApprovalsInboxPage } from './ApprovalsInboxPage';

afterEach(() => cleanup());

function permissions(): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_1',
    tenantId: 't_1',
    roles: [],
    permissionSets: [],
    objects: {},
    fields: {},
    systemPermissions: ['setup.access'],
  };
}

function renderInbox(locale: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <MePermissionsProvider initialPermissions={permissions()}>
          <MemoryRouter initialEntries={['/apps/app/system/approvals']}>
            <Routes>
              <Route path="/apps/:appName/system/approvals" element={<ApprovalsInboxPage />} />
            </Routes>
          </MemoryRouter>
        </MePermissionsProvider>
      </LocalizationProvider>
    </I18nProvider>,
  );
}

/** The queue cell for a row submitted at `submittedAt`, under `locale` as the display locale. */
async function queueCell(locale: string, submittedAt: string): Promise<string> {
  renderInbox(locale);
  await screen.findAllByText('PO old');
  const title = new Date(submittedAt).toLocaleString(locale);
  const cells = [...document.querySelectorAll('td[title]')].filter((el) => el.getAttribute('title') === title);
  expect(cells, `no queue cell titled ${title}`).toHaveLength(1);
  const text = (cells[0].textContent ?? '').trim();
  cleanup();
  return text;
}

describe('ApprovalsInboxPage — the past-30-days date follows the display locale (objectui#10375)', () => {
  it('formats as de-CH under an English UI with a de-CH display locale', async () => {
    const text = await queueCell('de-CH', OLD);
    expect(text, `got: ${text}`).toBe('4.3.2020');
    expect(text).toBe(new Date(OLD).toLocaleDateString('de-CH'));
  });

  it('control: formats as en-US under an en-US display locale', async () => {
    const text = await queueCell('en-US', OLD);
    expect(text, `got: ${text}`).toBe('3/4/2020');
    expect(text).toBe(new Date(OLD).toLocaleDateString('en-US'));
  });

  /** ⭐ THE PIN: no runner locale can make both readings equal. */
  it('is a reading of the session, not of the machine', async () => {
    expect(await queueCell('de-CH', OLD)).not.toBe(await queueCell('en-US', OLD));
  });

  it('every date the page formats receives the declared tag, never the machine locale', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await queueCell('de-CH', OLD);
    });
    const dates = calls.filter((c) => c.api === 'Date.prototype.toLocaleDateString');
    expect(dates.length, `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBeGreaterThan(0);
    expect(dates.every((c) => c.locale === 'de-CH'), `saw: ${JSON.stringify(dates)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });

  /**
   * The buckets up to 30 days are WORDS, so they stay on `tr` and the UI
   * language: a three-day-old request under an English UI reads the English
   * bucket even with a `de-CH` display locale — not a date, and not German.
   */
  it('leaves the relative buckets on the UI language', async () => {
    expect(await queueCell('de-CH', RECENT)).toBe('3d ago');
  });
});
