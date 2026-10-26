// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11799 — the metadata edit page asks `GET …/layers` again for no
 * item it already knows has no layer.
 *
 * An item that has never been published has no layer, and the framework
 * answers `/layers` with a 404 for it. Two of this page's re-reads followed
 * a write that cannot make a layer:
 *  - the refresh after a save, which always goes into a draft: after a create,
 *    and after editing an item whose load found no layer;
 *  - the refresh after "Discard draft" of such an item.
 * Each asked `/layers` again and logged the same 404. Now the answer the page
 * already holds stands, so what the author sees is what the 404 gave before.
 *
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does: 404 for `/layers` with no layer and
 * for `?state=draft` with no draft. Requests are counted on it. The `doc`
 * type's editor stands in for every type (the flow is the page's own).
 *
 * The page's LOAD of a never-published item still asks `/layers` and gets its
 * 404: nothing the page holds before that read says the item was never saved
 * (the draft read, sent beside it, only says a draft is pending). The framework
 * keeps that 404 for every caller by design (objectstack-ai/objectstack#22397,
 * answer (a)), so the page reads it as "never published": `MetadataClient.layered()`
 * resolves the 404 as an envelope with every layer null, and the lock banner,
 * the Layers sheet and the reset verdict show their no-published-version form,
 * with no error. Pinned in the second describe below, with two controls: a
 * published item still gets its layers, and a failed `/layers` read (a 5xx)
 * still shows the load error.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { ComponentRegistry } from '@object-ui/core';
import { DocSchema } from '@objectstack/spec/system';
import { MetadataClient } from '@object-ui/data-objectstack';

