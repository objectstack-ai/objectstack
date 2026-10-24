// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12303 row 2 — "Discard draft" on the metadata edit page says that
 * it discarded, and names what.
 *
 * Measured on the card: the `DELETE …?state=draft` answered 200, the pending
 * banner went away, and nothing on the page said so. The page now raises the
 * console's shared success toast naming the item, once the discard and its
 * re-read have landed. objectui#12690 changed WHAT names it: the item's own
 * label when it carries one (here the fixture's label is its name), the
 * machine `type/name` only when it carries none; that rule is pinned in
 * `ResourceEditPage.discardDraftLabel-12690.test.tsx`. A refused discard raises none: it
 * keeps the page's error line, as before.
 *
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does (the same double
 * `ResourceEditPage.layersUnsaved-11799.test.tsx` uses). Only `sonner` is
 * replaced, so the toast call itself is what is read. The confirm is the
 * page's in-app AlertDialog (objectui#13333), answered by clicking it;
 * `window.confirm` is stubbed only as a tripwire that must never be called.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { z } from 'zod';
import { ComponentRegistry } from '@object-ui/core';
import { DocSchema } from '@objectstack/spec/system';
import { MetadataClient } from '@object-ui/data-objectstack';

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const doc = (name: string, content: string) => ({ name, label: name, content, group: 'reference' });

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  deletes: 0,
  /** When set, a draft DELETE is refused with this status and message. */
  refuseDiscard: null as null | { status: number; message: string },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const q = url.searchParams;
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') {
    return json(200, { drafts: [...server.drafts.keys()].map((k) => ({ type: k.split('/')[0], name: k.split('/')[1], packageId: null })) });
  }
  if (seg.length === 1) return json(200, { items: [] });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = server.active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row, editable: true, deletable: true, resettable: false, lock: 'none' })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 3 && seg[2] === 'references') return json(200, []);
  if (seg.length === 2 && method === 'DELETE') {
    server.deletes += 1;
    if (q.get('state') === 'draft' && server.refuseDiscard) {
      return json(server.refuseDiscard.status, { error: { code: 'ITEM_LOCKED', message: server.refuseDiscard.message } });
    }
    if (q.get('state') === 'draft') server.drafts.delete(key);
    else server.active.delete(key);
    return json(200, {});
  }
  if (seg.length === 2) {
    const draftRead = q.get('state') === 'draft';
    const row = (draftRead ? server.drafts : server.active).get(key);
    return row
      ? json(200, { type: seg[0], name: seg[1], item: draftRead ? { ...row, _draft: true } : row })
      : json(404, { error: { code: draftRead ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } });
  }
  return json(200, {});
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
import { tFormat } from './i18n';

const DOC_JSON_SCHEMA = z.toJSONSchema(DocSchema as unknown as z.ZodType) as Record<string, unknown>;
client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();

const STUB_NS = 'discard-feedback-12303';
function StubMarkdown({ schema }: { schema: { content?: string } }) {
  return <div data-testid="markdown-render">{schema.content}</div>;
}
beforeAll(() => {
  ComponentRegistry.register('markdown', StubMarkdown as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});

const confirmSpy = vi.fn(() => true);
beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.deletes = 0;
  server.refuseDiscard = null;
  for (const fn of Object.values(toasts)) fn.mockClear();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  window.localStorage.setItem('metadata-admin:autosave', '0');
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
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
const discardButton = () => screen.getAllByRole('button', { name: 'Discard draft' })[0]!;

/** Click Discard draft and answer the in-app confirm: accept or cancel. */
async function discardAnswering(accept: boolean) {
  fireEvent.click(discardButton());
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(
    within(dialog).getByTestId(accept ? 'resource-edit-confirm-action' : 'resource-edit-confirm-cancel'),
  );
}

async function openDrafted(name: string) {
  server.active.set(`doc/${name}`, doc(name, '# Live'));
  server.drafts.set(`doc/${name}`, doc(name, '# Live, drafted'));
  renderEdit(name);
  expect(await source()).toHaveValue('# Live, drafted');
  await settle();
}

describe('MetadataResourceEditPage — "Discard draft" says what it discarded (objectui#12303)', () => {
  it('a landed discard raises one success toast naming the item, and the published body is back', async () => {
    await openDrafted('live_guide');

    await discardAnswering(true);
    await waitFor(() => expect(server.drafts.has('doc/live_guide')).toBe(false));
    await settle();

    expect(await source()).toHaveValue('# Live');
    expect(toasts.success).toHaveBeenCalledTimes(1);
    expect(toasts.success).toHaveBeenCalledWith(
      tFormat('engine.edit.draftDiscarded', 'en', { item: 'live_guide' }),
    );
    // The words name the item, not just the act. objectui#12690 — by its label
    // (`doc()` labels the fixture with its name), no longer as `doc/live_guide`.
    expect(toasts.success.mock.calls[0]![0]).toContain('live_guide');
  });

  it('CONTROL: a declined confirm sends no DELETE and says nothing', async () => {
    await openDrafted('live_guide');

    await discardAnswering(false);
    await settle();

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(server.deletes).toBe(0);
    expect(server.drafts.has('doc/live_guide')).toBe(true);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('CONTROL: a refused discard raises no success toast; the page shows the refusal and keeps the draft', async () => {
    await openDrafted('live_guide');
    server.refuseDiscard = { status: 403, message: 'doc/live_guide belongs to a read-only package and cannot be changed.' };

    await discardAnswering(true);
    await waitFor(() => expect(server.deletes).toBe(1));
    await settle();

    expect(await screen.findByText(/belongs to a read-only package/)).toBeInTheDocument();
    expect(server.drafts.has('doc/live_guide')).toBe(true);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('objectui#13333: the native confirm() is never asked on this path', async () => {
    await openDrafted('live_guide');
    await discardAnswering(true);
    await waitFor(() => expect(server.drafts.has('doc/live_guide')).toBe(false));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
