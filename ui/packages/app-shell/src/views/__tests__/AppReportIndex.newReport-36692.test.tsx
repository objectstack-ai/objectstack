// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36692 — a report is made from its own entry: the reports index
 * offers 「New report」, which opens the report builder at `reports/new`.
 * The design mode no longer hosts the builder (the maintainer's 「照 Twenty
 * 分开」), so this is the one way to a new report.
 *
 *  - a workspace admin sees 「New report」 in the index header, linking to the
 *    app's `reports/new`, also on an index with no report yet;
 *  - it is gated as the builder is: a member gets none;
 *  - it is not offered while the shell's design mode is on, and is again
 *    once the mode is left.
 *
 * The harness is `AppReportIndex.otherAppsAddress-29024.test.tsx`'s (the real
 * `MetadataProvider`, `MePermissionsProvider`, `ExpressionProvider` and
 * `I18nProvider` in `en`), with the admin status stubbed and the shell's real
 * design-mode controller around the page.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

const admin = vi.hoisted(() => ({ isAdmin: true, isResolved: true }));
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_admin' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => admin,
}));

import { MetadataProvider } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { DesignModeProvider, useDesignModeController } from '../../layout/designMode';
import { AppReportIndexView } from '../AppReportIndexView';

const CRM_APP = { name: 'crm', label: 'CRM', active: true, _packageId: 'com.example.crm', navigation: [] };

const REPORTS = [{ name: 'crm_win_rate', label: 'Win Rate', dataset: 'ds_accounts', _packageId: 'com.example.crm' }];
const DATASETS = [{ name: 'ds_accounts', object: 'crm_account' }];

const ANSWER: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u_admin',
  tenantId: null,
  positions: [],
  hasAnyQueue: false,
  objectsUsingQueues: [],
  permissionSets: ['admin'],
  systemPermissions: [],
  objects: { crm_account: { allowRead: true } },
  fields: {},
};

function adapterFor(reports: unknown[]) {
  const items: Record<string, unknown[]> = { app: [CRM_APP], report: reports, dataset: DATASETS };
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

/** The shell's hold on the design mode, with its door and its Cancel as plain buttons. */
function Shell({ children }: { children: React.ReactNode }) {
  const mode = useDesignModeController({ appName: 'crm', appBasePath: '/apps/crm', enabled: true });
  return (
    <DesignModeProvider value={mode}>
      <button type="button" onClick={() => mode.enter()}>
        enter design mode
      </button>
      <button type="button" onClick={mode.cancel}>
        leave design mode
      </button>
      {children}
    </DesignModeProvider>
  );
}

function renderIndex(reports: unknown[] = REPORTS) {
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ANSWER }) as unknown as Response);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher as unknown as typeof fetch}>
        <MetadataProvider adapter={adapterFor(reports)}>
          <ExpressionProvider app={CRM_APP}>
            <MemoryRouter initialEntries={['/apps/crm/reports']}>
              <Shell>
                <Routes>
                  <Route path="/apps/:appName/reports" element={<AppReportIndexView />} />
                  <Route path="/apps/:appName/reports/new" element={<p data-testid="builder-page">builder</p>} />
                </Routes>
              </Shell>
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
  admin.isAdmin = true;
  admin.isResolved = true;
});

describe('「New report」 on the reports index (objectstack#36692)', () => {
  it('a workspace admin sees it in the header; it opens the report builder', async () => {
    renderIndex();
    await screen.findByTestId('report-index-entry-crm_win_rate');
    const link = screen.getByTestId('report-index-new');
    expect(link).toHaveTextContent('New report');
    expect(link).toHaveAttribute('href', '/apps/crm/reports/new');
    fireEvent.click(link);
    expect(await screen.findByTestId('builder-page')).toBeInTheDocument();
  });

  it('an index with no report yet offers it too', async () => {
    renderIndex([]);
    await screen.findByText('No reports');
    expect(screen.getByTestId('report-index-new')).toHaveAttribute('href', '/apps/crm/reports/new');
  });

  it('gated as the builder is: a member gets none', async () => {
    admin.isAdmin = false;
    renderIndex();
    await screen.findByTestId('report-index-entry-crm_win_rate');
    expect(screen.queryByTestId('report-index-new')).toBeNull();
  });

  it('not offered while the design mode is on; offered again once it is left', async () => {
    renderIndex();
    await screen.findByTestId('report-index-entry-crm_win_rate');
    fireEvent.click(screen.getByText('enter design mode'));
    expect(screen.queryByTestId('report-index-new')).toBeNull();
    fireEvent.click(screen.getByText('leave design mode'));
    expect(screen.getByTestId('report-index-new')).toBeInTheDocument();
  });
});
