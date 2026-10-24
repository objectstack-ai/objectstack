// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11910 — the Interfaces pillar holds a new dashboard widget unsent
 * until it is bound, instead of drawing a red refusal.
 *
 * The card: *Add widget* → *Metric* made the leaf autosave PUT the widget as
 * `{ id, type, title }`, the draft door answered 422 on its `dataset` and
 * `values`, and "Changes not saved" showed right after the click. The pillar now
 * holds such a dashboard as the Data and Automations pillars hold theirs
 * (objectui#11786): nothing is sent, the widget's inspector says what it needs,
 * a neutral line on the canvas names it, and binding it lets the next autosave
 * go. A finished widget the server refuses still shows the red strip.
 *
 * Mounted with a metadata client double that records every save, the real
 * `DashboardPreview` canvas (its *Add widget* picker) and the real
 * `DashboardWidgetInspector`.
 *
 * objectui#11951: removing a bound widget's last measure (or the last dimension
 * a two-measure scatter needs) is held the same way, not sent as a shape the
 * spec refuses; the second `describe` pins it through the inspector's own
 * remove buttons.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DashboardSchema } from '@objectstack/spec/ui';
// Module-scope import of the lazily loaded canvas renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';

const NAV = [{ id: 'nav_sales', type: 'dashboard', label: 'Sales', dashboardName: 'sales_dash' }];

/** One bound widget: the dashboard parses with the spec as served. */
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

/** The object a nav entry added in the last pin is bound to (objectui#11776). */
const TASK = { name: 'acme_task', label: 'Task' };

let refuseDashboard: Error | null;
/** The dashboard the metadata double serves; objectui#11951's pins swap in their own. */
let dashFixture: Record<string, unknown> = SALES_DASH;

const mockClient = {
  save: vi.fn(async (type: string, _name: string, _body: Record<string, unknown>) => {
    if (type === 'dashboard' && refuseDashboard) throw refuseDashboard;
    return { success: true, version: 'v1', state: 'draft' };
  }),
  list: vi.fn(async (type: string) => {
    if (type === 'app') return [{ name: 'acme_app', label: 'Acme' }];
    if (type === 'dataset') return DATASETS;
    if (type === 'dashboard') return [dashFixture];
    if (type === 'object') return [TASK];
    return [];
  }),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', active: true, navigation: NAV } };
    if (type === 'dashboard') return { effective: JSON.parse(JSON.stringify(dashFixture)) };
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
import { t, tFormat } from '../metadata-admin/i18n';

registerMetadataPreview('dashboard', DashboardPreview);
registerMetadataInspector('dashboard', DashboardWidgetInspector);

beforeEach(() => {
  refuseDashboard = null;
  dashFixture = SALES_DASH;
  for (const fn of Object.values(mockClient)) fn.mockClear();
});
afterEach(cleanup);

function mountPillar(onHeldEditChange?: (clause: string | null) => void) {
  return render(
    <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
      <InterfacesPillar packageId="com.acme.app" onHeldEditChange={onHeldEditChange} />
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

/** Past the autosave's 1.5 s debounce. */
async function outlastDebounce(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 2300));
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** The dashboard leaf is open on its canvas, in design mode. */
async function ready(): Promise<void> {
  await screen.findByTitle('dashboard · sales_dash', undefined, { timeout: 8000 });
  await screen.findByRole('button', { name: t('engine.inspector.add.widget', 'en') }, { timeout: 8000 });
}

/** *Add widget* → *Metric (KPI)*: the canvas selects the new widget, whose inspector opens. */
async function addMetric(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: t('engine.inspector.add.widget', 'en') }));
  await userEvent.click(await screen.findByRole('button', { name: /^Metric \(KPI\)/ }));
  await within(rail()).findByDisplayValue('New metric (kpi)', undefined, { timeout: 8000 });
}

async function bindDataset(): Promise<void> {
  await userEvent.click(within(rail()).getByRole('combobox', { name: t('engine.inspector.widget.dataset', 'en') }));
  await userEvent.click(await screen.findByRole('option', { name: /sales_ds/ }));
  await flush();
}

/** The measures editor is the second "Add field" in the binding section (dimensions first). */
async function addMeasure(): Promise<void> {
  const adds = await within(rail()).findAllByRole('button', { name: t('engine.form.addFieldPlain', 'en') });
  expect(adds.length, 'the dimensions and measures editors').toBe(2);
  fireEvent.click(adds[1]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByText(/^Revenue/));
  await flush();
}

const heldLine = (input: string, widget = 'New metric (kpi)') =>
  tFormat('engine.studio.held.line', 'en', {
    clause: tFormat('engine.studio.held.widgetNeedsInput', 'en', { input: t(input, 'en'), widget }),
  });

