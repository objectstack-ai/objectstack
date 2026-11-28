// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36902 (epic objectstack#36890 decisions 1, 12 and 14) — the
 * generic item page's Save takes effect at once, as the Studio designers'
 * Save does:
 *
 *  1. Save writes the item's draft and then publishes that one item
 *     (`POST /meta/:type/:name/publish`), pinned to the published version the
 *     page loaded; the draft-version pin and the conflict dialog stay; there
 *     is no auto-save and no second Publish step.
 *  2. A create publishes after its first-write save.
 *  3. An AI-written draft (`draftChanges[].by` copilot or mcp) is the version
 *     on screen, with the designers' notice; Save makes it live; its discard
 *     asks first when the page holds unsaved edits.
 *  4. A person's pending draft is marked as unpublished changes, with its own
 *     Publish and Discard.
 *  5. Every departure the shell sees asks while edits are unsaved: ×, ‹ ›, an
 *     in-app link, a reload or close. Browser Back is not guarded.
 *  6. A refused publish says why, and nothing goes live.
 *
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework's `/meta` doors do (draft and published
 * versions, `409 METADATA_CONFLICT` with `currentVersion`). Only `sonner`,
 * `window.confirm` and the editor's locale hook are replaced.
 */

import '@testing-library/jest-dom/vitest';
// The source under test reaches a dynamic import of this module: its first load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { ComponentRegistry } from '@object-ui/core';
import { DocSchema } from '@objectstack/spec/system';
import { MetadataClient } from '@object-ui/data-objectstack';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

interface Row {
  body: Record<string, unknown>;
  version: string;
  draftChanges?: Array<{ path: string[]; by: string; actor: string; at: string }>;
}

/** What the server holds, and every write it was sent. */
const server = {
  active: new Map<string, Row>(),
  drafts: new Map<string, Row>(),
  writes: [] as Array<{ method: string; key: string; search: string; ifMatch: string | null; ifNoneMatch: string | null; status: number }>,
  /** The publish door's next refusal, sent once. */
  refusePublish: null as null | { status: number; body: unknown },
  seq: 0,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const conflict = (key: string, head: string | null) =>
  json(409, { error: `${key} has been modified since you loaded it (current is ${head}).`, code: 'METADATA_CONFLICT', currentVersion: head });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  if (seg[0] === '_drafts') {
    return json(200, { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1] })) });
  }
  if (seg.length === 1) return json(200, { items: [{ name: 'alpha' }, { name: 'guide' }, { name: 'zeta' }] });
  const key = `${seg[0]}/${seg[1]}`;
  const headers = new Headers(init?.headers);
  const ifMatch = headers.get('If-Match');
  const ifNoneMatch = headers.get('If-None-Match');
  const log = (status: number) =>
    server.writes.push({ method, key, search: url.search, ifMatch, ifNoneMatch, status });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, {
          code: null,
          overlay: row.body,
          overlayScope: 'env',
          effective: row.body,
          // The stored draft layer, as the framework serves it to an author.
          draft: server.drafts.get(key)?.body ?? null,
          overlayVersion: row.version,
          editable: true,
          deletable: true,
          resettable: false,
          lock: 'none',
        })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 3 && seg[2] === 'references') return json(200, []);
  if (seg.length === 3 && seg[2] === 'publish' && method === 'POST') {
    if (server.refusePublish) {
      const { status, body } = server.refusePublish;
      server.refusePublish = null;
      log(status);
      return json(status, body);
    }
    const head = server.active.get(key)?.version ?? null;
    if ((ifMatch !== null && ifMatch !== head) || (ifNoneMatch !== null && head !== null)) {
      log(409);
      return conflict(key, head);
    }
    const draft = server.drafts.get(key);
    if (!draft) {
      log(404);
      return json(404, { error: { code: 'NO_DRAFT', message: 'nothing pending' } });
    }
    server.seq += 1;
    const version = `pub:v${server.seq}`;
    server.active.set(key, { body: draft.body, version });
    server.drafts.delete(key);
    log(200);
    return json(200, { success: true, version, seq: server.seq, message: `Published ${key}` });
  }
  if (method === 'PUT') {
    const head = server.drafts.get(key)?.version ?? null;
    if ((ifMatch !== null && ifMatch !== head) || (ifNoneMatch !== null && head !== null)) {
      log(409);
      return conflict(key, head);
    }
    server.seq += 1;
    const version = `draft:v${server.seq}`;
    server.drafts.set(key, { body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>, version });
    log(200);
    return json(200, { success: true, version, seq: server.seq, state: 'draft', message: `Saved ${key}` });
  }
  if (method === 'DELETE') {
    if (url.searchParams.get('state') === 'draft') server.drafts.delete(key);
    else server.active.delete(key);
    log(200);
    return json(200, { success: true });
  }
  if (url.searchParams.get('state') === 'draft') {
    const row = server.drafts.get(key);
    if (!row) return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
    return json(200, {
      type: seg[0],
      name: seg[1],
      item: row.body,
      version: row.version,
      ...(row.draftChanges ? { draftChanges: row.draftChanges } : {}),
    });
  }
  const row = server.active.get(key);
  return row ? json(200, { type: seg[0], name: seg[1], item: row.body }) : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
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
import { t } from './i18n';

