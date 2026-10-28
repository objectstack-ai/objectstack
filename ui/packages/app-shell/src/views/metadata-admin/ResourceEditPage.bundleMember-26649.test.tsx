// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26649 — the metadata edit page opened with `?member=` reads and
 * writes THAT bundle member.
 *
 * Setup's list links each language of an `email_template` to
 * `…/email_template/NAME?member=LOCALE`. The page forwards the member to its
 * layered read and its draft read (ruling 6444406836), and to every by-name
 * write it issues for the item — publish, reset and discard — because each of
 * those doors addresses the CANONICAL member when it is named none: Reset on
 * the `zh-CN` page would otherwise remove the `en-US` overlay.
 *
 * The REAL page over a REAL `MetadataClient`, whose transport is an in-memory
 * server keyed by `(name, member)` as the framework keys a bundle (canonical
 * member `en-US`), so a request that drops the member lands on the other
 * language and the assertion on what is stored goes red.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataClient } from '@object-ui/data-objectstack';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

const CANONICAL = 'en-US';
const NAME = 'duly.task_overdue';

const tpl = (locale: string, subject: string) => ({
  name: NAME,
  label: `Overdue ${locale}`,
  locale,
  subject,
  bodyHtml: `<p>${subject}</p>`,
});

/** One member's stored state, as the framework holds a bundle row. */
interface MemberRows {
  code: Record<string, unknown> | null;
  overlay: Record<string, unknown> | null;
  draft: Record<string, unknown> | null;
}

const server = {
  members: new Map<string, MemberRows>(),
  requests: [] as Array<{ method: string; path: string; query: URLSearchParams }>,
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
  server.requests.push({ method, path: seg.join('/'), query: q });
  if (seg[0] === '_drafts') {
    return json(200, {
      drafts: [...server.members.entries()]
        .filter(([, rows]) => rows.draft)
        .map(([member]) => ({ type: 'email_template', name: NAME, member, packageId: null })),
    });
  }
  if (seg.length === 1) return json(200, { items: [] });
  const member = q.get('member') ?? CANONICAL;
  const rows = server.members.get(member);
  if (seg.length === 3 && seg[2] === 'layers') {
    if (!rows || (!rows.code && !rows.overlay)) return json(404, { error: { code: 'NOT_FOUND', message: 'absent' } });
    const effective = rows.overlay ?? rows.code;
    return json(200, {
      code: rows.code, overlay: rows.overlay, overlayScope: rows.overlay ? 'env' : null, effective,
      editable: true, deletable: true, resettable: !!(rows.code && rows.overlay), lock: 'none',
    });
  }
  if (seg.length === 3 && seg[2] === 'references') return json(200, []);
  if (seg.length === 3 && seg[2] === 'publish' && method === 'POST') {
    if (!rows?.draft) return json(404, { error: { code: 'NO_DRAFT', message: 'no draft' } });
    rows.overlay = rows.draft;
    rows.draft = null;
    return json(200, { success: true, version: 'sha256:1', seq: 2, message: 'published' });
  }
  if (seg.length === 2 && method === 'DELETE') {
    if (rows) {
      if (q.get('state') === 'draft') rows.draft = null;
      else rows.overlay = null;
    }
    return json(200, {});
  }
  if (seg.length === 2 && method === 'GET') {
    const draftRead = q.get('state') === 'draft';
    const row = draftRead ? rows?.draft : (rows?.overlay ?? rows?.code);
    return row
      ? json(200, { type: 'email_template', name: NAME, item: draftRead ? { ...row, _draft: true } : row, ...(draftRead ? { version: 'sha256:d' } : {}) })
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
        { type: 'email_template', label: 'Email Template', domain: 'system', allowEnvironmentOverlay: true, allowRuntimeCreate: true },
      ],
    }),
  };
});

import { MetadataResourceEditPage } from './ResourceEditPage';
import { registerDefaultMetadataSchemas } from './default-schemas';

client.current = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });
registerDefaultMetadataSchemas();

beforeEach(() => {
  server.members.clear();
  server.requests.length = 0;
  server.members.set(CANONICAL, { code: tpl(CANONICAL, 'Overdue'), overlay: null, draft: null });
  server.members.set('zh-CN', {
    code: tpl('zh-CN', '逾期'),
    overlay: tpl('zh-CN', '逾期了'),
    draft: tpl('zh-CN', '逾期了，请处理'),
  });
  window.localStorage.setItem('metadata-admin:autosave', '0');
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) });
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

