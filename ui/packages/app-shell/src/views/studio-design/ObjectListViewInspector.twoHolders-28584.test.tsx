// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28584 — an `object` leaf's list-view buffer reads the published
 * layer of a view two packages hold at the Studio package it is open in.
 *
 * Since objectstack#28337, the layered view naming no package refuses a name
 * whose active rows two packages hold: `409 RESOURCE_CONFLICT`, naming the
 * holders and the `?package=` remedy. The buffer read it naming no package, so
 * on such a deployment the leaf's list view failed to load. It now reads at
 * the package it reads the draft at and saves to.
 *
 * The REAL hook (`useObjectListViewDraft`) over a REAL `MetadataClient`, whose
 * transport is an in-memory server holding the view in two packages and
 * answering the layered read as the framework does: the holder's stack with
 * `?package=`, the refusal without it.
 *
 * Pinned, for each holder: the one layered read names that package, nothing is
 * refused, and the buffer holds that holder's view, ⛔ never the other's.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const PKG_A = 'app.alpha';
const PKG_B = 'app.beta';
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

/** Each holder's published view: alpha shows one column, beta two. */
const HOLDERS: Record<string, Record<string, unknown>> = {
  [PKG_A]: viewItem(['title']),
  [PKG_B]: viewItem(['title', 'status']),
};

const requests: Array<{ method: string; path: string; search: string; status: number }> = [];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const pkg = url.searchParams.get('package');
  let status = 200;
  let body: unknown = [];
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    if (seg[0] === '_drafts') {
      body = { drafts: [] };
    } else if (seg.length === 3 && seg[0] === 'view' && seg[1] === VIEW && seg[2] === 'layers') {
      const row = pkg ? HOLDERS[pkg] : undefined;
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else if (!pkg) {
        [status, body] = [
          409,
          {
            success: false,
            error: {
              code: 'RESOURCE_CONFLICT',
              message: `Name the package this layered read is for, then send it again: view '${VIEW}' is held by '${PKG_A}' and '${PKG_B}'.`,
            },
          },
        ];
      } else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2) {
      [status, body] = [404, { error: { code: url.searchParams.get('state') === 'draft' ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } }];
    }
  }
  requests.push({ method, path: url.pathname, search: url.search, status });
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
function Probe({ packageId }: { packageId: string }) {
  const d = useObjectListViewDraft({ client, packageId, leaf: LEAF, publishNonce: 0 });
  return (
    <pre data-testid="probe">
      {JSON.stringify({ loadedFor: d.loadedFor, row: d.row, hasDraft: d.hasDraft, failure: d.failure ? String(d.failure.error) : null })}
    </pre>
  );
}

async function openLeafIn(packageId: string) {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Probe packageId={packageId} />
    </MetadataCtx.Provider>,
  );
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
  return JSON.parse(screen.getByTestId('probe').textContent ?? '{}') as Record<string, unknown>;
}

const layersReads = () =>
  requests
    .filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/view/${VIEW}/layers`)
    .map((r) => ({ search: r.search, status: r.status }));

beforeEach(() => {
  requests.length = 0;
});
afterEach(cleanup);

describe('useObjectListViewDraft — a view two packages hold (objectstack#28584)', () => {
  for (const [pkg, other] of [[PKG_A, PKG_B], [PKG_B, PKG_A]] as const) {
    it(`open in ${pkg}: the layered read names ${pkg}, and the buffer holds ${pkg}'s view`, async () => {
      const seen = await openLeafIn(pkg);

      expect(layersReads()).toEqual([{ search: `?package=${pkg}`, status: 200 }]);
      expect(requests.filter((r) => r.status === 409)).toEqual([]);
      expect(seen).toEqual({ loadedFor: `listView:${VIEW}`, row: HOLDERS[pkg], hasDraft: false, failure: null });
      expect(seen.row).not.toEqual(HOLDERS[other]);
    });
  }
});
