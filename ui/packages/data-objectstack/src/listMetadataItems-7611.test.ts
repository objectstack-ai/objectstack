/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ObjectStackAdapter.listMetadataItems` — the registry list the
 * `position-ref` / `permission-ref` field widgets read (objectui#7611).
 *
 * The `DataSource` contract makes an empty answer AUTHORITATIVE ("this registry
 * declares no item of this type"), so a failure must reject — never resolve
 * `[]`, which is the defect `getObjects` keeps. Every case goes through the
 * real `ObjectStackClient` over a stubbed `fetch`, so the client's own
 * envelope unwrap and error raise are part of what is measured.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let seq = 0;

/** A fresh base URL per adapter, so the shared discovery cache cannot carry over. */
function makeAdapter(meta: (url: string) => Response) {
  const baseUrl = `http://registry-list-7611-${++seq}.local`;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/discovery')) return json(200, { success: true, data: {} });
    return meta(url);
  });
  return { adapter: new ObjectStackAdapter({ baseUrl, fetch: fetchImpl }), fetchImpl };
}

describe('ObjectStackAdapter.listMetadataItems (objectui#7611)', () => {
  it("reads GET /api/v1/meta/:type and answers each item's name and label", async () => {
    const { adapter, fetchImpl } = makeAdapter(() =>
      json(200, {
        success: true,
        data: {
          type: 'position',
          items: [
            { name: 'sales_manager', label: 'Sales Manager', permissionSets: ['sales_user'] },
            { name: 'auditor' },
          ],
        },
      }),
    );

    await expect(adapter.listMetadataItems('position')).resolves.toEqual([
      { name: 'sales_manager', label: 'Sales Manager' },
      { name: 'auditor' },
    ]);
    const urls = fetchImpl.mock.calls.map(([u]) => String(u));
    expect(urls.some((u) => u.endsWith('/api/v1/meta/position'))).toBe(true);
  });

  it('lists only items with a string name, and leaves off a label that is not a string', async () => {
    const { adapter } = makeAdapter(() =>
      json(200, {
        success: true,
        data: {
          type: 'permission',
          items: [
            { name: 'sales_user', label: { en: 'Sales User' } },
            { label: 'Nameless' },
            { name: 42 },
            null,
          ],
        },
      }),
    );

    await expect(adapter.listMetadataItems('permission')).resolves.toEqual([{ name: 'sales_user' }]);
  });

  it('answers an empty registry as [] — the authoritative empty answer', async () => {
    const { adapter } = makeAdapter(() => json(200, { success: true, data: { type: 'position', items: [] } }));
    await expect(adapter.listMetadataItems('position')).resolves.toEqual([]);
  });

  it('REJECTS a failed request instead of answering an empty registry', async () => {
    const { adapter } = makeAdapter(() =>
      json(500, { success: false, error: { code: 'INTERNAL_ERROR', message: 'registry offline' } }),
    );
    // The transport's own error, as the client stamps it — not a substitute.
    await expect(adapter.listMetadataItems('position')).rejects.toMatchObject({
      httpStatus: 500,
      code: 'INTERNAL_ERROR',
    });
  });

  it('REJECTS an answer that carries no items list instead of reading it as empty', async () => {
    const { adapter } = makeAdapter(() => json(200, { success: true, data: { type: 'position' } }));
    await expect(adapter.listMetadataItems('position')).rejects.toThrow(/items list/);
  });
});
