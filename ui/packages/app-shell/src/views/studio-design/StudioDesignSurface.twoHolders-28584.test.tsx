// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28584 — the Studio pillars read the layered view of an item two
 * packages hold at the package the pillar is open in.
 *
 * Since objectstack#28337, the layered view naming no package refuses a name
 * whose active rows two packages hold: `409 RESOURCE_CONFLICT`, naming the
 * holders and the `?package=` remedy. The Interfaces pillar's app and leaf,
 * the Automations pillar's flow and the Data pillar's object read it naming no
 * package, so on such a deployment each failed to load. Each now reads at the
 * package it reads the draft at and saves to.
 *
 * The REAL pillars over a REAL `MetadataClient`, whose transport is an
 * in-memory server holding every published item in this package and in a
 * second one, and answering the layered read as the framework does: the
 * holder's stack with `?package=`, the refusal without it.
 *
 * Pinned, per pillar: every layered read names this package, none is refused,
 * and what loads is this package's item, ⛔ never the other holder's.
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
const OTHER = 'com.other.app';
const NAV = [{ id: 'n1', type: 'dashboard', label: 'Customers', dashboardName: 'customer_dashboard' }];
const OTHER_NAV = [{ id: 'n1', type: 'dashboard', label: 'Elsewhere', dashboardName: 'other_dashboard' }];
const flow = (name: string, label: string) => ({
  name,
  label,
  type: 'autolaunched',
  status: 'obsolete',
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [{ id: 'e1', source: 'start', target: 'end' }],
});

/** The server: each published item's body per holder, and every request it was asked. */
const server = {
  holders: new Map<string, Map<string, Record<string, unknown>>>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number }>,
};

/** `name` of `type`, published in both packages, each with its own body. */
function holdBoth(type: string, name: string, mine: Record<string, unknown>, theirs: Record<string, unknown>) {
  server.holders.set(`${type}/${name}`, new Map([[PKG, mine], [OTHER, theirs]]));
}

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
    } else if (seg.length === 1) {
      body = {
        items: [...server.holders.entries()]
          .filter(([key]) => key.startsWith(`${seg[0]}/`))
          .map(([, byPkg]) => byPkg.get(pkg ?? PKG))
          .filter(Boolean),
      };
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const byPkg = server.holders.get(`${seg[0]}/${seg[1]}`);
      const row = pkg ? byPkg?.get(pkg) : undefined;
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else if (!pkg && byPkg && byPkg.size > 1) {
        [status, body] = [
          409,
          {
            success: false,
            error: {
              code: 'RESOURCE_CONFLICT',
              message: `Name the package this layered read is for, then send it again: '${seg[1]}' is held by '${PKG}' and '${OTHER}'.`,
            },
          },
        ];
      } else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2) {
      [status, body] = [404, { error: { code: url.searchParams.get('state') === 'draft' ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } }];
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
  server.holders.clear();
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

/** The layered reads sent for `type/name`: each one's query string and status. */
function layersReads(type: string, name: string) {
  return server.requests
    .filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/${type}/${name}/layers`)
    .map((r) => ({ search: r.search, status: r.status }));
}

const refused = () => server.requests.filter((r) => r.status === 409).map((r) => `${r.path}${r.search}`);

describe('Studio pillars — an item two packages hold is read at this package (objectstack#28584)', () => {
  it('Interfaces: the app and its dashboard leaf are read at this package, and its nav loads', async () => {
    holdBoth('app', 'acme_app', { name: 'acme_app', label: 'Acme', navigation: NAV }, { name: 'acme_app', label: 'Other', navigation: OTHER_NAV });
    holdBoth(
      'dashboard',
      'customer_dashboard',
      { name: 'customer_dashboard', label: 'Mine', widgets: [] },
      { name: 'customer_dashboard', label: 'Theirs', widgets: [] },
    );
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(layersReads('dashboard', 'customer_dashboard')).toHaveLength(1));
    await settle();

    expect(layersReads('app', 'acme_app')).toEqual([{ search: `?package=${PKG}`, status: 200 }]);
    expect(layersReads('dashboard', 'customer_dashboard')).toEqual([{ search: `?package=${PKG}`, status: 200 }]);
    expect(refused()).toEqual([]);
    // This package's nav, not the other holder's.
    expect(await screen.findByTitle('dashboard · customer_dashboard')).toBeInTheDocument();
    expect(screen.queryByTitle('dashboard · other_dashboard')).toBeNull();
  });

  it('Automations: the flow is read at this package', async () => {
    holdBoth('flow', 'p_flow', flow('p_flow', 'Mine'), flow('p_flow', 'Theirs'));
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/automations`]}>
        <AutomationsPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(layersReads('flow', 'p_flow')).toHaveLength(1));
    await settle();

    expect(layersReads('flow', 'p_flow')).toEqual([{ search: `?package=${PKG}`, status: 200 }]);
    expect(refused()).toEqual([]);
  });

  it('Data: the object is read at this package', async () => {
    holdBoth(
      'object',
      'acme_account',
      { name: 'acme_account', label: 'Account', fields: { title: { type: 'text' } } },
      { name: 'acme_account', label: 'Theirs', fields: { code: { type: 'text' } } },
    );
    render(
      <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
        <DataPillar packageId={PKG} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(layersReads('object', 'acme_account')).toHaveLength(1));
    await settle();

    expect(layersReads('object', 'acme_account')).toEqual([{ search: `?package=${PKG}`, status: 200 }]);
    expect(refused()).toEqual([]);
  });
});
