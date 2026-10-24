// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11799 — the package OWD overview asks `GET …/layers` for no object
 * that has never been saved.
 *
 * An object the author created in the package and never published has a
 * draft and no layer, and the framework answers `/layers` with a 404 for it.
 * The overview read every object's layered baseline beside its draft, so every
 * open of the Access pillar's OWD table, and every OWD save of such an object,
 * logged an expected 404. Now an object the package's published list does not
 * hold is not asked while its draft is in hand: the baseline is used only
 * without a draft (objectui#10765).
 *
 * The REAL panel over a REAL `MetadataClient`, whose transport is an in-memory
 * server answering as the framework does: 404 for `/layers` with no layer and
 * for `?state=draft` with no draft. Requests are counted on it.
 *
 * Pinned, for the load and for the save:
 *  - an unsaved object sends no `/layers`, and its row reads its draft exactly
 *    as before (the 404 answer was never used for it);
 *  - CONTROL: a published object sends exactly one `/layers`, as before;
 *  - CONTROL: an unsaved object whose draft does not come back reads its
 *    baseline as before, so a vanished draft never leaves the row on nothing.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MetadataClient } from '@object-ui/data-objectstack';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { t } from '../metadata-admin/i18n';
import { PackageOwdOverviewPanel } from './PackageOwdOverviewPanel';

const en = (key: string) => t(key, 'en-US');

/** What each dial lists an OWD value under; the dials are the shared Select (objectui#11865). */
const OWD_LABEL: Record<string, string> = {
  '': en('engine.studio.settings.sharingUnset'),
  private: en('engine.studio.settings.sharingPrivate'),
  public_read: en('engine.studio.settings.sharingPublicRead'),
};

/** Pick a dial's option by its label, through the trigger, as a user does. */
async function pickOwd(testId: string, label: string): Promise<void> {
  fireEvent.keyDown(screen.getByTestId(testId), { key: 'ArrowDown' });
  const listbox = await screen.findByRole('listbox');
  fireEvent.click(within(listbox).getByRole('option', { name: label }));
}

const PKG = 'com.acme.app';

interface Row {
  type: string;
  name: string;
  body: Record<string, unknown>;
  packageId: string | null;
}

/** The server: published rows, draft rows, and every request it was asked. */
const server = {
  active: new Map<string, Row>(),
  drafts: new Map<string, Row>(),
  /** Names whose `?state=draft` read fails (a 500), to drive the fallback control. */
  brokenDraftReads: new Set<string>(),
  requests: [] as Array<{ method: string; path: string; search: string; status: number; body?: unknown }>,
};

