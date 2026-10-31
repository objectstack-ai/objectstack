// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27520 row 7, the Studio half — a list view's sort on a date
 * field names its direction as time.
 *
 * #28423 taught `SortBuilder` to read "Oldest → Newest" for a `date` or
 * `datetime` row when its `fields` carry `type`, and the console list passes
 * it. Studio's list-view panel handed the builder `{ value, label }` only, so
 * the same sort on the same field still read "A → Z" there.
 *
 * The REAL hook (`useObjectListViewDraft`), the REAL panel, the REAL
 * `useObjectFields` over a REAL `MetadataClient` and the REAL `SortBuilder`.
 *
 * Pinned:
 *  - a `date` row reads "Oldest → Newest", a `datetime` row "Newest → Oldest";
 *  - CONTROL: a text row still reads "A → Z".
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.acme.app';
const VIEW = 'acme_loan.default';

const OBJECT_DEF = {
  name: 'acme_loan',
  label: 'Loan',
  fields: {
    book: { name: 'book', label: 'Book', type: 'text' },
    opened_on: { name: 'opened_on', label: 'Opened on', type: 'date' },
    approved_at: { name: 'approved_at', label: 'Approved at', type: 'datetime' },
  },
};

const gridView = (extra: Record<string, unknown> = {}) => ({
  name: VIEW,
  object: 'acme_loan',
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'acme_loan' }, columns: ['book'], ...extra },
});

const server = { active: new Map<string, Record<string, unknown>>() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (method === 'PUT') return json(200, { success: true, version: 'v2', state: 'draft' });
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  // No view draft is pending in this suite.
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  }
  const row = server.active.get(key);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { ObjectListViewInspector, useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const METADATA: MetadataContextValue = {
  apps: [],
  objects: [OBJECT_DEF],
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

const LEAF: Surface = { type: 'object', name: 'acme_loan', label: 'Loans' };

function Host() {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  return <ObjectListViewInspector listView={listView} readOnly={false} locale="en" />;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

async function openPanel(): Promise<HTMLElement> {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Host />
    </MetadataCtx.Provider>,
  );
  await settle();
  return screen.getByTestId('studio-list-view-inspector');
}


/** The sort popover's direction triggers, one per row, in row order. */
async function directionTriggers(panel: HTMLElement): Promise<HTMLElement[]> {
  fireEvent.click(within(panel).getByTestId('list-view-sort-trigger'));
  const popover = await screen.findByRole('dialog');
  // Each row draws two comboboxes: its field, then its direction.
  return within(popover)
    .getAllByRole('combobox')
    .filter((_, i) => i % 2 === 1);
}

beforeEach(() => {
  server.active.clear();
});
afterEach(cleanup);

describe('ObjectListViewInspector — a date sort reads Oldest → Newest (objectstack#27520)', () => {
  it('a `date` row reads "Oldest → Newest" and a `datetime` row "Newest → Oldest"', async () => {
    server.active.set(
      `view/${VIEW}`,
      gridView({
        sort: [
          { field: 'opened_on', order: 'asc' },
          { field: 'approved_at', order: 'desc' },
        ],
      }),
    );
    const [date, datetime] = await directionTriggers(await openPanel());
    expect(date).toHaveTextContent('Oldest → Newest');
    expect(datetime).toHaveTextContent('Newest → Oldest');
  });

  it('CONTROL: a text row still reads "A → Z"', async () => {
    server.active.set(`view/${VIEW}`, gridView({ sort: [{ field: 'book', order: 'asc' }] }));
    const [text] = await directionTriggers(await openPanel());
    expect(text).toHaveTextContent('A → Z');
  });
});
