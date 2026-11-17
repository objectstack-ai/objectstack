// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34796 — Studio's list-view panel shows each column by its label;
 * the field's machine name is on the row's hover title only. The row component
 * is shared with the Setup designers, whose rows keep the name beside the
 * label (the CONTROL below).
 *
 * The harness is `ObjectListViewInspector.displayTitle-13151.test.tsx`'s: the
 * real panel over a metadata client answering from an in-memory server.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.acme.app';

const OBJECT_DEF = {
  name: 'acme_loan',
  label: 'Loan',
  fields: {
    book: { name: 'book', label: 'Book', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

/** The views the server holds, by name. */
const server = { active: new Map<string, Record<string, unknown>>() };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (method === 'PUT') return json(200, { success: true, version: 'v2', state: 'draft' });
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg.length === 2 && url.searchParams.get('state') === 'draft') {
    return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
  }
  const row = server.active.get(`${seg[0]}/${seg[1]}`);
  if (seg.length === 3 && seg[2] === 'layers') {
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { ObjectListViewInspector, useObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';
import { DraftTargetLabels, type DraftTargetLabel } from '../../hooks/useNavTargetLabel';
import { FieldListRow } from '../metadata-admin/previews/ViewColumnPanes';

function metadataOf(objects: unknown[]): MetadataContextValue {
  return {
    apps: [],
    objects,
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
}

function Host({ leaf, locale }: { leaf: Surface; locale: string }) {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf, publishNonce: 0 });
  return <ObjectListViewInspector listView={listView} readOnly={false} locale={locale} />;
}

function mount({
  leaf = { type: 'object', name: 'acme_loan', label: 'Loans' } as Surface,
  locale = 'en-US',
  objects = [OBJECT_DEF] as unknown[],
  drafts = [] as DraftTargetLabel[],
} = {}) {
  return render(
    <MetadataCtx.Provider value={metadataOf(objects)}>
      <DraftTargetLabels.Provider value={drafts}>
        <Host leaf={leaf} locale={locale} />
      </DraftTargetLabels.Provider>
    </MetadataCtx.Provider>,
  );
}


beforeEach(() => {
  server.active.clear();
});
afterEach(cleanup);

describe("Studio's list-view column rows keep field names on hover (objectstack#34796)", () => {
  it('a row reads its label alone, with the field name as its title', async () => {
    server.active.set('view/acme_loan.default', {
      name: 'acme_loan.default',
      object: 'acme_loan',
      viewKind: 'list',
      label: 'Active loans',
      isDefault: true,
      config: { type: 'grid', data: { provider: 'object', object: 'acme_loan' }, columns: ['book', 'status'] },
    });
    mount();
    const columns = await screen.findByTestId('list-view-columns', undefined, { timeout: 8000 });
    await waitFor(() => expect(columns).toHaveTextContent('Book'));
    expect(columns).toHaveTextContent('Status');
    // No visible machine name: neither as text nor as the old secondary code element.
    expect(columns.textContent).not.toMatch(/\bbook\b|\bstatus\b/);
    expect(columns.querySelector('code')).toBeNull();
    expect(screen.getByTitle('book')).toHaveTextContent('Book');
    expect(screen.getByTitle('status')).toHaveTextContent('Status');
  });

  it('CONTROL: outside the Studio panel the shared row keeps the name beside the label', () => {
    const noop = () => {};
    render(
      <FieldListRow
        index={0}
        label="Book"
        fieldName="book"
        fieldType="text"
        selected={false}
        canEdit={false}
        dragging={false}
        dropBefore={false}
        onSelect={noop}
        onRemove={noop}
        onDragStart={noop}
        onDragEnd={noop}
        onDragOverRow={noop}
        onDropRow={noop}
      />,
    );
    const code = document.querySelector('code');
    expect(code).not.toBeNull();
    expect(code).toHaveTextContent('book');
  });
});
