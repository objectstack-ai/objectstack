// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11823 (steps 2 and 3) — what the Interfaces pillar's New dashboard /
 * New report / New page write, judged by the spec, the report's
 * dataset/measure fields and the page's source-kind field. The pillar-level
 * pins (the writes, the rail, the canvas) are in
 * `StudioDesignSurface.interfacesCreate-11823.test.tsx` (dashboard, report)
 * and `StudioDesignSurface.interfacesCreatePage-11823.test.tsx` (page).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppSchema, DashboardSchema, NavigationItemSchema, PageSchema, ReportSchema } from '@objectstack/spec/ui';
import { CAP_REACT_PAGES, disableCapability, enableCapability } from '@object-ui/core';
import { SchemaRenderer } from '@object-ui/react';
// The runtime page renderer and the html tier's blocks, registered at import
// (module scope, per AGENTS.md's flaky-test discipline).
import '@object-ui/components';

let datasets: Array<Record<string, unknown>>;
const mockClient = {
  list: vi.fn(async () => datasets),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient };
});

import {
  DEFAULT_PAGE_SOURCE_KIND,
  NO_REPORT_BINDING,
  PageCreateFields,
  ReportCreateFields,
  buildDashboardSkeleton,
  buildPageSkeleton,
  buildReportSkeleton,
  interfaceNavEntry,
  isReportBindingComplete,
  pageStarterSource,
  type PageSourceKind,
  type ReportBinding,
} from './interfaceCreate';
import type { NavNode } from './navSurface';
import { t, type SupportedLocale } from '../metadata-admin/i18n';
import { isStaticPageOption } from '../metadata-admin/inspectors/nav-target';

const LOCALES: SupportedLocale[] = ['en-US', 'zh-CN'];
const starterOf = (locale: SupportedLocale) => t('engine.studio.interfaces.create.pageStarter', locale);

beforeEach(() => {
  datasets = [
    {
      name: 'orders_ds',
      label: 'Orders',
      measures: [{ name: 'revenue', label: 'Revenue' }],
      dimensions: [{ name: 'region' }],
    },
    { name: 'tickets_ds', label: 'Tickets', measures: [{ name: 'ticket_count' }], dimensions: [] },
  ];
});
afterEach(cleanup);

