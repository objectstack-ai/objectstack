// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36750 — the list-view buffer does not ask `GET …/layers` for the
 * fallback default view id.
 *
 * With no view of the object flagged default, the buffer edits
 * `<object>.default` (`listViewTargetOf`), the name the panel's first edit
 * creates the view under. Nothing is published under it, so the server
 * answers its `/layers` with a 404 (objectstack#22397) and the browser logs a
 * failed request on every open of such an object. The guard that used to skip
 * this read covered draft-only objects only (objectui#12508); since
 * objectstack#36511 a new object is published at once, so it no longer
 * applies. The buffer already knows the id is the fallback: no view of the
 * object's merged `listViews` (which holds every view item the server serves,
 * under its qualified name) nor of this package's drafted list views is held
 * under it.
 *
 * The REAL hook over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does (404 for `/layers` with no layer).
 *
 * Pinned:
 *  - the fallback id: no `/layers`, and the buffer reads "not created yet";
 *  - CONTROL: a published default view the merged `listViews` holds (flagged)
 *    still reads its layer;
 *  - CONTROL: a view held under `default` unflagged (the target falls back to
 *    the id a view really has) still reads its layer;
 *  - CONTROL: while the shell's objects are still loading, absence from them
 *    says nothing, so the layer is read as before; once they answer, the
 *    fallback stops being read; a context that reports no load status (a
 *    hand-rolled one) is read as before too;
 *  - the Customize door's served-override read (`useServedOverride`) skips
 *    the layered read for an item flagged `unpublished`, answering as its 404
 *    did, and still reads the pair's draft first.
 */

import '@testing-library/jest-dom/vitest';
// Paid at collection, not inside a clocked case (check:test-source-alias):
// the source under test loads `@objectstack/lint` lazily.
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue, type MetadataTypeStatus } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { useObjectListViewDraft, type ObjectListViewDraft } from './ObjectListViewInspector';
import { useServedOverride, type ServedOverride } from './StudioCustomizeControls';
import type { Surface } from './navSurface';

const PKG = 'com.acme.app';
const OBJECT = 'acme_ticket';
const FALLBACK = `${OBJECT}.default`;

