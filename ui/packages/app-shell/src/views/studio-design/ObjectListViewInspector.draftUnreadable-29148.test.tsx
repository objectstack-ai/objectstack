// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29148 — the list-view panel of an `object` leaf takes a pending
 * view draft the server refuses to read (`403 PERMISSION_DENIED`: a list view
 * carries the same audience gate, `requiredPermissions`, as a dashboard) for
 * what it is, never for "no draft". No buffer is installed over it: the
 * published view is not offered to edit, the panel's strip says why with the
 * server's sentence behind Details, and the save the pillar's autosave would
 * send has nothing to send.
 *
 * The REAL hook (`useObjectListViewDraft`) and the REAL panel over a REAL
 * `MetadataClient`, whose transport is an in-memory server: the drafts ledger
 * lists the gated view, and its `?state=draft` read answers 403 as the read
 * gate does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';

const PKG = 'com.acme.app';
const VIEW = 'showcase_task.default';
const GATE_REFUSAL = "You do not have permission to open the 'showcase_task.default' view.";

const OBJECT_DEF = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

const viewItem = (columns: string[], extra: Record<string, unknown> = {}) => ({
  name: VIEW,
  object: 'showcase_task',
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns },
  ...extra,
});

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Draft rows whose read is refused as the audience gate refuses it. */
  gated: new Set<string>(),
  layerReads: [] as string[],
  puts: [] as Array<{ item: string; ifMatch: string | null; ifNoneMatch: string | null }>,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (seg[0] === '_drafts') {
    return json(200, { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1] })) });
  }
  const item = `${seg[0]}/${seg[1]}`;
  if (method === 'PUT') {
    const headers = new Headers(init?.headers);
    server.puts.push({ item, ifMatch: headers.get('If-Match'), ifNoneMatch: headers.get('If-None-Match') });
    server.drafts.set(item, JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
    return json(200, { success: true, version: 'v2', state: 'draft' });
  }
  if (seg[0] === 'object' && seg.length === 2) return json(200, { type: 'object', name: seg[1], item: OBJECT_DEF });
  if (seg.length === 3 && seg[2] === 'layers') {
    server.layerReads.push(item);
    const row = server.active.get(item);
    return row ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row }) : json(404, { error: { code: 'NOT_FOUND' } });
  }
  if (url.searchParams.get('state') === 'draft') {
    if (server.gated.has(item)) return json(403, { success: false, error: { code: 'PERMISSION_DENIED', message: GATE_REFUSAL } });
    const row = server.drafts.get(item);
    return row ? json(200, { type: seg[0], name: seg[1], item: row, version: 'v1' }) : json(404, { error: { code: 'NO_DRAFT' } });
  }
  const row = server.active.get(item);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => client };
});

import { ObjectListViewInspector, useObjectListViewDraft, type ObjectListViewDraft } from './ObjectListViewInspector';
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

const LEAF: Surface = { type: 'object', name: 'showcase_task', label: 'Tasks' };

/** The hook's latest answer, handed out after each commit. */
const hook = React.createRef<ObjectListViewDraft>() as React.MutableRefObject<ObjectListViewDraft | null>;

function Host() {
  const listView = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  React.useLayoutEffect(() => {
    hook.current = listView;
  });
  return (
    <>
      <ObjectListViewInspector listView={listView} readOnly={false} locale="en-US" />
      {listView.conflictDialog}
    </>
  );
}

function mount() {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Host />
    </MetadataCtx.Provider>,
  );
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.gated.clear();
  server.layerReads = [];
  server.puts = [];
  hook.current = null;
  server.active.set(`view/${VIEW}`, viewItem(['title']));
});
afterEach(cleanup);

describe('useObjectListViewDraft — a view draft the server refuses to read is not "no draft" (objectstack#29148)', () => {
  it('installs no buffer over the refused draft: the strip says why, nothing is editable, and the save sends nothing', async () => {
    const gatedDraft = viewItem(['title', 'status'], { requiredPermissions: ['showcase.export_data'] });
    server.drafts.set(`view/${VIEW}`, gatedDraft);
    server.gated.add(`view/${VIEW}`);

    mount();

    // Red on base: the refusal was read as "no draft", and the published view
    // was installed as the buffer and offered to edit.
    const strip = await screen.findByTestId('list-view-refusal', undefined, { timeout: 8000 });
    expect(strip).toHaveTextContent(t('engine.studio.refusal.draftUnreadable', 'en-US'));
    // The server's own sentence stays reachable, behind Details.
    expect(strip.querySelector('details')).toHaveTextContent(GATE_REFUSAL);
    expect(screen.queryByTestId('list-view-columns')).toBeNull();
    // The published layer is never read to stand in for the draft.
    expect(server.layerReads).toEqual([]);
    // No buffer: the autosave's target was never loaded, and its save has nothing to send.
    expect(hook.current!.row).toBeNull();
    expect(hook.current!.loadedFor).not.toBe(hook.current!.targetKey);
    await act(async () => hook.current!.save({ unmoved: () => true }));
    await flush();
    expect(server.puts).toEqual([]);
    expect(server.drafts.get(`view/${VIEW}`)).toStrictEqual(gatedDraft);
  });

  it('CONTROL: with no pending draft the published view opens, and a save is pinned to "no draft row"', async () => {
    mount();

    expect(await screen.findByTestId('list-view-columns', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.queryByText(t('engine.studio.refusal.draftUnreadable', 'en-US'))).toBeNull();
    expect(hook.current!.loadedFor).toBe(hook.current!.targetKey);

    await act(async () => hook.current!.edit(viewItem(['title', 'status'])));
    await act(async () => hook.current!.save({ unmoved: () => true }));
    await flush();
    expect(server.puts).toEqual([{ item: `view/${VIEW}`, ifMatch: null, ifNoneMatch: '*' }]);
  });
});
