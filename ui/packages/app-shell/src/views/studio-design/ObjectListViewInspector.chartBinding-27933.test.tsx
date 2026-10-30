// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27933 — the list-view panel edits a chart view's binding: the
 * ADR-0021 dataset of this object it reads, and that dataset's measures and
 * dimensions, all in the list body's `chart` block.
 *
 * The REAL hook (`useObjectListViewDraft`) and the REAL panel over a REAL
 * `MetadataClient`, whose transport serves the dataset catalog, judges every
 * view PUT with the installed spec's `view` schema and answers the write
 * door's 422 on refusal.
 *
 * Pinned:
 *  - the object's two datasets are listed by label (a dataset of another
 *    object is not), and the stored binding shows by label;
 *  - picking the other dataset keeps the measure both declare and drops the
 *    measure and the dimension it does not, then a dimension of its own is
 *    added by label; the saved draft holds that binding, the spec accepts it,
 *    and a reopened panel shows it;
 *  - a dataset that shares no measure leaves none: the `values` key is
 *    removed, so the pillar holds the edit (the spec would refuse it) until a
 *    measure is picked;
 *  - a stored name the bound dataset does not declare is shown, marked;
 *  - the catalog read fails: the stored names are shown as saved, with the
 *    reason, and the rest of the panel is unaffected;
 *  - the Studio's draft world reads the draft-overlaid catalog;
 *  - CONTROLS: an object with no dataset says so and offers no picker; a grid
 *    and a calendar view get no chart section.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';

const PKG = 'com.acme.app';
const VIEW = 'acme_task.default';

const OBJECT_DEF = {
  name: 'acme_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
    start_date: { name: 'start_date', label: 'Start date', type: 'date' },
  },
};

const HOURS = {
  name: 'task_hours',
  label: 'Task hours',
  object: 'acme_task',
  measures: [
    { name: 'record_count', label: 'Tasks', aggregate: 'count' },
    { name: 'total_hours', label: 'Total hours', aggregate: 'sum' },
  ],
  dimensions: [{ name: 'by_status', label: 'By status' }],
};
const THROUGHPUT = {
  name: 'task_throughput',
  label: 'Throughput',
  object: 'acme_task',
  measures: [
    { name: 'record_count', label: 'Tasks', aggregate: 'count' },
    { name: 'avg_cycle', label: 'Average cycle time', aggregate: 'avg' },
  ],
  dimensions: [{ name: 'by_week', label: 'By week' }],
};
const BURN = {
  name: 'task_burn',
  label: 'Burn',
  object: 'acme_task',
  measures: [{ name: 'burned', label: 'Burned', aggregate: 'sum' }],
  dimensions: [],
};
const DEALS = {
  name: 'deal_stats',
  label: 'Deals',
  object: 'acme_deal',
  measures: [{ name: 'record_count', label: 'Deals' }],
  dimensions: [],
};

const view = (config: Record<string, unknown>) => ({
  name: VIEW,
  object: 'acme_task',
  viewKind: 'list',
  isDefault: true,
  config: { data: { provider: 'object', object: 'acme_task' }, columns: ['title', 'status'], ...config },
});

const chartView = (chart: Record<string, unknown>) => view({ type: 'chart', chart });

const server = {
  active: new Map<string, Record<string, unknown>>(),
  datasets: [] as Array<Record<string, unknown>> | 'fail',
  datasetListUrls: [] as string[],
  puts: [] as Array<{ name: string; status: number; body: any }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg[0] === 'dataset' && seg.length === 1) {
    server.datasetListUrls.push(url.pathname + url.search);
    return server.datasets === 'fail'
      ? json(503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'analytics offline' } })
      : json(200, { items: server.datasets });
  }
  if (method === 'PUT') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const verdict = getMetadataTypeSchema('view')!.safeParse(body);
    server.puts.push({ name: seg[1]!, status: verdict.success ? 200 : 422, body });
    if (!verdict.success) {
      return json(422, {
        success: false,
        error: { code: 'INVALID_METADATA', message: 'view failed validation', details: { issues: verdict.error.issues } },
      });
    }
    return json(200, { success: true, version: 'v2', state: 'draft' });
  }
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  // No view draft is pending in this suite.
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  }
  const row = server.active.get(key);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { listViewHeldEdit, ObjectListViewInspector, useObjectListViewDraft } from './ObjectListViewInspector';
