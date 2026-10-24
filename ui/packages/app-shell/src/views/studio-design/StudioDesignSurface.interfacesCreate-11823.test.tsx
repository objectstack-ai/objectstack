// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11823 (step 2) — the Interfaces pillar creates a dashboard and a
 * report, links each from the app's navigation, and opens it on the
 * structured canvas.
 *
 * Pinned here, through the mounted Interfaces pillar with a metadata client
 * double and the real `DashboardPreview` / `ReportPreview` canvases:
 *
 *  - New dashboard saves a draft `DashboardSchema` parses, saves the app
 *    document with a `dashboard` entry naming it (the whole document parses
 *    with `AppSchema`), shows the entry in the rail, and opens the dashboard
 *    on its canvas in design mode ("+ add widget");
 *  - New report asks for a dataset and one of its measures, saves a draft
 *    `ReportSchema` parses, links it with a `report` entry, and opens it;
 *  - a report with no dataset chosen, and an identifier another dashboard or
 *    report already holds (published in any package, or a draft), are refused
 *    in the dialog and nothing is written;
 *  - a refused item save stays in the dialog and links nothing; a refused nav
 *    save shows the canvas refusal strip and keeps the entry on screen;
 *  - CONTROLS: no create entry on a read-only package, on a package with no
 *    app, or while nav editing is open.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppSchema, DashboardSchema, ReportSchema } from '@objectstack/spec/ui';
// Module-scope imports of the lazily loaded canvas renderers (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';
import '@object-ui/plugin-report';

const NAV = [
  { id: 'nav_home', type: 'dashboard', label: 'Home', dashboardName: 'home_dash' },
  { id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://example.com' },
];

const HOME_DASH = {
  name: 'home_dash',
  label: 'Home',
  widgets: [{ id: 'w1', type: 'metric', title: 'Total', layout: { x: 0, y: 0, w: 3, h: 2 } }],
};

const DATASETS = [
  {
    name: 'orders_ds',
    label: 'Orders',
    object: 'order',
    dimensions: [{ name: 'region', label: 'Region' }],
    measures: [
      { name: 'revenue', label: 'Revenue', aggregate: 'sum' },
      { name: 'order_count', label: 'Order count', aggregate: 'count' },
    ],
  },
];

let apps: Array<Record<string, unknown>>;
let published: Record<string, Array<Record<string, unknown>>>;
let draftHeaders: Array<{ type: string; name: string; packageId: string }>;
let draftRows: Record<string, Record<string, unknown>>;
let refuse: Record<string, Error>;

const mockClient = {
  save: vi.fn(async (type: string, name: string, body: Record<string, unknown>) => {
    if (refuse[type]) throw refuse[type];
    draftRows[`${type}:${name}`] = body;
    return { success: true, version: 'v1', state: 'draft' };
  }),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return apps;
    if (type === 'dataset') return DATASETS;
    return published[type] ?? [];
  }),
  listDrafts: vi.fn(async (opts: { type?: string } = {}) =>
    draftHeaders.filter((h) => !opts.type || h.type === opts.type),
  ),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') {
      return { effective: { name: 'acme_app', label: 'Acme', active: true, navigation: NAV } };
    }
    const row = (published[type] ?? []).find((r) => r.name === name);
    return row ? { effective: row } : { code: null, overlay: null, overlayScope: null, effective: null };
  }),
  getDraft: vi.fn(async (type: string, name: string) => {
    const body = draftRows[`${type}:${name}`];
    return body ? { item: body } : null;
  }),
  get: vi.fn(async (type: string, name: string) =>
    type === 'dataset' ? DATASETS.find((d) => d.name === name) : undefined,
  ),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';
import { ReportPreview } from '../metadata-admin/previews/ReportPreview';
import { t } from '../metadata-admin/i18n';

registerMetadataPreview('dashboard', DashboardPreview);
registerMetadataPreview('report', ReportPreview);

beforeEach(() => {
  apps = [{ name: 'acme_app', label: 'Acme' }];
  published = { dashboard: [HOME_DASH], report: [] };
  draftHeaders = [];
  draftRows = {};
  refuse = {};
  mockClient.save.mockClear();
});
afterEach(cleanup);

function mountPillar(readOnly = false) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" readOnly={readOnly} />
    </MemoryRouter>,
  );
}

/** The pillar has loaded its app and opened the first leaf. */
async function ready() {
  await screen.findByTitle('dashboard · home_dash', undefined, { timeout: 8000 });
}

// objectui#12455 — the rail's "+" lists every nav kind; its Dashboard and
// Report items continue into the create flow, addressed by their test ids.
async function openCreate(item: 'New dashboard' | 'New report') {
  await userEvent.click(await screen.findByTestId('if-create-menu'));
  await userEvent.click(await screen.findByTestId(item === 'New dashboard' ? 'if-create-dashboard' : 'if-create-report'));
  return screen.findByRole('dialog');
}

