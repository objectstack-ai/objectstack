// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12690 — "Discard draft" on the metadata edit page names the item by
 * its label, not by its machine id.
 *
 * Measured on the card: discarding the draft of an object labelled "QA Widget"
 * asked `…for object/uxscratch_widget?` and then toasted
 * `Draft discarded: object/uxscratch_widget`. The confirm and the toast now
 * name the label the item's loaded body carries, in both catalogs the editor
 * ships; an item that carries no label still reads `type/name`, and the discard
 * request itself is unchanged.
 *
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does (the double
 * `ResourceEditPage.discardFeedback-12303.test.tsx` uses). Only `sonner` and
 * the editor's locale hook are replaced. The confirm is the page's in-app
 * AlertDialog (objectui#13333), so its title is read off the rendered dialog;
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

const locale = vi.hoisted(() => ({ current: 'en-US' as 'en-US' | 'zh-CN' }));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => locale.current,
}));

const server = {
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Every DELETE the page sent, as path + query. */
  deletes: [] as string[],
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
    server.deletes.push(`${url.pathname}${url.search}`);
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

const STUB_NS = 'discard-draft-label-12690';
function StubMarkdown({ schema }: { schema: { content?: string } }) {
  return <div data-testid="markdown-render">{schema.content}</div>;
}
beforeAll(() => {
  ComponentRegistry.register('markdown', StubMarkdown as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});

const confirmSpy = vi.fn((_message?: string) => true);
beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.deletes = [];
  locale.current = 'en-US';
  for (const fn of Object.values(toasts)) fn.mockClear();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  asked.length = 0;
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

const source = () => screen.findByRole('textbox', { name: /Markdown source|Markdown 源码|Markdown/ }, { timeout: 8000 });

/** Opens `doc/NAME` holding a draft; `label` undefined means the body carries none. */
async function openDrafted(name: string, label: string | undefined) {
  const body = (content: string) => ({ name, ...(label === undefined ? {} : { label }), content, group: 'reference' });
  server.active.set(`doc/${name}`, body('# Live'));
  server.drafts.set(`doc/${name}`, body('# Live, drafted'));
  render(
    <MemoryRouter initialEntries={[`/metadata/doc/${name}`]}>
      <Routes>
        <Route path="/metadata/doc/:name" element={<MetadataResourceEditPage type="doc" name={name} />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await source()).toHaveValue('# Live, drafted');
  await settle();
}

/** What the in-app confirm asked, captured before it is accepted. */
const asked: string[] = [];

async function discard(name: string) {
  const label = locale.current === 'zh-CN' ? '丢弃草稿' : 'Discard draft';
  fireEvent.click(screen.getAllByRole('button', { name: label })[0]!);
  const dialog = await screen.findByRole('alertdialog');
  asked.push(within(dialog).getByRole('heading').textContent ?? '');
  fireEvent.click(within(dialog).getByTestId('resource-edit-confirm-action'));
  await waitFor(() => expect(server.drafts.has(`doc/${name}`)).toBe(false));
  await settle();
}

describe('MetadataResourceEditPage — "Discard draft" names the item by its label (objectui#12690)', () => {
  it('en: the confirm and the toast name the label, not doc/NAME', async () => {
    await openDrafted('qa_widget', 'QA Widget');
    await discard('qa_widget');

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBe(tFormat('engine.edit.discardDraftConfirm', 'en-US', { item: 'QA Widget' }));
    expect(asked[0]).toContain('QA Widget');
    expect(asked[0]).not.toContain('doc/qa_widget');

    expect(toasts.success).toHaveBeenCalledTimes(1);
    const said = toasts.success.mock.calls[0]![0] as string;
    expect(said).toBe(tFormat('engine.edit.draftDiscarded', 'en-US', { item: 'QA Widget' }));
    expect(said).toContain('QA Widget');
    expect(said).not.toContain('doc/qa_widget');
  });

  it('zh-CN: the confirm and the toast name the label, not doc/NAME', async () => {
    locale.current = 'zh-CN';
    await openDrafted('qa_widget', 'QA Widget');
    await discard('qa_widget');

    expect(asked[0]).toBe(tFormat('engine.edit.discardDraftConfirm', 'zh-CN', { item: 'QA Widget' }));
    expect(asked[0]).toContain('QA Widget');
    expect(asked[0]).not.toContain('doc/qa_widget');

    const said = toasts.success.mock.calls[0]![0] as string;
    expect(said).toBe(tFormat('engine.edit.draftDiscarded', 'zh-CN', { item: 'QA Widget' }));
    expect(said).toContain('QA Widget');
    expect(said).not.toContain('doc/qa_widget');
  });

  it('CONTROL: an item with no label still reads type/name, and the discard request is unchanged', async () => {
    await openDrafted('plain_note', undefined);
    await discard('plain_note');

    expect(asked).toEqual(['Discard the pending draft for doc/plain_note?']);
    expect(toasts.success).toHaveBeenCalledWith('Draft discarded: doc/plain_note');
    // The same one DELETE of the draft row, at the same package-less address.
    expect(server.deletes).toEqual(['/api/v1/meta/doc/plain_note?state=draft']);
  });
});
