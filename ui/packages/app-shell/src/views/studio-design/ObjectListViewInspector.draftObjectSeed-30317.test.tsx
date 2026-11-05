// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30317 — on a draft-only object, a list view created in Studio
 * Interfaces starts from the object's first five fields, as one of a
 * published object does.
 *
 * Measured on #30177's dev boot: the first edit of `acmetrial_deal.default`
 * (a draft-only object, no view yet) wrote `columns: [amount]`, the one
 * column the author touched, and New view fell back to the same empty seed.
 * The shell's merged `metadata.objects` holds published objects only, so the
 * hook found no definition to seed from. It now reads the object's drafted
 * definition through the same client with the drafts overlaid when the merged
 * one is missing.
 *
 * The REAL hook over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does (`GET /meta/object/<name>?preview=draft`
 * serves the pending draft in its envelope; 404 for a name with neither).
 *
 * Pinned:
 *  - a draft-only object: the seed is its drafted definition's first five
 *    fields, the first edit of the default view writes them plus the edit,
 *    and New view with no columns picked writes them too;
 *  - CONTROL: a published object seeds from the merged definition, and no
 *    object read is sent for it;
 *  - CONTROL: an object neither published nor drafted (404) seeds nothing and
 *    the panel does not fail on it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { newListViewItem, useObjectListViewDraft, type DraftOnlyObjects, type ObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const PKG = 'com.example.acme-trial';
const DEAL = 'acmetrial_deal';
const CASE = 'acmetrial_case';
const GHOST = 'acmetrial_ghost';

const dealDraft = {
  name: DEAL,
  label: 'Deal',
  fields: {
    internal_score: { name: 'internal_score', type: 'number', hidden: true },
    name: { name: 'name', type: 'text' },
    amount: { name: 'amount', type: 'currency' },
    stage: { name: 'stage', type: 'select' },
    close_date: { name: 'close_date', type: 'date' },
    probability: { name: 'probability', type: 'percent' },
    notes: { name: 'notes', type: 'textarea' },
  },
};
const DEAL_SEED = ['name', 'amount', 'stage', 'close_date', 'probability'];

const caseDef = {
  name: CASE,
  label: 'Case',
  fields: { subject: { name: 'subject', type: 'text' }, priority: { name: 'priority', type: 'select' } },
};

const server = {
  objectDrafts: new Map<string, Record<string, unknown>>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number }>,
  writes: [] as Array<{ path: string; body: Record<string, unknown> }>,
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
    } else if (seg.length === 1) {
      // `_drafts`, the published lists and the draft-overlaid lists: nothing pending, nothing published.
      body = [];
    } else if (seg.length === 2 && seg[0] === 'object') {
      const draft = url.searchParams.get('preview') === 'draft' ? server.objectDrafts.get(seg[1]) : undefined;
      if (draft) body = { type: 'object', name: seg[1], item: { ...draft, _draft: true } };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2) {
      [status, body] = [404, { error: { code: 'NO_DRAFT', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, search: url.search, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

// The shell's metadata cache holds published objects only: the draft-only one is absent.
const METADATA: MetadataContextValue = {
  apps: [],
  objects: [caseDef],
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

const known: DraftOnlyObjects = { publishNonce: 0, names: new Set([DEAL, GHOST]) };

let latest: ObjectListViewDraft | null = null;
function HookProbe({ object }: { object: string }) {
  const leaf: Surface = { type: 'object', name: object, label: object };
  const d = useObjectListViewDraft({ client, packageId: PKG, leaf, publishNonce: 0, draftOnlyObjects: known });
  React.useLayoutEffect(() => {
    latest = d;
  });
  return null;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function mount(object: string) {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <HookProbe object={object} />
    </MetadataCtx.Provider>,
  );
  await settle();
  return () => latest!;
}

/** The panel's first edit, as the panel makes it: one column added to the view it shows. */
async function firstEdit(d: () => ObjectListViewDraft, column: string) {
  const { target, row, seedColumns } = d();
  const working = row ?? newListViewItem(target!, seedColumns);
  const config = working.config as Record<string, unknown>;
  await act(async () => {
    d().edit({ ...working, config: { ...config, columns: [...(config.columns as unknown[]), column] } });
  });
  await act(async () => {
    await d().save({ unmoved: () => true });
  });
  await settle();
}

const objectReads = (name: string) =>
  server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/object/${name}`);

beforeEach(() => {
  server.objectDrafts.clear();
  server.requests = [];
  server.writes = [];
  latest = null;
});
afterEach(cleanup);

describe('useObjectListViewDraft — a draft-only object seeds a new view from its drafted definition (objectstack#30317)', () => {
  it('the first edit of the default view writes the drafted object\'s first five fields, then the edit', async () => {
    server.objectDrafts.set(DEAL, dealDraft);
    const d = await mount(DEAL);

    expect(d().target).toEqual({ objectName: DEAL, viewId: `${DEAL}.default`, isDefault: true });
    expect(d().seedColumns).toEqual(DEAL_SEED);
    expect(d().canvas?.view).toMatchObject({ columns: DEAL_SEED });

    await firstEdit(d, 'notes');
    expect(server.writes.map((w) => w.path)).toEqual([`view/${DEAL}.default`]);
    expect((server.writes[0]!.body.config as Record<string, unknown>).columns).toEqual([...DEAL_SEED, 'notes']);
  });

  it('New view with no columns picked writes the drafted object\'s first five fields', async () => {
    server.objectDrafts.set(DEAL, dealDraft);
    const d = await mount(DEAL);

    let refusal: unknown = 'pending';
    await act(async () => {
      refusal = await d().createView({ type: 'grid', label: 'Open deals', name: `${DEAL}.open_deals` });
    });
    expect(refusal).toBeNull();
    expect(server.writes.map((w) => w.path)).toEqual([`view/${DEAL}.open_deals`]);
    expect((server.writes[0]!.body.config as Record<string, unknown>).columns).toEqual(DEAL_SEED);
  });

  it('CONTROL: a published object seeds from the merged definition, and no object read is sent for it', async () => {
    const d = await mount(CASE);

    expect(d().seedColumns).toEqual(['subject', 'priority']);
    expect(objectReads(CASE)).toEqual([]);
  });

  it('CONTROL: an object with neither a draft nor a published row seeds nothing, and the panel does not fail', async () => {
    const d = await mount(GHOST);

    expect(objectReads(GHOST).map((r) => r.status)).toEqual([404]);
    expect(d().seedColumns).toEqual([]);
    expect(d().failure).toBeNull();
    expect(d().loadedFor).toBe(`listView:${GHOST}.default`);
  });
});