describe('the create bodies parse with the spec (objectui#11823 step 2)', () => {
  it('a dashboard with no widget yet', () => {
    const body = buildDashboardSkeleton('sales_overview', 'Sales overview');
    const parsed = DashboardSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('a report bound to a dataset and one of its measures', () => {
    const body = buildReportSkeleton('revenue_by_region', 'Revenue by region', { dataset: 'orders_ds', measure: 'revenue' });
    const parsed = ReportSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('CONTROL: the spec refuses a report with no dataset, which is why the dialog asks for one', () => {
    const { dataset: _dataset, values: _values, ...unbound } = buildReportSkeleton('r', 'R', {
      dataset: 'orders_ds',
      measure: 'revenue',
    }) as Record<string, unknown>;
    const parsed = ReportSchema.safeParse(unbound);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toContain('dataset');
  });

  it('a binding is complete only with both a dataset and a measure', () => {
    expect(isReportBindingComplete(NO_REPORT_BINDING)).toBe(false);
    expect(isReportBindingComplete({ dataset: 'orders_ds', measure: '' })).toBe(false);
    expect(isReportBindingComplete({ dataset: 'orders_ds', measure: 'revenue' })).toBe(true);
  });
});

describe('the navigation entry that links a new item (objectui#11823 step 2)', () => {
  const navigation: NavNode[] = [
    { id: 'nav_sales', type: 'dashboard', dashboardName: 'old_sales' },
    {
      id: 'grp',
      type: 'group',
      label: 'More',
      children: [{ id: 'nav_sales_2', type: 'url', label: 'Docs', url: 'https://example.com' }],
    },
  ];

  it('takes an id no entry holds, at any depth', () => {
    expect(interfaceNavEntry('dashboard', 'sales', 'Sales', navigation).id).toBe('nav_sales_3');
    expect(interfaceNavEntry('dashboard', 'pipeline', 'Pipeline', navigation).id).toBe('nav_pipeline');
  });

  it('a dashboard entry carries no label, so it inherits the dashboard\'s; a report entry carries the author\'s', () => {
    expect(interfaceNavEntry('dashboard', 'pipeline', 'Pipeline', navigation)).toEqual({
      id: 'nav_pipeline',
      type: 'dashboard',
      dashboardName: 'pipeline',
    });
    expect(interfaceNavEntry('report', 'revenue', 'Revenue', navigation)).toEqual({
      id: 'nav_revenue',
      type: 'report',
      reportName: 'revenue',
      label: 'Revenue',
    });
  });

  it("a page entry carries the author's label: a label-less page entry shows its pageName (objectui#11823 step 3)", () => {
    expect(interfaceNavEntry('page', 'team_handbook', 'Team handbook', navigation)).toEqual({
      id: 'nav_team_handbook',
      type: 'page',
      pageName: 'team_handbook',
      label: 'Team handbook',
    });
  });

  it('each entry parses as a navigation item, and in an app document beside the entries it joins', () => {
    for (const kind of ['dashboard', 'report', 'page'] as const) {
      const entry = interfaceNavEntry(kind, 'sales', 'Sales', navigation);
      const item = NavigationItemSchema.safeParse(entry);
      expect(item.success, JSON.stringify(item.error?.issues)).toBe(true);
      const app = AppSchema.safeParse({ name: 'acme_app', label: 'Acme', navigation: [...navigation, entry] });
      expect(app.success, JSON.stringify(app.error?.issues)).toBe(true);
    }
  });
});

/**
 * The options a create-form picker lists, opened from the keyboard. The pickers
 * are the shared `Select` (objectui#11865); `interfaceCreate.sharedSelect-11865`
 * pins the conversion itself.
 */
async function listed(testId: string): Promise<HTMLElement[]> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  return within(await screen.findByRole('listbox')).getAllByRole('option');
}

/** Pick the option labelled `label` from a create-form picker. */
async function pickOption(testId: string, label: string): Promise<void> {
  const option = (await listed(testId)).find((o) => o.textContent === label);
  if (!option) throw new Error(`${testId} lists no "${label}"`);
  fireEvent.click(option);
}

describe('ReportCreateFields (objectui#11823 step 2)', () => {
  function Host({ initial = NO_REPORT_BINDING }: { initial?: ReportBinding }) {
    const [value, setValue] = React.useState<ReportBinding>(initial);
    return (
      <>
        <ReportCreateFields value={value} onChange={setValue} locale="en-US" />
        <output data-testid="binding">{JSON.stringify(value)}</output>
      </>
    );
  }

  it('chooses nothing for the author, and a dataset change clears the measure', async () => {
    render(<Host />);
    const dataset = await screen.findByTestId('create-report-dataset');
    expect(dataset.textContent).toBe(t('engine.studio.interfaces.create.datasetPlaceholder', 'en-US'));
    expect(screen.queryByTestId('create-report-measure')).toBeNull();

    await pickOption('create-report-dataset', 'Orders (orders_ds)');
    const measure = await screen.findByTestId('create-report-measure');
    expect(measure.textContent).toBe(t('engine.studio.interfaces.create.measurePlaceholder', 'en-US'));
    await pickOption('create-report-measure', 'Revenue (revenue)');
    expect(screen.getByTestId('binding')).toHaveTextContent('{"dataset":"orders_ds","measure":"revenue"}');

    await pickOption('create-report-dataset', 'Tickets (tickets_ds)');
    expect(screen.getByTestId('binding')).toHaveTextContent('{"dataset":"tickets_ds","measure":""}');
  });

  it('says so when there is no dataset to report on', async () => {
    datasets = [];
    render(<Host />);
    expect(await screen.findByTestId('create-report-no-datasets')).toHaveTextContent(
      'There is no dataset to report on yet.',
    );
    expect(screen.queryByTestId('create-report-dataset')).toBeNull();
  });
});

describe('the page create body (objectui#11823 step 3)', () => {
  it.each(['html', 'react'] as const)('a %s source page parses with the spec, as an app page', (kind) => {
    const body = buildPageSkeleton('team_handbook', 'Team handbook', kind, starterOf('en-US'));
    expect(body).toEqual({
      name: 'team_handbook',
      label: 'Team handbook',
      type: 'app',
      kind,
      source: pageStarterSource(kind, starterOf('en-US')),
    });
    const parsed = PageSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.type).toBe('app');
    // A navigation entry can open it: the nav editor's own page picker keeps it.
    expect(isStaticPageOption(parsed.data as { type?: string })).toBe(true);
  });

  it('CONTROL: without its page type the spec reads it as a record page, which a page nav entry cannot open', () => {
    const { type: _type, ...untyped } = buildPageSkeleton('team_handbook', 'Team handbook', 'html', starterOf('en-US')) as Record<
      string,
      unknown
    >;
    const parsed = PageSchema.safeParse(untyped);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(parsed.data?.type).toBe('record');
    expect(isStaticPageOption(parsed.data as { type?: string })).toBe(false);
  });

  it('CONTROL: the spec refuses a source page with an empty source, which is why it starts from one', () => {
    const parsed = PageSchema.safeParse({
      ...buildPageSkeleton('team_handbook', 'Team handbook', 'html', starterOf('en-US')),
      source: '',
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual(['source']);
  });

  it('the dialog starts on html, the tier every deployment renders', () => {
    expect(DEFAULT_PAGE_SOURCE_KIND).toBe('html');
  });

  it.each(LOCALES)("the %s starter line holds nothing the html parser stops at or that JSX text refuses", (locale) => {
    const text = starterOf(locale);
    expect(text).not.toBe('engine.studio.interfaces.create.pageStarter');
    expect(text).not.toMatch(/[<>{}]/);
  });
});

describe('the page starter renders through the runtime page renderer (objectui#11823 step 3)', () => {
  it.each(LOCALES)('the html starter compiles and renders, in %s', async (locale) => {
    const body = buildPageSkeleton('team_handbook', 'Team handbook', 'html', starterOf(locale));
    render(<SchemaRenderer schema={body as never} />);
    expect(await screen.findByText(starterOf(locale))).toBeInTheDocument();
    expect(screen.queryByText(/HTML page failed to compile/)).toBeNull();
  });

  it('the react starter runs and renders', async () => {
    const body = buildPageSkeleton('team_handbook', 'Team handbook', 'react', starterOf('en-US'));
    render(<SchemaRenderer schema={body as never} />);
    expect(await screen.findByText(starterOf('en-US'), undefined, { timeout: 8000 })).toBeInTheDocument();
  });
});

describe('PageCreateFields (objectui#11823 step 3)', () => {
  function Host({ initial = DEFAULT_PAGE_SOURCE_KIND }: { initial?: PageSourceKind }) {
    const [value, setValue] = React.useState<PageSourceKind>(initial);
    return (
      <>
        <PageCreateFields value={value} onChange={setValue} locale="en-US" />
        <output data-testid="kind">{value}</output>
      </>
    );
  }

  afterEach(() => enableCapability(CAP_REACT_PAGES));

  it('offers html and react, starting on html, and the hint follows the choice', async () => {
    render(<Host />);
    expect(screen.getByTestId('create-page-kind').textContent).toBe('HTML');
    expect(screen.getByTestId('create-page-kind-hint')).toHaveTextContent(
      t('engine.studio.interfaces.create.pageKindHtmlHint', 'en-US'),
    );
    const options = await listed('create-page-kind');
    expect(options.map((o) => o.textContent)).toEqual(['HTML', 'React']);
    fireEvent.click(options[1]);
    expect(screen.getByTestId('kind')).toHaveTextContent('react');
    expect(screen.getByTestId('create-page-kind-hint')).toHaveTextContent(
      t('engine.studio.interfaces.create.pageKindReactHint', 'en-US'),
    );
  });

  it('offers no react on a deployment that turned react pages off', async () => {
    disableCapability(CAP_REACT_PAGES);
    render(<Host />);
    expect((await listed('create-page-kind')).map((o) => o.textContent)).toEqual(['HTML']);
  });
});
