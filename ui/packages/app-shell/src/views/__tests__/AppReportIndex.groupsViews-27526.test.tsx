// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27526 — the report index groups its reports by primary object
 * and offers the reader two views, 全部 and 最近, kept per user.
 *
 * The report schema carries no grouping key, so the object is derived: the
 * object of the first dataset a report binds that the dataset list maps to
 * one. Sections follow the app's navigation order, the objects it does not
 * name come next by label, and the reports with no object close the list in
 * 「其它」. The view is a `workspacePreference` (scope `user`); 最近 reads the
 * recent-items store. The served report list carries no creator, so there is
 * no 「我创建的」 view.
 *
 * Pinned through the real `MetadataProvider` (a fake adapter answers
 * `/meta/:type`), the real `MePermissionsProvider`, `ExpressionProvider`,
 * `RecentItemsProvider` (seeded through its localStorage key) and
 * `I18nProvider` in `en`:
 *
 *  (a) grouping: one section per primary object in navigation order, then an
 *      object the navigation does not name, then 「其它」; a joined report goes
 *      under the first of its datasets that names an object; each header
 *      shows its count and collapses its section;
 *  (b) views: 全部 with no stored choice; picking 最近 stores it in the
 *      preference store and a new mount reads it back; 最近 lists the opened
 *      reports most recent first, only those the index lists, with when each
 *      was opened; an unreadable stored value is no choice;
 *  (c) search: filters within the current view only, by label or object, and
 *      says so when nothing matches.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsAuthenticatedResponse } from '@object-ui/permissions';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_agent' }, activeOrganization: null }),
}));

import { MetadataProvider } from '../../providers/MetadataProvider';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { RecentItemsProvider } from '../../context/RecentItemsProvider';
import { AppReportIndexView } from '../AppReportIndexView';
import {
  REPORT_INDEX_VIEW_PREFERENCE,
  groupReportsByObject,
  reportPrimaryObject,
  type AppReportEntry,
} from '../appReportIndex';
import { workspacePreferenceStorageKey } from '../../utils/workspacePreference';

const PKG = 'com.example.crm';

const CRM_APP = {
  name: 'crm',
  label: 'CRM',
  active: true,
  _packageId: PKG,
  // Opportunity is named before Lead: the sections follow this order, not the labels'.
  navigation: [
    { id: 'nav_opps', type: 'object', objectName: 'crm_opportunity', label: 'Deals' },
    {
      id: 'nav_sales',
      type: 'group',
      label: 'Sales',
      children: [{ id: 'nav_leads', type: 'object', objectName: 'crm_lead', label: 'Leads' }],
    },
  ],
};

const REPORTS = [
  { name: 'lead_sources', label: 'Lead Sources', dataset: 'ds_leads', _packageId: PKG },
  { name: 'lead_conversion', label: 'Lead Conversion', dataset: 'ds_leads', _packageId: PKG },
  { name: 'pipeline', label: 'Pipeline', dataset: 'ds_opps', _packageId: PKG },
  // An object the navigation does not name.
  { name: 'case_aging', label: 'Case Aging', dataset: 'ds_cases', _packageId: PKG },
  // A joined report: its first dataset is unknown, its second reads leads.
  {
    name: 'mixed_funnel',
    label: 'Mixed Funnel',
    type: 'joined',
    blocks: [{ dataset: 'ds_gone' }, { dataset: 'ds_leads' }, { dataset: 'ds_opps' }],
    _packageId: PKG,
  },
  // No dataset at all: 「其它」.
  { name: 'scratch', label: 'Scratch Pad', _packageId: PKG },
];

const DATASETS = [
  { name: 'ds_leads', object: 'crm_lead' },
  { name: 'ds_opps', object: 'crm_opportunity' },
  { name: 'ds_cases', object: 'crm_case' },
];

const OBJECTS = [
  { name: 'crm_lead', label: 'Lead', pluralLabel: 'Leads', _packageId: PKG },
  { name: 'crm_opportunity', label: 'Opportunity', pluralLabel: 'Opportunities', _packageId: PKG },
  { name: 'crm_case', label: 'Case', pluralLabel: 'Cases', _packageId: PKG },
];

const ANSWER: MePermissionsAuthenticatedResponse = {
  authenticated: true,
  userId: 'u_agent',
  tenantId: null,
  positions: [],
  hasAnyQueue: false,
  permissionSets: ['sales'],
  systemPermissions: [],
  objects: {
    crm_lead: { allowRead: true },
    crm_opportunity: { allowRead: true },
    crm_case: { allowRead: true },
  },
  fields: {},
};

const RECENT_KEY = 'objectui-recent-items:u:u_agent';
const VIEW_KEY = workspacePreferenceStorageKey(REPORT_INDEX_VIEW_PREFERENCE, 'user');

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/** Seed the recent-items store, most recent first, as the provider stores it. */
function seedRecent(entries: Array<{ name: string; type?: string; visitedAt: string }>) {
  localStorage.setItem(
    RECENT_KEY,
    JSON.stringify(
      entries.map(({ name, type = 'report', visitedAt }) => ({
        id: `${type}:${name}`,
        type,
        name,
        href: `/apps/crm/${type}/${name}`,
        visitedAt,
      })),
    ),
  );
}