const DOC_JSON_SCHEMA = z.toJSONSchema(DocSchema as unknown as z.ZodType) as Record<string, unknown>;
client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();

const STUB_NS = 'save-at-once-36902';
function StubMarkdown({ schema }: { schema: { content?: string } }) {
  return <div data-testid="markdown-render">{schema.content}</div>;
}
beforeAll(() => {
  ComponentRegistry.register('markdown', StubMarkdown as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});

const LEAVE_QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en-US');
const confirmSpy = vi.fn((_message?: string) => false);

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.writes = [];
  server.refusePublish = null;
  server.seq = 0;
  for (const fn of Object.values(toasts)) fn.mockClear();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(false);
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
  window.history.replaceState(null, '', '/metadata/doc/guide');
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const source = () => screen.findByRole('textbox', { name: /Markdown source|Markdown/ }, { timeout: 8000 });
const saveButton = () => screen.getByTestId('resource-save');
const publishWrites = () => server.writes.filter((w) => w.key === 'doc/guide' && w.method === 'POST');

/** Opens `doc/guide`, published at `pub:v0`, beside a link to another page. */
async function openGuide(opts: { draft?: Row } = {}) {
  server.active.set('doc/guide', { body: { name: 'guide', label: 'Guide', content: '# Live', group: 'reference' }, version: 'pub:v0' });
  if (opts.draft) server.drafts.set('doc/guide', opts.draft);
  render(
    <MemoryRouter initialEntries={['/metadata/doc/guide']}>
      <Link to="/metadata/other">Other page</Link>
      <Routes>
        <Route
          path="/metadata/doc/guide"
          element={
            <>
              <MetadataResourceEditPage type="doc" name="guide" />
              <Where />
            </>
          }
        />
        <Route path="/metadata/doc/:name" element={<Where />} />
        <Route path="/metadata/doc" element={<Where />} />
        <Route path="/metadata/other" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  await source();
  await settle();
}

async function editSource(value = '# Live, edited') {
  fireEvent.change(await source(), { target: { value } });
  await settle();
}

describe('Save takes effect at once (objectstack#36902 item 1)', () => {
  it('Save writes the draft, then publishes that one item pinned to the published version it loaded', async () => {
    await openGuide();
    await editSource();
    fireEvent.click(saveButton());
    await waitFor(() => expect(publishWrites()).toHaveLength(1), { timeout: 8000 });

    const [put, publish] = server.writes;
    expect(put).toMatchObject({ method: 'PUT', key: 'doc/guide', search: '?mode=draft', ifNoneMatch: '*', status: 200 });
    expect(publish).toMatchObject({ method: 'POST', key: 'doc/guide', ifMatch: 'pub:v0', status: 200 });
    expect(server.active.get('doc/guide')?.body).toMatchObject({ content: '# Live, edited' });
    expect(server.drafts.has('doc/guide')).toBe(false);
    // No second step: no draft is left, so nothing offers a Publish.
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveAttribute('data-state', 'saved'));
    expect(screen.queryByTestId('resource-unpublished-changes')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Publish$/ })).toBeNull();
  });

  it('a second Save chains its pins: the draft asserts none again, the publish names the version the first one left', async () => {
    await openGuide();
    await editSource('# one');
    fireEvent.click(saveButton());
    await waitFor(() => expect(publishWrites()).toHaveLength(1), { timeout: 8000 });
    await settle();
    await editSource('# two');
    fireEvent.click(saveButton());
    await waitFor(() => expect(publishWrites()).toHaveLength(2), { timeout: 8000 });
    const second = server.writes.slice(2);
    expect(second[0]).toMatchObject({ method: 'PUT', ifNoneMatch: '*', status: 200 });
    expect(second[1]).toMatchObject({ method: 'POST', ifMatch: 'pub:v2', status: 200 });
  });

  it('there is no auto-save: an edit left alone sends nothing, and the switch is gone', async () => {
    await openGuide();
    await editSource();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2000));
    });
    expect(server.writes).toEqual([]);
    expect(screen.getByTestId('save-status')).toHaveAttribute('data-state', 'unsaved');
    expect(screen.queryByTitle(/Auto-save/)).toBeNull();
  });

  it('the published row moved since the load: the conflict dialog asks, and "keep editing" leaves nothing live or pending', async () => {
    await openGuide();
    await editSource();
    // Another editor publishes in between.
    server.active.set('doc/guide', { body: { name: 'guide', label: 'Guide', content: '# Theirs' }, version: 'pub:theirs' });
    fireEvent.click(saveButton());
    expect(await screen.findByTestId('draft-conflict-dialog', {}, { timeout: 8000 })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('draft-conflict-cancel'));
    await waitFor(() => expect(screen.getByTestId('studio-refusal-message')).toBeInTheDocument());
    expect(server.active.get('doc/guide')?.body).toMatchObject({ content: '# Theirs' });
    // The draft the save wrote was taken back; the edit stays on the page, unsaved.
    expect(server.drafts.has('doc/guide')).toBe(false);
    expect(await source()).toHaveValue('# Live, edited');
  });
});

