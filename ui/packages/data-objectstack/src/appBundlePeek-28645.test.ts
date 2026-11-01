/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28645 — `peekAppBundle` reads the active app bundle without
 * waiting, so a console reader that answers in render (a page route, a nav
 * label) can answer from it and read its list only for what it does not hold.
 *
 * Measured through the REAL adapter and the REAL client over a transport that
 * holds every request open until the test answers it.
 *
 * Pinned:
 *  - no app entered answers `none` and asks nothing;
 *  - the first load answers `pending`, its `settled` the one load, and `ready`
 *    with the items once it lands;
 *  - a bundle past its lifetime is asked again with `If-None-Match`, and the
 *    held items answer while that is on the wire;
 *  - an app with no bundle answers `ready` with nothing held;
 *  - a cache clear answers `pending` again until the new download lands.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

const BASE = 'http://test.local';
const APP = 'b28645_app';
const BUNDLE_PATH = `/api/v1/meta/app/${APP}/bundle`;

interface HeldRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  respond: (status: number, body?: unknown, headers?: Record<string, string>) => void;
}

function respondWith(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  if (status === 304) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function heldAdapter() {
  const held: HeldRequest[] = [];
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (url.endsWith('/api/v1/discovery')) {
      return Promise.resolve(respondWith(200, { success: true, data: { capabilities: {}, routes: {} } }));
    }
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((v, k) => { headers[k] = v; });
    return new Promise<Response>((resolve) => {
      held.push({
        method,
        path: decodeURIComponent(url.replace(BASE, '')),
        headers,
        respond: (status, body, h) => resolve(respondWith(status, body, h)),
      });
    });
  });
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch, autoReconnect: false });
  await ds.connect();
  return { ds, held };
}

async function drain() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

const contact = { name: 'b28645_contact', label: 'Contact', fields: { name: { type: 'text', label: 'Name' } } };
const task = { name: 'b28645_task', label: 'Task', fields: { contact: { type: 'lookup', reference: 'b28645_contact' } } };

/** The bundle's answer: bare, every member the envelope its by-name read answers. */
function bundle(label = 'Contact') {
  const env = (type: string, item: { name: string; [key: string]: unknown }, extra: Record<string, unknown> = {}) => ({ type, name: item.name, item, ...extra });
  return {
    app: env('app', { name: APP, label: 'App' }),
    objects: [
      env('object', { ...contact, label }, { sortability: { fields: { name: { sortable: true } } } }),
      env('object', task),
    ],
    views: [env('view', { name: 'b28645_contact.all', object: 'b28645_contact', label: 'All' })],
    pages: [env('page', { name: 'b28645_contact_page', label: 'Contact page' })],
    dashboards: [env('dashboard', { name: 'b28645_home', label: 'Home' })],
  };
}


describe('objectstack#28645 — peekAppBundle', () => {
  it('answers none before any app is entered, and asks nothing', async () => {
    const { ds, held } = await heldAdapter();
    expect(ds.peekAppBundle()).toEqual({ status: 'none' });
    await drain();
    expect(held).toHaveLength(0);
  });

  it('answers pending while the first load is on the wire, then ready with what it holds', async () => {
    const { ds, held } = await heldAdapter();
    const entered = ds.loadAppBundle(APP);
    const first = ds.peekAppBundle();
    expect(first.status).toBe('pending');
    const second = ds.peekAppBundle();
    // Two peeks of one load hand out the load's own promise.
    expect(second.status).toBe('pending');
    expect((second as { settled?: unknown }).settled).toBe((first as { settled?: unknown }).settled);
    await drain();
    expect(held.map((h) => h.path)).toEqual([BUNDLE_PATH]);
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await entered;
    const ready = ds.peekAppBundle();
    expect(ready.status).toBe('ready');
    if (ready.status !== 'ready') return;
    expect(ready.settled).toBeUndefined();
    expect((ready.items.get('page')?.get('b28645_contact_page')?.item as any).label).toBe('Contact page');
    expect(ready.items.get('view')?.has('b28645_contact.all')).toBe(true);
    expect(ready.items.get('object')?.has('b28645_task')).toBe(true);
    await drain();
    expect(held).toHaveLength(1);
  });

  it('past its lifetime it asks again with If-None-Match, answering from what it holds meanwhile', async () => {
    const { ds, held } = await heldAdapter();
    const entered = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await entered;
    // Every held bundle asks again before its next answer (as a metadata write does).
    ds.invalidateCache('b28645_contact');
    const revalidating = ds.peekAppBundle();
    expect(revalidating.status).toBe('ready');
    if (revalidating.status !== 'ready') return;
    expect(revalidating.settled).toBeInstanceOf(Promise);
    expect((revalidating.items.get('object')?.get('b28645_contact')?.item as any).label).toBe('Contact');
    await drain();
    expect(held.map((h) => h.path)).toEqual([BUNDLE_PATH, BUNDLE_PATH]);
    expect(held[1].headers['if-none-match']).toBe('W/"b1"');
    held[1].respond(200, bundle('Person'), { ETag: 'W/"b2"' });
    await revalidating.settled;
    const fresh = ds.peekAppBundle();
    expect(fresh.status === 'ready' && (fresh.items.get('object')?.get('b28645_contact')?.item as any).label).toBe('Person');
  });

  it('an app with no bundle answers ready with nothing held', async () => {
    const { ds, held } = await heldAdapter();
    const entered = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(404, { success: false, error: { code: 'NOT_FOUND', message: 'no' } });
    await entered;
    const peek = ds.peekAppBundle();
    expect(peek.status).toBe('ready');
    expect(peek.status === 'ready' && peek.items.size).toBe(0);
  });

  it('after a cache clear it answers pending until the new download lands', async () => {
    const { ds, held } = await heldAdapter();
    const entered = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await entered;
    ds.clearCache();
    const cleared = ds.peekAppBundle();
    expect(cleared.status).toBe('pending');
    await drain();
    expect(held).toHaveLength(2);
    expect(held[1].headers['if-none-match']).toBeUndefined();
    held[1].respond(200, bundle(), { ETag: 'W/"b2"' });
    if (cleared.status === 'pending') await cleared.settled;
    expect(ds.peekAppBundle().status).toBe('ready');
  });
});