import { StudioDatasetAuthoringContext } from './datasetCreate';
import type { Surface } from './navSurface';

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
};

const LEAF: Surface = { type: 'object', name: 'acme_task', label: 'Tasks' };

/** The panel, the pillar's held judgement of its buffer, and the autosave's one call into it. */
function Host({ readOnly = false }: { readOnly?: boolean }) {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  return (
    <>
      <span data-testid="dirty">{String(listView.dirty)}</span>
      <span data-testid="held">{listViewHeldEdit(listView, 'en')?.input ?? ''}</span>
      <button type="button" data-testid="save" onClick={() => void listView.save({ unmoved: () => true })}>
        save
      </button>
      <ObjectListViewInspector listView={listView} readOnly={readOnly} locale="en" />
    </>
  );
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function openPanel({ readOnly = false, studio = false }: { readOnly?: boolean; studio?: boolean } = {}): Promise<void> {
  const host = <Host readOnly={readOnly} />;
  render(
    <MetadataCtx.Provider value={METADATA}>
      {studio ? (
        <StudioDatasetAuthoringContext.Provider value={{ packageId: PKG }}>{host}</StudioDatasetAuthoringContext.Provider>
      ) : (
        host
      )}
    </MetadataCtx.Provider>,
  );
  await settle();
  await waitFor(() => expect(screen.getByTestId('studio-list-view-inspector')).toBeInTheDocument());
}

const section = () => screen.getByTestId('list-view-chart');
const datasetTrigger = () => within(section()).getByTestId('list-view-chart-dataset-trigger');

/** The labels a select lists, as an author opens it. */
async function optionsOf(trigger: HTMLElement): Promise<string[]> {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const labels = within(listbox)
    .getAllByRole('option')
    .map((o) => o.textContent ?? '');
  fireEvent.keyDown(listbox, { key: 'Escape' });
  await settle();
  return labels;
}

/** Pick the option whose text starts with `label` in the select `trigger`. */
async function pick(trigger: HTMLElement, label: string) {
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  const hit = within(listbox)
    .getAllByRole('option')
    .find((o) => (o.textContent ?? '').startsWith(label));
  if (!hit) throw new Error(`no option "${label}"`);
  fireEvent.click(hit);
  await settle();
}

const addPicker = (key: 'values' | 'dimensions') => document.getElementById(`studio-list-view-chart-${key}`)!;

/** The names a member list holds, in order, and the ones marked as not in the dataset. */
function members(key: 'values' | 'dimensions') {
  const rows = within(screen.getByTestId(`list-view-chart-${key}`)).queryAllByTestId('list-view-chart-member');
  return {
    names: rows.map((r) => r.getAttribute('data-name')),
    labels: rows.map((r) => r.firstElementChild?.firstElementChild?.textContent),
    stale: rows.filter((r) => r.getAttribute('data-stale') === 'true').map((r) => r.getAttribute('data-name')),
  };
}

async function save() {
  fireEvent.click(screen.getByTestId('save'));
  await settle();
}

beforeEach(() => {
  server.active.clear();
  server.datasets = [HOURS, THROUGHPUT, BURN, DEALS];
  server.datasetListUrls = [];
  server.puts = [];
});
afterEach(cleanup);

describe('objectstack#27933 — a chart view’s dataset binding in the list-view panel', () => {
  it('lists the object’s datasets by label, never another object’s, and shows the stored binding by label', async () => {
    server.active.set(`view/${VIEW}`, chartView({ dataset: 'task_hours', values: ['total_hours'], dimensions: ['by_status'] }));
    await openPanel();
    await waitFor(() => expect(datasetTrigger()).toHaveTextContent('Task hours (task_hours)'));
    expect(await optionsOf(datasetTrigger())).toEqual([
      'Task hours (task_hours)',
      'Throughput (task_throughput)',
      'Burn (task_burn)',
    ]);
    await waitFor(() => expect(members('values').labels).toEqual(['Total hours']));
    expect(members('dimensions').labels).toEqual(['By status']);
    // The add pickers offer the bound dataset's other members, by label.
    expect(await optionsOf(addPicker('values'))).toEqual(['Tasksrecord_count']);
    // Opening the panel edits nothing, so the autosave has nothing to send.
    expect(screen.getByTestId('dirty')).toHaveTextContent('false');
    expect(server.puts).toEqual([]);
  });

  it('another dataset keeps the shared measure, drops what it does not declare; each pick saves, and a reopened panel shows it', async () => {
    server.active.set(
      `view/${VIEW}`,
      chartView({ chartType: 'line', dataset: 'task_hours', values: ['record_count', 'total_hours'], dimensions: ['by_status'] }),
    );
    await openPanel();
    await waitFor(() => expect(members('values').names).toEqual(['record_count', 'total_hours']));

    await pick(datasetTrigger(), 'Throughput');
    expect(datasetTrigger()).toHaveTextContent('Throughput (task_throughput)');
    await waitFor(() => expect(members('values').names).toEqual(['record_count']));
    expect(members('values').stale).toEqual([]);
    expect(members('dimensions').names).toEqual([]);

    await pick(addPicker('dimensions'), 'By week');
    await pick(addPicker('values'), 'Average cycle time');
    expect(members('values').labels).toEqual(['Tasks', 'Average cycle time']);
    expect(screen.getByTestId('held')).toHaveTextContent(/^$/);

    await save();
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0]!.status).toBe(200);
    expect(server.puts[0]!.body.config.chart).toEqual({
      chartType: 'line',
      dataset: 'task_throughput',
      values: ['record_count', 'avg_cycle'],
      dimensions: ['by_week'],
    });

    // Reopen on what was saved: the panel shows the stored binding.
    server.active.set(`view/${VIEW}`, server.puts[0]!.body);
    cleanup();
    await openPanel();
    await waitFor(() => expect(datasetTrigger()).toHaveTextContent('Throughput (task_throughput)'));
    await waitFor(() => expect(members('values').labels).toEqual(['Tasks', 'Average cycle time']));
    expect(members('dimensions').labels).toEqual(['By week']);
  });

  it('a dataset that shares no measure leaves none: the edit is held until one is picked, never sent for the spec to refuse', async () => {
    server.active.set(`view/${VIEW}`, chartView({ dataset: 'task_hours', values: ['total_hours'] }));
    await openPanel();
    await waitFor(() => expect(members('values').names).toEqual(['total_hours']));

    await pick(datasetTrigger(), 'Burn');
    expect(members('values').names).toEqual([]);
    // Held on the unset measures, by the label the section draws them with.
    expect(screen.getByTestId('held')).toHaveTextContent('Measures');
    // What the hold keeps from the draft door: the spec refuses the block without measures.
    const refused = getMetadataTypeSchema('view')!.safeParse(chartView({ dataset: 'task_burn' }));
    expect(refused.success).toBe(false);
    // An empty list would be finished-but-wrong, which is sent: the key is removed instead.
    expect(within(section()).getByTestId('list-view-chart-dimensions')).toHaveTextContent('This dataset declares no dimensions.');

    await pick(addPicker('values'), 'Burned');
    expect(screen.getByTestId('held')).toHaveTextContent(/^$/);
    await save();
    expect(server.puts.map((p) => p.status)).toEqual([200]);
    expect(server.puts[0]!.body.config.chart).toEqual({ dataset: 'task_burn', values: ['burned'] });
  });

  it('marks a stored name the bound dataset does not declare, and lets it be removed', async () => {
    server.active.set(`view/${VIEW}`, chartView({ dataset: 'task_hours', values: ['record_count', 'retired_measure'] }));
    await openPanel();
    await waitFor(() => expect(members('values').stale).toEqual(['retired_measure']));
    fireEvent.click(within(screen.getByTestId('list-view-chart-values')).getByRole('button', { name: /retired_measure/ }));
    await settle();
    expect(members('values').names).toEqual(['record_count']);
    await save();
    expect(server.puts[0]!.body.config.chart).toEqual({ dataset: 'task_hours', values: ['record_count'] });
  });

  it('a failed catalog read shows the stored names as saved, with the reason; the panel carries on', async () => {
    server.datasets = 'fail';
    server.active.set(`view/${VIEW}`, chartView({ dataset: 'task_hours', values: ['total_hours'], dimensions: ['by_status'] }));
    await openPanel();
    await waitFor(() => expect(within(section()).getByTestId('list-view-chart-read-failed')).toHaveTextContent('analytics offline'));
    expect(within(section()).queryByTestId('list-view-chart-dataset-trigger')).toBeNull();
    expect(within(section()).getByTestId('list-view-chart-stored-dataset')).toHaveTextContent('task_hours');
    expect(members('values')).toEqual({ names: ['total_hours'], labels: ['total_hours'], stale: [] });
    expect(members('dimensions').names).toEqual(['by_status']);
    expect(addPicker('values')).toBeNull();
    expect(screen.getByTestId('list-view-columns')).toBeInTheDocument();
  });

  it('reads the draft-overlaid catalog in the Studio’s draft world', async () => {
    server.active.set(`view/${VIEW}`, chartView({ dataset: 'task_hours', values: ['total_hours'] }));
    await openPanel({ studio: true });
    await waitFor(() => expect(datasetTrigger()).toHaveTextContent('Task hours'));
    expect(server.datasetListUrls).toEqual(['/api/v1/meta/dataset?preview=draft']);
  });

  it('a read-only package shows the binding and offers no edit', async () => {
    server.active.set(`view/${VIEW}`, chartView({ dataset: 'task_hours', values: ['total_hours'] }));
    await openPanel({ readOnly: true });
    await waitFor(() => expect(members('values').labels).toEqual(['Total hours']));
    expect(datasetTrigger()).toBeDisabled();
    expect(addPicker('values')).toBeNull();
    expect(within(screen.getByTestId('list-view-chart-values')).queryByRole('button')).toBeNull();
  });

  it('CONTROL: an object with no dataset says so and offers no empty picker', async () => {
    server.datasets = [DEALS];
    server.active.set(`view/${VIEW}`, chartView({ dataset: 'task_hours', values: ['total_hours'] }));
    await openPanel();
    await waitFor(() => expect(within(section()).getByTestId('list-view-chart-no-datasets')).toBeInTheDocument());
    expect(within(section()).queryByTestId('list-view-chart-dataset-trigger')).toBeNull();
    expect(addPicker('values')).toBeNull();
  });

  it('CONTROL: a grid and a calendar view get no chart section', async () => {
    server.active.set(`view/${VIEW}`, view({ type: 'grid' }));
    await openPanel();
    expect(screen.queryByTestId('list-view-chart')).toBeNull();
    cleanup();
    server.active.set(`view/${VIEW}`, view({ type: 'calendar', calendar: { startDateField: 'start_date' } }));
    await openPanel();
    expect(screen.getByTestId('list-view-type-settings')).toBeInTheDocument();
    expect(screen.queryByTestId('list-view-chart')).toBeNull();
    expect(server.datasetListUrls).toEqual([]);
  });
});