const BOOK = { name: 'docprobe_manual', label: 'Probe Manual', groups: [{ key: 'reference', label: 'Reference' }] };
const doc = (name: string, content: string) => ({ name, label: name, content, group: 'reference' });

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number }>,
  /** Protection fields a stored row's `/layers` answer carries beyond the defaults. */
  layerExtras: new Map<string, Record<string, unknown>>(),
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
    } else if (seg.length === 1) {
      body = { items: seg[0] === 'book' ? [BOOK] : [] };
    } else if (seg.length === 3 && seg[2] === 'layers' && server.failLayers.has(key)) {
      [status, body] = [500, { error: { code: 'INTERNAL_ERROR', message: 'metadata store unavailable' } }];
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(key);
      if (row) body = { code: null, overlay: row, overlayScope: 'env', effective: row, editable: true, deletable: true, resettable: false, lock: 'none', ...server.layerExtras.get(key) };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 3 && seg[2] === 'references') {
      body = [];
    } else if (seg.length === 2 && method === 'PUT') {
      const item = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (q.get('mode') === 'draft') server.drafts.set(key, item);
      else server.active.set(key, item);
      body = { type: seg[0], name: seg[1], state: q.get('mode') === 'draft' ? 'draft' : 'active' };
    } else if (seg.length === 2 && method === 'DELETE') {
      if (q.get('state') === 'draft') server.drafts.delete(key);
      else server.active.delete(key);
      body = {};
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

const client = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('./useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => client.current,
    useMetadataTypes: () => ({
      loading: false,
      entries: [
        { type: 'doc', label: 'Documentation', domain: 'system', allowEnvironmentOverlay: false, allowRuntimeCreate: true, schema: DOC_JSON_SCHEMA },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { registerBuiltinPreviews } from './previews';

const DOC_JSON_SCHEMA = z.toJSONSchema(DocSchema as unknown as z.ZodType) as Record<string, unknown>;
client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();

const STUB_NS = 'layers-unsaved-11799';
function StubMarkdown({ schema }: { schema: { content?: string } }) {
  return <div data-testid="markdown-render">{schema.content}</div>;
}
beforeAll(() => {
  ComponentRegistry.register('markdown', StubMarkdown as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.requests = [];
  server.layerExtras.clear();
  server.failLayers.clear();
  window.localStorage.setItem('metadata-admin:autosave', '0');
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) });
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
  // objectui#12496 — the page now reopens the sheet a `?tab=` in the window
  // URL names, and opening one writes it there; reset it so a sheet one test
  // opened does not open in the next test's mount.
  window.history.replaceState({}, '', '/');
});

const layersAsked = (name: string) =>
  server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/doc/${name}/layers`).length;
const puts = (name: string) => server.requests.filter((r) => r.method === 'PUT' && r.path === `/api/v1/meta/doc/${name}`).length;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderEdit(name: string) {
  render(
    <MemoryRouter initialEntries={[`/metadata/doc/${name}`]}>
      <Routes>
        <Route path="/metadata/doc/:name" element={<MetadataResourceEditPage type="doc" name={name} />} />
      </Routes>
    </MemoryRouter>,
  );
}

const source = () => screen.findByRole('textbox', { name: 'Markdown source' }, { timeout: 8000 });
const saveButton = () => screen.getByRole('button', { name: /Save \(⌘S\)/ });
const discardButton = () => screen.getAllByRole('button', { name: 'Discard draft' })[0]!;

/** Accept the page's in-app confirm (objectui#13333) once it opens. */
async function acceptInAppConfirm() {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByTestId('resource-edit-confirm-action'));
}

describe('MetadataResourceEditPage — no /layers re-read for an item known to have no layer (objectui#11799)', () => {
  it('SAVE of an item whose load found no layer: the refresh asks no /layers, and the editor shows the saved draft as before', async () => {
    server.drafts.set('doc/fresh_guide', doc('fresh_guide', '# Draft'));
    renderEdit('fresh_guide');
    expect(await source()).toHaveValue('# Draft');
    await settle();
    // The load's read stays (see the header): one 404.
    expect(layersAsked('fresh_guide')).toBe(1);

    fireEvent.change(await source(), { target: { value: '# Draft, edited' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(puts('fresh_guide')).toBe(1));
    await settle();

    expect(layersAsked('fresh_guide')).toBe(1);
    expect(server.drafts.get('doc/fresh_guide')).toMatchObject({ content: '# Draft, edited' });
    expect(await source()).toHaveValue('# Draft, edited');
    expect(screen.getAllByRole('button', { name: 'Discard draft' }).length).toBeGreaterThan(0);
  });

  it('CONTROL: SAVE of a published item re-reads its layers exactly once, as before', async () => {
    server.active.set('doc/live_guide', doc('live_guide', '# Live'));
    renderEdit('live_guide');
    expect(await source()).toHaveValue('# Live');
    await settle();
    expect(layersAsked('live_guide')).toBe(1);

    fireEvent.change(await source(), { target: { value: '# Live, edited' } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(puts('live_guide')).toBe(1));
    await settle();

    expect(layersAsked('live_guide')).toBe(2);
    expect(await source()).toHaveValue('# Live, edited');
  });

  it('CREATE: the refresh after the save asks no /layers for the item just created', async () => {
    render(
      <MemoryRouter initialEntries={['/metadata/doc/new']}>
        <Routes>
          <Route
            path="/metadata/doc/new"
            element={
              <>
                <MetadataResourceEditPage type="doc" name="" createMode />
                <Where />
              </>
            }
          />
          <Route path="/metadata/doc/:name" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const label = await waitFor(() => {
      const el = document.getElementById('mdf-label') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el!;
    }, { timeout: 8000 });
    fireEvent.change(label, { target: { value: 'New Guide' } });
    await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('new_guide'));
    fireEvent.change(await source(), { target: { value: '# New' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/new_guide'));
    await settle();
    expect(puts('new_guide')).toBe(1);
    expect(layersAsked('new_guide')).toBe(0);
    expect(server.drafts.get('doc/new_guide')).toMatchObject({ name: 'new_guide', content: '# New' });
  });

  it('DISCARD of an item whose load found no layer: no /layers re-read, and the editor is left on nothing, as before', async () => {
    server.drafts.set('doc/fresh_guide', doc('fresh_guide', '# Draft'));
    renderEdit('fresh_guide');
    expect(await source()).toHaveValue('# Draft');
    await settle();
    expect(layersAsked('fresh_guide')).toBe(1);

    fireEvent.click(discardButton());

    await acceptInAppConfirm();
    await waitFor(() => expect(server.drafts.has('doc/fresh_guide')).toBe(false));
    await settle();

    expect(layersAsked('fresh_guide')).toBe(1);
    expect(screen.queryAllByRole('button', { name: 'Discard draft' })).toHaveLength(0);
    expect(await source()).toHaveValue('');
  });

  it('CONTROL: DISCARD over a published item re-reads its layers exactly once and shows the published body, as before', async () => {
    server.active.set('doc/live_guide', doc('live_guide', '# Live'));
    server.drafts.set('doc/live_guide', doc('live_guide', '# Live, drafted'));
    renderEdit('live_guide');
    expect(await source()).toHaveValue('# Live, drafted');
    await settle();
    expect(layersAsked('live_guide')).toBe(1);

    fireEvent.click(discardButton());

    await acceptInAppConfirm();
    await waitFor(() => expect(server.drafts.has('doc/live_guide')).toBe(false));
    await settle();

    expect(layersAsked('live_guide')).toBe(2);
    expect(await source()).toHaveValue('# Live');
  });
});

/** The item's `/layers` reads, in order, as the server answered them. */
const layersStatuses = (name: string) =>
  server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/doc/${name}/layers`).map((r) => r.status);

/** Opens the Layers sheet and returns the Overlay tab, whose badge names the overlay layer. */
async function overlayTab() {
  fireEvent.click(screen.getByTitle('Layers'));
  return screen.findByRole('tab', { name: /Overlay/ });
}

describe('MetadataResourceEditPage — the LOAD reads a /layers 404 as "never published", with no error (objectui#11799)', () => {
  it('a draft-only item opens on its draft: one /layers, its 404, and no error, lock banner or reset/delete control', async () => {
    server.drafts.set('doc/fresh_guide', doc('fresh_guide', '# Draft'));
    renderEdit('fresh_guide');
    expect(await source()).toHaveValue('# Draft');
    await settle();

    expect(layersStatuses('fresh_guide')).toEqual([404]);
    expect(screen.queryByText(/Failed to load/)).toBeNull();
    // The draft is pending, and nothing says it is published, locked or resettable.
    expect(screen.getByText(/Pending changes/)).toBeInTheDocument();
    expect(screen.queryByTestId('lock-banner-title')).toBeNull();
    expect(screen.queryByTestId('reset-or-delete-button')).toBeNull();
    // The Layers sheet: no overlay layer, and no code layer to diff against.
    expect(await overlayTab()).toHaveTextContent('none');
    expect(screen.getByText(/No code-level artifact to compare against/)).toBeInTheDocument();
  });

  it('CONTROL: a published item gets its layers, and the page uses them: the delete control and the overlay layer', async () => {
    server.active.set('doc/live_guide', doc('live_guide', '# Live'));
    renderEdit('live_guide');
    expect(await source()).toHaveValue('# Live');
    await settle();

    expect(layersStatuses('live_guide')).toEqual([200]);
    expect(screen.queryByText(/Failed to load/)).toBeNull();
    expect(screen.getByTestId('reset-or-delete-button')).toBeInTheDocument();
    expect(await overlayTab()).toHaveTextContent('env');
  });

  it('CONTROL: a published item locked by its layers shows the lock banner from that answer', async () => {
    server.active.set('doc/live_guide', doc('live_guide', '# Live'));
    server.layerExtras.set('doc/live_guide', { lock: 'no-delete', deletable: false, lockReason: 'Shipped with the manual' });
    renderEdit('live_guide');
    expect(await source()).toHaveValue('# Live');
    await settle();

    expect(layersStatuses('live_guide')).toEqual([200]);
    expect(screen.getByTestId('lock-banner-title')).toHaveTextContent('This item is locked and cannot be deleted.');
    expect(screen.getByText('Shipped with the manual')).toBeInTheDocument();
    expect(screen.queryByTestId('reset-or-delete-button')).toBeNull();
  });

  it('CONTROL: a failed /layers read (a 5xx) still shows the load error, even with a draft in hand', async () => {
    server.drafts.set('doc/fresh_guide', doc('fresh_guide', '# Draft'));
    server.failLayers.add('doc/fresh_guide');
    renderEdit('fresh_guide');

    expect(await screen.findByText('Failed to load doc/fresh_guide: metadata store unavailable', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(layersStatuses('fresh_guide')).toEqual([500]);
    expect(screen.queryByText(/Pending changes/)).toBeNull();
  });
});
