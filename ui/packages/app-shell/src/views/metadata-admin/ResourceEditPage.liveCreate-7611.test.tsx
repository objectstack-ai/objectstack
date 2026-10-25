// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7611 — a permission set created from the Setup catalog is created
 * LIVE.
 *
 * The set's edit page (`PermissionMatrixEditPage`) edits the live set outside a
 * package and reads no draft. Measured on objectstack `main` before this: "New"
 * saved a draft, the editor opened an empty set without the label, its Save
 * wrote the grants live, and the create draft stayed pending — Home offered
 * "1 unpublished change", and publishing it replaced the grants with the empty
 * create body.
 *
 * The REAL page over a REAL `MetadataClient`, its transport an in-memory server
 * that records each PUT's `mode` and pin, as in
 * `ResourceEditPage.createFirstWritePin-11773.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const server = {
  puts: [] as Array<{ name: string; mode: string | null; packageId: string | null; ifNoneMatch: string | null }>,
};

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
  if (method === 'PUT') {
    server.puts.push({
      name: seg[1]!,
      mode: url.searchParams.get('mode'),
      packageId: url.searchParams.get('package'),
      ifNoneMatch: new Headers(init?.headers).get('If-None-Match'),
    });
    return json(200, { success: true, version: 'hmac-sha256:v1', seq: 1, state: 'active', message: 'Saved' });
  }
  return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = vi.hoisted(() => ({ current: null as unknown }));

const PERMISSION_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' }, label: { type: 'string' }, objects: { type: 'object' } },
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        { type: 'permission', label: 'Permission Set', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: PERMISSION_SCHEMA },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerBuiltinAnchors } from './anchors';

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });
registerBuiltinAnchors();

beforeEach(() => {
  server.puts = [];
  window.localStorage.setItem('metadata-admin:autosave', '0');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
  window.history.replaceState(null, '', '/');
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

/** Open the create form, label the set "QA Parity Set", and press Save. */
async function createSet() {
  render(
    <MemoryRouter initialEntries={['/metadata/permission/new']}>
      <Routes>
        <Route
          path="/metadata/permission/new"
          element={
            <>
              <MetadataResourceEditPage type="permission" name="" createMode />
              <Where />
            </>
          }
        />
        <Route path="/metadata/permission/:name" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  const label = await waitFor(() => {
    const el = document.getElementById('mdf-label') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  }, { timeout: 8000 });
  fireEvent.change(label, { target: { value: 'QA Parity Set' } });
  await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('qa_parity_set'));
  fireEvent.click(screen.getByRole('button', { name: /Save \(⌘S\)/ }));
}

describe('a permission set is created live (objectui#7611)', () => {
  it('outside a package: one live PUT with the first-write pin, then the editor opens', async () => {
    await createSet();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/permission/qa_parity_set'), { timeout: 8000 });
    expect(server.puts).toEqual([{ name: 'qa_parity_set', mode: null, packageId: null, ifNoneMatch: '*' }]);
  });

  it('under a package binding the create stays a package draft (control)', async () => {
    window.history.replaceState(null, '', '/?package=com.acme.crm');
    await createSet();
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(server.puts[0]).toEqual({ name: 'qa_parity_set', mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' });
  });
});
