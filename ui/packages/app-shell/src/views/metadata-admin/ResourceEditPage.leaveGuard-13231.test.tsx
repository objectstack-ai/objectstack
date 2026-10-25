// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13231 — the metadata edit page registers its unsaved draft with the
 * shell's unsaved-edits seam, so the shell's menus ask before dropping it, and
 * its own leave guard keeps working through the seam.
 *
 * The page used to install its own `beforeunload` listener and its own
 * capture-phase link listener while dirty. A shell menu that navigates from a
 * button (Help, the avatar's Profile, the workspace switcher) saw neither, so
 * it left at once and the draft was lost. The page now registers the draft
 * with the seam instead, with the question it always asked
 * (`engine.edit.unsavedLeaveConfirm`), and the seam guards a tab close, a link
 * and every shell departure that goes through `confirmUnsavedLeave`.
 *
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does (the double
 * `ResourceEditPage.discardDraftLabel-12690.test.tsx` uses). Only `sonner`,
 * `window.confirm` and the editor's locale hook are replaced.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
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

const active = new Map<string, Record<string, unknown>>();

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg.length === 1) return json(200, { items: [] });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = active.get(key);
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row, editable: true, deletable: true, resettable: false, lock: 'none' })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 3 && seg[2] === 'references') return json(200, []);
  if (seg.length === 2 && method === 'GET') {
    const draftRead = url.searchParams.get('state') === 'draft';
    const row = draftRead ? undefined : active.get(key);
    return row
      ? json(200, { type: seg[0], name: seg[1], item: row })
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
import { t } from './i18n';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits';

const DOC_JSON_SCHEMA = z.toJSONSchema(DocSchema as unknown as z.ZodType) as Record<string, unknown>;
client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();

const STUB_NS = 'leave-guard-13231';
function StubMarkdown({ schema }: { schema: { content?: string } }) {
  return <div data-testid="markdown-render">{schema.content}</div>;
}
beforeAll(() => {
  ComponentRegistry.register('markdown', StubMarkdown as never, { namespace: STUB_NS });
});
afterAll(() => {
  ComponentRegistry.unregister('markdown', STUB_NS);
});

/** The page's own leave question, the one its link guard has always asked. */
const QUESTION = t('engine.edit.unsavedLeaveConfirm', 'en-US');

const confirmSpy = vi.fn((_message?: string) => false);
beforeEach(() => {
  active.clear();
  for (const fn of Object.values(toasts)) fn.mockClear();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(false);
  window.localStorage.setItem('metadata-admin:autosave', '0');
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
  window.history.replaceState(null, '', '/metadata/doc/guide');
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem('metadata-admin:autosave');
  window.history.replaceState(null, '', '/');
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const source = () => screen.findByRole('textbox', { name: /Markdown source|Markdown/ }, { timeout: 8000 });

/** Opens `doc/guide` with a stored body, beside a link to another page. */
async function openGuide() {
  active.set('doc/guide', { name: 'guide', label: 'Guide', content: '# Live', group: 'reference' });
  render(
    <MemoryRouter initialEntries={['/metadata/doc/guide']}>
      <Link to="/metadata/doc">All docs</Link>
      <Routes>
        <Route path="/metadata/doc/:name" element={<MetadataResourceEditPage type="doc" name="guide" />} />
        <Route path="/metadata/doc" element={<div>Docs list</div>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await source()).toHaveValue('# Live');
  await settle();
}

async function editSource() {
  fireEvent.change(await source(), { target: { value: '# Live, edited' } });
  await settle();
}

/** A `beforeunload` the window receives now, and whether a listener held it. */
function unloadHeld(): boolean {
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  return unload.defaultPrevented;
}

describe('MetadataResourceEditPage registers its unsaved draft with the shell seam (objectui#13231)', () => {
  it('a dirty draft: a shell departure asks the page\'s own question, and Cancel never leaves', async () => {
    await openGuide();
    await editSource();

    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    expect(go).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
  });

  it('a dirty draft: its link guard still asks, and Cancel keeps the page and the draft', async () => {
    await openGuide();
    await editSource();

    fireEvent.click(screen.getByRole('link', { name: 'All docs' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(QUESTION);
    expect(screen.queryByText('Docs list')).toBeNull();
    expect(await source()).toHaveValue('# Live, edited');
  });

  it('a dirty draft: a tab close raises the browser\'s own prompt', async () => {
    await openGuide();
    await editSource();
    expect(unloadHeld()).toBe(true);
  });

  it('CONTROL: a clean page registers nothing — no prompt, and a tab close is not held', async () => {
    await openGuide();

    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(unloadHeld()).toBe(false);

    fireEvent.click(screen.getByRole('link', { name: 'All docs' }));
    expect(await screen.findByText('Docs list')).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('CONTROL: once the page has unmounted, nothing is registered', async () => {
    await openGuide();
    await editSource();
    cleanup();

    const go = vi.fn();
    confirmUnsavedLeave(go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(unloadHeld()).toBe(false);
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
