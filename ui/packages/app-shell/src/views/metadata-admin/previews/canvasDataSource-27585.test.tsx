// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27585 — the Studio canvas runs a report or a dataset widget over
 * a dataset that is still a draft.
 *
 * Through the REAL `ObjectStackAdapter` (its fetch stubbed) and the real
 * runtime renderers: the stub server answers the dataset by name only when the
 * request asks for the draft world, as the dataset door does for a draft-only
 * dataset, and a published-world request gets the door's own 404. Pinned:
 * - in the Studio (its dataset-authoring context present) the report preview
 *   and the dashboard preview send `previewDrafts: true` and draw the rows;
 * - outside it (Setup's editors) the same previews send no flag;
 * - the draft source is the adapter for every other member, one per adapter.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
// Module-scope imports of the lazily loaded renderers, so the previews'
// `React.lazy` factories resolve at once instead of racing the wait window
// (ui/AGENTS.md, flaky-test discipline). Specifiers identical to the previews'.
import '@object-ui/plugin-report';
import '@object-ui/plugin-dashboard';
import { ObjectStackAdapter, clearSharedDiscoveryCache } from '@object-ui/data-objectstack';
import { StudioDatasetAuthoringContext } from '../../studio-design/datasetCreate';

const current = vi.hoisted(() => ({ adapter: null as unknown }));
vi.mock('../../../providers/AdapterProvider', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../providers/AdapterProvider')>();
  return { ...mod, useAdapter: () => current.adapter };
});

import { ReportPreview } from './ReportPreview';
import { DashboardPreview } from './DashboardPreview';
import { datasetDraftsSource } from './canvasDataSource';

/** The dataset-query bodies the adapter posted. */
let posted: Array<Record<string, unknown>> = [];

function draftOnlyServer() {
  return vi.fn(async (url: unknown, init?: { body?: string }) => {
    const u = String(url);
    if (u.includes('/api/v1/discovery')) {
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data: { version: 'v1', routes: {} } }) };
    }
    if (u.includes('/api/v1/analytics/dataset/query')) {
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      posted.push(body);
      if (body.previewDrafts !== true) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found',
          json: async () => ({ code: 'NOT_FOUND', message: `Dataset "${String(body.datasetName)}" not found.` }),
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ rows: [{ region: 'north_draft_row', revenue: 7 }], fields: [] }),
      };
    }
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) };
  });
}

beforeEach(() => {
  clearSharedDiscoveryCache();
  posted = [];
  current.adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000',
    autoReconnect: false,
    fetch: draftOnlyServer() as never,
  });
});
afterEach(cleanup);

const authoring = { packageId: 'com.acme.sales' };
const inStudio = ({ children }: { children: React.ReactNode }) => (
  <StudioDatasetAuthoringContext.Provider value={authoring}>{children}</StudioDatasetAuthoringContext.Provider>
);

const report = { name: 'by_region', label: 'By region', dataset: 'draft_sales', rows: ['region'], values: ['revenue'] };
const dashboard = {
  name: 'sales_board',
  label: 'Sales',
  widgets: [
    { id: 'w1', type: 'table', title: 'By region', dataset: 'draft_sales', dimensions: ['region'], values: ['revenue'], layout: { x: 0, y: 0, w: 6, h: 4 } },
  ],
};

function renderReport(wrapper?: typeof inStudio) {
  return render(<ReportPreview type="report" name="by_region" draft={report} locale="en-US" />, wrapper ? { wrapper } : undefined);
}

function renderDashboard(wrapper?: typeof inStudio) {
  return render(
    <DashboardPreview type="dashboard" name="sales_board" draft={dashboard} selection={null} locale="en-US" />,
    wrapper ? { wrapper } : undefined,
  );
}

describe('Studio canvas — a draft-only dataset draws (objectstack#27585)', () => {
  it('the report preview asks for the draft world and draws its rows', async () => {
    renderReport(inStudio);
    expect(await screen.findByText('north_draft_row')).toBeInTheDocument();
    expect(posted).not.toHaveLength(0);
    for (const body of posted) expect(body).toMatchObject({ datasetName: 'draft_sales', previewDrafts: true });
  });

  it('the dashboard preview asks for the draft world and draws its rows', async () => {
    renderDashboard(inStudio);
    expect(await screen.findByText('north_draft_row')).toBeInTheDocument();
    expect(posted).not.toHaveLength(0);
    for (const body of posted) expect(body).toMatchObject({ datasetName: 'draft_sales', previewDrafts: true });
  });
});

describe('outside the Studio the previews query the published world', () => {
  it('the report preview sends no draft flag', async () => {
    renderReport();
    await waitFor(() => expect(posted).not.toHaveLength(0));
    for (const body of posted) expect(body).not.toHaveProperty('previewDrafts');
    expect(screen.queryByText('north_draft_row')).not.toBeInTheDocument();
  });

  it('the dashboard preview sends no draft flag', async () => {
    renderDashboard();
    await waitFor(() => expect(posted).not.toHaveLength(0));
    for (const body of posted) expect(body).not.toHaveProperty('previewDrafts');
    expect(screen.queryByText('north_draft_row')).not.toBeInTheDocument();
  });
});

describe('datasetDraftsSource', () => {
  it('is one source per adapter, and the adapter itself for every other member', () => {
    const calls: unknown[] = [];
    const adapter = {
      name: 'stub',
      queryDataset(this: unknown, ...args: unknown[]) {
        calls.push({ self: this, args });
        return Promise.resolve({ rows: [], fields: [] });
      },
      whoAmI(this: unknown) {
        return this;
      },
    };
    const source = datasetDraftsSource(adapter);
    expect(datasetDraftsSource(adapter)).toBe(source);
    expect(source.name).toBe('stub');
    expect(source.whoAmI()).toBe(adapter);
    void source.queryDataset('draft_sales', { measures: ['revenue'] }, { limit: 5 } as never);
    expect(calls).toEqual([
      { self: adapter, args: ['draft_sales', { measures: ['revenue'] }, { limit: 5, previewDrafts: true }] },
    ]);
  });
});
