// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11799 — opening an item in Studio asks no question whose expected
 * answer is a 404.
 *
 * Every item Studio opened sent `GET /meta/:type/:name?state=draft`, which
 * answers 404 when there is no draft, and `GET /meta/:type/:name/layers`, which
 * answers 404 for an item that has never been saved. The console filled with
 * red lines for expected answers. Now:
 *  - whether a draft exists comes from the drafts ledger (`GET /meta/_drafts`,
 *    the client's shared read), and the draft is read only when listed;
 *  - the published baseline is read only when the load uses it, for an item
 *    with no pending draft, so an unsaved item never asks `/layers`;
 *  - the Interfaces pillar's app found only in the ledger reads no `/layers`.
 *
 * The REAL pillars over a REAL `MetadataClient`, whose transport is an
 * in-memory server answering as the framework does: a 404 for `?state=draft`
 * with no draft and for `/layers` with no layer. Requests are counted on it.
 *
 * Not covered, said here so it does not read as covered: the Data pillar
 * still reads `/layers` for a draft-only object. That read is how it learns
 * there is no published definition yet (`hasBaseline`) and which fields the
 * data API can select, both used even with a draft, and nothing it holds
 * answers either question for certain.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// Module-scope import of the lazily loaded dashboard renderer (AGENTS.md,
// flaky-test discipline).
import '@object-ui/plugin-dashboard';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.acme.app';
const NAV = [
  { id: 'n1', type: 'dashboard', label: 'Customers', dashboardName: 'customer_dashboard' },
  { id: 'n2', type: 'dashboard', label: 'Fresh', dashboardName: 'fresh_dashboard' },
];
const dashboard = (name: string) => ({ name, label: name, widgets: [] });
const flow = (name: string) => ({
  name,
  label: name,
  type: 'autolaunched',
  status: 'obsolete',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

interface Row {
  type: string;
  name: string;
  body: Record<string, unknown>;
  packageId: string | null;
}

/** The server: published rows, draft rows, and every request it was asked. */
const server = {
  active: new Map<string, Row>(),
  drafts: new Map<string, Row>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number }>,
};

function put(rows: Map<string, Row>, type: string, name: string, body: Record<string, unknown>) {
  rows.set(`${type}/${name}`, { type, name, body, packageId: PKG });
}

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
      body = {
        drafts: [...server.drafts.values()]
          .filter((d) => (!q.get('type') || d.type === q.get('type')) && (!q.get('packageId') || d.packageId === q.get('packageId')))
          .map((d) => ({ type: d.type, name: d.name, packageId: d.packageId, organizationId: null })),
      };
    } else if (seg.length === 1) {
      body = { items: [...server.active.values()].filter((r) => r.type === seg[0]).map((r) => r.body) };
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(`${seg[0]}/${seg[1]}`);
      if (row) body = { code: null, overlay: row.body, overlayScope: 'env', effective: row.body };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2 && method === 'PUT') {
      const item = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      server.drafts.set(`${seg[0]}/${seg[1]}`, { type: seg[0], name: seg[1], body: item, packageId: q.get('package') });
      body = { type: seg[0], name: seg[1], state: 'draft' };
    } else if (seg.length === 2) {
      const draftRead = q.get('state') === 'draft';
      const row = (draftRead ? server.drafts : server.active).get(`${seg[0]}/${seg[1]}`);
      if (row) body = { type: seg[0], name: seg[1], item: draftRead ? { ...row.body, _draft: true } : row.body };
      else [status, body] = [404, { error: { code: draftRead ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, search: url.search, status });
  return json(status, body);
}

const transport = vi.fn(serve) as unknown as typeof fetch;
const client = new MetadataClient({ baseUrl: '', fetch: transport });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => [{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]) };
});

// The Data pillar's records grid calls `find()` on this adapter (objectui#8620).
vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { AutomationsPillar, DataPillar, InterfacesPillar } from './StudioDesignSurface';
import { registerMetadataPreview } from '../metadata-admin/preview-registry';
import { DashboardPreview } from '../metadata-admin/previews/DashboardPreview';
import { createEmptyDataSource, failOnAbsorbedFetchError } from './__tests__/emptyDataSource';

const dataSource = createEmptyDataSource();
failOnAbsorbedFetchError();
registerMetadataPreview('dashboard', DashboardPreview);

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.requests = [];
  // The Automations pillar's flow-status probe goes through the global fetch.
  vi.stubGlobal('fetch', transport);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Let every queued load run to the end. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** GETs of `/meta/<type>/<name>` with `suffix` (`?state=draft` or `/layers`). */
function asked(type: string, name: string, suffix: '?state=draft' | '/layers'): number {
  const path = `/api/v1/meta/${type}/${name}`;
  return server.requests.filter(
    (r) =>
      r.method === 'GET' &&
      (suffix === '/layers' ? r.path === `${path}/layers` : r.path === path && r.search.includes('state=draft')),
  ).length;
}

const misses = () => server.requests.filter((r) => r.status === 404).map((r) => `${r.path}${r.search}`);

function interfacesTree() {
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <InterfacesPillar packageId={PKG} />
    </MemoryRouter>
  );
}

