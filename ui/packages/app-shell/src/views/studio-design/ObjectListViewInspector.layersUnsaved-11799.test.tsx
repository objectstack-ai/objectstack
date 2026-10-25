// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11799 — an `object` leaf's list-view buffer asks `GET …/layers`
 * for no view the panel created and nobody published.
 *
 * The first edit in the panel saves the view to the package draft
 * (objectui#11823), so until a publish that view has a draft and no layer, and
 * the framework answers `/layers` with a 404 for it. The buffer read the
 * layered view beside the draft on every open of the leaf. It uses the
 * published layer only without a draft (objectui#10765), so the layer is now
 * read once the draft read says there is none.
 *
 * The REAL hook (`useObjectListViewDraft`) over a REAL `MetadataClient`, whose
 * transport is an in-memory server answering as the framework does: 404 for
 * `/layers` with no layer and for `?state=draft` with no draft.
 *
 * Pinned:
 *  - a view that has a draft and no layer sends no `/layers`, and the buffer
 *    holds its draft exactly as before (the 404 answer was never used for it);
 *  - CONTROL: a published view with no draft sends exactly one `/layers`, and
 *    the buffer holds its published layer, as before.
 *
 * A view that exists nowhere yet (no draft, no layer: the default list view of
 * an object that has none) still asks `/layers` and gets its 404. Nothing the
 * hook holds says the view was never saved: its draft read says only whether a
 * draft is pending, and the object's `listViews` from the metadata cache is not
 * read as that answer here (the 11823 pillar suite serves a default view its
 * object definition does not list). The framework keeps that 404 by design
 * (objectstack-ai/objectstack#22397, answer (a)), and `MetadataClient.layered()`
 * resolves it as an envelope with every layer null, so the buffer reads it as
 * "not created yet": no row, no failure, and the canvas shows the view the first
 * edit will create. Pinned in the second describe below, with a control: a
 * failed `/layers` read (a 5xx) is still the buffer's load failure.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const PKG = 'com.acme.app';
const VIEW = 'showcase_task.default';

const OBJECT_DEF = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

/** The object's default list view as a server serves a view item. */
const viewItem = (columns: string[]) => ({
  name: VIEW,
  object: 'showcase_task',
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns },
});

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number }>,
  /** Rows whose `/layers` read fails with a 5xx. */
  failLayers: new Set<string>(),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const q = url.searchParams;
  let status = 200;
  let body: unknown = [];
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    if (seg[0] === '_drafts') {
      body = { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1], packageId: PKG })) };
    } else if (seg.length === 3 && seg[2] === 'layers' && server.failLayers.has(`${seg[0]}/${seg[1]}`)) {
      [status, body] = [500, { error: { code: 'INTERNAL_ERROR', message: 'metadata store unavailable' } }];
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(`${seg[0]}/${seg[1]}`);
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2) {
      const draftRead = q.get('state') === 'draft';
      const row = (draftRead ? server.drafts : server.active).get(`${seg[0]}/${seg[1]}`);
      if (row) body = { type: seg[0], name: seg[1], item: draftRead ? { ...row, _draft: true } : row };
      else [status, body] = [404, { error: { code: draftRead ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, search: url.search, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

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

const LEAF: Surface = { type: 'object', name: 'showcase_task', label: 'Tasks' };

/** Prints what the buffer holds. */
function Probe() {
  const d = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  return (
    <pre data-testid="probe">
      {JSON.stringify({ loadedFor: d.loadedFor, row: d.row, hasDraft: d.hasDraft, failure: d.failure ? String(d.failure.error) : null })}
    </pre>
  );
}

const probe = () =>
  JSON.parse(screen.getByTestId('probe').textContent ?? '{}') as {
    loadedFor: string;
    row: Record<string, unknown> | null;
    hasDraft: boolean;
    failure: string | null;
  };

const layersAsked = () => server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/view/${VIEW}/layers`).length;

async function openLeaf() {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Probe />
    </MetadataCtx.Provider>,
  );
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.requests = [];
  server.failLayers.clear();
});
afterEach(cleanup);

describe('useObjectListViewDraft — an unpublished view is not asked for /layers (objectui#11799)', () => {
  it('a view with a draft and no layer sends no /layers, and the buffer holds the draft as before', async () => {
    server.drafts.set(`view/${VIEW}`, viewItem(['title', 'status']));
    await openLeaf();

    expect(layersAsked()).toBe(0);
    expect(server.requests.filter((r) => r.status === 404)).toEqual([]);
    expect(probe()).toEqual({
      loadedFor: `listView:${VIEW}`,
      // The served draft, its read decoration off: what the 404 answer left it as.
      row: viewItem(['title', 'status']),
      hasDraft: true,
      failure: null,
    });
  });

  it('CONTROL: a published view with no draft sends exactly one /layers, and the buffer holds the published layer', async () => {
    server.active.set(`view/${VIEW}`, viewItem(['title']));
    await openLeaf();

    expect(layersAsked()).toBe(1);
    expect(probe()).toEqual({ loadedFor: `listView:${VIEW}`, row: viewItem(['title']), hasDraft: false, failure: null });
  });
});

/** What the buffer holds, plus the columns the canvas shows for it. */
function CanvasProbe() {
  const d = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  const view = d.canvas?.view as { columns?: unknown } | undefined;
  return (
    <pre data-testid="canvas-probe">
      {JSON.stringify({
        loadedFor: d.loadedFor,
        row: d.row,
        hasDraft: d.hasDraft,
        failure: d.failure ? { during: d.failure.during, error: String(d.failure.error) } : null,
        canvasColumns: view?.columns ?? null,
      })}
    </pre>
  );
}

async function openLeafWithCanvas() {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <CanvasProbe />
    </MetadataCtx.Provider>,
  );
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
  return JSON.parse(screen.getByTestId('canvas-probe').textContent ?? '{}') as Record<string, unknown>;
}

const layersStatuses = () =>
  server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/view/${VIEW}/layers`).map((r) => r.status);

describe('useObjectListViewDraft — a view that exists nowhere reads its /layers 404 as "not created yet" (objectui#11799)', () => {
  it('no draft and no layer: one /layers, its 404, no failure, and the canvas shows the view the first edit creates', async () => {
    const seen = await openLeafWithCanvas();

    expect(layersStatuses()).toEqual([404]);
    expect(seen).toEqual({
      loadedFor: `listView:${VIEW}`,
      row: null,
      hasDraft: false,
      failure: null,
      // `defaultListColumnsFromObject` over the object's two fields.
      canvasColumns: ['title', 'status'],
    });
  });

  it('CONTROL: a failed /layers read (a 5xx) is still the buffer\'s load failure', async () => {
    server.failLayers.add(`view/${VIEW}`);
    const seen = await openLeafWithCanvas();

    expect(layersStatuses()).toEqual([500]);
    expect(seen.loadedFor).toBe('');
    expect(seen.canvasColumns).toBeNull();
    expect(seen.failure).toEqual({ during: 'load', error: expect.stringContaining('metadata store unavailable') });
  });
});
