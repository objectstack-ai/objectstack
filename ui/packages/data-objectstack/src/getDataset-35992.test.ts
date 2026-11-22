/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectStackAdapter.getDataset` — the dataset definition a dashboard reads to
 * learn a dataset-bound widget's base object, so a filter on a field holding
 * several values is lowered to `$contains` (objectstack#35992).
 *
 * `null` means "no such dataset" and a failure rejects, so the dashboard can
 * tell the two apart. Every case goes through the real `ObjectStackClient`
 * over a stubbed `fetch`, so the client's envelope unwrap and error raise are
 * part of what is measured.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let seq = 0;

/** A fresh base URL per adapter, so the shared discovery cache cannot carry over. */
function makeAdapter(meta: (url: string) => Response) {
  const baseUrl = `http://dataset-def-35992-${++seq}.local`;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/discovery')) return json(200, { success: true, data: {} });
    return meta(url);
  });
  return { adapter: new ObjectStackAdapter({ baseUrl, fetch: fetchImpl }), fetchImpl };
}

const metaUrls = (fetchImpl: ReturnType<typeof makeAdapter>['fetchImpl']) =>
  fetchImpl.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/api/v1/meta/'));

const DATASET = { name: 'project_metrics', label: 'Project Metrics', object: 'showcase_project' };

describe('ObjectStackAdapter.getDataset (objectstack#35992)', () => {
  it('reads GET /api/v1/meta/dataset/:name and answers the item', async () => {
    const { adapter, fetchImpl } = makeAdapter(() =>
      json(200, { success: true, data: { type: 'dataset', name: 'project_metrics', item: DATASET } }),
    );
    await expect(adapter.getDataset('project_metrics')).resolves.toMatchObject({ object: 'showcase_project' });
    expect(metaUrls(fetchImpl)).toEqual([expect.stringMatching(/\/api\/v1\/meta\/dataset\/project_metrics$/)]);
  });

  it("sends the reader's package as callerPackage", async () => {
    const { adapter, fetchImpl } = makeAdapter(() =>
      json(200, { success: true, data: { type: 'dataset', name: 'project_metrics', item: DATASET } }),
    );
    await adapter.getDataset('project_metrics', { callerPackage: 'com.example.showcase' });
    expect(metaUrls(fetchImpl)).toEqual([
      expect.stringMatching(/\/api\/v1\/meta\/dataset\/project_metrics\?callerPackage=com\.example\.showcase$/),
    ]);
  });

  it('answers null for an envelope with no item (no such dataset)', async () => {
    const { adapter } = makeAdapter(() => json(200, { success: true, data: { type: 'dataset', name: 'nope' } }));
    await expect(adapter.getDataset('nope')).resolves.toBeNull();
  });

  it('answers null for a 404', async () => {
    const { adapter } = makeAdapter(() =>
      json(404, { success: false, error: { code: 'RESOURCE_NOT_FOUND', message: 'not found' } }),
    );
    await expect(adapter.getDataset('nope')).resolves.toBeNull();
  });

  it('REJECTS a failed read instead of answering "no such dataset"', async () => {
    const { adapter } = makeAdapter(() =>
      json(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'registry offline' } }),
    );
    await expect(adapter.getDataset('project_metrics')).rejects.toMatchObject({
      httpStatus: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('reads one definition once per name and reader package', async () => {
    const { adapter, fetchImpl } = makeAdapter(() =>
      json(200, { success: true, data: { type: 'dataset', name: 'project_metrics', item: DATASET } }),
    );
    await adapter.getDataset('project_metrics');
    await adapter.getDataset('project_metrics');
    expect(metaUrls(fetchImpl)).toHaveLength(1);
  });
});
