// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36906 — the create landing's history entry, at the REAL call site.
 *
 * A create's Save navigates to the new item. In a Studio package's area, a
 * dashboard's or a report's item address leaves for the app at once, so that
 * landing REPLACES the create page's history entry (`studioCreateLandsInApp`,
 * read by `MetadataResourceEditPage`): Back from the app lands on the list,
 * not on an empty create form. Every other type, and Setup (no area host),
 * land as before, with a PUSH.
 *
 * `StudioAreaAppOpen-36906.test.tsx` drives the area's routes over a create
 * stub; this file drives the real page, so the call site itself is pinned.
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server holding drafts and publishes, as in
 * `ResourceEditPage.createFirstWritePin-11773.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches a dynamic import of this module: its first load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const server = {
  drafts: new Map<string, Record<string, unknown>>(),
  active: new Map<string, Record<string, unknown>>(),
  puts: [] as Array<{ key: string; packageId: string | null }>,
  seq: 0,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg.length === 1) return json(200, { items: [] });
  if (seg.length === 3 && seg[2] === 'publish' && method === 'POST') {
    const body = server.drafts.get(key);
    if (!body) return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
    server.active.set(key, body);
    server.drafts.delete(key);
    return json(200, { success: true, version: `sha256:${key}`, message: 'published' });
  }
  if (seg.length === 3) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  if (method === 'PUT') {
    server.puts.push({ key, packageId: url.searchParams.get('package') });
    server.seq += 1;
    server.drafts.set(key, JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return json(200, { success: true, version: `hmac-sha256:v${server.seq}`, seq: server.seq, state: 'draft', message: `Saved ${key}` });
  }
  return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
}

const client = vi.hoisted(() => ({ current: null as unknown }));

const NAMED_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' }, label: { type: 'string' } },
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        { type: 'dashboard', label: 'Dashboard', domain: 'ui', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: NAMED_SCHEMA },
        { type: 'view', label: 'View', domain: 'ui', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: NAMED_SCHEMA },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });
registerDefaultMetadataSchemas();

const PKG = 'com.acme.crm';
/** The package a Setup create's address names. */
const SETUP_PKG = 'app.setup_side';
const AREA: MetadataAreaHost = { packageId: PKG, readOnly: false, basePath: `/studio/${PKG}/metadata` };

beforeEach(() => {
  server.drafts.clear();
  server.active.clear();
  server.puts = [];
  server.seq = 0;
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
  window.history.replaceState(null, '', '/');
});

/** Where the create landed, and whether that landing pushed or replaced the history entry. */
function Landed() {
  return (
    <div data-testid="landed">
      {useLocation().pathname} {useNavigationType()}
    </div>
  );
}

/**
 * Open `type`'s create form (under `host` when one is given, else as Setup
 * mounts it), name it `pipeline`, and press Save.
 */
async function createAndSave(type: 'dashboard' | 'view', host: MetadataAreaHost | null) {
  const base = host ? host.basePath : '/apps/setup/metadata';
  // The page binds its saves to `?package=` (`readActivePackageBinding`), as the area's address does.
  // Setup's create names its package too (objectstack#38149: else it asks first).
  window.history.replaceState(null, '', `/?package=${host?.packageId ?? SETUP_PKG}`);
  const tree = (
    <MemoryRouter initialEntries={[`${base}/${type}`, `${base}/${type}/new`]} initialIndex={1}>
      <Routes>
        <Route path={`${base}/${type}`} element={<div data-testid="list" />} />
        <Route path={`${base}/${type}/new`} element={<MetadataResourceEditPage type={type} name="" createMode />} />
        <Route path={`${base}/${type}/:name`} element={<Landed />} />
      </Routes>
    </MemoryRouter>
  );
  render(host ? <MetadataAreaHostContext.Provider value={host}>{tree}</MetadataAreaHostContext.Provider> : tree);
  const label = await waitFor(() => {
    const el = document.getElementById('mdf-label') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  }, { timeout: 8000 });
  fireEvent.change(label, { target: { value: 'Pipeline' } });
  fireEvent.change(document.getElementById('mdf-name') as HTMLInputElement, { target: { value: 'pipeline' } });
  await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('pipeline'));
  fireEvent.click(screen.getByRole('button', { name: /Save \(⌘S\)/ }));
  return `${base}/${type}/pipeline`;
}

describe("the create landing's history entry, at the real page (objectstack#36906)", () => {
  it("in a package's area, a dashboard's create landing REPLACES the create page's entry", async () => {
    const item = await createAndSave('dashboard', AREA);
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent(`${item} REPLACE`), { timeout: 8000 });
    expect(server.puts).toEqual([{ key: 'dashboard/pipeline', packageId: PKG }]);
  });

  it("CONTROL: in the same area, a view's create landing PUSHES, as before", async () => {
    const item = await createAndSave('view', AREA);
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent(`${item} PUSH`), { timeout: 8000 });
    expect(server.puts).toEqual([{ key: 'view/pipeline', packageId: PKG }]);
  });

  it("CONTROL: with no area host (Setup), a dashboard's create landing PUSHES, as before", async () => {
    const item = await createAndSave('dashboard', null);
    await waitFor(() => expect(screen.getByTestId('landed')).toHaveTextContent(`${item} PUSH`), { timeout: 8000 });
    expect(server.puts).toEqual([{ key: 'dashboard/pipeline', packageId: SETUP_PKG }]);
  });
});