function renderEdit(search: string) {
  render(
    <MemoryRouter initialEntries={[`/metadata/email_template/${NAME}${search}`]}>
      <Routes>
        <Route path="/metadata/email_template/:name" element={<MetadataResourceEditPage type="email_template" name={NAME} />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The requests to one door: `layers`, `publish`, the draft read, or a DELETE. */
const sent = (pick: (r: (typeof server.requests)[number]) => boolean) => server.requests.filter(pick);
const layerReads = () => sent((r) => r.path.endsWith('/layers'));
const draftReads = () => sent((r) => r.method === 'GET' && r.query.get('state') === 'draft');

async function confirmDialog() {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByTestId('resource-edit-confirm-action'));
}

describe('MetadataResourceEditPage — ?member= opens that bundle member (objectstack#26649)', () => {
  it('reads the member\'s layers and draft, and shows its own body', async () => {
    renderEdit('?scope=environment&member=zh-CN');
    expect(await screen.findByDisplayValue('逾期了，请处理', undefined, { timeout: 8000 })).toBeInTheDocument();
    await settle();

    expect(layerReads().length).toBeGreaterThan(0);
    for (const r of layerReads()) expect(r.query.get('member')).toBe('zh-CN');
    expect(draftReads().length).toBeGreaterThan(0);
    for (const r of draftReads()) expect(r.query.get('member')).toBe('zh-CN');
    expect(screen.queryByDisplayValue('Overdue')).not.toBeInTheDocument();
  });

  it('CONTROL: with no ?member= the page reads the canonical member and sends no selector', async () => {
    renderEdit('?scope=environment');
    expect(await screen.findByDisplayValue('Overdue', undefined, { timeout: 8000 })).toBeInTheDocument();
    await settle();

    for (const r of server.requests) expect(r.query.has('member')).toBe(false);
  });

  it('Publish promotes the opened member\'s draft, not the canonical member\'s', async () => {
    renderEdit('?scope=environment&member=zh-CN');
    await screen.findByDisplayValue('逾期了，请处理', undefined, { timeout: 8000 });
    await settle();

    fireEvent.click(screen.getByTitle('Publish'));
    await waitFor(() => expect(server.members.get('zh-CN')!.draft).toBeNull());
    await settle();

    const publishes = sent((r) => r.path.endsWith('/publish'));
    expect(publishes).toHaveLength(1);
    expect(publishes[0]!.query.get('member')).toBe('zh-CN');
    expect(server.members.get('zh-CN')!.overlay).toMatchObject({ subject: '逾期了，请处理' });
  });

  it('Discard draft discards the opened member\'s draft', async () => {
    renderEdit('?scope=environment&member=zh-CN');
    await screen.findByDisplayValue('逾期了，请处理', undefined, { timeout: 8000 });
    await settle();

    fireEvent.click(screen.getAllByTitle('Discard draft')[0]!);
    await confirmDialog();
    await waitFor(() => expect(server.members.get('zh-CN')!.draft).toBeNull());

    const deletes = sent((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.query.get('state')).toBe('draft');
    expect(deletes[0]!.query.get('member')).toBe('zh-CN');
  });

  it('Reset removes the opened member\'s overlay and leaves the other language alone', async () => {
    server.members.get('zh-CN')!.draft = null;
    server.members.get(CANONICAL)!.overlay = tpl(CANONICAL, 'Overdue, customised');
    renderEdit('?scope=environment&member=zh-CN');
    await screen.findByDisplayValue('逾期了', undefined, { timeout: 8000 });
    await settle();

    fireEvent.click(screen.getByTestId('reset-or-delete-button'));
    await confirmDialog();
    await waitFor(() => expect(server.members.get('zh-CN')!.overlay).toBeNull());
    await settle();

    const deletes = sent((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.query.get('member')).toBe('zh-CN');
    expect(server.members.get(CANONICAL)!.overlay).toMatchObject({ subject: 'Overdue, customised' });
    // The re-read after the reset is the same member's layers.
    expect(layerReads().at(-1)!.query.get('member')).toBe('zh-CN');
    expect(await screen.findByDisplayValue('逾期')).toBeInTheDocument();
  });
});