describe('a new dashboard widget is held until it is bound (objectui#11910)', () => {
  it('Add widget → Metric sends nothing and shows no red strip; the line and the inspector name the dataset', async () => {
    const report = vi.fn();
    mountPillar(report);
    await ready();
    await addMetric();
    await outlastDebounce();

    expect(dashboardSaves(), 'the unbound widget is not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal'), 'no red strip on the normal path').toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(heldLine('engine.inspector.widget.dataset'));
    expect(within(rail()).getByTestId('widget-field-held-hint-dataset')).toHaveTextContent(
      t('engine.studio.held.inputHint', 'en'),
    );
    // Publish's half: the surface is told what is held.
    expect(report).toHaveBeenLastCalledWith(
      tFormat('engine.studio.held.widgetNeedsInput', 'en', {
        input: t('engine.inspector.widget.dataset', 'en'),
        widget: 'New metric (kpi)',
      }),
    );
  });

  it('a dataset moves the hold to the measures; a measure sends the save, which the spec accepts, and clears it', async () => {
    const report = vi.fn();
    mountPillar(report);
    await ready();
    await addMetric();
    await bindDataset();
    await outlastDebounce();
    expect(dashboardSaves()).toEqual([]);
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(heldLine('engine.inspector.widget.values'));
    expect(within(rail()).queryByTestId('widget-field-held-hint-dataset')).toBeNull();
    expect(within(rail()).getByTestId('widget-field-held-hint-values')).toBeInTheDocument();

    await addMeasure();
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    const [sent] = dashboardSaves();
    expect((sent.widgets as unknown[])[1]).toMatchObject({
      id: 'widget_1',
      type: 'metric',
      dataset: 'sales_ds',
      values: ['revenue'],
    });
    expect(DashboardSchema.safeParse(sent).success, 'the body sent is one the door accepts').toBe(true);
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(within(rail()).queryByTestId('widget-field-held-hint-values')).toBeNull();
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(report).toHaveBeenLastCalledWith(null);
  });

  it('"Show me" reopens the held widget after its inspector was closed', async () => {
    mountPillar();
    await ready();
    await addMetric();
    expect(
      within(screen.getByTestId('studio-held')).queryByRole('button', { name: t('engine.studio.refusal.show', 'en') }),
      'no "Show me" while that widget is the one open',
    ).toBeNull();

    fireEvent.click(within(rail()).getByRole('button', { name: t('engine.inspector.widget.close', 'en') }));
    await waitFor(() => expect(within(rail()).queryByDisplayValue('New metric (kpi)')).toBeNull());
    fireEvent.click(
      within(screen.getByTestId('studio-held')).getByRole('button', { name: t('engine.studio.refusal.show', 'en') }),
    );
    expect(await within(rail()).findByDisplayValue('New metric (kpi)')).toBeInTheDocument();
    expect(within(rail()).getByTestId('widget-field-held-hint-dataset')).toBeInTheDocument();
  });

  // CONTROL: errors stay for finished work.
  it('a finished widget the server refuses still shows the red strip, and no held line', async () => {
    refuseDashboard = Object.assign(new Error('Validation failed'), {
      status: 422,
      issues: [{ path: 'widgets.1.dataset', message: 'Dataset "sales_ds" is not published' }],
    });
    mountPillar();
    await ready();
    await addMetric();
    await bindDataset();
    await addMeasure();
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    expect(await screen.findByTestId('studio-refusal')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  // CONTROL: every type the picker offers needs a binding on the installed
  // spec (the predicate's pins walk them all), so the "saves at once" control
  // is an edit on a dashboard whose widgets are all bound.
  it('an edit to a dashboard whose widgets are all bound saves at once, with no line', async () => {
    mountPillar();
    await ready();
    const [pipeline] = await screen.findAllByTestId('dashboard-preview-widget-pipeline', undefined, { timeout: 8000 });
    fireEvent.click(pipeline);
    const title = await within(rail()).findByDisplayValue('Pipeline');
    fireEvent.change(title, { target: { value: 'Pipeline value' } });
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });

  // Only the leaf autosave is held: the nav editor's own save is another buffer.
  it('a held widget does not hold the navigation save', async () => {
    mountPillar();
    await ready();
    await addMetric();
    fireEvent.click(screen.getByTitle(/^Edit navigation/));
    fireEvent.click(await screen.findByRole('button', { name: /Add nav item/ }, { timeout: 8000 }));
    // *Link object* is the shared `Select` since objectui#11865: open its list and pick.
    fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(`\\(${TASK.name}\\)$`) }));
    await waitFor(() => expect(mockClient.save.mock.calls.filter((c) => c[0] === 'app')).toHaveLength(1), {
      timeout: 4000,
    });
    expect(dashboardSaves(), 'the widget is still held').toEqual([]);
    expect(screen.getByTestId('studio-held')).toBeInTheDocument();
  });
});

