// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27356 (row 11) — an app's report index with nothing to list
 * (Setup → All reports, "This app has no reports you can open.") points the
 * reader at the apps whose index has a report for them, each linking to that
 * app's own index.
 *
 * Pinned through the real `MetadataProvider` (a fake adapter answers
 * `/meta/:type`), the real `MePermissionsProvider`, `ExpressionProvider` and
 * `I18nProvider` in `en`, the harness of `AppReportIndex-13020`:
 *
 *  - an app that ships a report the member may read is offered;
 *  - an app whose only report reads an object the member may not read, an app
 *    that ships no report, and the current app are not;
 *  - CONTROL: an index that lists reports draws no such links.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_admin' }, activeOrganization: null }),
}));

import { MetadataProvider } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { AppReportIndexView } from '../AppReportIndexView';

const SETUP_APP = { name: 'setup', label: 'Setup', active: true, _packageId: 'com.objectstack.setup', navigation: [] };
const CRM_APP = { name: 'crm', label: 'CRM', active: true, _packageId: 'com.example.crm', navigation: [] };
const HR_APP = { name: 'hr', label: 'People', active: true, _packageId: 'com.example.hr', navigation: [] };
const EMPTY_APP = { name: 'notes', label: 'Notes', active: true, _packageId: 'com.example.notes', navigation: [] };

const REPORTS = [
  { name: 'crm_win_rate', label: 'Win Rate', dataset: 'ds_accounts', _packageId: 'com.example.crm' },
  { name: 'hr_salaries', label: 'Salaries', dataset: 'ds_salaries', _packageId: 'com.example.hr' },
];

const DATASETS = [
  { name: 'ds_accounts', object: 'crm_account' },
  { name: 'ds_salaries', object: 'hr_salary' },
];

const ANSWER: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u_admin',
  tenantId: null,
  positions: [],
  hasAnyQueue: false,
  permissionSets: ['admin'],
  systemPermissions: [],
  objects: {
    crm_account: { allowRead: true },
    hr_salary: { allowRead: false },
  },
  fields: {},
};

function adapterFor(apps: unknown[]) {
  const items: Record<string, unknown[]> = { app: apps, report: REPORTS, dataset: DATASETS };
  return {
    clearCache: vi.fn(),
    getObjectSchema: () => Promise.resolve(null),
    getClient: () => ({
      meta: {
        getItems: (type: string) => Promise.resolve({ type, items: items[type] ?? [] }),
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function renderIndex(current: any) {
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ANSWER }) as unknown as Response);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher as unknown as typeof fetch}>
        <MetadataProvider adapter={adapterFor([SETUP_APP, CRM_APP, HR_APP, EMPTY_APP])}>
          <ExpressionProvider app={current}>
            <MemoryRouter initialEntries={[`/apps/${current.name}/reports`]}>
              <Routes>
                <Route path="/apps/:appName/reports" element={<AppReportIndexView />} />
              </Routes>
            </MemoryRouter>
          </ExpressionProvider>
        </MetadataProvider>
      </MePermissionsProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('an empty report index points at the apps that have reports (objectstack#27356 row 11)', () => {
  it('offers the apps whose index has a report for this reader, each linking to its index', async () => {
    renderIndex(SETUP_APP);
    expect(await screen.findByText('This app has no reports you can open.')).toBeInTheDocument();
    const nav = await screen.findByTestId('report-index-other-apps');
    expect(within(nav).getByText('Reports in your other apps:')).toBeInTheDocument();
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(['CRM']);
    expect(links[0]).toHaveAttribute('href', '/apps/com.example.crm/reports');
    // Not an app whose only report the reader may not read, one with none, or this one.
    expect(within(nav).queryByText('People')).toBeNull();
    expect(within(nav).queryByText('Notes')).toBeNull();
    expect(within(nav).queryByText('Setup')).toBeNull();
  });

  it('CONTROL: an index that lists reports draws no links to other apps', async () => {
    renderIndex(CRM_APP);
    expect(await screen.findByRole('link', { name: /Win Rate/ })).toBeInTheDocument();
    expect(screen.queryByTestId('report-index-other-apps')).toBeNull();
  });
});
