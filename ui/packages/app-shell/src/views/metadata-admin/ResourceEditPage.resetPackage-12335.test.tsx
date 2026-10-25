// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12335 — the metadata editor's Reset/Delete and "Discard draft" name
 * the package whose row they remove.
 *
 * Since objectstack `543b33dee` (`@objectstack/rest` 18.0.0-next.1) the delete
 * door reads `?package=`. A delete that names no package addresses the one
 * package that holds the item; when two packages hold it the door refuses
 * `409 RESOURCE_CONFLICT`, deletes nothing, and names `?package=` as the
 * remedy. Before this card the editor could not send that remedy: its save and
 * publish stated the editor's package (`?package=` on the editor URL, read by
 * `readActivePackageBinding()`), and its reset and discard stated none.
 *
 * The card's acceptance, as pins over the REAL page and a REAL
 * `MetadataClient`, whose transport is an in-memory server holding one item in
 * two packages and answering the delete door as the framework does:
 *
 *   - bound: the editor URL carries `?package=`, so the reset and the discard
 *     send it, and only that package's row goes;
 *   - unbound: no package on the URL (or the `all` scope), so the request
 *     carries no `package` key at all, and the door's 409 reaches the author
 *     as the page's error line, in the door's own words. Nothing is deleted.
 *
 * Only `sonner` is replaced, so the success toast a landed discard raises is
 * read directly (objectui#12303).
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

const NAME = 'shared_guide';
const KEY = `doc/${NAME}`;
const PKG_A = 'com.acme.alpha';
const PKG_B = 'com.acme.beta';

const doc = (content: string) => ({ name: NAME, label: NAME, content, group: 'reference' });

/** One item's rows, keyed by the package each is bound to. */
type Rows = Map<string, Record<string, unknown>>;

const server = {
  active: new Map<string, Rows>(),
  drafts: new Map<string, Rows>(),
  /** Every DELETE the door received, as its parsed query. */
  deletes: [] as URLSearchParams[],
};

/** The door's refusal, worded as the framework words it; read back verbatim below. */
const AMBIGUOUS =
  "Name the package this delete is for, then send it again: on the REST door add ?package= with the package id, " +
  `in process pass packageId. Nothing was deleted. doc '${NAME}' belongs to 2 packages ('${PKG_A}', '${PKG_B}'), ` +
  'and a delete that names none has no single row to remove.';

/**
 * The page's error line leads with the refusal's first sentence and keeps the
 * whole server text behind "More" (objectui#13332): open it and read it whole.
 */
async function expectRefusalShown() {
  fireEvent.click(await screen.findByTestId('refusal-more'));
  expect(screen.getByTestId('refusal-detail').textContent).toBe(AMBIGUOUS);
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** `?package=`, as the framework's normaliser reads it: `all` and empty name none. */
const packageParam = (q: URLSearchParams): string | null => {
  const pkg = q.get('package');
  return pkg && pkg !== 'all' ? pkg : null;
};

/** The row a read addresses: the named package's, or the first one stored. */
function rowFor(rows: Rows | undefined, pkg: string | null): Record<string, unknown> | undefined {
  if (!rows) return undefined;
  return pkg ? rows.get(pkg) : rows.values().next().value;
}

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://console.test');
  const q = url.searchParams;
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (!meta) return json(200, []);
  const seg = meta[1].split('/').map(decodeURIComponent);
  const key = `${seg[0]}/${seg[1]}`;
  if (seg[0] === '_drafts') {
    const drafts = [...server.drafts.entries()].flatMap(([k, rows]) =>
      [...rows.keys()].map((pkg) => ({ type: k.split('/')[0], name: k.split('/')[1], packageId: pkg })),
    );
    return json(200, { drafts });
  }
  if (seg.length === 1) return json(200, { items: [] });
  if (seg.length === 3 && seg[2] === 'layers') {
    const row = rowFor(server.active.get(key), packageParam(q));
    return row
      ? json(200, { code: null, overlay: row, overlayScope: 'env', effective: row, editable: true, deletable: true, resettable: false, lock: 'none' })
      : json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
  }
  if (seg.length === 3 && seg[2] === 'references') return json(200, []);
  if (seg.length === 2 && method === 'DELETE') {
    server.deletes.push(new URLSearchParams(q));
    const rows = (q.get('state') === 'draft' ? server.drafts : server.active).get(key);
    const pkg = packageParam(q);
    if (!pkg && rows && rows.size > 1) {
      // objectstack `543b33dee`: the REST door's 4xx body carries the sentence
      // as `error` and the ADR-0112 code beside it.
      return json(409, { error: AMBIGUOUS, code: 'RESOURCE_CONFLICT' });
    }
    const target = pkg ?? (rows ? rows.keys().next().value : undefined);
    const removed = target !== undefined && !!rows?.delete(target);
    return json(200, { success: true, reset: removed });
  }
  if (seg.length === 2) {
    const draftRead = q.get('state') === 'draft';
    const row = rowFor((draftRead ? server.drafts : server.active).get(key), packageParam(q));
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

const DOC_JSON_SCHEMA = z.toJSONSchema(DocSchema as unknown as z.ZodType) as Record<string, unknown>;
client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

registerDefaultMetadataSchemas();
registerBuiltinPreviews();

const STUB_NS = 'reset-package-12335';
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
  // The item, in two packages, each with a published row and a pending draft.
  server.active.clear();
  server.drafts.clear();
  server.deletes = [];
  server.active.set(KEY, new Map([[PKG_A, doc('# Alpha live')], [PKG_B, doc('# Beta live')]]));
  server.drafts.set(KEY, new Map([[PKG_A, doc('# Alpha drafted')], [PKG_B, doc('# Beta drafted')]]));
  for (const fn of Object.values(toasts)) fn.mockClear();
  confirmSpy.mockReset();
  confirmSpy.mockReturnValue(true);
  window.localStorage.setItem('metadata-admin:autosave', '0');
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: confirmSpy });
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

/**
 * Open the editor at `search`, put on BOTH urls the page reads: the router's
 * (the load's read scope) and the window's (`readActivePackageBinding()`, the
 * one every write of the loop states).
 */
async function openAt(search: string, expectedDraft: string) {
  const path = `/metadata/doc/${NAME}${search}`;
  window.history.replaceState(null, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/metadata/doc/:name" element={<MetadataResourceEditPage type="doc" name={NAME} />} />
        <Route path="/metadata/doc" element={<span data-testid="list-view">list</span>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByRole('textbox', { name: 'Markdown source' }, { timeout: 8000 })).toHaveValue(expectedDraft);
  await settle();
}

const discardButton = () => screen.getAllByRole('button', { name: 'Discard draft' })[0]!;
const resetButton = () => screen.getByTestId('reset-or-delete-button');

/** Accept the page's in-app confirm (objectui#13333) once it opens. */
async function acceptInAppConfirm() {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByTestId('resource-edit-confirm-action'));
}
const lastDelete = () => server.deletes[server.deletes.length - 1]!;
const packagesHeld = (store: Map<string, Rows>) => [...(store.get(KEY)?.keys() ?? [])];

describe('ResourceEditPage — a bound editor names its package on reset and discard (objectui#12335)', () => {
  it('Discard draft sends ?state=draft&package=, and only that package`s draft goes', async () => {
    await openAt(`?package=${PKG_A}`, '# Alpha drafted');

    fireEvent.click(discardButton());

    await acceptInAppConfirm();
    await waitFor(() => expect(server.deletes).toHaveLength(1));
    await settle();

    expect(lastDelete().get('state')).toBe('draft');
    expect(lastDelete().get('package')).toBe(PKG_A);
    expect(packagesHeld(server.drafts)).toEqual([PKG_B]);
    expect(packagesHeld(server.active)).toEqual([PKG_A, PKG_B]);
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it('Delete sends ?package= and no state, and only that package`s published row goes', async () => {
    await openAt(`?package=${PKG_A}`, '# Alpha drafted');

    fireEvent.click(resetButton());

    await acceptInAppConfirm();
    await waitFor(() => expect(server.deletes).toHaveLength(1));
    await settle();

    expect(lastDelete().get('package')).toBe(PKG_A);
    expect(lastDelete().has('state')).toBe(false);
    expect(packagesHeld(server.active)).toEqual([PKG_B]);
    expect(packagesHeld(server.drafts)).toEqual([PKG_A, PKG_B]);
  });
});

describe('ResourceEditPage — an unbound editor sends no package, and the 409 reaches the author (objectui#12335)', () => {
  it('Discard draft: no `package` key; the refusal is the page`s error line and both drafts stay', async () => {
    await openAt('', '# Alpha drafted');

    fireEvent.click(discardButton());

    await acceptInAppConfirm();
    await waitFor(() => expect(server.deletes).toHaveLength(1));
    await settle();

    expect(lastDelete().get('state')).toBe('draft');
    // Absent, never empty.
    expect(lastDelete().has('package')).toBe(false);
    await expectRefusalShown();
    expect(packagesHeld(server.drafts)).toEqual([PKG_A, PKG_B]);
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it('Delete: no `package` key; the refusal is the page`s error line, the page stays and both rows stay', async () => {
    await openAt('', '# Alpha drafted');

    fireEvent.click(resetButton());

    await acceptInAppConfirm();
    await waitFor(() => expect(server.deletes).toHaveLength(1));
    await settle();

    expect([...lastDelete().keys()]).toEqual([]);
    await expectRefusalShown();
    expect(screen.queryByTestId('list-view')).toBeNull();
    expect(packagesHeld(server.active)).toEqual([PKG_A, PKG_B]);
  });

  it('`?package=all` is the show-everything scope, not a package: the discard sends none', async () => {
    await openAt('?package=all', '# Alpha drafted');

    fireEvent.click(discardButton());

    await acceptInAppConfirm();
    await waitFor(() => expect(server.deletes).toHaveLength(1));
    await settle();

    expect(lastDelete().has('package')).toBe(false);
    await expectRefusalShown();
  });
});
