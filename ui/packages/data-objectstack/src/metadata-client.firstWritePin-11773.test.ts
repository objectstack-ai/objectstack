// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — the save options' two preconditions on the `/meta` PUT door
 * (ADR-0008): `ifMatch` → `If-Match: <version>`, `ifNoneMatch` → `If-None-Match: *`.
 *
 * The door refuses the pair `400` (`If-Match` needs a current row, `*` needs
 * none, so they can never both hold), measured on the published
 * `@objectstack/*` 18.0.0-next.0 server. The client refuses it first, before
 * any request, so a confused caller learns it at the call and not as a 400.
 *
 * The read half: `getDraft` hands the caller the envelope the draft read
 * served, `version` included — the token a draft save at the same address
 * pins with (`GetMetaItemResponseSchema`'s `version`).
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

interface Sent {
  url: string;
  method: string;
  headers: Headers;
}

function clientOver(answer: (url: string, init: RequestInit) => Response) {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers) });
    return answer(url, init ?? {});
  }) as unknown as typeof fetch;
  return { client: new MetadataClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl }), sent };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const receipt = { success: true, version: 'hmac-sha256:aa', seq: 1, state: 'draft', message: 'Saved' };

describe('MetadataClient.save — the first-write pin (objectui#11773)', () => {
  it('sends ifNoneMatch as `If-None-Match: *`, and no If-Match', async () => {
    const { client, sent } = clientOver(() => json(200, receipt));
    await client.save('object', 'acme_note', { name: 'acme_note' }, { mode: 'draft', packageId: 'com.acme.app', ifNoneMatch: '*' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe('PUT');
    expect(sent[0]!.headers.get('If-None-Match')).toBe('*');
    expect(sent[0]!.headers.get('If-Match')).toBeNull();
  });

  it('control: ifMatch alone is sent as If-Match, with no If-None-Match', async () => {
    const { client, sent } = clientOver(() => json(200, receipt));
    await client.save('object', 'acme_note', { name: 'acme_note' }, { mode: 'draft', ifMatch: 'hmac-sha256:aa' });
    expect(sent[0]!.headers.get('If-Match')).toBe('hmac-sha256:aa');
    expect(sent[0]!.headers.get('If-None-Match')).toBeNull();
  });

  it('control: neither option sends neither header (unpinned, as before)', async () => {
    const { client, sent } = clientOver(() => json(200, receipt));
    await client.save('object', 'acme_note', { name: 'acme_note' }, { mode: 'draft' });
    expect(sent[0]!.headers.get('If-Match')).toBeNull();
    expect(sent[0]!.headers.get('If-None-Match')).toBeNull();
  });

  it('never sends the two together: both set is refused before any request', async () => {
    const { client, sent } = clientOver(() => json(200, receipt));
    await expect(
      client.save('object', 'acme_note', { name: 'acme_note' }, { ifMatch: 'hmac-sha256:aa', ifNoneMatch: '*' }),
    ).rejects.toThrow(/mutually exclusive/);
    expect(sent).toEqual([]);
  });

  it('the door\'s refusal of a pinned save reaches the caller parsed, with the body kept for its currentVersion', async () => {
    const refusal = {
      error: 'object/acme_note has been modified since you loaded it. Expected parent null but current is hmac-sha256:bb.',
      code: 'METADATA_CONFLICT',
      currentVersion: 'hmac-sha256:bb',
    };
    const { client } = clientOver(() => json(409, refusal));
    const err = await client
      .save('object', 'acme_note', { name: 'acme_note' }, { mode: 'draft', ifNoneMatch: '*' })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409, code: 'METADATA_CONFLICT', body: refusal });
  });
});

describe('MetadataClient.getDraft — the read surfaces its version (objectui#11773)', () => {
  it('hands back the served envelope with `version`, read at the package it names', async () => {
    const { client, sent } = clientOver((url) => {
      if (url.endsWith('/meta/_drafts')) return json(200, { drafts: [{ type: 'object', name: 'acme_note' }] });
      return json(200, { type: 'object', name: 'acme_note', item: { name: 'acme_note' }, version: 'hmac-sha256:aa' });
    });
    const envelope = await client.getDraft<{ version?: unknown }>('object', 'acme_note', { packageId: 'com.acme.app' });
    expect(envelope?.version).toBe('hmac-sha256:aa');
    const read = sent.find((s) => s.url.includes('/meta/object/acme_note'))!;
    expect(new URL(read.url).searchParams.get('package')).toBe('com.acme.app');
    expect(new URL(read.url).searchParams.get('state')).toBe('draft');
  });
});
