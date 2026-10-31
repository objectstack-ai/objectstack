/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27627 — a record open is ONE data request.
 *
 * Measured on origin/main with this file's own transport (the default record
 * page over four related lists, StrictMode, the real adapter): a cold open sent
 * 13 requests in two waves — the record, the approval list, two access
 * verdicts and four related definitions, then the approval lock and four
 * `top=1` count probes — and a warm open 9, also in two waves.
 *
 * The page now asks `POST /data/{object}/{id}/page` once, before any reader's
 * effect runs, and every reader takes its part from it. Pinned here: one page
 * request per open, no count probe, no separate verdict / field-access /
 * approval / lock / record read, one wave of data requests; the badges draw the
 * payload's totals; and the record a drawer step shows next is asked ahead, so stepping to it
 * asks nothing for the record it opens.
 *
 * objectstack#27524: the 动态 panel leads the page's right column in every
 * tier, so the stream is on screen at open and reads its own sources beside
 * the page request, in the same wave: the record's comment thread, its
 * activity and, once per view, the mention list. None of them is a part of the page the payload answers;
 * they are pinned on their own below, not counted as page requests.
 *
 * And once the app's metadata bundle is in (`loadAppBundle`, on app entry), the
 * object definitions the blocks read come from it: a record open in a warm
 * session asks the page and no metadata at all (its 动态 stream's own reads aside), and a cold one adds at most
 * the one bundle request.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { __clearRecordEditableCache } from '../../../plugin-detail/src/useRecordEditable';
import { __resetRecordApprovalsStore } from '../hooks/useRecordApprovals';
import { RecordDetailView } from './RecordDetailView';
import { RecordDrawerUpcomingContext } from './recordDrawerStack';

const BASE = 'http://test.local';
const OBJECT = 'os_27627_contact';
const ACCOUNT = 'os_27627_account';
const CHILDREN = ['os_27627_task', 'os_27627_case', 'os_27627_deal', 'os_27627_event'];

const contactDef = {
  name: OBJECT,
  label: 'Contact',
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    email: { label: 'Email', type: 'email' },
    account: { label: 'Account', type: 'lookup', reference: ACCOUNT },
  },
};
const accountDef = { name: ACCOUNT, label: 'Account', fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } } };
const childDef = (name: string) => ({
  name,
  label: name.replace('os_27627_', ''),
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    status: { label: 'Status', type: 'text' },
    contact: { label: 'Contact', type: 'lookup', reference: OBJECT },
  },
});
const ALL = [contactDef, accountDef, ...CHILDREN.map(childDef)];
/** Each related list's total, distinct per child so a badge names its own. */
const TOTAL: Record<string, number> = { os_27627_task: 7, os_27627_case: 4, os_27627_deal: 9, os_27627_event: 2 };

interface Held { wave: number; method: string; path: string; body: any; released: boolean; release: () => void }

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', ...headers } });

/** The page payload the route answers for `body`, for record `id`. */
function pageAnswer(id: string, body: any) {
  return {
    success: true,
    data: {
      object: OBJECT,
      id,
      record: { id, name: `Contact ${id}`, email: 'a@b.c', account: 'a1' },
      related: (body.related ?? []).map((r: any) => ({
        object: r.object,
        field: r.field,
        total: TOTAL[r.object] ?? 0,
        records: Array.from({ length: Math.min(r.top, TOTAL[r.object] ?? 0) }, (_, i) => ({ id: `${r.object}-${i}`, name: `${r.object} ${i}`, status: 'open' })),
      })),
      ...(body.fieldAccess ? { fieldAccess: { object: OBJECT, recordId: id, readable: ['name', 'email', 'account'], editable: ['name', 'email'], writable: true } } : {}),
      ...(body.explain ? { explain: Object.fromEntries(body.explain.map((op: string) => [op, { allowed: true, record: { recordId: id, visible: true } }])) } : {}),
      ...(body.approvals ? { approvals: { requests: [], lock: { locked: false } } } : {}),
    },
  };
}

const APP = 'demo';
const BUNDLE = `/api/v1/meta/app/${APP}/bundle`;

/** The bundle carries its per-caller validator, as the route serves a bundle it may be kept by. */
const BUNDLE_HEADERS = { ETag: 'W/"demo-bundle-1"', 'Cache-Control': 'private, no-cache' };

