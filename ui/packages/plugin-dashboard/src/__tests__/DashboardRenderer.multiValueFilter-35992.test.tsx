/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35992 — a fixture dashboard whose global `select` filter is bound
 * to a field holding several values (`labels`, a `multiselect`; `team_members`,
 * a `user` with `multiple: true`).
 *
 * The server refuses `=` / `$in` on such a field (the data door answers 400;
 * the dataset door answers 200 with no rows), and answers `$contains` with the
 * matching rows. So the dashboard reads the bound field's definition first
 * (the dataset's base object through `DataSource.getDataset`, then
 * `getObjectSchema`), HOLDS the widget's query until it has it, and sends
 * `$contains` per member, `$or` for any of several. A data source without
 * `getDataset` keeps `=` / `$in` and says so, naming the filter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import type { DashboardComponentSchema } from '@object-ui/types';
// Side-effect imports at MODULE scope (ui/AGENTS.md flaky-test rule): the
// `provider: 'object'` table case draws `object-data-table`, registered here.
import '@object-ui/components';
import '../index';
import { DashboardRenderer } from '../DashboardRenderer';
import { resetFilterFieldFactsWarnings } from '../filterFieldFacts';

beforeEach(() => {
  resetFilterFieldFactsWarnings();
  // Best-effort metadata probes are not what these cases are about.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '{}' })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

/** The fixture object: one multi-value select, one multi-value user, one single-value select. */
const PROJECT_SCHEMA = {
  name: 'project',
  fields: {
    name: { type: 'text', label: 'Name' },
    labels: {
      type: 'multiselect',
      label: 'Labels',
      options: [
        { value: 'frontend', label: 'Frontend' },
        { value: 'qa', label: 'QA' },
      ],
    },
    team_members: { type: 'user', label: 'Team Members', multiple: true },
    status: { type: 'select', label: 'Status' },
  },
};

/** The fixture dashboard: a global filter on `labels`, read by a dataset-bound widget. */
const fixtureDashboard = (
  defaultValue: string | undefined,
  extra: Partial<DashboardComponentSchema> = {},
): DashboardComponentSchema => ({
  type: 'dashboard',
  globalFilters: [
    {
      name: 'label',
      field: 'labels',
      type: 'select',
      options: [
        { value: 'frontend', label: 'Frontend' },
        { value: 'qa', label: 'QA' },
      ],
      ...(defaultValue === undefined ? {} : { defaultValue }),
    },
  ],
  widgets: [{ id: 'w1', type: 'bar', dataset: 'project_metrics', values: ['project_count'] }],
  ...extra,
});

const makeQueryDataset = () =>
  vi.fn(async (_dataset: string, _selection: unknown) => ({ rows: [{ project_count: 2 }], fields: [] }));

const runtimeFilters = (queryDataset: ReturnType<typeof makeQueryDataset>, dataset: string): unknown[] =>
  queryDataset.mock.calls
    .filter((c) => c[0] === dataset)
    .map((c) => (c[1] as { runtimeFilter?: unknown })?.runtimeFilter);

const makeSource = (overrides: Record<string, unknown> = {}) => ({
  queryDataset: makeQueryDataset(),
  getDataset: vi.fn(async (name: string) =>
    name === 'project_metrics' ? { name, label: 'Project Metrics', object: 'project' } : null,
  ),
  getObjectSchema: vi.fn(async (object: string) => (object === 'project' ? PROJECT_SCHEMA : null)),
  ...overrides,
});

describe('DashboardRenderer: a global filter bound to a multi-value field (objectstack#35992)', () => {
  it('sends $contains for the selected member, never = on the multi-value field', async () => {
    const source = makeSource();
    render(<DashboardRenderer schema={fixtureDashboard('frontend')} dataSource={source} />);

    await waitFor(() =>
      expect(runtimeFilters(source.queryDataset, 'project_metrics')).toContainEqual({
        labels: { $contains: 'frontend' },
      }),
    );
    // Held until the definition arrived: no query ever carried the refused `=`.
    expect(runtimeFilters(source.queryDataset, 'project_metrics')).not.toContainEqual({ labels: 'frontend' });
    expect(source.getDataset).toHaveBeenCalledWith('project_metrics', undefined);
    expect(source.getObjectSchema).toHaveBeenCalledWith('project');
  });

  it('holds the widget query, drawing a skeleton, until the field definition arrives', async () => {
    let answerDataset!: (value: unknown) => void;
    const source = makeSource({
      getDataset: vi.fn(() => new Promise((resolve) => { answerDataset = resolve; })),
    });
    render(<DashboardRenderer schema={fixtureDashboard('frontend')} dataSource={source} />);

    expect(await screen.findByTestId('dashboard-widget-filter-pending')).toBeInTheDocument();
    expect(source.queryDataset).not.toHaveBeenCalled();

    await act(async () => {
      answerDataset({ name: 'project_metrics', label: 'Project Metrics', object: 'project' });
    });
    await waitFor(() =>
      expect(runtimeFilters(source.queryDataset, 'project_metrics')).toEqual([{ labels: { $contains: 'frontend' } }]),
    );
    expect(screen.queryByTestId('dashboard-widget-filter-pending')).not.toBeInTheDocument();
  });

  it('lowers a lookup filter on a multi-value user field to $contains', async () => {
    const source = makeSource();
    const schema = fixtureDashboard(undefined, {
      globalFilters: [{ name: 'member', field: 'team_members', type: 'lookup', defaultValue: 'usr_1' }],
    });
    render(<DashboardRenderer schema={schema} dataSource={source} />);
    await waitFor(() =>
      expect(runtimeFilters(source.queryDataset, 'project_metrics')).toEqual([{ team_members: { $contains: 'usr_1' } }]),
    );
  });

  it('holds nothing while the filter has no value', async () => {
    const source = makeSource({ getDataset: vi.fn(() => new Promise(() => {})) });
    render(<DashboardRenderer schema={fixtureDashboard(undefined)} dataSource={source} />);
    await waitFor(() => expect(runtimeFilters(source.queryDataset, 'project_metrics')).toEqual([undefined]));
    expect(screen.queryByTestId('dashboard-widget-filter-pending')).not.toBeInTheDocument();
  });

  it('keeps a single-value field on =', async () => {
    const source = makeSource();
    const schema = fixtureDashboard(undefined, {
      globalFilters: [
        { name: 'state', field: 'status', type: 'select', options: [{ value: 'open', label: 'Open' }], defaultValue: 'open' },
      ],
    });
    render(<DashboardRenderer schema={schema} dataSource={source} />);
    await waitFor(() => expect(runtimeFilters(source.queryDataset, 'project_metrics')).toContainEqual({ status: 'open' }));
  });

  it('a data source without getDataset keeps = and warns, naming the filter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = makeSource({ getDataset: undefined });
    render(<DashboardRenderer schema={fixtureDashboard('frontend')} dataSource={source} />);

    await waitFor(() =>
      expect(runtimeFilters(source.queryDataset, 'project_metrics')).toContainEqual({ labels: 'frontend' }),
    );
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"label"'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('getDataset');
    expect(lines[0]).toContain('"project_metrics"');
    expect(source.getObjectSchema).not.toHaveBeenCalled();
  });

  it('a dataset the server does not serve keeps = and warns, naming the filter', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const source = makeSource({ getDataset: vi.fn(async () => null) });
    render(<DashboardRenderer schema={fixtureDashboard('frontend')} dataSource={source} />);

    await waitFor(() =>
      expect(runtimeFilters(source.queryDataset, 'project_metrics')).toContainEqual({ labels: 'frontend' }),
    );
    expect(warn.mock.calls.map((c) => String(c[0])).some((l) => l.includes('"label"'))).toBe(true);
  });

  it('a provider: object table lowers the same filter against its own object', async () => {
    const find = vi.fn(async (_object: string, _query?: unknown) => ({ data: [{ id: '1', name: 'Apollo' }], total: 1 }));
    const source = { ...makeSource(), find, findOne: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() };
    const schema = fixtureDashboard('frontend', {
      widgets: [
        {
          id: 't1',
          type: 'table',
          options: { data: { provider: 'object', object: 'project' }, columns: [{ accessorKey: 'name', header: 'Name' }] },
        },
      ],
    });
    render(<DashboardRenderer schema={schema} dataSource={source} />);

    await waitFor(() =>
      expect(find.mock.calls.map((c) => (c[1] as { $filter?: unknown })?.$filter)).toContainEqual({
        labels: { $contains: 'frontend' },
      }),
    );
    expect(find.mock.calls.map((c) => (c[1] as { $filter?: unknown })?.$filter)).not.toContainEqual({ labels: 'frontend' });
    expect(source.getDataset).not.toHaveBeenCalled();
  });
});
