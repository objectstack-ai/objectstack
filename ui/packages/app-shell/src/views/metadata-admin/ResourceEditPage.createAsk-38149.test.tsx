// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — the item editor's create asks for its package when its
 * address names none: a deep link (`/apps/setup/metadata/TYPE/new`), Studio's
 * cross-package leg (`/studio/~all/metadata/TYPE/new`), Setup's catalog
 * (`?scope=environment`). Nothing is written until the person picks a package
 * or creates one; the item is then saved as a draft there and published at
 * once, and the editor opens it under that package.
 *
 * Setup's positions and permission sets (decisions Q-a of topic
 * objectstack#37424, answered A, on the premise the dogfood probe
 * `position-in-package-binds-outside-sets-38149` measures): a `createLive`
 * type takes the draft-and-publish path in the chosen package too.
 *
 * Over the REAL page and a REAL `MetadataClient`, its transport an in-memory
 * server recording each write; the position's and permission set's
 * registrations are the real ones.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The source under test reaches `celAuthoring`'s dynamic `@objectstack/lint`
// import; its first load is paid here, at collection (`check:test-source-alias`).
import '@objectstack/lint';
// …and `anchors.ts`'s dynamic `@object-ui/plugin-detail` import, the same way.
import '@object-ui/plugin-detail';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

type Write = { method: string; path: string; mode: string | null; packageId: string | null };
const server = { writes: [] as Write[], refuseNext: false };

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
    if (server.refuseNext) {
      server.refuseNext = false;
      server.writes.push({ method: `${method} (refused)`, path: url.pathname, mode: url.searchParams.get('mode'), packageId: url.searchParams.get('package') });
      return json(422, { success: false, error: { code: 'INVALID_METADATA', message: 'Refused once' } });
    }
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

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        { type: 'position', label: 'Position', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA },
        { type: 'permission', label: 'Permission Set', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: SCHEMA },
      ],
    }),
  };
});

/** The server's package list the ask reads. */
vi.mock('../studio-design/packages-io', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchPackages: async () => [
    { id: 'app.alpha', name: 'Alpha', writable: true, namespace: 'alpha' },
    { id: 'com.objectstack.setup', name: 'Setup', writable: false, namespace: 'setup' },
  ],
}));

import { MetadataResourceEditPage } from './ResourceEditPage';
import './anchors';
import '../../services/builtinComponents';

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