function adapterFor(asked: string[]) {
  const items: Record<string, unknown[]> = { app: [CRM_APP], report: REPORTS, dataset: DATASETS, object: OBJECTS };
  return {
    clearCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, params?: { packageId?: string }) => {
          asked.push(params?.packageId ? `${type}?packageId=${params.packageId}` : type);
          return Promise.resolve({ type, items: items[type] ?? [] });
        },
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function renderIndex() {
  const asked: string[] = [];
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => ANSWER }) as unknown as Response);
  const view = render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher as unknown as typeof fetch}>
        <MetadataProvider adapter={adapterFor(asked)}>
          <ExpressionProvider app={CRM_APP}>
            <RecentItemsProvider>
              <MemoryRouter initialEntries={['/apps/crm/reports']}>
                <Routes>
                  <Route path="/apps/:appName/reports" element={<AppReportIndexView />} />
                </Routes>
              </MemoryRouter>
            </RecentItemsProvider>
          </ExpressionProvider>
        </MetadataProvider>
      </MePermissionsProvider>
    </I18nProvider>,
  );
  return { asked, unmount: view.unmount };
}

/** Each section's header label and its links' text, in DOM order. */
function sections(): Array<{ header: string; count: string; links: string[] }> {
  return screen.queryAllByTestId('report-index-section').map((section) => {
    const button = within(section).getByRole('button');
    return {
      header: button.querySelector('.truncate')?.textContent ?? '',
      count: within(section).getByTestId('report-index-section-count').textContent ?? '',
      links: within(section)
        .queryAllByRole('link')
        .map((a) => a.textContent ?? ''),
    };
  });
}

/** Wait until the lists have answered and the index has drawn its rows. */
async function settled() {
  await screen.findByRole('link', { name: 'Pipeline' });
}

