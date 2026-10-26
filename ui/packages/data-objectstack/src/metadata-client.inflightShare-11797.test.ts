/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11797 — concurrent identical metadata GETs share one request.
 *
 * Opening a Studio package mounts several readers that ask the metadata API
 * the same question at once, each through its OWN `MetadataClient`: the
 * console mints one per component (`useMetadataClient`), all on one shared
 * authenticated fetch. So the clients below are two instances on one
 * transport, as the console builds them, not one instance asked twice.
 *
 * Counted on the wire: the transport holds every request open until the test
 * answers it, so "at once" means the first request is genuinely pending when
 * the second call is made.
 *
 * The rules pinned besides the one-request count:
 *   - the key is method + URL + headers + transport — a different scope, a
 *     draft-preview client or another transport is a different question;
 *   - every caller, the first one included, gets an answer no other caller
 *     holds;
 *   - the entry goes when the read settles, so a later call asks again (no
 *     reuse window);
 *   - a failure reaches every caller that shared it and is not remembered;
 *   - a write through the transport drops pending reads, so a read asked
 *     after a save or a publish is never answered by one sent before it.
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
          url: String(input),
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

function clientsOn(fetch: typeof globalThis.fetch) {
  return [
    new MetadataClient({ baseUrl: BASE, fetch }),
    new MetadataClient({ baseUrl: BASE, fetch }),
  ] as const;
}

