/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11799 — `getDraft()` asks the drafts ledger before the item.
 *
 * `GET /meta/:type/:name?state=draft` answers 404 when there is no draft, and
 * Studio reads it for every item it opens, so the console logged one error per
 * opened item for an expected answer. The client now reads the pending-drafts
 * ledger (`GET /meta/_drafts`, through the shared read objectui#11797 made) and
 * sends the item read only when the ledger lists the name.
 *
 * Pinned, counted on the wire:
 *   - no draft: the ledger read, and no item read;
 *   - a draft: one item read, whose envelope comes back as before;
 *   - a draft saved a moment ago is found: a ledger read sent before the save
 *     is not joined by a question asked after it lands;
 *   - an unreadable ledger is unknown, not empty: the item read is sent;
 *   - the ledger is read whole, so a row the item read would serve but a
 *     filtered ledger would not list still leads to the item read;
 *   - questions asked together share one ledger read.
 */
import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

interface HeldRequest {
  method: string;
  url: string;
  respond: (status: number, body: unknown) => void;
  fail: (error: Error) => void;
}

/** A transport whose every request waits until the test answers it. */
function heldTransport() {
  const held: HeldRequest[] = [];
  const fetch = vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        held.push({
          method: (init?.method ?? 'GET').toUpperCase(),
          url: String(input).replace(BASE, ''),
          respond: (status, body) =>
            resolve(
              new Response(JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json' },
              }),
            ),
          fail: reject,
        });
      }),
  ) as unknown as typeof globalThis.fetch;
  const gets = () => held.filter((r) => r.method === 'GET');
  return { fetch, held, gets };
}

/** Let every queued continuation run, so a call that WOULD fetch has fetched. */
async function drain() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const BASE = 'http://test.local';
const LEDGER = '/api/v1/meta/_drafts';
const HOME_DRAFT = '/api/v1/meta/page/home?state=draft';
const ENVELOPE = { type: 'page', name: 'home', item: { name: 'home', label: 'Home', _draft: true } };
const ledgerOf = (...rows: Array<{ type: string; name: string; packageId?: string | null }>) => ({
  drafts: rows.map((r) => ({ packageId: null, ...r })),
});

const isItemDraftRead = (url: string) => url.includes('state=draft');

describe('MetadataClient.getDraft — the drafts ledger answers first (objectui#11799)', () => {
  it('an item with no draft: the ledger is read, and no ?state=draft request is sent', async () => {
    const { fetch, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    const draft = c.getDraft('page', 'home');
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER]);
    gets()[0].respond(200, ledgerOf({ type: 'page', name: 'other' }));

    await expect(draft).resolves.toBeNull();
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER]);
    expect(gets().some((r) => isItemDraftRead(r.url))).toBe(false);
  });

  it('control: an item the ledger lists gets exactly one ?state=draft request, and its envelope', async () => {
    const { fetch, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    const draft = c.getDraft('page', 'home');
    await drain();
    gets()[0].respond(200, ledgerOf({ type: 'page', name: 'home' }));
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER, HOME_DRAFT]);
    gets()[1].respond(200, ENVELOPE);

    await expect(draft).resolves.toEqual(ENVELOPE);
  });

  it('a draft saved a moment ago is found: a ledger read sent before the save is not joined after it lands', async () => {
    const { fetch, held, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    // Asked before the save: its ledger read is on the wire, still pending.
    const before = c.getDraft('page', 'home');
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER]);

    // The draft is saved, and the write lands while that ledger read is pending.
    const saved = c.save('page', 'home', { name: 'home', label: 'Home' }, { mode: 'draft' });
    await drain();
    const put = held.find((r) => r.method === 'PUT');
    expect(put?.url).toBe('/api/v1/meta/page/home?mode=draft');
    put!.respond(200, { type: 'page', name: 'home', state: 'draft' });
    await saved;

    // Asked after the save: a NEW ledger read, not the pending one.
    const after = c.getDraft('page', 'home');
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER, LEDGER]);

    // The pending read answers from before the save; the new one lists the draft.
    gets()[0].respond(200, ledgerOf());
    gets()[1].respond(200, ledgerOf({ type: 'page', name: 'home' }));
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER, LEDGER, HOME_DRAFT]);
    gets()[2].respond(200, ENVELOPE);

    await expect(before).resolves.toBeNull();
    await expect(after).resolves.toEqual(ENVELOPE);
  });

  it('control: with no write in between, a second question joins the pending ledger read', async () => {
    const { fetch, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    const first = c.getDraft('page', 'home');
    await drain();
    const second = c.getDraft('page', 'home');
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER]);

    gets()[0].respond(200, ledgerOf());
    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
  });

  it.each([
    ['403, a caller without an authoring capability', 403, { error: { code: 'FORBIDDEN', message: 'no' } }],
    ['501, a kernel without drafts', 501, { error: { code: 'NOT_IMPLEMENTED', message: 'no' } }],
  ])('an unreadable ledger (%s) is unknown, not empty: the item read is sent', async (_label, status, body) => {
    const { fetch, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    const draft = c.getDraft('page', 'home');
    await drain();
    gets()[0].respond(status, body);
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER, HOME_DRAFT]);
    gets()[1].respond(200, ENVELOPE);

    await expect(draft).resolves.toEqual(ENVELOPE);
  });

  it('a ledger the network never answered is unknown too: the item read is sent', async () => {
    const { fetch, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    const draft = c.getDraft('page', 'home');
    await drain();
    gets()[0].fail(new TypeError('Failed to fetch'));
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER, HOME_DRAFT]);
    gets()[1].respond(404, { error: { code: 'NO_DRAFT', message: 'none' } });

    await expect(draft).resolves.toBeNull();
  });

  it('the ledger is read whole: a package-less row and a row under the plural spelling still lead to the item read', async () => {
    const { fetch, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    // `?state=draft&package=` serves the package's row OR the package-less one,
    // and either spelling of the type; a ledger filtered by package or type
    // would not list these two.
    const scoped = c.getDraft('page', 'home', { packageId: 'com.acme.app' });
    const residue = c.getDraft('object', 'acme_account');
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER]);
    gets()[0].respond(
      200,
      ledgerOf({ type: 'page', name: 'home', packageId: null }, { type: 'objects', name: 'acme_account' }),
    );
    await drain();
    expect(gets().map((r) => r.url)).toEqual([
      LEDGER,
      '/api/v1/meta/page/home?state=draft&package=com.acme.app',
      '/api/v1/meta/object/acme_account?state=draft',
    ]);
    gets()[1].respond(200, ENVELOPE);
    gets()[2].respond(200, { type: 'object', name: 'acme_account', item: { name: 'acme_account' } });

    await expect(scoped).resolves.toEqual(ENVELOPE);
    await expect(residue).resolves.toEqual({ type: 'object', name: 'acme_account', item: { name: 'acme_account' } });
  });

  it('questions asked together share one ledger read, and only listed items are read', async () => {
    const { fetch, gets } = heldTransport();
    const c = new MetadataClient({ baseUrl: BASE, fetch });

    const answers = ['home', 'about', 'pricing'].map((name) => c.getDraft('page', name));
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER]);
    gets()[0].respond(200, ledgerOf({ type: 'page', name: 'about' }));
    await drain();
    expect(gets().map((r) => r.url)).toEqual([LEDGER, '/api/v1/meta/page/about?state=draft']);
    gets()[1].respond(200, { type: 'page', name: 'about', item: { name: 'about' } });

    await expect(Promise.all(answers)).resolves.toEqual([
      null,
      { type: 'page', name: 'about', item: { name: 'about' } },
      null,
    ]);
  });
});