function typeName(dialog: HTMLElement, placeholder: string, text: string) {
  fireEvent.change(within(dialog).getByPlaceholderText(placeholder), { target: { value: text } });
}

/**
 * The options a create-dialog picker lists, opened from the keyboard. The
 * pickers are the shared `Select` (objectui#11865), whose list opens in a
 * portal outside the dialog.
 */
async function listed(dialog: HTMLElement, testId: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(await within(dialog).findByTestId(testId), { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

/** Pick the option labelled `label` from a create-dialog picker. */
async function pickOption(dialog: HTMLElement, testId: string, label: string): Promise<void> {
  const option = (await listed(dialog, testId)).find((o) => o.textContent === label);
  if (!option) throw new Error(`${testId} lists no "${label}"`);
  fireEvent.click(option);
}

function savesOf(type: string): Array<[string, string, Record<string, unknown>, Record<string, unknown>]> {
  return mockClient.save.mock.calls.filter((c) => c[0] === type) as never;
}

describe('the Interfaces pillar creates a dashboard and a report (objectui#11823 step 2)', () => {
  it('New dashboard saves a spec-valid draft, links it from the navigation, and opens it on the dashboard canvas', async () => {
    mountPillar();
    await ready();
    const dialog = await openCreate('New dashboard');
    typeName(dialog, 'Dashboard name (e.g. Sales overview)', 'Sales overview');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(savesOf('app')).toHaveLength(1), { timeout: 8000 });

    // The item's draft: the spec's minimum, parsed by the spec.
    const [[, name, body, options]] = savesOf('dashboard');
    expect(name).toBe('sales_overview');
    // objectui#11773 — a create is the first-write pin.
    expect(options).toEqual({ mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*', surface: 'studio' });
    expect(body).toEqual({ name: 'sales_overview', label: 'Sales overview', widgets: [] });
    const parsedDash = DashboardSchema.safeParse(body);
    expect(parsedDash.success, JSON.stringify(parsedDash.error?.issues)).toBe(true);

    // The entry that links it, appended to the app document the server holds;
    // no label, so it inherits the dashboard's.
    const [[, appName, appBody, appOptions]] = savesOf('app');
    expect(appName).toBe('acme_app');
    // objectui#11773 — the app had no pending draft when the pillar loaded it,
    // so the nav save that links the new item is the first-write pin too.
    expect(appOptions).toEqual({ mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*', surface: 'studio' });
    expect(appBody.navigation).toEqual([
      ...NAV,
      { id: 'nav_sales_overview', type: 'dashboard', dashboardName: 'sales_overview' },
    ]);
    const parsedApp = AppSchema.safeParse(appBody);
    expect(parsedApp.success, JSON.stringify(parsedApp.error?.issues)).toBe(true);

    // It appears in the rail, and the canvas is open on it, in design mode:
    // the structured canvas with its "+ add widget".
    expect(await screen.findByTitle('dashboard · sales_overview')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId('if-canvas-caption')).toHaveAttribute(
        'title',
        expect.stringContaining('dashboard · sales_overview'),
      ),
    );
    expect(await screen.findByText(t('engine.dashboardPreview.empty', 'en-US'), undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getByText(t('engine.inspector.add.widget', 'en-US'))).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('New report asks for a dataset and a measure, saves a spec-valid draft, links it, and opens it on the report canvas', async () => {
    mountPillar();
    await ready();
    const dialog = await openCreate('New report');
    typeName(dialog, 'Report name (e.g. Revenue by region)', 'Revenue by region');

    await pickOption(dialog, 'create-report-dataset', 'Orders (orders_ds)');
    const measures = await listed(dialog, 'create-report-measure');
    expect(measures.map((o) => o.textContent)).toEqual([
      'Choose a measure…',
      'Revenue (revenue)',
      'Order count (order_count)',
    ]);
    fireEvent.click(measures[1]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    await waitFor(() => expect(savesOf('app')).toHaveLength(1), { timeout: 8000 });

    const [[, name, body, options]] = savesOf('report');
    expect(name).toBe('revenue_by_region');
    // objectui#11773 — a create is the first-write pin.
    expect(options).toEqual({ mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*', surface: 'studio' });
    expect(body).toEqual({
      name: 'revenue_by_region',
      label: 'Revenue by region',
      type: 'summary',
      drilldown: true,
      dataset: 'orders_ds',
      values: ['revenue'],
    });
    const parsedReport = ReportSchema.safeParse(body);
    expect(parsedReport.success, JSON.stringify(parsedReport.error?.issues)).toBe(true);

    // A report entry carries its label: the spec's inheritance stops at
    // object, view and dashboard targets.
    const [[, , appBody]] = savesOf('app');
    expect((appBody.navigation as unknown[]).at(-1)).toEqual({
      id: 'nav_revenue_by_region',
      type: 'report',
      reportName: 'revenue_by_region',
      label: 'Revenue by region',
    });
    const parsedApp = AppSchema.safeParse(appBody);
    expect(parsedApp.success, JSON.stringify(parsedApp.error?.issues)).toBe(true);

    // It appears in the rail, and the canvas is the report renderer drawing it.
    expect(await screen.findByTitle('report · revenue_by_region')).toBeInTheDocument();
    const report = await screen.findByTestId('dataset-report', undefined, { timeout: 8000 });
    expect(report).toHaveAttribute('data-report-name', 'revenue_by_region');
    expect(report).toHaveAttribute('data-report-presentation', 'summary');
    expect(screen.queryByText(t('engine.reportPreview.empty', 'en-US'))).toBeNull();
  });

  it('a report with no dataset chosen is refused in the dialog, and nothing is written', async () => {
    mountPillar();
    await ready();
    const dialog = await openCreate('New report');
    typeName(dialog, 'Report name (e.g. Revenue by region)', 'Revenue by region');
    await within(dialog).findByTestId('create-report-dataset');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(
      await within(dialog).findByText('Choose the dataset this report reads, and one of its measures.'),
    ).toBeInTheDocument();
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('an identifier a dashboard in another package holds is refused in the dialog, and nothing is written', async () => {
    published.dashboard = [HOME_DASH, { name: 'sales_overview', label: 'Their sales' }];
    mountPillar();
    await ready();
    const dialog = await openCreate('New dashboard');
    typeName(dialog, 'Dashboard name (e.g. Sales overview)', 'Sales overview');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(
      await within(dialog).findByText(
        'A dashboard with the identifier “sales_overview” already exists. Choose another identifier.',
      ),
    ).toBeInTheDocument();
    expect(mockClient.save).not.toHaveBeenCalled();
    expect(screen.queryByTitle('dashboard · sales_overview')).toBeNull();
  });

  it('an identifier a report draft holds is refused in the dialog, and nothing is written', async () => {
    draftHeaders = [{ type: 'report', name: 'revenue_by_region', packageId: 'com.other.app' }];
    mountPillar();
    await ready();
    const dialog = await openCreate('New report');
    typeName(dialog, 'Report name (e.g. Revenue by region)', 'Revenue by region');
    await pickOption(dialog, 'create-report-dataset', 'Orders (orders_ds)');
    await pickOption(dialog, 'create-report-measure', 'Revenue (revenue)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(
      await within(dialog).findByText(
        'A report with the identifier “revenue_by_region” already exists. Choose another identifier.',
      ),
    ).toBeInTheDocument();
    expect(mockClient.save).not.toHaveBeenCalled();
  });

  it('a refused item save stays in the dialog and links nothing', async () => {
    refuse.dashboard = new Error('The server refused the dashboard.');
    mountPillar();
    await ready();
    const dialog = await openCreate('New dashboard');
    typeName(dialog, 'Dashboard name (e.g. Sales overview)', 'Sales overview');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(await within(dialog).findByText('The server refused the dashboard.')).toBeInTheDocument();
    expect(savesOf('app')).toHaveLength(0);
    expect(screen.queryByTitle('dashboard · sales_overview')).toBeNull();
  });

  it('a refused nav save shows the canvas refusal strip and keeps the new entry and its canvas on screen', async () => {
    refuse.app = new Error('The server refused the app.');
    mountPillar();
    await ready();
    const dialog = await openCreate('New dashboard');
    typeName(dialog, 'Dashboard name (e.g. Sales overview)', 'Sales overview');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(await screen.findByTestId('studio-refusal', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(savesOf('dashboard')).toHaveLength(1);
    expect(screen.getByTitle('dashboard · sales_overview')).toBeInTheDocument();
    expect(await screen.findByText(t('engine.dashboardPreview.empty', 'en-US'), undefined, { timeout: 8000 })).toBeInTheDocument();
  });

  describe('controls', () => {
    it('a read-only package shows no create entry', async () => {
      mountPillar(true);
      await ready();
      expect(screen.queryByTestId('if-create-menu')).toBeNull();
    });

    it('a package with no app shows no create entry: there is no navigation to link from', async () => {
      apps = [];
      mountPillar();
      expect(await screen.findByText(t('engine.studio.if.noAppTitle', 'en-US'), undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(screen.queryByTestId('if-create-menu')).toBeNull();
    });

    it('the create entry is withdrawn while nav editing is open, and back once it closes', async () => {
      mountPillar();
      await ready();
      expect(screen.getByTestId('if-create-menu')).toBeInTheDocument();
      fireEvent.click(screen.getByTitle(t('engine.studio.if.editNavTitle', 'en-US')));
      await waitFor(() => expect(screen.queryByTestId('if-create-menu')).toBeNull());
      fireEvent.click(screen.getByTitle(t('engine.studio.if.doneEditTitle', 'en-US')));
      expect(await screen.findByTestId('if-create-menu')).toBeInTheDocument();
    });
  });
});