const server = {
  active: new Map<string, Record<string, unknown>>(),
  requests: [] as Array<{ method: string; path: string; status: number }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  let status = 200;
  let body: unknown = [];
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    if (seg.length === 1 && seg[0] === '_drafts') {
      body = [];
    } else if (seg.length === 1) {
      body = [];
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(`${seg[0]}/${seg[1]}`);
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row, draft: null };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2) {
      [status, body] = [404, { error: { code: 'NO_DRAFT', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

const listItem = (name: string, isDefault: boolean) => ({
  name,
  object: OBJECT,
  viewKind: 'list',
  ...(isDefault ? { isDefault: true } : {}),
  config: { type: 'grid', data: { provider: 'object', object: OBJECT }, columns: ['title'] },
});

function metadataOf(listViews: Record<string, unknown> | undefined, status: MetadataTypeStatus | null): MetadataContextValue {
  return {
    apps: [],
    objects: [{ name: OBJECT, label: 'Ticket', fields: { title: { name: 'title', type: 'text' } }, ...(listViews ? { listViews } : {}) }],
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
    ...(status ? { getTypeStatus: () => status } : {}),
  };
}

let latest: ObjectListViewDraft | null = null;
function Probe() {
  const leaf: Surface = { type: 'object', name: OBJECT, label: OBJECT };
  const d = useObjectListViewDraft({ client, packageId: PKG, leaf, publishNonce: 0 });
  React.useLayoutEffect(() => {
    latest = d;
  });
  return null;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function open(metadata: MetadataContextValue) {
  const view = render(
    <MetadataCtx.Provider value={metadata}>
      <Probe />
    </MetadataCtx.Provider>,
  );
  await settle();
  return {
    d: () => latest!,
    rerender: async (next: MetadataContextValue) => {
      view.rerender(
        <MetadataCtx.Provider value={next}>
          <Probe />
        </MetadataCtx.Provider>,
      );
      await settle();
    },
  };
}

const layersAsked = (name: string) =>
  server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/view/${name}/layers`).map((r) => r.status);

beforeEach(() => {
  server.active.clear();
  server.requests = [];
  latest = null;
});
afterEach(cleanup);

describe('useObjectListViewDraft — the fallback default view is not asked for /layers (objectstack#36750)', () => {
  it('no view flagged default and none held under the fallback id: no /layers, and the buffer reads "not created yet"', async () => {
    const { d } = await open(metadataOf(undefined, 'ready'));

    expect(d().target).toEqual({ objectName: OBJECT, viewId: FALLBACK, isDefault: true });
    expect(d().targetIsFallback).toBe(true);
    expect(layersAsked(FALLBACK)).toEqual([]);
    expect(server.requests.filter((r) => r.status >= 400)).toEqual([]);
    expect(d().loadedFor).toBe(`listView:${FALLBACK}`);
    expect(d().row).toBeNull();
    expect(d().failure).toBeNull();
  });

  it('CONTROL: a published default view the merged listViews holds still reads its layer', async () => {
    const all = listItem(`${OBJECT}.all`, true);
    server.active.set(`view/${all.name}`, all);
    const { d } = await open(metadataOf({ [all.name]: { ...all.config, name: all.name, isDefault: true } }, 'ready'));

    expect(d().target?.viewId).toBe(`${OBJECT}.all`);
    expect(d().targetIsFallback).toBe(false);
    expect(layersAsked(`${OBJECT}.all`)).toEqual([200]);
    expect(d().row).toEqual(all);
  });

  it('CONTROL: a view held under `default` unflagged is no fallback, and still reads its layer', async () => {
    const held = listItem(FALLBACK, false);
    server.active.set(`view/${FALLBACK}`, held);
    // An object document's own `listViews` keys its entries bare.
    const { d } = await open(metadataOf({ default: { ...held.config } }, 'ready'));

    expect(d().target).toEqual({ objectName: OBJECT, viewId: FALLBACK, isDefault: true });
    expect(d().targetIsFallback).toBe(false);
    expect(layersAsked(FALLBACK)).toEqual([200]);
    expect(d().row).toEqual(held);
  });

  it('CONTROL: while the shell\'s objects are loading the layer is read as before; once they answer, it is not read again', async () => {
    const { d, rerender } = await open(metadataOf(undefined, 'loading'));

    expect(d().targetIsFallback).toBe(false);
    expect(layersAsked(FALLBACK)).toEqual([404]);
    expect(d().row).toBeNull();
    expect(d().failure).toBeNull();

    await rerender(metadataOf(undefined, 'ready'));
    expect(d().targetIsFallback).toBe(true);
    expect(layersAsked(FALLBACK)).toEqual([404]);
    expect(d().loadedFor).toBe(`listView:${FALLBACK}`);
    expect(d().row).toBeNull();
  });

  it('CONTROL: a context that reports no load status proves no absence, so the layer is read as before', async () => {
    const { d } = await open(metadataOf(undefined, null));

    expect(d().targetIsFallback).toBe(false);
    expect(layersAsked(FALLBACK)).toEqual([404]);
    expect(d().row).toBeNull();
    expect(d().failure).toBeNull();
  });
});

describe('useServedOverride — an item flagged `unpublished` is not asked for its layers (objectstack#36750)', () => {
  let served: ServedOverride | null = null;
  function ServedProbe({ fake, unpublished, pair }: { fake: Parameters<typeof useServedOverride>[0]; unpublished: boolean; pair: string | null }) {
    const s = useServedOverride(fake, { type: 'view', name: FALLBACK, ...(unpublished ? { unpublished: true } : {}) }, 'com.acme.base', pair, 0);
    React.useLayoutEffect(() => {
      served = s;
    });
    return null;
  }
  const fakeClient = () => ({
    getDraft: vi.fn(async () => null),
    layered: vi.fn(async () => ({ code: null, overlay: null, overlayScope: null, effective: null })),
  });

  it('skips the layered read and answers as its 404 did, after reading the pair\'s draft', async () => {
    const fake = fakeClient();
    render(<ServedProbe fake={fake as never} unpublished pair="com.acme.base.custom" />);
    await settle();

    expect(fake.layered).not.toHaveBeenCalled();
    expect(fake.getDraft).toHaveBeenCalledTimes(1);
    expect(served).toEqual({ declaration: null, state: null, shipped: 'none' });
  });

  it('CONTROL: an item not flagged still reads its layers, with the same answer for nothing published', async () => {
    const fake = fakeClient();
    render(<ServedProbe fake={fake as never} unpublished={false} pair={null} />);
    await settle();

    expect(fake.layered).toHaveBeenCalledTimes(1);
    expect(served).toEqual({ declaration: null, state: null, shipped: 'none' });
  });
});
