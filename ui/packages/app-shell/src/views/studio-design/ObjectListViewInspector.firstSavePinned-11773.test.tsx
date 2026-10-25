// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — an `object` leaf's list-view buffer pins its first draft
 * save to the draft read its load made.
 *
 * The load reads the view's draft at the package the save writes
 * (`?state=draft&package=P`): a read naming no package serves a package-bound
 * draft's body with `version: null`, which says nothing about a save to `P`.
 * What that read served pins the first save: `If-Match` with a pending draft's
 * version, or `If-None-Match: *` when none was pending.
 *
 * The REAL hook (`useObjectListViewDraft`) over a REAL `MetadataClient`, whose
 * transport is an in-memory server answering as the published
 * `@objectstack/*` 18.0.0-next.0 door was measured to (readings on the pull
 * request).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MetadataCtx, type MetadataContextValue } from '@object-ui/react';
import { MetadataClient } from '@object-ui/data-objectstack';
import { useObjectListViewDraft, type ObjectListViewDraft } from './ObjectListViewInspector';
import type { Surface } from './navSurface';

const PKG = 'com.acme.app';
const VIEW = 'showcase_task.default';

const OBJECT_DEF = {
  name: 'showcase_task',
  label: 'Task',
  fields: {
    title: { name: 'title', label: 'Title', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
  },
};

const viewItem = (columns: string[]) => ({
  name: VIEW,
  object: 'showcase_task',
  viewKind: 'list',
  isDefault: true,
  config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns },
});

const server = {
  active: new Map<string, Record<string, unknown>>(),
  /** Draft rows by `type/name@package`. */
  drafts: new Map<string, { body: Record<string, unknown>; version: string }>(),
  draftReads: [] as string[],
  puts: [] as Array<{ ifMatch: string | null; ifNoneMatch: string | null; status: number }>,
  seq: 0,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const q = url.searchParams;
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  const item = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') {
    return json(200, { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1]!.split('@')[0] })) });
  }
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(item);
    return row ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row }) : json(404, { error: { code: 'NOT_FOUND' } });
  }
  const address = `${item}@${q.get('package') ?? ''}`;
  if (method === 'PUT') {
    const headers = new Headers(init?.headers);
    const ifMatch = headers.get('If-Match');
    const ifNoneMatch = headers.get('If-None-Match');
    const head = server.drafts.get(address)?.version ?? null;
    const refused = (ifMatch !== null && ifMatch !== head) || (ifNoneMatch !== null && head !== null);
    server.puts.push({ ifMatch, ifNoneMatch, status: refused ? 409 : 200 });
    if (refused) return json(409, { error: `${item} has been modified since you loaded it.`, code: 'METADATA_CONFLICT', currentVersion: head });
    server.seq += 1;
    const version = `hmac-sha256:v${server.seq}`;
    server.drafts.set(address, { body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, version });
    return json(200, { success: true, version, seq: server.seq, state: 'draft' });
  }
  if (q.get('state') === 'draft') {
    server.draftReads.push(url.search);
    const own = server.drafts.get(address);
    // Content falls back to any package's draft; the version is the address's.
    const served = own ?? [...server.drafts.entries()].find(([k]) => k.startsWith(`${item}@`))?.[1];
    if (!served) return json(404, { error: 'No pending draft.', code: 'NO_DRAFT' });
    return json(200, { type: seg[0], name: seg[1], item: { ...served.body, _draft: true }, version: own ? own.version : null });
  }
  const row = server.active.get(item);
  return row ? json(200, { type: seg[0], name: seg[1], item: row }) : json(404, { error: { code: 'NOT_FOUND' } });
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

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

/** The hook's latest answer, handed out by the probe after each commit. */
const hook = React.createRef<ObjectListViewDraft>() as React.MutableRefObject<ObjectListViewDraft | null>;

function Probe({ hookRef }: { hookRef: React.MutableRefObject<ObjectListViewDraft | null> }) {
  const draft = useObjectListViewDraft({ client, packageId: PKG, leaf: LEAF, publishNonce: 0 });
  React.useLayoutEffect(() => {
    hookRef.current = draft;
  });
  return draft.conflictDialog;
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** Open the leaf, edit the view's columns, and send the save the autosave would. */
async function openEditAndSave(columns: string[]) {
  render(
    <MetadataCtx.Provider value={METADATA}>
      <Probe hookRef={hook} />
    </MetadataCtx.Provider>,
  );
  await flush();
  await act(async () => hook.current!.edit(viewItem(columns)));
  await act(async () => hook.current!.save({ unmoved: () => true }));
  await flush();
}

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.draftReads = [];
  server.puts = [];
  server.seq = 0;
});
afterEach(cleanup);

describe('useObjectListViewDraft — the first save after a load is pinned (objectui#11773)', () => {
  it('a published view with no pending draft: the first save sends If-None-Match: *', async () => {
    server.active.set(`view/${VIEW}`, viewItem(['title']));
    await openEditAndSave(['title', 'status']);
    expect(server.puts).toEqual([{ ifMatch: null, ifNoneMatch: '*', status: 200 }]);
    // The drafts ledger answered "none", so no `?state=draft` read was sent.
    expect(server.draftReads).toEqual([]);
  });

  it('a pending draft in the package: the first save sends If-Match with the version the read, at the package, served', async () => {
    server.drafts.set(`view/${VIEW}@${PKG}`, { body: viewItem(['title']), version: 'hmac-sha256:pending' });
    await openEditAndSave(['title', 'status']);
    expect(server.puts).toEqual([{ ifMatch: 'hmac-sha256:pending', ifNoneMatch: null, status: 200 }]);
    expect(server.draftReads.length).toBeGreaterThan(0);
    expect(server.draftReads.every((search) => new URLSearchParams(search).get('package') === PKG)).toBe(true);
  });

  it('a draft saved in the package while the panel was open: the first save is refused, not written over', async () => {
    server.active.set(`view/${VIEW}`, viewItem(['title']));
    render(
      <MetadataCtx.Provider value={METADATA}>
        <Probe hookRef={hook} />
      </MetadataCtx.Provider>,
    );
    await flush();
    // Another editor's first save lands after this panel's load.
    server.drafts.set(`view/${VIEW}@${PKG}`, { body: viewItem(['status']), version: 'hmac-sha256:theirs' });
    await act(async () => hook.current!.edit(viewItem(['title', 'status'])));
    let saved!: Promise<void>;
    act(() => {
      saved = hook.current!.save({ unmoved: () => true });
    });
    // The conflict dialog asks; the author keeps editing, and nothing is sent.
    fireEvent.click(await screen.findByTestId('draft-conflict-cancel'));
    await act(async () => saved);
    expect(server.puts).toEqual([{ ifMatch: null, ifNoneMatch: '*', status: 409 }]);
    expect(server.drafts.get(`view/${VIEW}@${PKG}`)?.body).toEqual(viewItem(['status']));
    expect(hook.current!.failure?.during).toBe('save');
  });
});
