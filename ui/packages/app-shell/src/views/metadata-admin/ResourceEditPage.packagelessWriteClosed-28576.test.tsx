// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28576 (ADR-0146 D11) — Setup's item page over a PACKAGED item
 * shows the server's refusal of its package-less write as sent.
 *
 * The server closed the package-less write onto an item a code package ships:
 * a save or a reset naming no package is refused `403 NOT_OVERRIDABLE`, and
 * the sentence names the base's paired `.custom` package and the
 * `os migrate packageless-overlays` ceremony — the two things the
 * administrator can do. Setup's overlay page stays until its route retires
 * (Studio is the editor), so what it owes is to relay that sentence whole, in
 * the server's words: its error line leads with the first sentence and keeps
 * the full text behind "More" (objectui#13332).
 *
 * Pinned over the REAL page and a REAL `MetadataClient`, whose transport is an
 * in-memory server answering the `/meta` doors as the framework does after
 * the close: the packaged item's layers, and a `403` for each write that names
 * no package. Both the Save (a `PUT` with no `package`) and the Reset (a
 * `DELETE` with no `package`) are asserted to have reached the server with no
 * `package` key, so the refusal read back is the one that write was given.
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

const NAME = 'shipped_guide';
const BASE = 'com.acme.handbook';
const PAIR = `${BASE}.custom`;

const doc = (content: string) => ({ name: NAME, label: NAME, content, group: 'reference' });

/** The server's sentences, worded as the framework words them; read back verbatim below. */
const SAVE_CLOSED =
  `'doc/${NAME}' ships in '${BASE}', and a write naming no package onto a packaged item is closed: a customization ` +
  `of an installed package lives in its paired .custom package (ADR-0146 D11). Save it into '${PAIR}' ` +
  `(?package=${PAIR}), declaring overrides: { package: '${BASE}', basedOn }. A package-less customization stored ` +
  `before this release is still served; run \`os migrate packageless-overlays\` first to move it into '${PAIR}'.`;
const RESET_CLOSED =
  `'doc/${NAME}' ships in '${BASE}', and a write naming no package onto a packaged item is closed: a customization ` +
  `of an installed package lives in its paired .custom package (ADR-0146 D11). Remove it from '${PAIR}' ` +
  `(?package=${PAIR}). A package-less customization stored before this release is still served; run ` +
  `\`os migrate packageless-overlays\` first to move it into '${PAIR}'.`;

const server = {
  /** The packaged item's stored package-less row, as an unmigrated deployment holds it. */
  overlay: doc('# Customized') as Record<string, unknown>,
  writes: [] as Array<{ method: string; query: URLSearchParams }>,
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
  if (seg[0] === '_drafts') return json(200, { drafts: [] });
  if (seg.length === 1) return json(200, { items: [] });
  if (seg.length === 3 && seg[2] === 'layers') {
    const code = { ...doc('# Shipped'), _packageId: BASE, _provenance: 'package' };
    return json(200, {
      code, overlay: server.overlay, overlayScope: 'env', effective: server.overlay,
      provenance: 'package', packageId: BASE, editable: true, deletable: true, resettable: true, lock: 'none',
    });
  }
  if (seg.length === 3 && seg[2] === 'references') return json(200, []);
  if (seg.length === 2 && (method === 'PUT' || method === 'DELETE')) {
    server.writes.push({ method, query: new URLSearchParams(q) });
    // After the close: a write naming no package onto this packaged item is refused.
    if (!q.get('package')) {
      return json(403, { error: method === 'PUT' ? SAVE_CLOSED : RESET_CLOSED, code: 'NOT_OVERRIDABLE' });
    }
    return json(200, { success: true });
  }
  if (seg.length === 2) {
    if (q.get('state') === 'draft') return json(404, { error: { code: 'NO_DRAFT', message: 'absent' } });
    return json(200, { type: seg[0], name: seg[1], item: server.overlay });
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
        // An overlay-able type as the registry serves the five: the page opens
        // the packaged item for editing on this flag (objectui#12141).
        { type: 'doc', label: 'Documentation', domain: 'system', allowEnvironmentOverlay: true, allowRuntimeCreate: true, schema: DOC_JSON_SCHEMA },
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

const STUB_NS = 'packageless-write-closed-28576';
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
  server.overlay = doc('# Customized');
  server.writes = [];
  for (const fn of Object.values(toasts)) fn.mockClear();
  window.localStorage.setItem('metadata-admin:autosave', '0');
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

async function open() {
  const path = `/metadata/doc/${NAME}`;
  window.history.replaceState(null, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/metadata/doc/:name" element={<MetadataResourceEditPage type="doc" name={NAME} />} />
        <Route path="/metadata/doc" element={<span data-testid="list-view">list</span>} />
      </Routes>
    </MemoryRouter>,
  );
  const source = await screen.findByRole('textbox', { name: 'Markdown source' }, { timeout: 8000 });
  await settle();
  return source;
}

/** The page's error line, opened whole: the server's sentence as sent. */
async function refusalShown(): Promise<string> {
  fireEvent.click(await screen.findByTestId('refusal-more'));
  return screen.getByTestId('refusal-detail').textContent ?? '';
}

describe('Setup shows the server\'s refusal of a package-less write onto a packaged item as sent (objectstack#28576)', () => {
  it('Save: the PUT names no package, and the refusal is the page\'s error line, word for word', async () => {
    const source = await open();
    fireEvent.change(source, { target: { value: '# Customized again' } });
    fireEvent.click(screen.getByRole('button', { name: /Save \(⌘S\)/ }));

    await waitFor(() => expect(server.writes.filter((w) => w.method === 'PUT')).toHaveLength(1));
    await settle();
    expect(server.writes[0]!.query.has('package')).toBe(false);
    expect(await refusalShown()).toBe(SAVE_CLOSED);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('Reset: the DELETE names no package, and the refusal is the page\'s error line, word for word; the page stays', async () => {
    await open();
    fireEvent.click(screen.getByTestId('reset-or-delete-button'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByTestId('resource-edit-confirm-action'));

    await waitFor(() => expect(server.writes.filter((w) => w.method === 'DELETE')).toHaveLength(1));
    await settle();
    expect([...server.writes[0]!.query.keys()]).toEqual([]);
    expect(await refusalShown()).toBe(RESET_CLOSED);
    expect(screen.queryByTestId('list-view')).toBeNull();
  });
});