describe('a create publishes after its save (objectstack#36902 item 2)', () => {
  function renderCreate() {
    // objectstack#38149 — the create's address names its package (else it asks first).
    window.history.replaceState(null, '', '/?package=app.test');
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
  }
  async function fillAndSave() {
    const label = await waitFor(() => {
      const el = document.getElementById('mdf-label') as HTMLInputElement | null;
      expect(el).not.toBeNull();
      return el!;
    }, { timeout: 8000 });
    fireEvent.change(label, { target: { value: 'New Guide' } });
    await waitFor(() => expect((document.getElementById('mdf-name') as HTMLInputElement).value).toBe('new_guide'));
    fireEvent.change(await source(), { target: { value: '# New' } });
    fireEvent.click(saveButton());
  }

  it('the create lands live: first-write draft, then its publish, then the item opens', async () => {
    renderCreate();
    await fillAndSave();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/new_guide'), { timeout: 8000 });
    expect(server.writes.map((w) => [w.method, w.key, w.ifNoneMatch, w.status])).toEqual([
      ['PUT', 'doc/new_guide', '*', 200],
      ['POST', 'doc/new_guide', null, 200],
    ]);
    expect(server.active.get('doc/new_guide')?.body).toMatchObject({ name: 'new_guide', content: '# New' });
    expect(server.drafts.has('doc/new_guide')).toBe(false);
  });

  it('a refused publish of the create takes its draft back, says why, and stays on the form', async () => {
    server.refusePublish = { status: 422, body: { error: 'Publish refused: the referenced object exists only in a draft.', code: 'INVALID_METADATA' } };
    renderCreate();
    await fillAndSave();
    expect(await screen.findByTestId('studio-refusal-message', {}, { timeout: 8000 })).toHaveTextContent(/exists only in a draft/);
    expect(server.drafts.has('doc/new_guide')).toBe(false);
    expect(server.active.has('doc/new_guide')).toBe(false);
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/new');
  });
});

