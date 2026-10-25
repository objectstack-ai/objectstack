// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12508 — the list-view buffer does not ask `GET …/layers` for a view
 * of a draft-only object.
 *
 * Measured on the card's session: create an object in the Data pillar, open
 * it in Interfaces, and the buffer asked `/layers` for its default list view
 * (`st_ticket.default`) and got a 404. Nothing of a draft-only object is
 * published, so no view of it has a layer. The Interfaces pillar already reads
 * the package's published objects and drafts; it hands the buffer the
 * draft-only names, stamped with the publish they were read under, and the
 * buffer skips `/layers` for a view of one of them that has no draft.
 *
 * The REAL hook over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does (404 for `/layers` with no layer and
 * for `?state=draft` with no draft).
 *
 * Pinned:
 *  - a view absent from both drafts and published, of a draft-only object:
 *    no `/layers`, and the buffer reads "not created yet" (no row, no failure);
 *  - CONTROL: the same view with an answer read under an EARLIER publish is
 *    still asked (that publish may have made the object live);
 *  - CONTROL: a published object's view still reads its layer;
 *  - CONTROL: a failed `/layers` read (a 5xx) is still the buffer's failure.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { useObjectListViewDraft, type DraftOnlyObjects } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const PKG = 'com.default.studio-test';
const DRAFT_ONLY = 'st_ticket';
const PUBLISHED = 'st_case';

const server = {
  active: new Map<string, Record<string, unknown>>(),
  requests: [] as Array<{ method: string; path: string; status: number }>,
  failLayers: new Set<string>(),
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
    if (seg.length === 3 && seg[2] === 'layers' && server.failLayers.has(`${seg[0]}/${seg[1]}`)) {
      [status, body] = [500, { error: { code: 'INTERNAL_ERROR', message: 'metadata store unavailable' } }];
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(`${seg[0]}/${seg[1]}`);
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2) {
      // No view draft is pending in this suite.
      [status, body] = [404, { error: { code: 'NO_DRAFT', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

const publishedDef = { name: PUBLISHED, label: 'Case', fields: { title: { name: 'title', type: 'text' } } };
const caseView = {
  name: `${PUBLISHED}.default`,
  object: PUBLISHED,
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: PUBLISHED }, columns: ['title'] },
};

// The shell's metadata cache holds published objects only: the draft-only one is absent.
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [publishedDef],
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

function Probe({ object, publishNonce, known }: { object: string; publishNonce: number; known: DraftOnlyObjects | null }) {
  const leaf: Surface = { type: 'object', name: object, label: object };
  const d = useObjectListViewDraft({ client, packageId: PKG, leaf, publishNonce, draftOnlyObjects: known });
  return (
    <pre data-testid="probe">
      {JSON.stringify({
        loadedFor: d.loadedFor,
        row: d.row,
        hasDraft: d.hasDraft,
        failure: d.failure ? { during: d.failure.during, error: String(d.failure.error) } : null,
      })}
    </pre>
  );
}

async function open(object: string, publishNonce: number, known: DraftOnlyObjects | null) {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Probe object={object} publishNonce={publishNonce} known={known} />
    </MetadataCtx.Provider>,
  );
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
  return JSON.parse(screen.getByTestId('probe').textContent ?? '{}') as Record<string, unknown>;
}

const layersAsked = (object: string) =>
  server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/view/${object}.default/layers`).map((r) => r.status);

const knownUnder = (publishNonce: number): DraftOnlyObjects => ({ publishNonce, names: new Set([DRAFT_ONLY]) });

beforeEach(() => {
  server.active.clear();
  server.requests = [];
  server.failLayers.clear();
});
afterEach(cleanup);

describe('useObjectListViewDraft — a view of a draft-only object is not asked for /layers (objectui#12508)', () => {
  it('no draft, no layer, draft-only object: no /layers, and the buffer reads "not created yet"', async () => {
    const seen = await open(DRAFT_ONLY, 0, knownUnder(0));

    expect(layersAsked(DRAFT_ONLY)).toEqual([]);
    expect(server.requests.filter((r) => r.status >= 400 && r.path.endsWith('/layers'))).toEqual([]);
    expect(seen).toEqual({ loadedFor: `listView:${DRAFT_ONLY}.default`, row: null, hasDraft: false, failure: null });
  });

  it('CONTROL: an answer read under an earlier publish does not count, so the view is still asked', async () => {
    const seen = await open(DRAFT_ONLY, 1, knownUnder(0));

    expect(layersAsked(DRAFT_ONLY)).toEqual([404]);
    expect(seen).toEqual({ loadedFor: `listView:${DRAFT_ONLY}.default`, row: null, hasDraft: false, failure: null });
  });

  it('CONTROL: a published object\'s view still reads its layer', async () => {
    server.active.set(`view/${PUBLISHED}.default`, caseView);
    const seen = await open(PUBLISHED, 0, knownUnder(0));

    expect(layersAsked(PUBLISHED)).toEqual([200]);
    expect(seen).toEqual({ loadedFor: `listView:${PUBLISHED}.default`, row: caseView, hasDraft: false, failure: null });
  });

  it('CONTROL: a failed /layers read (a 5xx) is still the buffer\'s load failure', async () => {
    server.failLayers.add(`view/${PUBLISHED}.default`);
    const seen = await open(PUBLISHED, 0, knownUnder(0));

    expect(layersAsked(PUBLISHED)).toEqual([500]);
    expect(seen.loadedFor).toBe('');
    expect(seen.failure).toEqual({ during: 'load', error: expect.stringContaining('metadata store unavailable') });
  });
});
