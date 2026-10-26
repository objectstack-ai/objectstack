// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13020 — an app's reports have an index, and ⌘K finds them.
 *
 * A report the app's navigation does not name used to have no UI path, and
 * the palette matched only the reports the navigation names. HotCRM ships ten
 * reports and seven were reachable only by typing a URL. Now the app's report
 * index (`/apps/APP/reports`) lists every report the app's package ships that
 * the member may open, and the palette offers the same ones.
 *
 * Pinned through the real `MetadataProvider` (a fake adapter answers
 * `/meta/:type` and records each type asked), the real `MePermissionsProvider`
 * fed the `/me/permissions` answer, the real `ExpressionProvider`, and the
 * real `I18nProvider` in `en`:
 *
 *  (a) a report the navigation does not name appears in the index and in ⌘K
 *      for a member who may read its dataset's object;
 *  (b) a report whose dataset reads an object the member may not read appears
 *      in neither, nor does a joined report with one such block;
 *  (c) CONTROLS: a nav-entry report is still offered by ⌘K through its entry,
 *      once; another package's report is in neither; the index reads the
 *      report and dataset lists and never the object registry; a closed
 *      palette reads neither list; an app that ships none shows the empty
 *      state.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_agent' }, activeOrganization: null }),
}));

import { MetadataProvider } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { CommandPalette } from '../../chrome/CommandPalette';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';
import { AppReportIndexView } from '../AppReportIndexView';

const PKG = 'com.example.crm';

const CRM_APP = {
  name: 'crm',
  label: 'CRM',
  active: true,
  _packageId: PKG,
  navigation: [
    { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
    { id: 'nav_pipeline', type: 'report', reportName: 'crm_pipeline', label: 'Pipeline' },
  ],
};

const REPORTS = [
  // Named by the navigation.
  { name: 'crm_pipeline', label: 'Pipeline', dataset: 'ds_accounts', _packageId: PKG },
  // Not named by the navigation, on a readable object.
  { name: 'crm_win_rate', label: 'Win Rate', description: 'Won over closed', dataset: 'ds_accounts', _packageId: PKG },
  // Not named by the navigation, on an object the member may not read.
  { name: 'crm_case_aging', label: 'Case Aging', dataset: 'ds_cases', _packageId: PKG },
  // A joined report, one of whose blocks reads the unreadable object.
  {
    name: 'crm_mixed',
    label: 'Mixed Blocks',
    type: 'joined',
    blocks: [{ dataset: 'ds_accounts' }, { dataset: 'ds_cases' }],
    _packageId: PKG,
  },
  // Another package's report.
  { name: 'hr_headcount', label: 'Headcount', dataset: 'ds_accounts', _packageId: 'com.example.hr' },
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

function adapterFor(reports: unknown[], asked: string[]) {
  const items: Record<string, unknown[]> = { app: [CRM_APP], report: reports, dataset: DATASETS };
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          asked.push(type);
          return Promise.resolve({ type, items: items[type] ?? [] });
        },
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function shell(children: React.ReactNode, url: string, reports: unknown[] = REPORTS) {
  const asked: string[] = [];
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ANSWER }) as unknown as Response);
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher as unknown as typeof fetch}>
        <MetadataProvider adapter={adapterFor(reports, asked)}>
          <ExpressionProvider app={CRM_APP}>
            <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
          </ExpressionProvider>
        </MetadataProvider>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  return asked;
}

function renderIndex(reports: unknown[] = REPORTS) {
  return shell(
    <Routes>
      <Route path="/apps/:appName/reports" element={<AppReportIndexView />} />
    </Routes>,
    '/apps/crm/reports',
    reports,
  );
}

function renderPalette(url: string) {
  return shell(
    <CommandPaletteProvider>
      <Routes>
        <Route
          path="/apps/:appName"
          element={<CommandPalette apps={[CRM_APP]} activeApp={CRM_APP} objects={[]} onAppChange={() => {}} />}
        />
      </Routes>
    </CommandPaletteProvider>,
    url,
  );
}

/** The visible text of every report item the palette rendered. */
function paletteReports(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-item][data-value^="report "]')).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('the app report index (objectui#13020)', () => {
  it('(a) lists a report the navigation does not name, linking to its route', async () => {
    renderIndex();
    const entry = await screen.findByRole('link', { name: /Win Rate/ });
    expect(entry).toHaveAttribute('href', '/apps/crm/report/crm_win_rate');
    expect(entry).toHaveTextContent('Won over closed');
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
  });

  it('(b) leaves out a report on an object the member may not read, and a joined report with such a block', async () => {
    renderIndex();
    await screen.findByRole('link', { name: /Win Rate/ });
    expect(screen.queryByRole('link', { name: /Case Aging/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Mixed Blocks/ })).not.toBeInTheDocument();
  });

  it('CONTROL: lists the nav-named report too, and no other package\'s report', async () => {
    renderIndex();
    await screen.findByRole('link', { name: /Win Rate/ });
    expect(screen.getByRole('link', { name: /Pipeline/ })).toHaveAttribute('href', '/apps/crm/report/crm_pipeline');
    expect(screen.queryByRole('link', { name: /Headcount/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Pipeline', 'Win RateWon over closed']);
  });

  it('CONTROL: reads the report and dataset lists, never the object registry', async () => {
    const asked = renderIndex();
    await screen.findByRole('link', { name: /Win Rate/ });
    expect(asked).toContain('report');
    expect(asked).toContain('dataset');
    expect(asked).not.toContain('object');
  });

  it('CONTROL: an app that ships no report shows the empty state', async () => {
    renderIndex([]);
    expect(await screen.findByText('No reports')).toBeInTheDocument();
    expect(screen.getByText('This app has no reports you can open.')).toBeInTheDocument();
  });
});

describe('⌘K offers the app\'s reports beyond its navigation (objectui#13020)', () => {
  it('(a) a report the navigation does not name, for a reader; (b) not one on an unreadable object', async () => {
    renderPalette('/apps/crm?palette=1');
    await waitFor(() => expect(paletteReports()).toContain('Win Rate'));
    expect(paletteReports()).not.toContain('Case Aging');
    expect(paletteReports()).not.toContain('Mixed Blocks');
    expect(paletteReports()).not.toContain('Headcount');
  });

  it('CONTROL: the nav-entry report is offered once, through its entry', async () => {
    renderPalette('/apps/crm?palette=1');
    await waitFor(() => expect(paletteReports()).toContain('Win Rate'));
    expect(paletteReports().filter((text) => text === 'Pipeline')).toHaveLength(1);
    const pipeline = document.querySelector('[cmdk-item][data-value^="report "]');
    expect(pipeline?.textContent).toBe('Pipeline');
  });

  it('CONTROL: a closed palette reads neither list', async () => {
    const asked = renderPalette('/apps/crm');
    await waitFor(() => expect(asked).toContain('app'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(asked).not.toContain('report');
    expect(asked).not.toContain('dataset');
  });
});
