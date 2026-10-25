// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11950 — a leaf save that goes through clears the red refusal strip
 * an earlier save of that leaf showed.
 *
 * The card: an Interfaces leaf (a dashboard here) whose autosave the draft door
 * refused showed "Changes not saved", and the strip stayed after the next edit
 * was saved. The leaf `doSave` set the pillar's error in its `catch` and
 * nothing but a leaf (re)load cleared it, so the strip went on saying the
 * draft was refused after the draft had been saved, until the author left the
 * leaf. Each save now starts clear, as the Data and Automations pillars' saves
 * do: as it is sent, before the request.
 *
 * Mounted like `InterfacesPillar.heldWidget-11910.test.tsx`: a metadata client
 * double that answers each dashboard save from a script (refuse, hold in
 * flight, or accept), the real `DashboardPreview` canvas and the real
 * `DashboardWidgetInspector`. Edits go through the bound widget's title.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
// Module-scope import of the lazily loaded canvas renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';

const NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_dash' }];

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

const DATASETS = [
  {
    name: 'sales_ds',
    label: 'Sales',
    object: 'opportunity',
    dimensions: [{ name: 'stage', label: 'Stage' }],
    measures: [{ name: 'revenue', label: 'Revenue', aggregate: 'sum' }],
  },
];

/** A save the double holds in flight until the test lets it land. */
interface Held {
  hold: Promise<void>;
  land: () => void;
}

function held(): Held {
  let land = () => {};
  const hold = new Promise<void>((resolve) => {
    land = resolve;
  });
  return { hold, land };
}

/** How the double answers each dashboard save, in order; past the end it accepts. */
let script: Array<Error | Held | 'accept'>;

/** The draft door's 422, naming one issue on the dashboard's only widget. */
function refusal(message: string): Error {
  return Object.assign(new Error('Validation failed'), {
    status: 422,
    issues: [{ path: 'widgets.0.dataset', message }],
  });
}

const mockClient = {
  save: vi.fn(async (type: string, _name: string, _body: Record<string, unknown>) => {
    if (type === 'dashboard') {
      const step = script.shift() ?? 'accept';
      if (step instanceof Error) throw step;
      if (step !== 'accept') await step.hold;
    }
    return { success: true, version: 'v1', state: 'draft' };
  }),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'dataset') return DATASETS;
    if (type === 'dashboard') return [SALES_DASH];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', active: true, navigation: NAV } };
    if (type === 'dashboard') return { effective: JSON.parse(JSON.stringify(SALES_DASH)) };
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
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { registerMetadataInspector } from '../metadata-admin/inspector-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';
import { DashboardWidgetInspector } from '../metadata-admin/inspectors/DashboardWidgetInspector';
import { t } from '../metadata-admin/i18n';

registerMetadataPreview('dashboard', DashboardPreview);
registerMetadataInspector('dashboard', DashboardWidgetInspector);

beforeEach(() => {
  script = [];
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

function dashboardSaves(): Array<Record<string, unknown>> {
  return mockClient.save.mock.calls.filter((c) => c[0] === 'dashboard').map((c) => c[2]);
}

/** The right rail: the inspector's own aside (classic layout). */
function rail(): HTMLElement {
  return screen.getByRole('complementary');
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** The dashboard leaf is open on its canvas, its bound widget's inspector in the rail. */
async function openPipeline(): Promise<HTMLElement> {
  await screen.findByTitle('dashboard · sales_dash', undefined, { timeout: 8000 });
  const [pipeline] = await screen.findAllByTestId('dashboard-preview-widget-pipeline', undefined, { timeout: 8000 });
  fireEvent.click(pipeline);
  return within(rail()).findByDisplayValue('Pipeline');
}

/** A finished edit: the widget's title, which the autosave sends as save number `nth`. */
async function retitle(title: HTMLElement, value: string, nth: number): Promise<void> {
  fireEvent.change(title, { target: { value } });
  await waitFor(() => expect(dashboardSaves()).toHaveLength(nth), { timeout: 4000 });
  await flush();
}

/** *Add widget* → *Metric (KPI)*: an unbound widget, which the pillar holds unsent (objectui#11910). */
async function addMetric(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: t('engine.inspector.add.widget', 'en') }));
  await userEvent.click(await screen.findByRole('button', { name: /^Metric \(KPI\)/ }));
  await within(rail()).findByDisplayValue('New metric (kpi)', undefined, { timeout: 8000 });
}

const FIRST = 'Dataset "sales_ds" is not published';
const SECOND = 'Dataset "sales_ds" was deleted';

describe('a leaf save that goes through clears the refusal an earlier save showed (objectui#11950)', () => {
  it('a refused save, then a save that goes through, leaves no strip', async () => {
    script = [refusal(FIRST), 'accept'];
    mountPillar();
    const title = await openPipeline();

    await retitle(title, 'Pipeline value', 1);
    expect(await screen.findByTestId('studio-refusal-detail')).toHaveTextContent(FIRST);

    await retitle(title, 'Pipeline total', 2);
    expect(dashboardSaves()[1]).toMatchObject({ widgets: [{ id: 'pipeline', title: 'Pipeline total' }] });
    await waitFor(() => expect(screen.queryByTestId('studio-refusal'), 'the saved draft shows no refusal').toBeNull());
  });

  // CONTROL: the reset does not swallow a refusal.
  it('a second refused save still shows its own refusal', async () => {
    script = [refusal(FIRST), refusal(SECOND)];
    mountPillar();
    const title = await openPipeline();

    await retitle(title, 'Pipeline value', 1);
    expect(await screen.findByTestId('studio-refusal-detail')).toHaveTextContent(FIRST);

    await retitle(title, 'Pipeline total', 2);
    await waitFor(() => expect(screen.getByTestId('studio-refusal-detail')).toHaveTextContent(SECOND));
    expect(screen.getAllByTestId('studio-refusal'), 'one strip, the latest save\'s').toHaveLength(1);
    expect(screen.getByTestId('studio-refusal-detail')).not.toHaveTextContent(FIRST);
  });

  // The held notice is the pillar's other line, read from the buffer rather
  // than from a save: a save that clears the refusal leaves it standing. The
  // sequence the pillar allows is on the same leaf, an unbound widget added
  // while a save is in flight; it holds one leaf's buffer only (objectui#11272),
  // so no other leaf's save can land beside a held one.
  it('a save in flight clears the refusal as it is sent, and leaves the hold an edit taken meanwhile raised', async () => {
    const inFlight = held();
    script = [refusal(FIRST), inFlight];
    mountPillar();
    const title = await openPipeline();

    await retitle(title, 'Pipeline value', 1);
    expect(await screen.findByTestId('studio-refusal')).toBeInTheDocument();

    await retitle(title, 'Pipeline total', 2);
    expect(screen.queryByTestId('studio-refusal'), 'cleared as the save is sent, as the other pillars\' saves are').toBeNull();

    await addMetric();
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();

    await act(async () => {
      inFlight.land();
    });
    await flush();
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(screen.getByTestId('studio-held'), 'the unbound widget is still held').toBeInTheDocument();
    expect(within(rail()).getByTestId('widget-field-held-hint-dataset')).toBeInTheDocument();
    expect(dashboardSaves(), 'and still unsent').toHaveLength(2);
  });
});