/** Wait until the object scope has answered and the section headers carry the objects' labels. */
async function labelled() {
  await screen.findByRole('button', { name: /Opportunities/ });
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('the report index groups by primary object (objectstack#27526)', () => {
  it('(a) one section per object in navigation order, an unnamed object next, 「其它」 last', async () => {
    renderIndex();
    await settled();
    await labelled();
    expect(sections()).toEqual([
      { header: 'Opportunities', count: '1', links: ['Pipeline'] },
      { header: 'Leads', count: '3', links: ['Lead Conversion', 'Lead Sources', 'Mixed Funnel'] },
      { header: 'Cases', count: '1', links: ['Case Aging'] },
      { header: 'Other', count: '1', links: ['Scratch Pad'] },
    ]);
  });

  it('(a) a row shows its report\'s object', async () => {
    renderIndex();
    await settled();
    await labelled();
    expect(screen.getByTestId('report-index-object-mixed_funnel')).toHaveTextContent('Lead');
    expect(screen.getByTestId('report-index-object-pipeline')).toHaveTextContent('Opportunity');
    expect(screen.queryByTestId('report-index-object-scratch')).not.toBeInTheDocument();
  });

  it('(a) a section header collapses and expands its own section only', async () => {
    renderIndex();
    await settled();
    await labelled();
    const leads = screen.getByRole('button', { name: /Leads/ });
    expect(leads).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(leads);
    expect(leads).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: 'Lead Sources' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pipeline' })).toBeInTheDocument();
    fireEvent.click(leads);
    expect(screen.getByRole('link', { name: 'Lead Sources' })).toBeInTheDocument();
  });

  it('CONTROL: the labels come from the app\'s package object scope, never the whole registry', async () => {
    const { asked } = renderIndex();
    await settled();
    await labelled();
    expect(asked).toContain(`object?packageId=${PKG}`);
    expect(asked).not.toContain('object');
  });

  it('the primary object is the first dataset that maps to one', () => {
    const datasetObjects = new Map([
      ['ds_leads', 'crm_lead'],
      ['ds_opps', 'crm_opportunity'],
    ]);
    expect(reportPrimaryObject({ dataset: 'ds_opps', blocks: [{ dataset: 'ds_leads' }] }, datasetObjects)).toBe(
      'crm_opportunity',
    );
    expect(reportPrimaryObject({ blocks: [{ dataset: 'ds_gone' }, { dataset: 'ds_leads' }] }, datasetObjects)).toBe(
      'crm_lead',
    );
    expect(reportPrimaryObject({ dataset: 'ds_gone' }, datasetObjects)).toBeUndefined();
    expect(reportPrimaryObject({}, datasetObjects)).toBeUndefined();
  });

  it('sections: navigation order first, then by label, then 「其它」; an object with no report has none', () => {
    const entry = (name: string, object?: string): AppReportEntry => ({ name, label: name, ...(object ? { object } : {}) });
    const grouped = groupReportsByObject(
      [entry('a', 'zeta'), entry('b'), entry('c', 'alpha'), entry('d', 'nav_second'), entry('e', 'nav_first')],
      ['nav_first', 'nav_unused', 'nav_second'],
      (object) => object,
    );
    expect(grouped.map((section) => section.object)).toEqual(['nav_first', 'nav_second', 'alpha', 'zeta', null]);
    expect(grouped[4].entries.map((e) => e.name)).toEqual(['b']);
  });
});

describe('the report index views and their persistence (objectstack#27526)', () => {
  it('(b) shows 全部 when the reader never chose', async () => {
    renderIndex();
    await settled();
    expect(screen.getByRole('button', { name: 'All reports' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('report-index-section')).toHaveLength(4);
  });

  it('(b) 最近 lists the opened reports the index lists, most recent first, with when each was opened', async () => {
    seedRecent([
      { name: 'case_aging', visitedAt: hoursAgo(1) },
      { name: 'crm_lead', type: 'object', visitedAt: hoursAgo(2) },
      { name: 'other_pkg_report', visitedAt: hoursAgo(3) },
      { name: 'pipeline', visitedAt: hoursAgo(5) },
    ]);
    renderIndex();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    const list = screen.getByTestId('report-index-recent');
    expect(within(list).getAllByRole('link').map((a) => a.textContent)).toEqual(['Case Aging', 'Pipeline']);
    expect(screen.queryByTestId('report-index-section')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-index-opened-case_aging')).toHaveTextContent('Opened 1 hour ago');
    expect(screen.getByTestId('report-index-opened-pipeline')).toHaveTextContent('Opened 5 hours ago');
  });

  it('(b) the 全部 rows show when the reader last opened a report, and nothing for one never opened', async () => {
    seedRecent([{ name: 'pipeline', visitedAt: hoursAgo(5) }]);
    renderIndex();
    await settled();
    expect(screen.getByTestId('report-index-opened-pipeline')).toHaveTextContent('Opened 5 hours ago');
    expect(screen.getByTestId('report-index-opened-case_aging')).toHaveTextContent('');
  });

  it('(b) the choice is stored per user in the preference store and read back on the next mount', async () => {
    seedRecent([{ name: 'pipeline', visitedAt: hoursAgo(5) }]);
    const first = renderIndex();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    expect(VIEW_KEY).toBe('os:pref:reports.index.view');
    expect(JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')).toEqual({ value: 'recent', v: 1 });
    first.unmount();

    renderIndex();
    await settled();
    expect(screen.getByRole('button', { name: 'Recent' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('report-index-recent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All reports' }));
    expect(JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')).toEqual({ value: 'all', v: 1 });
    expect(screen.getAllByTestId('report-index-section')).toHaveLength(4);
  });

  it('(b) an unreadable stored view is no choice: 全部', async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ value: 'mine', v: 1 }));
    renderIndex();
    await settled();
    expect(screen.getByRole('button', { name: 'All reports' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('(b) 最近 with nothing opened says so', async () => {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ value: 'recent', v: 1 }));
    renderIndex();
    await screen.findByText('No recently opened reports');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('CONTROL: there is no 我创建的 view', async () => {
    renderIndex();
    await settled();
    const views = screen.getByRole('group', { name: 'Report views' });
    expect(within(views).getAllByRole('button').map((b) => b.textContent)).toEqual(['All reports', 'Recent']);
  });
});

describe('the report index search filters the current view (objectstack#27526)', () => {
  it('(c) in 全部: by label, dropping the sections left empty and recounting the rest', async () => {
    renderIndex();
    await settled();
    await labelled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), { target: { value: 'lead s' } });
    expect(sections()).toEqual([{ header: 'Leads', count: '1', links: ['Lead Sources'] }]);
  });

  it('(c) in 全部: by object label', async () => {
    renderIndex();
    await settled();
    await labelled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), { target: { value: 'CASE' } });
    expect(sections()).toEqual([{ header: 'Cases', count: '1', links: ['Case Aging'] }]);
  });

  it('(c) in 最近: only the opened reports, never another view\'s', async () => {
    seedRecent([
      { name: 'lead_sources', visitedAt: hoursAgo(1) },
      { name: 'pipeline', visitedAt: hoursAgo(2) },
    ]);
    renderIndex();
    await settled();
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), { target: { value: 'lead' } });
    // Lead Conversion and Mixed Funnel match but were never opened.
    expect(within(screen.getByTestId('report-index-recent')).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Lead Sources',
    ]);
  });

  it('(c) says so when nothing in the view matches', async () => {
    renderIndex();
    await settled();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), { target: { value: 'zzz' } });
    expect(screen.getByText('No reports match your search.')).toBeInTheDocument();
    expect(screen.queryByTestId('report-index-section')).not.toBeInTheDocument();
  });
});
