// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26192 — a position created from Setup → Positions → New is
 * created LIVE, as a permission set is (objectui#7611).
 *
 * Positions register no `EditPage`, so "New" opens the generic
 * `MetadataResourceEditPage`, whose save writes a draft. Setup carries no
 * package binding (`?package=`), so before this the create was a draft with no
 * package: the Positions list (published items) never showed it and a read of
 * the name answered not found until the admin published it by hand. The
 * server admits a live position create (`allowRuntimeCreate` on the `position`
 * row of the spec's metadata-type registry), and the permission set, authored
 * beside it, already creates live through the same `createLive` key.
 *
 * Pinned on the REAL page over a REAL `MetadataClient`, with the position's
 * registration taken from the real `builtinComponents` module (its only home),
 * its transport an in-memory server that records each PUT's `mode`, package
 * and first-write pin, as in `ResourceEditPage.liveCreate-7611.test.tsx`:
 *
 *  - outside a package: ONE live PUT (no `mode`, no `package`) with the
 *    first-write pin, and the editor opens the created position;
 *  - under a package binding the create stays a package draft (control), the
 *    ADR-0086 package door's draft semantics.
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

const POSITION_SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string' },
    label: { type: 'string' },
    description: { type: 'string' },
  },
};

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        { type: 'position', label: 'Position', domain: 'security', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: POSITION_SCHEMA },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
// The position's registration — its only one — lives in the built-in
// component module, not in `anchors.ts`.
import '../../services/builtinComponents';

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

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

/** Open the create form, name the position `regional_lead`, and press Save. */
async function createPosition() {
  render(
    <MemoryRouter initialEntries={['/metadata/position/new']}>
      <Routes>
        <Route
          path="/metadata/position/new"
          element={
            <>
              <MetadataResourceEditPage type="position" name="" createMode />
              <Where />
            </>
          }
        />
        <Route path="/metadata/position/:name" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  const name = await waitFor(() => {
    const el = document.getElementById('mdf-name') as HTMLInputElement | null;
    expect(el).not.toBeNull();
    return el!;
  }, { timeout: 8000 });
  fireEvent.change(name, { target: { value: 'regional_lead' } });
  await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('regional_lead'));
  fireEvent.click(screen.getByRole('button', { name: /Save \(⌘S\)/ }));
}

describe('a position is created live from Setup (objectstack#26192)', () => {
  it('outside a package: one live PUT with the first-write pin, then the editor opens', async () => {
    await createPosition();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/position/regional_lead'), { timeout: 8000 });
    expect(server.puts).toEqual([{ name: 'regional_lead', mode: null, packageId: null, ifNoneMatch: '*' }]);
  });

  it('under a package binding the create stays a package draft (control)', async () => {
    window.history.replaceState(null, '', '/?package=com.acme.crm');
    await createPosition();
    await waitFor(() => expect(server.puts).toHaveLength(1), { timeout: 8000 });
    expect(server.puts[0]).toEqual({ name: 'regional_lead', mode: 'draft', packageId: 'com.acme.crm', ifNoneMatch: '*' });
  });
});