beforeEach(() => {
  server.writes = [];
  server.refuseNext = false;
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
  window.history.replaceState(null, '', '/');
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

/** Open the create form at `entry`, fill the name, and press Save. */
async function createAt(type: string, entry: string, name: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path={`/metadata/${type}/new`}
          element={
            <>
              <MetadataResourceEditPage type={type} name="" createMode />
              <Where />
            </>
          }
        />
        <Route path={`/metadata/${type}/:name`} element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  const input = await waitFor(() => {
    const el = document.getElementById('mdf-name') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  }, { timeout: 8000 });
  fireEvent.change(input, { target: { value: name } });
  await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe(name));
  fireEvent.click(screen.getByRole('button', { name: /Save \(⌘S\)/ }));
}

describe('the editor asks for a package before a create its address names none for (objectstack#38149)', () => {
  it('a deep link: the ask opens, Cancel writes nothing and stays on the form', async () => {
    await createAt('position', '/metadata/position/new', 'regional_lead');
    const dialog = await screen.findByTestId('package-create-ask', {}, { timeout: 8000 });
    // Only the writable package is offered.
    await within(dialog).findByTestId('package-create-ask-option-app.alpha');
    expect(within(dialog).queryByTestId('package-create-ask-option-com.objectstack.setup')).toBeNull();
    fireEvent.click(within(dialog).getByTestId('package-create-ask-cancel'));
    await waitFor(() => expect(screen.queryByTestId('package-create-ask')).toBeNull());
    expect(server.writes).toEqual([]);
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/position/new');
  });

  it('a position (Q-a): the chosen package takes a draft and its publish, and the item opens under it', async () => {
    await createAt('position', '/metadata/position/new?scope=environment', 'regional_lead');
    const dialog = await screen.findByTestId('package-create-ask', {}, { timeout: 8000 });
    fireEvent.click(await within(dialog).findByTestId('package-create-ask-option-app.alpha'));
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/position/regional_lead'), { timeout: 8000 });
    expect(screen.getByTestId('where')).toHaveTextContent('scope=environment');
    expect(screen.getByTestId('where')).toHaveTextContent('package=app.alpha');
    expect(server.writes).toEqual([
      { method: 'PUT', path: '/api/v1/meta/position/regional_lead', mode: 'draft', packageId: 'app.alpha' },
      { method: 'POST', path: '/api/v1/meta/position/regional_lead/publish', mode: null, packageId: 'app.alpha' },
    ]);
  });

  it('a permission set (Q-a, `createLive`): a draft in the chosen package and its publish, never a live package-less write', async () => {
    await createAt('permission', '/metadata/permission/new?scope=environment', 'regional_set');
    const dialog = await screen.findByTestId('package-create-ask', {}, { timeout: 8000 });
    fireEvent.click(await within(dialog).findByTestId('package-create-ask-option-app.alpha'));
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));
    await waitFor(() => expect(server.writes).toHaveLength(2), { timeout: 8000 });
    expect(server.writes).toEqual([
      { method: 'PUT', path: '/api/v1/meta/permission/regional_set', mode: 'draft', packageId: 'app.alpha' },
      { method: 'POST', path: '/api/v1/meta/permission/regional_set/publish', mode: null, packageId: 'app.alpha' },
    ]);
  });

  it('control: an address that names a package saves there with no ask', async () => {
    window.history.replaceState(null, '', '/?package=com.acme.crm');
    await createAt('position', '/metadata/position/new?package=com.acme.crm', 'regional_lead');
    await waitFor(() => expect(server.writes).toHaveLength(2), { timeout: 8000 });
    expect(screen.queryByTestId('package-create-ask')).toBeNull();
    expect(server.writes[0]).toEqual({ method: 'PUT', path: '/api/v1/meta/position/regional_lead', mode: 'draft', packageId: 'com.acme.crm' });
  });

  it('a refused first save keeps the form and the answer: the retry asks nothing and names the same package', async () => {
    server.refuseNext = true;
    await createAt('position', '/metadata/position/new', 'regional_lead');
    const dialog = await screen.findByTestId('package-create-ask', {}, { timeout: 8000 });
    fireEvent.click(await within(dialog).findByTestId('package-create-ask-option-app.alpha'));
    fireEvent.click(within(dialog).getByTestId('package-create-ask-continue'));
    await waitFor(() => expect(server.writes).toHaveLength(1), { timeout: 8000 });
    // The answer is not written into the address before the save: the form stays where it was.
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/position/new');
    expect(screen.getByTestId('where')).not.toHaveTextContent('package=');
    // A refusal holds Save until the form changes (the server-refusal gate): the author edits, then saves again.
    fireEvent.change(document.getElementById('mdf-label') as HTMLInputElement, { target: { value: 'Regional lead' } });
    await waitFor(() => expect(screen.getByTestId('resource-save')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('resource-save'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/position/regional_lead'), { timeout: 8000 });
    expect(screen.queryByTestId('package-create-ask')).toBeNull();
    expect(server.writes).toEqual([
      { method: 'PUT (refused)', path: '/api/v1/meta/position/regional_lead', mode: 'draft', packageId: 'app.alpha' },
      { method: 'PUT', path: '/api/v1/meta/position/regional_lead', mode: 'draft', packageId: 'app.alpha' },
      { method: 'POST', path: '/api/v1/meta/position/regional_lead/publish', mode: null, packageId: 'app.alpha' },
    ]);
  });
});