function answerFor(h: Held): unknown {
  if (h.path === BUNDLE) {
    const env = (type: string, item: { name: string }) => ({ type, name: item.name, item });
    return { app: env('app', { name: APP }), objects: ALL.map((o) => env('object', o)), views: [], pages: [], dashboards: [] };
  }
  const meta = /\/api\/v1\/meta\/object\/([^/?]+)/.exec(h.path);
  if (meta) return { success: true, data: ALL.find((o) => o.name === meta[1]) ?? null };
  const page = /\/api\/v1\/data\/[^/?]+\/([^/?]+)\/page$/.exec(h.path);
  if (page) return pageAnswer(page[1], h.body);
  // The record read of an adapter without the payload (`findOne`).
  const one = new RegExp(`/api/v1/data/${OBJECT}\\?.*\\["id","=","([^"]+)"\\]`).exec(h.path);
  if (one) return { success: true, data: { records: [{ id: one[1], name: `Contact ${one[1]}`, email: 'a@b.c', account: 'a1' }], total: 1 } };
  return { success: true, data: { records: [], total: 0 } };
}

function heldTransport() {
  const held: Held[] = [];
  const state = { wave: 1 };
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = decodeURIComponent(url.replace(BASE, ''));
    if (path.endsWith('/api/v1/discovery')) return Promise.resolve(json({ success: true, data: { capabilities: {}, routes: {} } }));
    return new Promise<Response>((resolve) => {
      const h: Held = {
        wave: state.wave, method, path,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
        released: false,
        release: () => { if (h.released) return; h.released = true; resolve(json(answerFor(h), h.path === BUNDLE ? BUNDLE_HEADERS : {})); },
      };
      held.push(h);
    });
  });
  return { fetch, held, state };
}

async function idle() {
  await act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
}
async function runWaves(held: Held[], state: { wave: number }) {
  await idle();
  for (let round = 0; round < 12; round++) {
    const pending = held.filter((h) => !h.released);
    if (pending.length === 0) return;
    state.wave += 1;
    await act(async () => { for (const h of pending) h.release(); await new Promise((r) => setTimeout(r, 0)); });
    await idle();
  }
}

const isMeta = (h: Held) => h.path.startsWith('/api/v1/meta/');
const isPage = (h: Held) => h.method === 'POST' && /\/api\/v1\/data\/[^/?]+\/[^/?]+\/page$/.test(h.path);
/** The 动态 stream's own reads (objectstack#27524): its sources, not the page's parts. */
const STREAM_SOURCES = ['sys_comment', 'sys_activity', 'sys_user'];
const isStreamRead = (h: Held) => h.method === 'GET' && STREAM_SOURCES.some((o) => h.path.startsWith(`/api/v1/data/${o}?`));
/** A stream read as `<object> <record>`, or `<object>` for the mention list, which names no record. */
const streamRead = (h: Held) => {
  const object = /\/api\/v1\/data\/([^/?]+)\?/.exec(h.path)![1];
  const rec = new RegExp(`${OBJECT}:([^"]+)"|"record_id","=","([^"]+)"`).exec(h.path);
  return rec ? `${object} ${rec[1] ?? rec[2]}` : object;
};
const streamReads = (held: Held[]) => held.filter(isStreamRead).map(streamRead).sort();
const dataRequests = (held: Held[]) => held.filter((h) => !isMeta(h) && !isStreamRead(h));

