// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28680 (maintainer ruling A) — *Publish all* writes app
 * navigation for each package-less page or dashboard it CREATES, the site the
 * retired `NavigationSyncEffect` diff used to catch.
 *
 * A package-less draft is a create when its item held no layer before the
 * publish (`/layers` answered 404); one that already had a published layer is
 * an update and writes nothing, so a page the author took out of navigation is
 * not put back by its next publish. Package-bound drafts never write: their
 * package ships its own navigation.
 *
 * Real: the hook, `useMetadataClient`, the `MetadataClient` it builds and the
 * `useNavigationWrites` door. Stubbed: `sonner`, `globalThis.fetch` (the
 * server) and the adapter's `meta.saveItem` (the app write).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { TranslateFn } from '@object-ui/i18n';
import { AdapterCtx, MetadataCtx, type MetadataContextValue } from '@object-ui/react';

vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
}));

import { usePublishAllDrafts } from '../usePublishAllDrafts';

const t: TranslateFn = (key) => key;

let drafts: unknown[] = [];
/** The `type/name` of every item that already has a published layer. */
let published = new Set<string>();
/** Every request the hook sent, as `METHOD path`, in order. */
const requests: string[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  requests.length = 0;
  published = new Set();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const path = url.slice(url.indexOf('/api/'));
      requests.push(`${(init?.method ?? 'GET').toUpperCase()} ${path}`);
      if (url.endsWith('/publish-drafts')) {
        return json({ success: true, data: { success: true, outcome: 'published', publishedCount: 1, failedCount: 0, published: [], failed: [] } });
      }
      const layers = path.match(/\/meta\/([^/]+)\/([^/?]+)\/layers/);
      if (layers) {
        const key = `${layers[1]}/${decodeURIComponent(layers[2])}`;
        return published.has(key)
          ? json({ code: null, overlay: { name: layers[2] }, overlayScope: 'env', effective: { name: layers[2] } })
          : json({ error: { code: 'NOT_FOUND', message: 'absent' } }, 404);
      }
      if (/\/publish(\?|$)/.test(url)) return json({ success: true, version: 'sha256:0', seq: 1, message: 'ok' });
      if (url.includes('/meta/_drafts')) return json({ drafts });
      return json({ success: true, data: {} });
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const crm = { name: 'crm', label: 'CRM', navigation: [] };

function metaValue(): MetadataContextValue {
  return {
    apps: [crm],
    objects: [],
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
    getTypeStatus: () => 'ready',
  } as unknown as MetadataContextValue;
}

async function publishAll() {
  const saveItem = vi.fn(async () => ({}));
  const adapter = { getClient: () => ({ meta: { saveItem } }) } as unknown as React.ComponentProps<
    typeof AdapterCtx.Provider
  >['value'];
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AdapterCtx.Provider value={adapter}>
      <MetadataCtx.Provider value={metaValue()}>{children}</MetadataCtx.Provider>
    </AdapterCtx.Provider>
  );
  const { result } = renderHook(() => usePublishAllDrafts(t), { wrapper });
  let outcome: Awaited<ReturnType<typeof result.current.publishAll>> | undefined;
  await act(async () => {
    outcome = await result.current.publishAll();
  });
  /** The entries written into `crm`, as `type:name`. */
  const entries = saveItem.mock.calls.map((call) => {
    const [, , schema] = call as unknown as [string, string, { navigation: Record<string, string>[] }];
    const e = schema.navigation.at(-1)!;
    return `${e.type}:${e.pageName ?? e.dashboardName}`;
  });
  return { outcome, entries };
}

describe('Publish all writes app navigation for the pages and dashboards it creates (objectstack#28680)', () => {
  it('a new package-less page and dashboard join navigation; an updated page, a packaged page and a flow do not', async () => {
    published.add('page/old_page');
    drafts = [
      { type: 'page', name: 'new_page', packageId: null },
      { type: 'page', name: 'old_page', packageId: null },
      { type: 'dashboard', name: 'new_dash', packageId: null },
      { type: 'page', name: 'pkg_page', packageId: 'com.acme.crm' },
      { type: 'flow', name: 'nightly_digest', packageId: null },
    ];
    const { outcome, entries } = await publishAll();

    expect(outcome).toEqual({ ok: true, attempted: 5 });
    expect(entries).toEqual(['page:new_page', 'dashboard:new_dash']);
    // The layers are asked BEFORE each publish, and only for pages and dashboards.
    expect(requests.filter((r) => r.includes('/layers'))).toEqual([
      'GET /api/v1/meta/page/new_page/layers',
      'GET /api/v1/meta/page/old_page/layers',
      'GET /api/v1/meta/dashboard/new_dash/layers',
    ]);
    const i = (needle: string) => requests.findIndex((r) => r.includes(needle));
    expect(i('/page/new_page/layers')).toBeLessThan(i('/page/new_page/publish'));
  });

  it('a layers read that fails is not taken for a create', async () => {
    drafts = [{ type: 'page', name: 'new_page', packageId: null }];
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) =>
        String(input).includes('/layers') ? json({ error: { code: 'INTERNAL', message: 'down' } }, 500) : realFetch(input as RequestInfo, init),
      ) as unknown as typeof fetch,
    );
    const { outcome, entries } = await publishAll();

    expect(outcome).toEqual({ ok: true, attempted: 1 });
    expect(entries).toEqual([]);
  });
});