describe('the AI assistant\'s draft (objectstack#36902 item 3, decision 1)', () => {
  const aiDraft = (): Row => ({
    body: { name: 'guide', label: 'Guide', content: '# From the AI', group: 'reference' },
    version: 'draft:ai',
    draftChanges: [{ path: ['content'], by: 'copilot', actor: 'u1', at: '2026-11-24T10:00:00.000Z' }],
  });

  it('the page shows the AI version with the notice, and a person\'s Save makes it live, the draft pin carried', async () => {
    await openGuide({ draft: aiDraft() });
    expect(await source()).toHaveValue('# From the AI');
    expect(screen.getByTestId('studio-ai-draft-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('resource-unpublished-changes')).toBeNull();
    await editSource('# From the AI, reviewed');
    fireEvent.click(saveButton());
    await waitFor(() => expect(publishWrites()).toHaveLength(1), { timeout: 8000 });
    expect(server.writes[0]).toMatchObject({ method: 'PUT', ifMatch: 'draft:ai', status: 200 });
    expect(server.active.get('doc/guide')?.body).toMatchObject({ content: '# From the AI, reviewed' });
    await waitFor(() => expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull());
  });

  it('a refused Save keeps the AI draft (it now carries the edit): nothing takes it back', async () => {
    server.refusePublish = { status: 422, body: { error: 'Publish refused.', code: 'INVALID_METADATA' } };
    await openGuide({ draft: aiDraft() });
    await editSource('# edited');
    fireEvent.click(saveButton());
    await screen.findByTestId('studio-refusal-message', {}, { timeout: 8000 });
    expect(server.writes.some((w) => w.method === 'DELETE')).toBe(false);
    expect(server.drafts.get('doc/guide')?.body).toMatchObject({ content: '# edited' });
  });

  it('discard asks first, in the page\'s own dialog, when the page holds unsaved edits; Cancel keeps both the draft and the edits', async () => {
    await openGuide({ draft: aiDraft() });
    await editSource('# unsaved');
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    expect(await screen.findByTestId('resource-edit-confirm-body')).toHaveTextContent(
      t('engine.studio.aiDraft.discardConfirmUnsaved', 'en-US'),
    );
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('resource-edit-confirm-cancel'));
    await settle();
    expect(server.writes).toEqual([]);
    expect(await source()).toHaveValue('# unsaved');
    expect(server.drafts.has('doc/guide')).toBe(true);
  });

  it('discard with unsaved edits, confirmed: the draft and the edits go, and the live version is back', async () => {
    await openGuide({ draft: aiDraft() });
    await editSource('# unsaved');
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    fireEvent.click(await screen.findByTestId('resource-edit-confirm-action'));
    await waitFor(() => expect(server.drafts.has('doc/guide')).toBe(false), { timeout: 8000 });
    await waitFor(async () => expect(await source()).toHaveValue('# Live'), { timeout: 8000 });
  });

  it('discard drops that one item\'s draft at its address and goes back to the live version', async () => {
    await openGuide({ draft: aiDraft() });
    fireEvent.click(screen.getByTestId('studio-ai-draft-discard'));
    // Nothing unsaved, so nothing to ask.
    expect(screen.queryByTestId('resource-edit-confirm-dialog')).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(server.drafts.has('doc/guide')).toBe(false), { timeout: 8000 });
    expect(server.writes).toEqual([expect.objectContaining({ method: 'DELETE', search: '?state=draft' })]);
    await waitFor(async () => expect(await source()).toHaveValue('# Live'), { timeout: 8000 });
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
  });
});

