// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13152 — the list-view panel's field pickers do not offer the
 * columns the platform injects and hides.
 *
 * Measured on the card: Studio, Interfaces, a list view's properties, Columns,
 * "Add field" listed "Search Index `__search`" last. The Data rail and the list
 * filter already keep that column out (objectui#11780, objectui#11810); this
 * panel mapped every field `useObjectFields` returned.
 *
 * The REAL hook (`useObjectListViewDraft`), the REAL panel and the REAL
 * `useObjectFields` over a REAL `MetadataClient`, whose transport serves the
 * object as the platform does: `__search` and `owning_business_unit_id` carry
 * `system: true` AND `hidden: true` (objectstack's `search-companion.ts` and
 * `OWNING_BUSINESS_UNIT_FIELD_DEF`).
 *
 * Pinned:
 *  - "Add field" offers neither `__search` nor `owning_business_unit_id`;
 *  - CONTROLS, the Data rail's predicate and not a wider one: an ordinary
 *    field, an author's own hidden field (`hidden` alone) and an injected field
 *    the platform does not hide (`system` alone, `owner_id`) are still offered;
 *  - CONTROL: a view whose filter already names `__search` keeps it among the
 *    panel's fields, so the held rule still reads by its label.
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
    // An author's own hidden field: the Data rail still lists it.
    internal_note: { name: 'internal_note', label: 'Internal note', type: 'textarea', hidden: true },
    // Injected by the platform but NOT hidden: an editable business field.
    owner_id: { name: 'owner_id', label: 'Owner', type: 'lookup', reference: 'sys_user', system: true },
    // The platform's own bookkeeping columns: both marks.
    __search: { name: '__search', label: 'Search Index', type: 'text', hidden: true, readonly: true, system: true },
    owning_business_unit_id: {
      name: 'owning_business_unit_id',
      label: 'Owning business unit',
      type: 'lookup',
      hidden: true,
      system: true,
    },
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
import { t } from '../metadata-admin/i18n';

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

/** The field names the Columns section's "Add field" popover offers, in order. */
async function addFieldOffers(panel: HTMLElement): Promise<string[]> {
  const columns = within(panel).getByTestId('list-view-columns');
  fireEvent.click(within(columns).getByRole('button', { name: t('engine.form.addFieldPlain', 'en') }));
  const popover = await screen.findByRole('dialog');
  return within(popover)
    .getAllByRole('button')
    .map((option) => option.querySelector('code')?.textContent ?? '');
}

beforeEach(() => {
  server.active.clear();
});
afterEach(cleanup);

describe('ObjectListViewInspector — the field pickers leave out the platform’s hidden columns (objectui#13152)', () => {
  it('"Add field" offers neither `__search` nor `owning_business_unit_id`', async () => {
    server.active.set(`view/${VIEW}`, gridView());
    const offers = await addFieldOffers(await openPanel());
    expect(offers).not.toContain('__search');
    expect(offers).not.toContain('owning_business_unit_id');
  });

  it('CONTROL: an ordinary field, an author’s own hidden field and an injected field the platform does not hide are still offered', async () => {
    server.active.set(`view/${VIEW}`, gridView());
    const offers = await addFieldOffers(await openPanel());
    expect(offers).toEqual(['book', 'internal_note', 'owner_id']);
  });

  it('CONTROL: a view whose filter already names `__search` keeps it, so the held rule still reads by its label', async () => {
    server.active.set(`view/${VIEW}`, gridView({ filter: [{ field: '__search', operator: 'contains', value: 'ada' }] }));
    const panel = await openPanel();
    expect(within(within(panel).getByTestId('list-view-filter')).getByTestId('filter-builder-trigger')).toHaveTextContent(
      'Search Index',
    );
    const offers = await addFieldOffers(panel);
    expect(offers).toEqual(['book', 'internal_note', 'owner_id', '__search']);
  });
});
