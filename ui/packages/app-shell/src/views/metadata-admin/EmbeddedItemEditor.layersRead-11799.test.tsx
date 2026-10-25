// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11799 — the embedded item editor's one `GET …/layers` read.
 *
 * `EmbeddedItemEditor` edits an item that lives inside a parent body
 * (`object.fields.amount`). It reads the parent's layered view once, when the
 * author saves, to splice the item back into the parent's current body. It
 * holds only the item snapshot and the parent's name, so nothing in hand says
 * whether the parent was ever published. The framework answers `/layers` with
 * a 404 for a parent that exists only as a draft, and keeps that answer by
 * design (objectstack-ai/objectstack#22397, answer (a)).
 *
 * The REAL editor over a REAL `MetadataClient`, whose transport is an
 * in-memory server answering as the framework does. Requests are counted on
 * it.
 *
 * Pinned:
 *  - opening an item of a draft-only parent sends no request at all, so it
 *    cannot show an error: the read belongs to the save, not to the open;
 *  - CONTROL: a published parent's save reads its layers once and splices the
 *    item into the effective body it got;
 *  - CONTROL: a failed `/layers` read (a 5xx) is the save's error, and nothing
 *    is PUT.
 *
 * Not covered here: what a SAVE does for a draft-only parent. That is
 * objectui#12027's write side, pinned in
 * `EmbeddedItemEditor.draftSave-12027.test.tsx`: the save reads the parent's
 * pending draft first and writes it back in draft mode, so it sends no
 * `/layers` read for such a parent at all. Both controls below have no draft,
 * so they still reach `/layers`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const FIELD_SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string', title: 'Label' },
    description: { type: 'string', title: 'Description' },
  },
} satisfies Record<string, unknown>;

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number }>,
  puts: [] as Array<{ search: string; body: Record<string, unknown> }>,
  /** Rows whose `/layers` read fails with a 5xx. */
  failLayers: new Set<string>(),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const q = url.searchParams;
  let status = 200;
  let body: unknown = [];
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    const key = `${seg[0]}/${seg[1]}`;
    if (seg[0] === '_drafts') {
      body = { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1], packageId: null })) };
    } else if (seg.length === 3 && seg[2] === 'layers' && server.failLayers.has(key)) {
      [status, body] = [500, { error: { code: 'INTERNAL_ERROR', message: 'metadata store unavailable' } }];
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(key);
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2 && method === 'PUT') {
      const item = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      server.puts.push({ search: url.search, body: item });
      if (q.get('mode') === 'draft') server.drafts.set(key, item);
      else server.active.set(key, item);
      body = { type: seg[0], name: seg[1], state: q.get('mode') === 'draft' ? 'draft' : 'active' };
    } else if (seg.length === 2) {
      const draftRead = q.get('state') === 'draft';
      const row = (draftRead ? server.drafts : server.active).get(key);
      if (row) body = { type: seg[0], name: seg[1], item: draftRead ? { ...row, _draft: true } : row };
      else [status, body] = [404, { error: { code: draftRead ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, search: url.search, status });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => client,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'field', label: 'Field', allowEnvironmentOverlay: true, schema: FIELD_SCHEMA }],
  }),
}));

import { EmbeddedItemEditor } from './EmbeddedItemEditor';

const ORDER = {
  name: 'sales_order',
  label: 'Sales Order',
  fields: { amount: { type: 'number', label: 'Amount' }, region: { type: 'text', label: 'Region' } },
};

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.requests = [];
  server.puts = [];
  server.failLayers.clear();
});
afterEach(cleanup);

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function openAmountField() {
  render(
    <EmbeddedItemEditor
      parentType="object"
      parentName="sales_order"
      embeddedPath="fields"
      itemName="amount"
      editAs="field"
      initialRaw={{ type: 'number', label: 'Amount' }}
    />,
  );
}

const saveButton = () => screen.getByRole('button', { name: /save into object/i });
const layersStatuses = () =>
  server.requests.filter((r) => r.method === 'GET' && r.path === '/api/v1/meta/object/sales_order/layers').map((r) => r.status);

describe('EmbeddedItemEditor — the parent\'s /layers read belongs to the save (objectui#11799)', () => {
  it('opening an item of a draft-only parent sends no request, and shows no error', async () => {
    server.drafts.set('object/sales_order', ORDER);
    openAmountField();
    await settle();

    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveValue('Amount');
    expect(server.requests).toEqual([]);
    expect(screen.queryByText(/metadata store unavailable|Validation failed|absent/)).toBeNull();
  });

  it('CONTROL: a published parent\'s save reads its layers once and splices the item into the body it got', async () => {
    server.active.set('object/sales_order', ORDER);
    openAmountField();
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Order amount' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(layersStatuses()).toEqual([200]);
    expect(server.puts).toHaveLength(1);
    expect(server.puts[0].body).toEqual({
      ...ORDER,
      fields: { ...ORDER.fields, amount: { type: 'number', label: 'Order amount' } },
    });
  });

  it('CONTROL: a failed /layers read (a 5xx) is the save\'s error, and nothing is PUT', async () => {
    server.active.set('object/sales_order', ORDER);
    server.failLayers.add('object/sales_order');
    openAmountField();
    fireEvent.click(saveButton());

    expect(await screen.findByText('metadata store unavailable')).toBeInTheDocument();
    await waitFor(() => expect(saveButton()).not.toBeDisabled());
    expect(layersStatuses()).toEqual([500]);
    expect(server.puts).toEqual([]);
    expect(screen.queryByText('Saved.')).toBeNull();
  });
});
