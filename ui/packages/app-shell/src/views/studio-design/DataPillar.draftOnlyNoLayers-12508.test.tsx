// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12508 — the Data pillar does not ask `GET /meta/object/NAME/layers`
 * for a draft-only object.
 *
 * Measured on the card's session: the object load read `/layers` beside the
 * draft for every selected object, so right after "New object" saved a draft
 * the console logged a 404 for it. A draft-only object (a pending draft, no
 * row in the package's published list) has no layer. The load now reads the
 * draft first for a name the published list does not hold, and the layers
 * only when no draft is served.
 *
 * The client is a real `MetadataClient` over an in-memory server answering as
 * the framework does: 404 for `/layers` with no layer and for `?state=draft`
 * with no draft, 500 for a broken store.
 *
 * Pinned:
 *  - a draft-only object: no `/layers`, and the editor holds its draft;
 *  - CONTROL: the drafts list names an object whose draft is no longer served
 *    (published since): its `/layers` is still read;
 *  - CONTROL: a published object still reads its layers;
 *  - CONTROL: a failed `/layers` read (a 5xx) on a published object still
 *    surfaces as the pillar's refusal.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.default.studio-test';

const server = {
  published: [] as Array<Record<string, unknown>>,
  drafts: new Map<string, Record<string, unknown>>(),
  /** Names the drafts list reports, whether or not a draft is served for them. */
  draftHeaders: [] as string[],
  failLayers: new Set<string>(),
  requests: [] as Array<{ method: string; path: string; status: number }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://test.local');
  const q = url.searchParams;
  let status = 200;
  let body: unknown = null;
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (method === 'GET' && meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    if (seg[0] === '_drafts') {
      body = { success: true, data: { drafts: server.draftHeaders.map((name) => ({ type: 'object', name, packageId: PKG })) } };
    } else if (seg.length === 1) {
      body = { type: seg[0], items: q.get('preview') === 'draft' ? [] : server.published };
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.published.find((o) => o.name === seg[1]);
      if (server.failLayers.has(seg[1])) [status, body] = [500, { error: { code: 'INTERNAL_ERROR', message: 'metadata store unavailable' } }];
      else if (row) body = { code: row, overlay: null, effective: row };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2 && q.get('state') === 'draft') {
      const row = server.drafts.get(seg[1]);
      if (row) body = { type: seg[0], name: seg[1], item: { ...row, _draft: true } };
      else [status, body] = [404, { error: { code: 'NO_DRAFT', message: 'absent' } }];
    } else {
      [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: 'http://test.local', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client, useMetadataTypes: () => ({ entries: [] }) };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => dataSource };
});

import { DataPillar } from './StudioDesignSurface';
import { createEmptyDataSource } from './__tests__/emptyDataSource';
import { registerBuiltinInspectors } from '../metadata-admin/inspectors';

const dataSource = createEmptyDataSource();
registerBuiltinInspectors();

const ticket = { name: 'st_ticket', label: 'Ticket', fields: [{ name: 'subject', label: 'Subject', type: 'text' }] };
const kase = { name: 'st_case', label: 'Case', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

beforeEach(() => {
  server.published = [];
  server.drafts.clear();
  server.draftHeaders = [];
  server.failLayers.clear();
  server.requests = [];
});
afterEach(cleanup);

async function openPillar() {
  render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/data`]}>
      <DataPillar packageId={PKG} />
    </MemoryRouter>,
  );
  await act(async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const reads = (name: string, suffix: '/layers' | '') =>
  server.requests
    .filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/object/${name}${suffix}`)
    .map((r) => r.status);

describe('DataPillar — a draft-only object is not asked for /layers (objectui#12508)', () => {
  it('a draft-only object: no /layers, and the editor holds its draft', async () => {
    server.drafts.set('st_ticket', ticket);
    server.draftHeaders = ['st_ticket'];
    await openPillar();

    expect(reads('st_ticket', ''), 'the draft read never ran: the harness is dead').toEqual([200]);
    expect(reads('st_ticket', '/layers')).toEqual([]);
    expect(server.requests.filter((r) => r.status >= 400)).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    expect(await screen.findByText('Subject')).toBeInTheDocument();
  });

  it('CONTROL: a name the drafts list holds but whose draft is no longer served still reads its /layers', async () => {
    server.draftHeaders = ['st_ticket'];
    await openPillar();

    expect(reads('st_ticket', '')).toEqual([404]);
    expect(reads('st_ticket', '/layers')).toEqual([404]);
  });

  it('CONTROL: a published object still reads its layers', async () => {
    server.published = [kase];
    await openPillar();

    expect(reads('st_case', '/layers')).toEqual([200]);
    fireEvent.click(await screen.findByRole('button', { name: 'Form' }));
    expect(await screen.findByText('Title')).toBeInTheDocument();
  });

  it('CONTROL: a 5xx on a published object\'s /layers still surfaces as the pillar\'s refusal', async () => {
    server.published = [kase];
    server.failLayers.add('st_case');
    await openPillar();

    expect(reads('st_case', '/layers')).toEqual([500]);
    expect(await screen.findByTestId('studio-refusal')).toBeInTheDocument();
  });
});