describe('Interfaces pillar — opening leaves asks no 404 question (objectui#11799)', () => {
  beforeEach(() => {
    put(server.active, 'app', 'acme_app', { name: 'acme_app', label: 'Acme', navigation: NAV });
    put(server.active, 'dashboard', 'customer_dashboard', dashboard('customer_dashboard'));
    // Created in Studio and never published: a draft and no layer.
    put(server.drafts, 'dashboard', 'fresh_dashboard', dashboard('fresh_dashboard'));
  });

  it('a saved leaf with no draft reads its baseline and no draft; an unsaved leaf reads its draft and no baseline', async () => {
    render(interfacesTree());
    await waitFor(() => expect(asked('dashboard', 'customer_dashboard', '/layers')).toBe(1));
    await settle();
    expect(asked('dashboard', 'customer_dashboard', '?state=draft')).toBe(0);
    expect(asked('app', 'acme_app', '?state=draft')).toBe(0);

    fireEvent.click(await screen.findByTitle('dashboard · fresh_dashboard'));
    await waitFor(() => expect(asked('dashboard', 'fresh_dashboard', '?state=draft')).toBe(1));
    await settle();
    expect(asked('dashboard', 'fresh_dashboard', '/layers')).toBe(0);
    expect(misses()).toEqual([]);
  });

  it('a draft saved a moment ago is found when the leaf is opened again: no stale "absent"', async () => {
    render(interfacesTree());
    await waitFor(() => expect(asked('dashboard', 'customer_dashboard', '/layers')).toBe(1));
    await settle();
    expect(asked('dashboard', 'customer_dashboard', '?state=draft')).toBe(0);

    // A draft lands for the open leaf through the transport Studio writes on.
    await act(async () => {
      await client.save('dashboard', 'customer_dashboard', { ...dashboard('customer_dashboard'), label: 'Edited' }, {
        mode: 'draft',
        packageId: PKG,
      });
    });

    fireEvent.click(await screen.findByTitle('dashboard · fresh_dashboard'));
    await waitFor(() => expect(asked('dashboard', 'fresh_dashboard', '?state=draft')).toBe(1));
    fireEvent.click(await screen.findByTitle('dashboard · customer_dashboard'));
    await waitFor(() => expect(asked('dashboard', 'customer_dashboard', '?state=draft')).toBe(1));
    await settle();
    // It now has a draft, so its baseline is not read a second time.
    expect(asked('dashboard', 'customer_dashboard', '/layers')).toBe(1);
    expect(misses()).toEqual([]);
  });
});

describe('Interfaces pillar — an app found only in the drafts ledger (objectui#11799)', () => {
  it('reads its draft and no /layers', async () => {
    put(server.drafts, 'app', 'acme_app', { name: 'acme_app', label: 'Acme', navigation: NAV });
    put(server.active, 'dashboard', 'customer_dashboard', dashboard('customer_dashboard'));
    render(interfacesTree());
    await waitFor(() => expect(asked('app', 'acme_app', '?state=draft')).toBe(1));
    await waitFor(() => expect(asked('dashboard', 'customer_dashboard', '/layers')).toBe(1));
    await settle();
    expect(asked('app', 'acme_app', '/layers')).toBe(0);
    expect(misses()).toEqual([]);
  });

  it('control: a published app reads its baseline', async () => {
    put(server.active, 'app', 'acme_app', { name: 'acme_app', label: 'Acme', navigation: NAV });
    put(server.active, 'dashboard', 'customer_dashboard', dashboard('customer_dashboard'));
    render(interfacesTree());
    await waitFor(() => expect(asked('app', 'acme_app', '/layers')).toBe(1));
    await settle();
    expect(asked('app', 'acme_app', '?state=draft')).toBe(0);
  });
});

describe('Automations pillar — opening flows asks no 404 question (objectui#11799)', () => {
  it('a saved flow with no draft reads its baseline and no draft; an unsaved flow reads its draft and no baseline', async () => {
    put(server.active, 'flow', 'p_flow', flow('p_flow'));
    put(server.drafts, 'flow', 'fresh_flow', flow('fresh_flow'));
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(asked('flow', 'p_flow', '/layers')).toBe(1));
    await settle();
    expect(asked('flow', 'p_flow', '?state=draft')).toBe(0);

    fireEvent.click((await screen.findAllByText('fresh_flow'))[0]);
    await waitFor(() => expect(asked('flow', 'fresh_flow', '?state=draft')).toBe(1));
    await settle();
    expect(asked('flow', 'fresh_flow', '/layers')).toBe(0);
    expect(misses()).toEqual([]);
  });
});

describe('Data pillar — the draft read follows the ledger (objectui#11799)', () => {
  it('a saved object with no draft is not asked for one; an unsaved object is', async () => {
    put(server.active, 'object', 'acme_account', { name: 'acme_account', label: 'Account', fields: { title: { type: 'text' } } });
    put(server.drafts, 'object', 'acme_fresh', { name: 'acme_fresh', label: 'Fresh', fields: { title: { type: 'text' } } });
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <DataPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(asked('object', 'acme_account', '/layers')).toBe(1));
    await settle();
    expect(asked('object', 'acme_account', '?state=draft')).toBe(0);

    fireEvent.click(await screen.findByText('acme_fresh'));
    await waitFor(() => expect(asked('object', 'acme_fresh', '?state=draft')).toBe(1));
  });
});