beforeEach(() => {
  cleanup();
  __clearRecordEditableCache();
  __resetRecordApprovalsStore();
  RelatedCountStore._reset();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function boot() {
  const { fetch, held, state } = heldTransport();
  vi.stubGlobal('fetch', fetch);
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  const metadata = {
    objects: ALL, pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  const view = (rec: string, upcoming: string | readonly string[] | null, embedded: boolean) => (
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/record/${rec}`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDrawerUpcomingContext.Provider value={[upcoming ?? []].flat().map((recordId) => ({ objectName: OBJECT, recordId }))}>
            <RecordDetailView dataSource={ds as never} objects={ALL as never} onEdit={() => {}} objectNameOverride={OBJECT} recordIdOverride={rec} embedded={embedded} />
          </RecordDrawerUpcomingContext.Provider>
        </MetadataCtx.Provider>
      </MemoryRouter>
    </React.StrictMode>
  );
  const open = (rec: string, upcoming: string | readonly string[] | null = null, embedded = false) => {
    const mounted = render(view(rec, upcoming, embedded));
    // The pane swaps the record in place (`recordDrawerStack`'s level key):
    // a step or a row click re-renders the same view with the next id.
    const step = (next: string, nextUpcoming: string | readonly string[] | null = null) =>
      mounted.rerender(view(next, nextUpcoming, embedded));
    return Object.assign(mounted, { step });
  };
  return { held, state, open, ds };
}

describe('objectstack#27627 — one request opens a record page', () => {
  it('a cold open sends one page request, no count probe and no separate part read, in one wave', async () => {
    const { held, state, open } = await boot();
    open('c1');
    await runWaves(held, state);

    const data = dataRequests(held);
    expect(data.map((h) => `${h.method} ${h.path}`)).toEqual([`POST /api/v1/data/${OBJECT}/c1/page`]);
    expect(held.filter((h) => /[?&](\$?top)=1\b/.test(h.path))).toEqual([]);
    // Every DATA request goes out in the first wave. With no app entered there
    // is no metadata bundle, so the object definitions the blocks read
    // (`/meta/object/…`) are read by name beside it; with one, see below.
    expect(data.every((h) => h.wave === 1)).toBe(true);

    // The request names what the page draws: its four related lists, the
    // header's verdicts, the field projection and the approval state.
    const [page] = data;
    expect(page.body.related.map((r: any) => [r.object, r.field])).toEqual(
      expect.arrayContaining(CHILDREN.map((c) => [c, 'contact'])),
    );
    expect(page.body.related).toHaveLength(CHILDREN.length);
    expect(page.body).toMatchObject({ explain: ['update', 'delete'], approvals: true, expand: ['account'] });

    // Every badge's total is the payload's.
    for (const c of CHILDREN) expect(RelatedCountStore.get(c, 'contact', 'c1')).toBe(TOTAL[c]);

    // The 动态 panel's own reads go out beside the page request, in its wave.
    expect(streamReads(held)).toEqual(['sys_activity c1', 'sys_comment c1', 'sys_user']);
    expect(held.filter(isStreamRead).every((h) => h.wave === 1)).toBe(true);
  });

  it('a warm open of another record sends one page request too', async () => {
    const { held, state, open } = await boot();
    const first = open('c1');
    await runWaves(held, state);
    first.unmount();
    held.length = 0;
    state.wave = 1;
    open('c2');
    await runWaves(held, state);
    expect(dataRequests(held).map((h) => `${h.method} ${h.path}`)).toEqual([`POST /api/v1/data/${OBJECT}/c2/page`]);
    expect(held.filter(isMeta)).toEqual([]);
    expect(streamReads(held)).toEqual(['sys_activity c2', 'sys_comment c2', 'sys_user']);
  });

  it("asks the record a drawer step shows next ahead, so stepping to it sends nothing", async () => {
    const { held, state, open } = await boot();
    const first = open('c1', 'c2');
    await runWaves(held, state);
    const pages = held.filter(isPage).map((h) => h.path);
    expect(pages).toEqual([
      `/api/v1/data/${OBJECT}/c1/page`,
      `/api/v1/data/${OBJECT}/c2/page`,
    ]);
    const asked = held.filter(isPage).map((h) => JSON.stringify(h.body));
    expect(new Set(asked).size).toBe(1);
    first.unmount();
    held.length = 0;
    open('c2', 'c3');
    await runWaves(held, state);
    // The step's own page is the prefetched answer; only the next one is asked.
    expect(held.filter(isPage).map((h) => h.path)).toEqual([`/api/v1/data/${OBJECT}/c3/page`]);
    expect(dataRequests(held).filter((h) => !isPage(h))).toEqual([]);
    // What the step does read is its 动态 stream, the payload's to answer no part of.
    expect(streamReads(held)).toEqual(['sys_activity c2', 'sys_comment c2', 'sys_user']);
  });
  // Merge resolution with objectstack#27056 (#27636): in a drawer, that card
  // warms the next record's related counts; the payload's prefetch carries
  // them, so only one of the two runs.
  const countProbesFor = (held: Held[], rec: string) =>
    held.filter((h) => h.method === 'GET' && CHILDREN.some((c) => h.path.startsWith(`/api/v1/data/${c}?`)) && h.path.includes(`"contact","=","${rec}"`));

  it('in a drawer, an adapter that answers the payload asks the next record once, as a page, and sends no count warm-up', async () => {
    const { held, state, open } = await boot();
    open('c1', 'c2', true);
    await runWaves(held, state);
    expect(held.filter(isPage).map((h) => h.path)).toEqual([
      `/api/v1/data/${OBJECT}/c1/page`,
      `/api/v1/data/${OBJECT}/c2/page`,
    ]);
    expect(countProbesFor(held, 'c2')).toEqual([]);
  });

  // Record pane v4 (objectstack#27545): the split pane beside the list and the
  // drawer draw the same embedded view, now handed BOTH neighbours, and a step,
  // ↑ ↓ or a click on another row swaps the record in place (maximize only
  // restyles the pane). Each neighbour is asked once, as a page, and the swap
  // to either one sends nothing for the record it opens.
  it('in the v4 pane, both neighbours are asked ahead as pages, and an in-place step to either opens from that answer', async () => {
    const { held, state, open } = await boot();
    const pane = open('c2', ['c3', 'c1'], true);
    await runWaves(held, state);
    expect(held.filter(isPage).map((h) => h.path)).toEqual([
      `/api/v1/data/${OBJECT}/c2/page`,
      `/api/v1/data/${OBJECT}/c3/page`,
      `/api/v1/data/${OBJECT}/c1/page`,
    ]);
    expect(countProbesFor(held, 'c3')).toEqual([]);
    expect(countProbesFor(held, 'c1')).toEqual([]);

    // ↑ to c1 (or a click on its row): its page is the prefetched answer. The
    // one neighbour asked is the record just left, whose answer the open took.
    held.length = 0;
    await act(async () => { pane.step('c1', ['c0', 'c2']); });
    await runWaves(held, state);
    expect(held.filter(isPage).map((h) => h.path)).toEqual([
      `/api/v1/data/${OBJECT}/c0/page`,
      `/api/v1/data/${OBJECT}/c2/page`,
    ]);
    expect(dataRequests(held).filter((h) => !isPage(h))).toEqual([]);
    // The swapped-in record's 动态 stream; the mention list is the view's, read once.
    expect(streamReads(held)).toEqual(['sys_activity c1', 'sys_comment c1']);
  });

  it('a cold session, entering the app as the record opens, adds one bundle request and no by-name metadata read', async () => {
    const { held, state, open, ds } = await boot();
    void ds.loadAppBundle(APP);
    open('c1');
    await runWaves(held, state);
    expect(held.filter(isMeta).map((h) => `${h.method} ${h.path}`)).toEqual([`GET ${BUNDLE}`]);
    expect(dataRequests(held).map((h) => `${h.method} ${h.path}`)).toEqual([`POST /api/v1/data/${OBJECT}/c1/page`]);
    // Both go out in the first wave, beside the 动态 stream's own reads: nothing waits on the other.
    expect(streamReads(held)).toEqual(['sys_activity c1', 'sys_comment c1', 'sys_user']);
    expect(held.every((h) => h.wave === 1)).toBe(true);
  });

  it('a warm session opens a record with one page request and zero metadata requests', async () => {
    const { held, state, open, ds } = await boot();
    // The app was entered earlier in the session; no record was opened yet,
    // so no object definition was ever read by name.
    const entered = ds.loadAppBundle(APP);
    await runWaves(held, state);
    await entered;
    held.length = 0;
    state.wave = 1;
    open('c1');
    await runWaves(held, state);
    expect(held.filter(isMeta)).toEqual([]);
    expect(dataRequests(held).map((h) => `${h.method} ${h.path}`)).toEqual([`POST /api/v1/data/${OBJECT}/c1/page`]);
    // What else goes out is the 动态 stream's own data reads (objectstack#27524), no metadata.
    expect(streamReads(held)).toEqual(['sys_activity c1', 'sys_comment c1', 'sys_user']);
  });

  it('in a drawer, an adapter without the payload keeps the count warm-up: each of the next record\'s counts is asked once', async () => {
    const { held, state, open, ds } = await boot();
    Object.assign(ds, { getRecordPage: undefined, prefetchRecordPage: undefined });
    open('c1', 'c2', true);
    await runWaves(held, state);
    expect(held.filter(isPage)).toEqual([]);
    const warm = countProbesFor(held, 'c2').map((h) => /\/api\/v1\/data\/([^/?]+)/.exec(h.path)![1]).sort();
    expect(warm).toEqual([...CHILDREN].sort());
  });
});
