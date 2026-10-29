// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26730 — the Interfaces strip gets a "Show me" that ends on the input.
 *
 * Measured before this card: a refused leaf save on the Interfaces page showed
 * its strip with no "Show me" at all, because the leaf save placed nothing
 * (`issueRefusal` with no locator). A dashboard's widget and a report's own
 * properties are now placed, and "Show me" opens them with the focus on the
 * input the sentence names: the widget's Title, the report's Label.
 *
 * Mounted like `InterfacesPillar.saveErrorClears-11950.test.tsx`: a metadata
 * client double whose leaf save answers the draft door's 422, with the real
 * registered previews and inspectors.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// Module-scope import of the lazily loaded canvas renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';

const DASH_NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_dash' }];
const REPORT_NAV = [{ id: 'nav_rep', type: 'report', label: 'Sales report', reportName: 'sales_report' }];

/** The app's navigation: the leaf the pillar opens first. */
let nav: Array<Record<string, unknown>> = DASH_NAV;

/** One bound widget: an edit to its title is a finished edit, sent at once. */
const SALES_DASH = {
  name: 'sales_dash',
  label: 'Sales',
  widgets: [
    {
      id: 'pipeline',
      type: 'metric',
      title: 'Pipeline',
      dataset: 'sales_ds',
      values: ['revenue'],
      layout: { x: 0, y: 0, w: 3, h: 2 },
    },
  ],
};

const SALES_REPORT = {
  name: 'sales_report',
  label: 'Sales report',
  type: 'tabular',
  dataset: 'sales_ds',
  values: ['revenue'],
};

const DATASETS = [
  {
    name: 'sales_ds',
    label: 'Sales',
    object: 'opportunity',
    dimensions: [{ name: 'stage', label: 'Stage' }],
    measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum' }],
  },
];

/** The draft door's 422 for every leaf save, naming `issuePath`. */
let issuePath = 'widgets.0.title';

function refusal(): Error {
  return Object.assign(new Error('Validation failed'), {
    status: 422,
    issues: [{ path: issuePath, message: 'Too long' }],
  });
}

const mockClient = {
  // The Studio's dataset pickers read the draft-overlaid catalog (objectstack#27518).
  withPreviewDrafts: vi.fn((): unknown => mockClient),
  save: vi.fn(async (type: string, _name: string, _body: Record<string, unknown>) => {
    if (type === 'dashboard' || type === 'report') throw refusal();
    return { success: true, version: 'v1', state: 'draft' };
  }),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'dataset') return DATASETS;
    if (type === 'dashboard') return [SALES_DASH];
    if (type === 'report') return [SALES_REPORT];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', active: true, navigation: nav } };
    if (type === 'dashboard') return { effective: JSON.parse(JSON.stringify(SALES_DASH)) };
    if (type === 'report') return { effective: JSON.parse(JSON.stringify(SALES_REPORT)) };
    return { code: null, overlay: null, overlayScope: null, effective: null };
  }),
  getDraft: vi.fn(async () => null),
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
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';
import { registerBuiltinPreviews } from '../metadata-admin/previews';
import { t, tFormat } from '../metadata-admin/i18n';

registerBuiltinPreviews();
registerBuiltinInspectors();

beforeEach(() => {
  nav = DASH_NAV;
  issuePath = 'widgets.0.title';
  for (const fn of Object.values(mockClient)) fn.mockClear();
});
afterEach(cleanup);

function mountPillar() {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" />
    </MemoryRouter>,
  );
}

/** The right rail: the inspector's own aside (classic layout). */
function rail(): HTMLElement {
  return screen.getByTestId('if-inspector');
}

const L = (key: string) => t(key, 'en');

describe('Interfaces page — "Show me" puts the focus on the input the refusal names (objectstack#26730)', () => {
  it('a dashboard widget\'s title: the widget opens with the focus on its Title', async () => {
    mountPillar();
    await screen.findByTitle('dashboard · sales_dash', undefined, { timeout: 8000 });
    const [pipeline] = await screen.findAllByTestId('dashboard-preview-widget-pipeline', undefined, { timeout: 8000 });
    fireEvent.click(pipeline);
    fireEvent.change(await within(rail()).findByDisplayValue('Pipeline'), { target: { value: 'Pipeline value' } });

    const strip = await screen.findByTestId('studio-refusal', undefined, { timeout: 4000 });
    expect(within(strip).getByTestId('studio-refusal-message')).toHaveTextContent(
      tFormat('engine.studio.refusal.widgetInput', 'en', { input: L('engine.inspector.widget.title'), widget: 'Pipeline value' }),
    );

    // Away from the widget: Escape drops the selection, so its inspector closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(within(rail()).queryByDisplayValue('Pipeline value')).toBeNull());

    fireEvent.click(within(strip).getByRole('button', { name: L('engine.studio.refusal.show') }));
    const title = await within(rail()).findByDisplayValue('Pipeline value', undefined, { timeout: 4000 });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('a report\'s own input: its properties open with the focus on it', async () => {
    nav = REPORT_NAV;
    issuePath = 'label';
    mountPillar();
    await screen.findByTitle('report · sales_report', undefined, { timeout: 8000 });
    const label = (await within(rail()).findByLabelText(L('engine.inspector.report.label'), undefined, {
      timeout: 8000,
    })) as HTMLInputElement;
    fireEvent.change(label, { target: { value: 'Sales by stage' } });

    const strip = await screen.findByTestId('studio-refusal', undefined, { timeout: 4000 });
    expect(within(strip).getByTestId('studio-refusal-message')).toHaveTextContent(
      tFormat('engine.studio.refusal.reportInput', 'en', { input: L('engine.inspector.report.label') }),
    );

    const show = within(strip).getByRole('button', { name: L('engine.studio.refusal.show') });
    show.focus();
    fireEvent.click(show);
    await waitFor(() => expect(document.activeElement).toBe(within(rail()).getByLabelText(L('engine.inspector.report.label'))));
  });
});
