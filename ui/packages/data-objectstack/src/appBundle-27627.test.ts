/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27627 — the console loads an app's metadata bundle once, and
 * answers the by-name reads of the items it holds from it.
 *
 * Measured through the REAL adapter and the REAL client over a transport that
 * holds every request open until the test answers it, so a read made while the
 * bundle is on the wire is genuinely made before it lands.
 *
 * Pinned:
 *  - a read made while the bundle loads waits for it, and a bundled item is
 *    never asked by name (objects, views, pages, dashboards, the app);
 *  - an item the bundle does not hold, and a call with options, keep the
 *    by-name route;
 *  - re-entering sends `If-None-Match`, and a `304` keeps what is held;
 *  - an invalidation naming a bundled item, and any metadata write through the
 *    client, make the next bundled read ask the bundle again first;
 *  - a bundled object carries its envelope's `sortability`, as its by-name read does;
 *  - a cache clear, or a bundle served with no validator, downloads it again;
 *  - a refused bundle leaves every read to its by-name route.
 */
import { describe, it, expect, vi } from 'vitest';
import { readObjectSortability } from '@object-ui/core';
import { ObjectStackAdapter } from './index';

const BASE = 'http://test.local';
const APP = 'b27627_app';
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

const contact = { name: 'b27627_contact', label: 'Contact', fields: { name: { type: 'text', label: 'Name' } } };
const task = { name: 'b27627_task', label: 'Task', fields: { contact: { type: 'lookup', reference: 'b27627_contact' } } };

/** The bundle's answer: bare, every member the envelope its by-name read answers. */
function bundle(label = 'Contact') {
  const env = (type: string, item: { name: string }, extra: Record<string, unknown> = {}) => ({ type, name: item.name, item, ...extra });
  return {
    app: env('app', { name: APP, label: 'App' }),
    objects: [
      env('object', { ...contact, label }, { sortability: { fields: { name: { sortable: true } } } }),
      env('object', task),
    ],
    views: [env('view', { name: 'b27627_contact.all', object: 'b27627_contact', label: 'All' } as { name: string })],
    pages: [env('page', { name: 'b27627_contact_page', label: 'Contact page' } as { name: string })],
    dashboards: [env('dashboard', { name: 'b27627_home', label: 'Home' } as { name: string })],
  };
}

const metaRequests = (held: HeldRequest[]) => held.filter((h) => h.path.startsWith('/api/v1/meta/'));

