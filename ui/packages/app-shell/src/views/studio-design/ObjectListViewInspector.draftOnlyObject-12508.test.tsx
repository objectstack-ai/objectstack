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
import {
  newListViewItem,
  useObjectListViewDraft,
  type DraftOnlyObjects,
  type ObjectListViewDraft,
} from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const PKG = 'com.default.studio-test';
const DRAFT_ONLY = 'st_ticket';
const PUBLISHED = 'st_case';

const server = {
  active: new Map<string, Record<string, unknown>>(),
  /** objectstack#30177 — this package's pending view drafts, by `view/<name>`. */
  drafts: new Map<string, Record<string, unknown>>(),
  requests: [] as Array<{ method: string; path: string; status: number }>,
  /** objectstack#30177 — the PUTs, by `view/<name>`, with the body sent. */
  writes: [] as Array<{ path: string; body: Record<string, unknown> }>,
  failLayers: new Set<string>(),
  /** objectstack#30177 — while set, the draft-overlaid view list waits for it. */
  holdViewList: null as Promise<void> | null,
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
    if (method === 'PUT' && seg.length === 2) {
      server.writes.push({ path: `${seg[0]}/${seg[1]}`, body: JSON.parse(String(init?.body ?? '{}')) });
      body = { success: true, version: 'v2', state: 'draft' };
    } else if (seg.length === 1 && seg[0] === '_drafts') {
      body = [...server.drafts.keys()].map((key) => ({ type: key.split('/')[0], name: key.slice(key.indexOf('/') + 1), packageId: PKG }));
    } else if (seg.length === 1 && url.searchParams.get('preview') === 'draft') {
      if (server.holdViewList) await server.holdViewList;
      body = [...server.drafts.entries()]
        .filter(([key]) => key.startsWith(`${seg[0]}/`))
        .map(([, row]) => ({ ...row, _draft: true, _packageId: PKG }));
    } else if (seg.length === 2 && url.searchParams.get('state') === 'draft' && server.drafts.has(`${seg[0]}/${seg[1]}`)) {
      body = { type: seg[0], name: seg[1], item: { ...server.drafts.get(`${seg[0]}/${seg[1]}`), _draft: true }, version: 'v1' };
    } else if (seg.length === 3 && seg[2] === 'layers' && server.failLayers.has(`${seg[0]}/${seg[1]}`)) {
      [status, body] = [500, { error: { code: 'INTERNAL_ERROR', message: 'metadata store unavailable' } }];
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(`${seg[0]}/${seg[1]}`);
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2) {
      // No draft of that view is pending.
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
  server.drafts.clear();
  server.requests = [];
  server.writes = [];
  server.failLayers.clear();
  server.holdViewList = null;
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

/**
 * objectstack#30177 — a draft-only object's nav entry with no `viewName`
 * opens the object's drafted default list view. The shell's merged metadata
 * does not hold the object, so its views are known from this package's
 * drafts alone: the entry is resolved against them, the view switcher lists
 * no "Default view" beside them, and the first edit writes to the drafted
 * view rather than creating a second default one.
 */
describe('useObjectListViewDraft — a draft-only object opens its drafted default view (objectstack#30177)', () => {
  const DEAL = 'acmetrial_deal';
  const ALL_DEALS = {
    name: `${DEAL}.all`,
    object: DEAL,
    viewKind: 'list',
    label: 'All deals',
    isDefault: true,
    config: { type: 'grid', data: { provider: 'object', object: DEAL }, columns: ['name'] },
  };
  const dealsKnown: DraftOnlyObjects = { publishNonce: 0, names: new Set([DEAL]) };

  let latest: ObjectListViewDraft | null = null;
  function HookProbe({ object, known }: { object: string; known: DraftOnlyObjects | null }) {
    const leaf: Surface = { type: 'object', name: object, label: object };
    latest = useObjectListViewDraft({ client, packageId: PKG, leaf, publishNonce: 0, draftOnlyObjects: known });
    return null;
  }

  const settle = () =>
    act(async () => {
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    });

  async function mount(object: string, known: DraftOnlyObjects | null) {
    render(
      <MetadataCtx.Provider value={METADATA}>
        <HookProbe object={object} known={known} />
      </MetadataCtx.Provider>,
    );
    await settle();
    return () => latest!;
  }

  /** The panel's first edit, as the panel makes it: one column added to the view it shows. */
  async function firstEdit(d: () => ObjectListViewDraft) {
    const { target, row, seedColumns } = d();
    const working = row ?? newListViewItem(target!, seedColumns);
    const config = working.config as Record<string, unknown>;
    await act(async () => {
      d().edit({ ...working, config: { ...config, columns: [...(config.columns as unknown[]), 'stage'] } });
    });
    await act(async () => {
      await d().save({ unmoved: () => true });
    });
    await settle();
  }

  it('the entry opens the drafted default view, the switcher lists no "Default view", and the first edit writes to that view', async () => {
    server.drafts.set(`view/${ALL_DEALS.name}`, ALL_DEALS);
    const d = await mount(DEAL, dealsKnown);

    expect(d().target).toEqual({ objectName: DEAL, viewId: `${DEAL}.all`, isDefault: true });
    expect(d().loadedFor).toBe(`listView:${DEAL}.all`);
    expect(d().row).toMatchObject({ name: `${DEAL}.all`, isDefault: true });
    expect(d().views.map((v) => v.target.viewId)).toEqual([`${DEAL}.all`]);

    await firstEdit(d);
    expect(server.writes.map((w) => w.path)).toEqual([`view/${DEAL}.all`]);
    expect(server.writes.filter((w) => w.body.isDefault === true).map((w) => w.body.name)).toEqual([`${DEAL}.all`]);
  });

  it('until the package\'s view drafts answer, no view is loaded and none is listed', async () => {
    server.drafts.set(`view/${ALL_DEALS.name}`, ALL_DEALS);
    let release = () => {};
    server.holdViewList = new Promise<void>((r) => {
      release = r;
    });
    const d = await mount(DEAL, dealsKnown);

    expect(d().loadedFor).toBe('');
    expect(d().views).toEqual([]);
    expect(server.requests.filter((r) => r.path.startsWith(`/api/v1/meta/view/${DEAL}.default`))).toEqual([]);

    release();
    await settle();
    expect(d().target?.viewId).toBe(`${DEAL}.all`);
    expect(d().loadedFor).toBe(`listView:${DEAL}.all`);
  });

  it('CONTROL: a published object\'s entry with no flagged view still opens `<object>.default`', async () => {
    const d = await mount(PUBLISHED, dealsKnown);

    expect(d().target).toEqual({ objectName: PUBLISHED, viewId: `${PUBLISHED}.default`, isDefault: true });
    expect(d().views.map((v) => v.target.viewId)).toEqual([`${PUBLISHED}.default`]);
  });

  it('CONTROL: a draft-only object with no drafted view still opens `<object>.default`, created by the first edit', async () => {
    const d = await mount(DEAL, dealsKnown);

    expect(d().target).toEqual({ objectName: DEAL, viewId: `${DEAL}.default`, isDefault: true });
    expect(d().loadedFor).toBe(`listView:${DEAL}.default`);
    await firstEdit(d);
    expect(server.writes.map((w) => w.path)).toEqual([`view/${DEAL}.default`]);
    expect(server.writes[0]!.body).toMatchObject({ name: `${DEAL}.default`, isDefault: true });
  });
});