describe('a bound widget whose binding the author empties is held, not sent refused (objectui#11951)', () => {
  /** A bar with one dimension and a scatter with two measures, beside the bound metric. */
  const BINDINGS_DASH = {
    ...SALES_DASH,
    widgets: [
      ...SALES_DASH.widgets,
      {
        id: 'by_stage',
        type: 'bar',
        title: 'By stage',
        dataset: 'sales_ds',
        dimensions: ['stage'],
        values: ['revenue'],
        layout: { x: 3, y: 0, w: 3, h: 2 },
      },
      {
        id: 'spread',
        type: 'scatter',
        title: 'Spread',
        dataset: 'sales_ds',
        dimensions: ['stage'],
        values: ['revenue', 'deal_count'],
        layout: { x: 6, y: 0, w: 3, h: 2 },
      },
    ],
  };

  /** Selects the canvas widget `id`, whose inspector opens on `title`. */
  async function selectWidget(id: string, title: string): Promise<void> {
    const [tile] = await screen.findAllByTestId(`dashboard-preview-widget-${id}`, undefined, { timeout: 8000 });
    fireEvent.click(tile);
    await within(rail()).findByDisplayValue(title, undefined, { timeout: 8000 });
  }

  /** The inspector's own remove button on the member `name` of a binding list. */
  function remove(name: string): void {
    fireEvent.click(
      within(rail()).getByRole('button', { name: tFormat('engine.viewColumnPanes.remove', 'en', { label: name }) }),
    );
  }

  it('the precondition: the dashboard as served parses with the spec', () => {
    expect(DashboardSchema.safeParse(BINDINGS_DASH).success).toBe(true);
  });

  it('removing a metric\'s last measure sends nothing and shows no red strip; picking another sends it', async () => {
    const report = vi.fn();
    mountPillar(report);
    await ready();
    await selectWidget('pipeline', 'Pipeline');
    remove('revenue');
    await outlastDebounce();

    expect(dashboardSaves(), 'the emptied measure list is not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal'), 'no red strip while the author is mid-way').toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(
      heldLine('engine.inspector.widget.values', 'Pipeline'),
    );
    expect(within(rail()).getByTestId('widget-field-held-hint-values')).toHaveTextContent(
      t('engine.studio.held.inputHint', 'en'),
    );
    expect(report).toHaveBeenLastCalledWith(
      tFormat('engine.studio.held.widgetNeedsInput', 'en', {
        input: t('engine.inspector.widget.values', 'en'),
        widget: 'Pipeline',
      }),
    );

    await addMeasure();
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    const [sent] = dashboardSaves();
    expect((sent.widgets as unknown[])[0]).toMatchObject({ id: 'pipeline', values: ['revenue'] });
    expect(DashboardSchema.safeParse(sent).success, 'the body sent is one the door accepts').toBe(true);
    await waitFor(() => expect(screen.queryByTestId('studio-held')).toBeNull());
    expect(within(rail()).queryByTestId('widget-field-held-hint-values')).toBeNull();
    expect(report).toHaveBeenLastCalledWith(null);
  });

  it('removing a one-measure bar\'s last dimension saves at once, as the spec accepts it', async () => {
    dashFixture = BINDINGS_DASH;
    mountPillar();
    await ready();
    await selectWidget('by_stage', 'By stage');
    remove('stage');
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    const [sent] = dashboardSaves();
    expect((sent.widgets as unknown[])[1]).toMatchObject({ id: 'by_stage', dimensions: [], values: ['revenue'] });
    expect(DashboardSchema.safeParse(sent).success, 'an emptied dimension list is one the door accepts').toBe(true);
    expect(screen.queryByTestId('studio-held')).toBeNull();
    expect(within(rail()).queryByTestId('widget-field-held-hint-dimensions')).toBeNull();
  });

  it('removing a two-measure scatter\'s last dimension holds it, and the inspector names the dimensions', async () => {
    dashFixture = BINDINGS_DASH;
    mountPillar();
    await ready();
    await selectWidget('spread', 'Spread');
    remove('stage');
    await outlastDebounce();

    expect(dashboardSaves(), 'a scatter the spec refuses for want of a dimension is not sent').toEqual([]);
    expect(screen.queryByTestId('studio-refusal')).toBeNull();
    expect(screen.getByTestId('studio-held-message')).toHaveTextContent(
      heldLine('engine.inspector.widget.dimensions', 'Spread'),
    );
    expect(within(rail()).getByTestId('widget-field-held-hint-dimensions')).toHaveTextContent(
      t('engine.studio.held.inputHint', 'en'),
    );
    expect(within(rail()).queryByTestId('widget-field-held-hint-values')).toBeNull();
  });

  // CONTROL: a finished but wrong widget is still sent when the author empties
  // a binding beside what is wrong, and the refusal shows.
  it('a widget with a dataset the author wrote wrong is sent when its last measure is removed, and the refusal shows', async () => {
    dashFixture = {
      ...SALES_DASH,
      widgets: [{ ...SALES_DASH.widgets[0], dataset: 'Sales Pipeline' }],
    };
    refuseDashboard = Object.assign(new Error('Validation failed'), {
      status: 422,
      issues: [{ path: 'widgets.0.dataset', message: 'Identifier must be lowercase snake_case' }],
    });
    mountPillar();
    await ready();
    await selectWidget('pipeline', 'Pipeline');
    remove('revenue');
    await waitFor(() => expect(dashboardSaves()).toHaveLength(1), { timeout: 4000 });
    expect((dashboardSaves()[0].widgets as unknown[])[0]).toMatchObject({ dataset: 'Sales Pipeline', values: [] });
    expect(await screen.findByTestId('studio-refusal')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-held')).toBeNull();
  });
});