function put(rows: Map<string, Row>, name: string, body: Record<string, unknown>) {
  rows.set(`object/${name}`, { type: 'object', name, body, packageId: PKG });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function serve(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const url = new URL(String(input), 'http://studio.test');
  const q = url.searchParams;
  let status = 200;
  let body: unknown = [];
  let sent: unknown;
  const meta = url.pathname.match(/^\/api\/v1\/meta\/(.+)$/);
  if (meta) {
    const seg = meta[1].split('/').map(decodeURIComponent);
    if (seg[0] === '_drafts') {
      body = {
        drafts: [...server.drafts.values()]
          .filter((d) => (!q.get('type') || d.type === q.get('type')) && (!q.get('packageId') || d.packageId === q.get('packageId')))
          .map((d) => ({ type: d.type, name: d.name, packageId: d.packageId, updatedAt: null, updatedBy: null })),
      };
    } else if (seg.length === 1) {
      body = {
        items: [...server.active.values()]
          .filter((r) => r.type === seg[0] && (!q.get('package') || r.packageId === q.get('package')))
          .map((r) => r.body),
      };
    } else if (seg.length === 3 && seg[2] === 'layers') {
      const row = server.active.get(`${seg[0]}/${seg[1]}`);
      if (row) body = { code: null, overlay: row.body, overlayScope: 'env', effective: row.body };
      else [status, body] = [404, { error: { code: 'NOT_FOUND', message: 'absent' } }];
    } else if (seg.length === 2 && method === 'PUT') {
      sent = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      server.drafts.set(`${seg[0]}/${seg[1]}`, {
        type: seg[0],
        name: seg[1],
        body: sent as Record<string, unknown>,
        packageId: q.get('package'),
      });
      body = { type: seg[0], name: seg[1], state: 'draft' };
    } else if (seg.length === 2) {
      const draftRead = q.get('state') === 'draft';
      const row = (draftRead ? server.drafts : server.active).get(`${seg[0]}/${seg[1]}`);
      if (draftRead && server.brokenDraftReads.has(seg[1])) [status, body] = [500, { error: { code: 'INTERNAL', message: 'boom' } }];
      else if (row) body = { type: seg[0], name: seg[1], item: draftRead ? { ...row.body, _draft: true } : row.body };
      else [status, body] = [404, { error: { code: draftRead ? 'NO_DRAFT' : 'NOT_FOUND', message: 'absent' } }];
    }
  }
  server.requests.push({ method, path: url.pathname, search: url.search, status, ...(sent ? { body: sent } : {}) });
  return json(status, body);
}

const client = new MetadataClient({ baseUrl: '', fetch: vi.fn(serve) as unknown as typeof fetch });

/** GETs of `/meta/object/<name>/layers`. */
const layersAsked = (name: string) =>
  server.requests.filter((r) => r.method === 'GET' && r.path === `/api/v1/meta/object/${name}/layers`).length;

/** The draft PUTs of `name`, as sent. */
const draftPuts = (name: string) =>
  server.requests.filter((r) => r.method === 'PUT' && r.path === `/api/v1/meta/object/${name}`).map((r) => r.body as Record<string, unknown>);

/** Let every queued read run to the end. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

/** Published in the package, no draft. */
const ACCOUNT = { name: 'crm_account', label: 'Account', sharingModel: 'public_read', fields: { name: { type: 'text' } } };
/** Created in the package and never published: a draft and no layer. */
const FRESH = { name: 'crm_fresh', label: 'Fresh', sharingModel: 'private', fields: { title: { type: 'text' } } };

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.brokenDraftReads.clear();
  server.requests = [];
  Element.prototype.scrollIntoView = vi.fn();
  put(server.active, ACCOUNT.name, ACCOUNT);
  put(server.drafts, FRESH.name, FRESH);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openPanel() {
  render(<PackageOwdOverviewPanel client={client} packageId={PKG} locale="en-US" />);
  await screen.findByTestId(`owd-row-${FRESH.name}`);
  await screen.findByTestId(`owd-row-${ACCOUNT.name}`);
  await settle();
}

describe('PackageOwdOverviewPanel — an unsaved object is not asked for /layers (objectui#11799)', () => {
  it('LOAD: the unsaved object sends no /layers and reads its draft as before; the published one sends exactly one', async () => {
    await openPanel();

    expect(layersAsked(FRESH.name)).toBe(0);
    // CONTROL: a published object is read as before.
    expect(layersAsked(ACCOUNT.name)).toBe(1);
    expect(server.requests.filter((r) => r.status === 404).map((r) => `${r.path}${r.search}`)).toEqual([]);

    // The unsaved object's row is its draft, exactly as the 404 answer left it.
    const row = screen.getByTestId(`owd-row-${FRESH.name}`);
    expect(row).toHaveTextContent('Fresh');
    expect(row).toHaveTextContent('Unpublished draft');
    expect(screen.getByTestId(`owd-internal-${FRESH.name}`).textContent).toBe(OWD_LABEL.private);
    // CONTROL: the published object's row is its baseline.
    expect(screen.getByTestId(`owd-internal-${ACCOUNT.name}`).textContent).toBe(OWD_LABEL.public_read);
  });

  it('SAVE: the unsaved object is saved over its draft with no /layers; the published one is re-read once', async () => {
    await openPanel();
    const before = { fresh: layersAsked(FRESH.name), account: layersAsked(ACCOUNT.name) };

    await pickOwd(`owd-internal-${FRESH.name}`, OWD_LABEL.public_read);
    await pickOwd(`owd-internal-${ACCOUNT.name}`, OWD_LABEL.private);
    fireEvent.click(screen.getByTestId('owd-save'));
    await waitFor(() => expect(draftPuts(FRESH.name)).toHaveLength(1));
    await waitFor(() => expect(draftPuts(ACCOUNT.name)).toHaveLength(1));
    await settle();

    // The save itself asked nothing of the unsaved object's layer; the reload after it neither.
    expect(layersAsked(FRESH.name) - before.fresh).toBe(0);
    // The edit landed on the draft as-is: every draft key kept, the model replaced.
    expect(draftPuts(FRESH.name)[0]).toEqual({ ...FRESH, sharingModel: 'public_read' });
    // CONTROL: the published object is read as before: once for the save, and
    // once by the reload after it.
    expect(layersAsked(ACCOUNT.name) - before.account).toBe(2);
    expect(draftPuts(ACCOUNT.name)[0]).toEqual({ ...ACCOUNT, sharingModel: 'private' });
    expect(server.requests.filter((r) => r.status === 404).map((r) => `${r.path}${r.search}`)).toEqual([]);
  });

  it('CONTROL: an unsaved object whose draft does not come back reads its baseline as before', async () => {
    server.brokenDraftReads.add(FRESH.name);
    await openPanel();

    // The draft read failed, so the baseline is the only source left: read, as
    // before (the framework answers 404, and the row stays on nothing, as before).
    expect(layersAsked(FRESH.name)).toBe(1);
    expect(screen.getByTestId(`owd-internal-${FRESH.name}`).textContent).toBe(OWD_LABEL['']);
    expect(screen.getByTestId(`owd-row-${FRESH.name}`)).not.toHaveTextContent('Unpublished draft');
  });
});
