// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13151 — the list-view panel of an `object` leaf names the view it
 * edits by its display name, never by the item's qualified name
 * (`<object>.<key>`), which it shows beneath as the machine name.
 *
 * The REAL hook (`useObjectListViewDraft`) and the REAL panel over a REAL
 * `MetadataClient`, whose transport is an in-memory server.
 *
 * Pinned:
 *  - a view with no label is headed by its object's display name and its
 *    role: "Default view" for the object's default list view, else the key
 *    the nav entry names it by; the not-created and not-list sentences name
 *    the same title, and neither holds the qualified name;
 *  - the object's display name is the one the nav rail gives a label-less
 *    entry: the published label, else a draft-only object's pending draft
 *    label, else its machine name;
 *  - the machine name stays on the panel, as a secondary line;
 *  - CONTROL: a view with a label is headed by that label, as before.
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
import { t } from '../metadata-admin/i18n';

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

/** The panel header's title: the line beside the kind chip. */
function headerTitle(locale = 'en-US'): string {
  const chip = screen.getByText(t('engine.studio.inspector.listView.kind', locale));
  return chip.nextElementSibling?.textContent ?? '';
}

/** Waits for the view's load to settle on the not-created notice or the editor. */
async function loaded(testId: 'list-view-not-created' | 'list-view-columns' | 'list-view-not-list') {
  return screen.findByTestId(testId, undefined, { timeout: 8000 });
}

beforeEach(() => {
  server.active.clear();
});
afterEach(cleanup);

describe('the list-view panel names the view by its display name (objectui#13151)', () => {
  it('an unlabelled default view not created yet: the object\'s name and its role, never the qualified name', async () => {
    mount();
    const notice = await loaded('list-view-not-created');

    expect(headerTitle()).toBe('Loan · Default view');
    expect(notice).toHaveTextContent('There is no list view “Loan · Default view” yet.');
    expect(notice).not.toHaveTextContent('acme_loan.default');
    // The machine name stays, as the secondary line.
    expect(screen.getByTestId('list-view-name')).toHaveTextContent('acme_loan.default');
  });

  it('reads in the designer locale', async () => {
    mount({ locale: 'zh-CN' });
    const notice = await loaded('list-view-not-created');

    expect(headerTitle('zh-CN')).toBe('Loan · 默认视图');
    expect(notice).toHaveTextContent('还没有列表视图「Loan · 默认视图」。');
    expect(notice).not.toHaveTextContent('acme_loan.default');
  });

  it('a draft-only object is named by its pending draft\'s label, as the nav rail names it', async () => {
    mount({
      leaf: { type: 'object', name: 'ux_site_visit', label: 'Site Visit' },
      objects: [],
      drafts: [{ type: 'object', name: 'ux_site_visit', label: 'Site Visit' }],
    });
    const notice = await loaded('list-view-not-created');

    expect(headerTitle()).toBe('Site Visit · Default view');
    expect(notice).not.toHaveTextContent('ux_site_visit.default');
    expect(screen.getByTestId('list-view-name')).toHaveTextContent('ux_site_visit.default');
  });

  it('an object with no label anywhere falls back to its machine name, still not the view\'s qualified name', async () => {
    mount({ objects: [{ ...OBJECT_DEF, label: undefined }] });
    await loaded('list-view-not-created');

    expect(headerTitle()).toBe('acme_loan · Default view');
  });

  it('an unlabelled named view is headed by the object\'s name and the key the nav entry names it by', async () => {
    server.active.set('view/acme_loan.open', {
      name: 'acme_loan.open',
      object: 'acme_loan',
      viewKind: 'list',
      config: { type: 'grid', data: { provider: 'object', object: 'acme_loan' }, columns: ['book'] },
    });
    mount({ leaf: { type: 'object', name: 'acme_loan', label: 'Open loans', viewName: 'open' } });
    await loaded('list-view-columns');

    expect(headerTitle()).toBe('Loan · open');
    expect(screen.getByTestId('list-view-name')).toHaveTextContent('acme_loan.open');
  });

  it('an unlabelled item that is not a list view: the not-list sentence names the same title', async () => {
    server.active.set('view/acme_loan.default', {
      name: 'acme_loan.default',
      object: 'acme_loan',
      viewKind: 'form',
      config: { type: 'simple', sections: [] },
    });
    mount();
    const notice = await loaded('list-view-not-list');

    expect(notice).toHaveTextContent('“Loan · Default view” is not a list view');
    expect(notice).not.toHaveTextContent('acme_loan.default');
  });

  it('CONTROL: a view with a label is headed by that label, as before', async () => {
    server.active.set('view/acme_loan.default', {
      name: 'acme_loan.default',
      object: 'acme_loan',
      viewKind: 'list',
      label: 'Active loans',
      isDefault: true,
      config: { type: 'grid', data: { provider: 'object', object: 'acme_loan' }, columns: ['book', 'status'] },
    });
    mount();
    await loaded('list-view-columns');

    await waitFor(() => expect(headerTitle()).toBe('Active loans'));
    expect(screen.queryByTestId('list-view-not-created')).not.toBeInTheDocument();
    expect(screen.getByTestId('list-view-name')).toHaveTextContent('acme_loan.default');
  });
});