describe('a person\'s pending draft (objectstack#36902 item 4, decision 14)', () => {
  const humanDraft = (): Row => ({
    body: { name: 'guide', label: 'Guide', content: '# Mine, unpublished', group: 'reference' },
    version: 'draft:mine',
    draftChanges: [{ path: ['content'], by: 'studio', actor: 'u1', at: '2026-11-20T10:00:00.000Z' }],
  });

  it('is marked as unpublished changes, never as the AI\'s, and its own Publish makes it live, pinned', async () => {
    await openGuide({ draft: humanDraft() });
    expect(await screen.findByTestId('resource-unpublished-changes')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
    fireEvent.click(screen.getByTestId('resource-draft-publish'));
    await waitFor(() => expect(publishWrites()).toHaveLength(1), { timeout: 8000 });
    expect(publishWrites()[0]).toMatchObject({ ifMatch: 'pub:v0', status: 200 });
    expect(server.active.get('doc/guide')?.body).toMatchObject({ content: '# Mine, unpublished' });
    await waitFor(() => expect(screen.queryByTestId('resource-unpublished-changes')).toBeNull());
  });

  it('a draft whose read recorded no provenance is a person\'s too', async () => {
    const { draftChanges: _omitted, ...bare } = humanDraft();
    await openGuide({ draft: bare });
    expect(await screen.findByTestId('resource-unpublished-changes')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-ai-draft-notice')).toBeNull();
  });

  it('its own Discard asks in-app and drops that one draft', async () => {
    await openGuide({ draft: humanDraft() });
    fireEvent.click(await screen.findByTestId('resource-draft-discard'));
    fireEvent.click(await screen.findByTestId('resource-edit-confirm-action'));
    await waitFor(() => expect(server.drafts.has('doc/guide')).toBe(false), { timeout: 8000 });
    expect(server.active.get('doc/guide')?.body).toMatchObject({ content: '# Live' });
  });
});

describe('a refused publish says why (objectstack#36902 item 6)', () => {
  it('the refusal reason is shown, nothing goes live, the saved draft is taken back and the edits stay', async () => {
    server.refusePublish = {
      status: 422,
      body: { error: 'doc/guide references object "invoice", which exists only in a draft.', code: 'INVALID_METADATA' },
    };
    await openGuide();
    await editSource();
    fireEvent.click(saveButton());
    expect(await screen.findByTestId('studio-refusal-message', {}, { timeout: 8000 })).toHaveTextContent(/exists only in a draft/);
    expect(server.active.get('doc/guide')?.body).toMatchObject({ content: '# Live' });
    expect(server.drafts.has('doc/guide')).toBe(false);
    expect(server.writes.map((w) => w.method)).toEqual(['PUT', 'POST', 'DELETE']);
    expect(await source()).toHaveValue('# Live, edited');
    expect(screen.getByTestId('save-status')).toHaveAttribute('data-state', 'unsaved');
  });
});

describe('the leave guard (objectstack#36902 item 5, decision 12)', () => {
  it('× asks while edits are unsaved, and Cancel stays', async () => {
    await openGuide();
    await editSource();
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/guide');
  });

  it('‹ › ask while edits are unsaved; OK opens the neighbour', async () => {
    await openGuide();
    await waitFor(() => expect(screen.getByTestId('studio-detail-next')).toBeEnabled(), { timeout: 8000 });
    await editSource();
    fireEvent.click(screen.getByTestId('studio-detail-next'));
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/guide');
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('studio-detail-previous'));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/alpha'));
  });

  it('an in-app link and a reload or close ask too', async () => {
    await openGuide();
    await editSource();
    fireEvent.click(screen.getByRole('link', { name: 'Other page' }));
    expect(confirmSpy).toHaveBeenCalledWith(LEAVE_QUESTION);
    expect(screen.getByTestId('where')).toHaveTextContent('/metadata/doc/guide');
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('browser Back is not guarded (the console is a BrowserRouter), and a saved page asks nothing', async () => {
    await openGuide();
    await editSource();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(confirmSpy).not.toHaveBeenCalled();
    fireEvent.click(saveButton());
    await waitFor(() => expect(publishWrites()).toHaveLength(1), { timeout: 8000 });
    await settle();
    fireEvent.click(screen.getByTestId('studio-detail-close'));
    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/metadata\/doc$/));
  });
});