describe('MetadataClient — concurrent identical GETs share one request (objectui#11797)', () => {
  it('two clients on one transport asking the same three questions send three requests, not six', async () => {
    const { fetch, gets } = heldTransport();
    const [a, b] = clientsOn(fetch);

    const calls = [
      a.listDrafts({ packageId: 'app.crm' }),
      b.listDrafts({ packageId: 'app.crm' }),
      a.list('object', { packageId: 'app.crm' }),
      b.list('object', { packageId: 'app.crm' }),
      a.get('object', 'crm_account'),
      b.get('object', 'crm_account'),
    ];
    await drain();

    expect(gets().map((r) => r.url.replace(BASE, ''))).toEqual([
      '/api/v1/meta/_drafts?packageId=app.crm',
      '/api/v1/meta/object?package=app.crm',
      '/api/v1/meta/object/crm_account',
    ]);

    gets()[0].respond(200, { drafts: [{ type: 'object', name: 'crm_account', packageId: 'app.crm' }] });
    gets()[1].respond(200, { items: [{ name: 'crm_account' }] });
    gets()[2].respond(200, { type: 'object', name: 'crm_account', item: { name: 'crm_account', label: 'Account' } });
    const [draftsA, draftsB, listA, listB, itemA, itemB] = await Promise.all(calls);

    expect(draftsB).toEqual(draftsA);
    expect(listB).toEqual(listA);
    expect(itemA).toEqual({ name: 'crm_account', label: 'Account' });
    expect(itemB).toEqual(itemA);
  });

  it('gives every caller its own copy, so one caller editing its answer leaves the other alone', async () => {
    const { fetch, gets } = heldTransport();
    const [a, b] = clientsOn(fetch);
    const first = a.get<{ fields: Record<string, unknown> }>('object', 'crm_account');
    const second = b.get<{ fields: Record<string, unknown> }>('object', 'crm_account');
    await drain();
    expect(gets()).toHaveLength(1);
    gets()[0].respond(200, { type: 'object', name: 'crm_account', item: { fields: { name: { type: 'text' } } } });

    const [mine, theirs] = await Promise.all([first, second]);
    expect(mine).not.toBe(theirs);
    mine!.fields.extra = { type: 'number' };
    expect(theirs!.fields).toEqual({ name: { type: 'text' } });
  });

  it.each([
    ['in the same tick', false],
    ['once the first request is already on the wire', true],
  ])(
    'the first caller editing its answer in its own continuation leaves a caller that joined %s with the answer as served',
    async (_when, joinLater) => {
      const { fetch, gets } = heldTransport();
      const [a, b] = clientsOn(fetch);
      const first = a.list<string>('object').then((mine) => {
        mine.push('added-by-first');
        mine.sort();
        return mine;
      });
      if (joinLater) await drain();
      const second = b.list<string>('object');
      await drain();
      expect(gets()).toHaveLength(1);
      gets()[0].respond(200, ['zeta', 'alpha']);

      expect(await first).toEqual(['added-by-first', 'alpha', 'zeta']);
      expect(await second).toEqual(['zeta', 'alpha']);
    },
  );

  /**
   * The rule under the public methods, checked where it cannot lean on them:
   * no caller of `shareRead` is handed the value the others are copied from.
   * Every public method reaches its caller through an `async` hop, which
   * happens to queue the caller's code behind every joiner's copy; a reader
   * that awaits the shared read with no hop in between must be just as safe.
   */
  it('no caller of the private `shareRead` holds the value another caller is copied from', async () => {
    type Sharing = { shareRead<R>(reader: string, url: string, read: () => Promise<R>): Promise<R> };
    const { fetch } = heldTransport();
    const [a, b] = clientsOn(fetch);
    let serve!: (value: string[]) => void;
    const read = () => new Promise<string[]>((resolve) => (serve = resolve));
    const shareOn = (c: MetadataClient) => (c as unknown as Sharing).shareRead.bind(c);

    const first = shareOn(a)('probe', `${BASE}/probe`, read).then((mine) => {
      mine.push('added-by-first');
      return mine;
    });
    const second = shareOn(b)('probe', `${BASE}/probe`, read);
    serve(['as-served']);

    expect(await first).toEqual(['as-served', 'added-by-first']);
    expect(await second).toEqual(['as-served']);
  });

  it('keeps different questions apart: scope, draft preview, headers and transport are part of the key', async () => {
    const { fetch, gets } = heldTransport();
    const [a] = clientsOn(fetch);
    const preview = a.withPreviewDrafts(true);
    const scoped = a.withEnvironment('env_1');
    const otherHeaders = new MetadataClient({ baseUrl: BASE, fetch, headers: { Authorization: 'Bearer other' } });
    const other = heldTransport();
    const otherTransport = new MetadataClient({ baseUrl: BASE, fetch: other.fetch });

    void a.list('object');
    void preview.list('object');
    void scoped.list('object');
    void otherHeaders.list('object');
    void otherTransport.list('object');
    void a.listDrafts({ packageId: 'app.crm' });
    void a.listDrafts({ packageId: 'app.hr' });
    await drain();

    expect(gets()).toHaveLength(6);
    expect(other.gets()).toHaveLength(1);
  });

  it('is not a response cache: once the read settles, the next call asks the server again', async () => {
    const { fetch, gets } = heldTransport();
    const [a, b] = clientsOn(fetch);
    const first = a.list('object');
    await drain();
    gets()[0].respond(200, [{ name: 'crm_account' }]);
    await first;

    const second = b.list('object');
    await drain();
    expect(gets()).toHaveLength(2);
    gets()[1].respond(200, [{ name: 'crm_account' }, { name: 'crm_contact' }]);
    expect(await second).toHaveLength(2);
  });

  it('rejects every caller that shared a failed read, and does not remember the failure', async () => {
    const { fetch, gets } = heldTransport();
    const [a, b] = clientsOn(fetch);
    const first = a.listDrafts({ packageId: 'app.crm' });
    const second = b.listDrafts({ packageId: 'app.crm' });
    await drain();
    expect(gets()).toHaveLength(1);
    gets()[0].respond(503, { success: false, error: { code: 'SERVICE_UNAVAILABLE', message: 'try again' } });

    await expect(first).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
    await expect(second).rejects.toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });

    const retry = a.listDrafts({ packageId: 'app.crm' });
    await drain();
    expect(gets()).toHaveLength(2);
    gets()[1].respond(200, []);
    await expect(retry).resolves.toEqual([]);
  });

  it('rejects every caller that shared a read the transport could not send, and asks again after', async () => {
    const { fetch, gets } = heldTransport();
    const [a, b] = clientsOn(fetch);
    const first = a.get('object', 'crm_account');
    const second = b.get('object', 'crm_account');
    await drain();
    gets()[0].fail(new TypeError('Failed to fetch'));
    await expect(first).rejects.toThrow('Failed to fetch');
    await expect(second).rejects.toThrow('Failed to fetch');

    void a.get('object', 'crm_account');
    await drain();
    expect(gets()).toHaveLength(2);
  });

  it.each([
    ['a draft save', (c: MetadataClient) => c.save('view', 'crm_account_list', { name: 'crm_account_list' }, { mode: 'draft' })],
    ['a package publish', (c: MetadataClient) => c.publishPackageDrafts('app.crm')],
    ['a single-item draft publish', (c: MetadataClient) => c.publishDraft('object', 'crm_account')],
    ['a reset', (c: MetadataClient) => c.reset('object', 'crm_account', { state: 'draft' })],
  ])('after %s, a read goes to the server even while a read from before it is still pending', async (_label, write) => {
    const { fetch, held, gets } = heldTransport();
    const [a, b] = clientsOn(fetch);

    const before = a.listDrafts({ packageId: 'app.crm' });
    await drain();
    expect(gets()).toHaveLength(1);

    const writing = write(b);
    await drain();
    const sent = held.find((r) => r.method !== 'GET')!;
    sent.respond(200, {});
    await writing;

    const after = a.listDrafts({ packageId: 'app.crm' });
    await drain();
    expect(gets()).toHaveLength(2);

    // The read asked before the write still answers the caller that held it.
    gets()[0].respond(200, [{ type: 'object', name: 'crm_account', packageId: 'app.crm' }]);
    gets()[1].respond(200, []);
    await expect(before).resolves.toHaveLength(1);
    await expect(after).resolves.toEqual([]);
  });

  it('a read asked after a write that failed also goes to the server', async () => {
    const { fetch, held, gets } = heldTransport();
    const [a, b] = clientsOn(fetch);
    void a.list('object');
    await drain();
    const writing = b.save('view', 'crm_account_list', { name: 'crm_account_list' });
    await drain();
    held.find((r) => r.method === 'PUT')!.respond(409, { success: false, error: { code: 'CONFLICT', message: 'stale' } });
    await expect(writing).rejects.toMatchObject({ status: 409 });

    void a.list('object');
    await drain();
    expect(gets()).toHaveLength(2);
  });
});
