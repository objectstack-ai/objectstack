// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack-ai/objectstack#29024 — the empty report index's "Reports in your
 * other apps" links open the app they name, a package's second app included.
 *
 * `/apps/PACKAGE_ID` resolves to the package's FIRST app, so a link keyed on
 * the package id opened CRM for "CRM Service". Each link now carries the app's
 * one address (`appAddressSegment`): the package id where it resolves back to
 * the app, else the app's name.
 *
 * The harness is `AppReportIndex.otherApps-27356.test.tsx`'s, with a second
 * app in CRM's package.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

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
// The package's second app: its package id opens CRM, the package's first.
const CRM_SERVICE_APP = { name: 'crm_service', label: 'CRM Service', active: true, _packageId: 'com.example.crm', navigation: [] };

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
        <MetadataProvider adapter={adapterFor([SETUP_APP, CRM_APP, CRM_SERVICE_APP, HR_APP])}>
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

describe('the other-apps links open the app they name (objectstack-ai/objectstack#29024)', () => {
  it('a package\'s second app links by its name; the first keeps the package id', async () => {
    renderIndex(SETUP_APP);
    const nav = await screen.findByTestId('report-index-other-apps');
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['CRM', '/apps/com.example.crm/reports'],
      ['CRM Service', '/apps/crm_service/reports'],
    ]);
  });
});
