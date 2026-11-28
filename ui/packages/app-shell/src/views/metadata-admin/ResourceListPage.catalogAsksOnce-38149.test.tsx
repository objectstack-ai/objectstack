// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — Setup's catalog (the environment scope, decisions Q-a of
 * topic objectstack#37424) asks for a new item's package exactly once, at Save.
 *
 * The catalog's New used to ask too, and wrote the answer into the create's
 * address. Studio's area drops `?package=` under the environment scope
 * (`areaLocationRedirect`), where every catalog create of a position or a
 * permission set lands, so the editor's Save asked a second time (measured
 * live). New now opens the create in the scope, naming no package, and Save
 * asks; the save names the chosen package.
 *
 * The REAL list and the REAL editor, mounted on Setup's two routes, over a
 * REAL `MetadataClient` whose transport is an in-memory server recording each
 * write; the permission set's registration is the real one.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The source under test reaches `celAuthoring`'s dynamic `@objectstack/lint`
// import; its first load is paid here, at collection (`check:test-source-alias`).
import '@objectstack/lint';
// …and `anchors.ts`'s dynamic `@object-ui/plugin-detail` import, the same way.
import '@object-ui/plugin-detail';
import '@objectstack/spec/identity';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

type Write = { method: string; path: string; mode: string | null; packageId: string | null };
const server = { writes: [] as Write[] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg.length === 1) return json(200, { items: [] });
  if (method === 'PUT' || method === 'POST') {
    server.writes.push({ method, path: url.pathname, mode: url.searchParams.get('mode'), packageId: url.searchParams.get('package') });
    return json(200, { success: true, version: 'hmac-sha256:v1', seq: 1, state: method === 'PUT' ? 'draft' : 'active', message: 'Saved' });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = vi.hoisted(() => ({ current: null as unknown }));

const SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' } },
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useMetadata')>()),
  useMetadataClient: () => client.current,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission Set', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA }],
  }),
}));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

/** The server's package list the ask reads, with its `writable` verdict. */
vi.mock('../studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPackages: async () => [
    { id: 'app.alpha', name: 'Alpha', writable: true, namespace: 'alpha' },
    { id: 'app.bravo', name: 'Bravo', writable: true, namespace: 'bravo' },
  ],
}));

import { MetadataResourceListPage } from './ResourceListPage';
import { MetadataResourceEditPage } from './ResourceEditPage';
import { t } from './i18n';
import './anchors';
import '../../services/builtinComponents';

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

beforeEach(() => {
  server.writes = [];
  window.localStorage.setItem('metadata-admin:autosave', '0');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ records: [], hasMore: false }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.removeItem('metadata-admin:autosave');
  window.history.replaceState(null, '', '/');
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

describe('Setup catalog: a new permission set asks for its package once, at Save (objectstack#38149, Q-a)', () => {
  it('New asks nothing; Save asks once; the save is a draft in the chosen package and its publish', async () => {
    render(
      <MemoryRouter initialEntries={['/apps/setup/metadata/permission?scope=environment']}>
        <Where />
        <Routes>
          <Route path="/apps/setup/metadata/:type" element={<MetadataResourceListPage type="permission" />} />
          <Route path="/apps/setup/metadata/:type/new" element={<MetadataResourceEditPage type="permission" name="" createMode />} />
          <Route path="/apps/setup/metadata/:type/:name" element={<div data-testid="landed" />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(t('engine.list.create', 'en-US')) }, { timeout: 8000 }));
    // New opens the create in the environment scope, naming no package, with no ask.
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/apps/setup/metadata/permission/new?scope=environment'));
    expect(screen.getByTestId('where')).not.toHaveTextContent('package=');
    expect(screen.queryByTestId('package-create-ask')).toBeNull();

    const input = await waitFor(() => {
      const el = document.getElementById('mdf-name') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el!;
    }, { timeout: 8000 });
    fireEvent.change(input, { target: { value: 'regional_set' } });
    await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('regional_set'));
    fireEvent.click(screen.getByRole('button', { name: /Save \(⌘S\)/ }));

    // Save asks, once, with nothing pre-selected.
    const dialog = await screen.findByTestId('package-create-ask', {}, { timeout: 8000 });
    expect(screen.getAllByTestId('package-create-ask')).toHaveLength(1);
    const alpha = await within(dialog).findByTestId('package-create-ask-option-app.alpha');
    expect(alpha).toHaveAttribute('data-state', 'unchecked');
    expect(server.writes).toEqual([]);
    fireEvent.click(alpha);
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));

    await waitFor(() => expect(server.writes).toHaveLength(2), { timeout: 8000 });
    expect(server.writes).toEqual([
      { method: 'PUT', path: '/api/v1/meta/permission/regional_set', mode: 'draft', packageId: 'app.alpha' },
      { method: 'POST', path: '/api/v1/meta/permission/regional_set/publish', mode: null, packageId: 'app.alpha' },
    ]);
    await waitFor(() => expect(screen.queryByTestId('package-create-ask')).toBeNull());
  });
});