describe('objectstack#27627 — the app metadata bundle', () => {
  it('a read made while the bundle loads waits for it, and nothing it holds is asked by name', async () => {
    const { ds, held } = await heldAdapter();
    const entered = ds.loadAppBundle(APP);
    const reads = Promise.all([
      ds.getObjectSchema('b27627_contact'),
      ds.getObjectSchema('b27627_task'),
      ds.getView('b27627_contact', 'b27627_contact.all'),
      ds.getPage('b27627_contact_page'),
      ds.getApp(APP),
      ds.getClient().meta.getItem('dashboard', 'b27627_home'),
    ]);
    await drain();
    expect(held.map((h) => `${h.method} ${h.path}`)).toEqual([`GET ${BUNDLE_PATH}`]);
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await entered;
    const [schema, child, view, page, app, dashboard] = await reads;
    expect((schema as any).label).toBe('Contact');
    expect((child as any).name).toBe('b27627_task');
    expect((view as any).label).toBe('All');
    expect((page as any).label).toBe('Contact page');
    expect((app as any).label).toBe('App');
    expect((dashboard as any).item.label).toBe('Home');
    await drain();
    expect(held).toHaveLength(1);
  });

  it('an item the bundle does not hold, and a read with options, keep the by-name route', async () => {
    const { ds, held } = await heldAdapter();
    const entered = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await entered;

    const outside = ds.getObjectSchema('sys_user');
    const scoped = ds.getClient().meta.getItem('page', 'b27627_contact_page', { packageId: 'p1' });
    await drain();
    const byPath = (path: string) => held.find((h) => h.path === path)!;
    expect(held.slice(1).map((h) => h.path).sort()).toEqual([
      '/api/v1/meta/object/sys_user',
      '/api/v1/meta/page/b27627_contact_page?package=p1',
    ]);
    byPath('/api/v1/meta/object/sys_user').respond(200, { success: true, data: { item: { name: 'sys_user', label: 'User' } } });
    byPath('/api/v1/meta/page/b27627_contact_page?package=p1').respond(200, { success: true, data: { item: { name: 'b27627_contact_page' } } });
    expect((await outside as any).label).toBe('User');
    await scoped;
  });

  it('re-entering sends If-None-Match, and a 304 keeps what is held', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.loadAppBundle(APP);
    await drain();
    expect(held[0].headers['if-none-match']).toBeUndefined();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await first;

    const again = ds.loadAppBundle(APP);
    await drain();
    expect(held).toHaveLength(2);
    expect(held[1].path).toBe(BUNDLE_PATH);
    expect(held[1].headers['if-none-match']).toBe('W/"b1"');
    held[1].respond(304);
    await again;

    expect((await ds.getObjectSchema('b27627_contact') as any).label).toBe('Contact');
    await drain();
    expect(held).toHaveLength(2);
  });

  it('an invalidation naming a bundled item asks the bundle again, not the item by name', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await first;
    expect((await ds.getObjectSchema('b27627_contact') as any).label).toBe('Contact');

    ds.invalidateCache('b27627_contact');
    const reread = ds.getObjectSchema('b27627_contact');
    await drain();
    expect(metaRequests(held).map((h) => h.path)).toEqual([BUNDLE_PATH, BUNDLE_PATH]);
    expect(held[1].headers['if-none-match']).toBe('W/"b1"');
    held[1].respond(200, bundle('Person'), { ETag: 'W/"b2"' });
    expect((await reread as any).label).toBe('Person');
  });

  it('an invalidation naming nothing the bundle holds leaves it current', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await first;
    ds.invalidateCache('view-overrides:b27627_contact');
    ds.invalidateCache('sys_user');
    await ds.getView('b27627_contact', 'b27627_contact.all');
    await drain();
    expect(held).toHaveLength(1);
  });

  it('a metadata write through the client makes the next bundled read ask the bundle again', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await first;

    const save = ds.getClient().meta.saveItem('page', 'b27627_contact_page', { name: 'b27627_contact_page', label: 'Renamed' });
    await drain();
    held[1].respond(200, { success: true, data: { name: 'b27627_contact_page' } });
    await save;

    const reread = ds.getClient().meta.getItem('page', 'b27627_contact_page');
    await drain();
    expect(held[2].path).toBe(BUNDLE_PATH);
    expect(held[2].headers['if-none-match']).toBe('W/"b1"');
    const next = bundle();
    next.pages = [{ type: 'page', name: 'b27627_contact_page', item: { name: 'b27627_contact_page', label: 'Renamed' } }];
    held[2].respond(200, next, { ETag: 'W/"b2"' });
    expect((await reread as any).item.label).toBe('Renamed');
  });

  it('a cache clear downloads the bundle again, with no validator', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: 'W/"b1"' });
    await first;

    ds.clearCache();
    const reread = ds.getObjectSchema('b27627_contact');
    await drain();
    expect(metaRequests(held).map((h) => h.path)).toEqual([BUNDLE_PATH, BUNDLE_PATH]);
    expect(held[1].headers['if-none-match']).toBeUndefined();
    held[1].respond(200, bundle('Kontakt'), { ETag: 'W/"b3"' });
    expect((await reread as any).label).toBe('Kontakt');
  });

  it("a bundled object carries its envelope's sortability, as its by-name read does", async () => {
    const { ds, held } = await heldAdapter();
    const entered = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { ETag: '"b1"' });
    await entered;
    expect(readObjectSortability(await ds.getObjectSchema('b27627_contact'))?.fields.name?.sortable).toBe(true);
  });

  it('a bundle served with no validator (`no-store`) is downloaded again, never revalidated', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.loadAppBundle(APP);
    await drain();
    held[0].respond(200, bundle(), { 'Cache-Control': 'private, no-store' });
    await first;
    const again = ds.loadAppBundle(APP);
    await drain();
    expect(held[1].path).toBe(BUNDLE_PATH);
    expect(held[1].headers['if-none-match']).toBeUndefined();
    held[1].respond(200, bundle());
    await again;
  });

  it('a refused bundle leaves every read to its by-name route', async () => {
    const { ds, held } = await heldAdapter();
    const first = ds.loadAppBundle(APP);
    await drain();
    // An app the caller cannot read refuses the whole bundle with the app read's own answer.
    held[0].respond(403, { success: false, error: { code: 'PERMISSION_DENIED', message: 'Not your app' } });
    await first;

    const read = ds.getObjectSchema('b27627_contact');
    await drain();
    expect(held[1].path).toBe('/api/v1/meta/object/b27627_contact');
    held[1].respond(200, { success: true, data: { item: contact } });
    expect((await read as any).name).toBe('b27627_contact');
  });
});
