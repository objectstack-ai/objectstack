// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13273 — the app's report index lists what the app's navigation
 * ships, a contributing module's reports included.
 *
 * The index kept only the reports whose `_packageId` is the app's own. A module
 * that contributes report entries to the app's navigation
 * (`navigationContributions`, merged into the served navigation with no
 * package stamp) owns its reports, so they were missing: HotCRM's admin saw 7
 * of 10, its service agent 2 of 5. Now the index lists the union of the owned
 * reports and every report a `type: 'report'` navigation entry names.
 *
 * Pinned through the real `MetadataProvider` (a fake adapter answers
 * `/meta/:type`), the real `MePermissionsProvider`, `ExpressionProvider` and
 * `I18nProvider`:
 *
 *  (a) an app whose package ships A and B, plus a module contributing C
 *      through a nested navigation group: the index lists A, B and C;
 *  (b) the dataset read gate still hides a report the member may not read,
 *      a contributed one included;
 *  (c) a navigation report entry the report list does not hold is not listed;
 *  (d) CONTROL: a single-package app lists exactly its own reports.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

import { MetadataProvider } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { AppReportIndexView } from '../AppReportIndexView';

const APP_PKG = 'com.example.crm';
const MODULE_PKG = 'com.example.crm.service';

/** The app as the server serves it: a module's group merged in, unstamped. */
const MULTI_PACKAGE_APP = {
  name: 'crm',
  label: 'CRM',
  _packageId: APP_PKG,
  navigation: [
    { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
    {
      id: 'grp_reports',
      type: 'group',
      label: 'Reports',
      children: [
        { id: 'nav_pipeline', type: 'report', reportName: 'crm_pipeline' },
        {
          id: 'grp_service',
          type: 'group',
          label: 'Service',
          children: [
            { id: 'nav_case_status', type: 'report', reportName: 'svc_case_status' },
            { id: 'nav_case_sla', type: 'report', reportName: 'svc_case_sla' },
            { id: 'nav_missing', type: 'report', reportName: 'svc_never_served' },
          ],
        },
      ],
    },
  ],
};

const SINGLE_PACKAGE_APP = {
  name: 'crm',
  label: 'CRM',
  _packageId: APP_PKG,
  navigation: [{ id: 'nav_pipeline', type: 'report', reportName: 'crm_pipeline' }],
};

const REPORTS = [
  // A and B: the app's own package.
  { name: 'crm_pipeline', label: 'Pipeline', dataset: 'ds_accounts', _packageId: APP_PKG },
  { name: 'crm_win_rate', label: 'Win Rate', dataset: 'ds_accounts', _packageId: APP_PKG },
  // C: the module's, named by the contributed navigation entry.
  { name: 'svc_case_status', label: 'Cases by Status', dataset: 'ds_accounts', _packageId: MODULE_PKG },
  // The module's, named by navigation, on an object the member may not read.
  { name: 'svc_case_sla', label: 'SLA Performance', dataset: 'ds_cases', _packageId: MODULE_PKG },
  // The module's, named by no navigation entry.
  { name: 'svc_unlinked', label: 'Unlinked', dataset: 'ds_accounts', _packageId: MODULE_PKG },
];

const DATASETS = [
  { name: 'ds_accounts', object: 'crm_account' },
  { name: 'ds_cases', object: 'crm_case' },
];

const ANSWER: MePermissionsResponse = {
  authenticated: true,
  userId: 'u_agent',
  tenantId: null,
  roles: [],
  permissionSets: ['service_agent'],
  systemPermissions: [],
  objects: {
    crm_account: { allowRead: true },
    crm_case: { allowRead: false },
  },
  fields: {},
};

function adapterFor(app: unknown) {
  const items: Record<string, unknown[]> = { app: [app], report: REPORTS, dataset: DATASETS };
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

function renderIndex(app: Record<string, unknown>) {
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ANSWER }) as unknown as Response);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher as unknown as typeof fetch}>
        <MetadataProvider adapter={adapterFor(app)}>
          <ExpressionProvider app={app}>
            <MemoryRouter initialEntries={['/apps/crm/reports']}>
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

/** The report names the index links to, in order. */
async function listedNames(): Promise<string[]> {
  await screen.findByTestId('report-index');
  return Array.from(document.querySelectorAll('[data-testid^="report-index-entry-"]')).map((el) =>
    (el.getAttribute('data-testid') ?? '').replace('report-index-entry-', ''),
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('the app report index lists what the navigation ships (objectui#13273)', () => {
  it('(a) lists the app package\'s reports and a report a module contributes through navigation', async () => {
    renderIndex(MULTI_PACKAGE_APP);
    expect(await screen.findByRole('link', { name: /Cases by Status/ })).toHaveAttribute(
      'href',
      '/apps/crm/report/svc_case_status',
    );
    const names = await listedNames();
    expect(names).toEqual(expect.arrayContaining(['crm_pipeline', 'crm_win_rate', 'svc_case_status']));
  });

  it('(b) the dataset read gate still hides an unreadable report, a contributed one included', async () => {
    renderIndex(MULTI_PACKAGE_APP);
    await screen.findByRole('link', { name: /Cases by Status/ });
    expect(screen.queryByRole('link', { name: /SLA Performance/ })).not.toBeInTheDocument();
  });

  it('(c) leaves out a navigation entry naming a report the report list does not hold', async () => {
    renderIndex(MULTI_PACKAGE_APP);
    await screen.findByRole('link', { name: /Cases by Status/ });
    const names = await listedNames();
    expect(names).not.toContain('svc_never_served');
    // Exactly the union, gated: no module report the navigation does not name.
    expect(names).toEqual(['svc_case_status', 'crm_pipeline', 'crm_win_rate']);
  });

  it('(d) CONTROL: a single-package app lists exactly its own reports', async () => {
    renderIndex(SINGLE_PACKAGE_APP);
    await screen.findByRole('link', { name: /Win Rate/ });
    expect(await listedNames()).toEqual(['crm_pipeline', 'crm_win_rate']);
  });
});
