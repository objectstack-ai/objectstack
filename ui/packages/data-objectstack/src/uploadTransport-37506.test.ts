/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#37506 — `uploadFile` / `uploadFiles` send through the host's
 * injected `fetch`, never the global one.
 *
 * The host's injected fetch is its authenticated fetch (the console hands
 * `createAuthenticatedFetch()`), which sends the stored bearer beside the
 * cookie. The two uploads used to call the global `fetch`, which carries the
 * cookie alone, so under a bearer-only session (the cookie replaced, blocked as
 * third-party, or cleared) an upload went out anonymous while every other
 * request of the same adapter was signed in.
 *
 * objectstack#38163 — and they send to the storage service's presigned flow,
 * the one upload route the standard server serves. They used to post to
 * `/api/data/<resource>/upload`, which the server answers 404; the fake network
 * below answers that path the same way.
 *
 * The injected fetch here stands in for the host's: it adds the bearer and
 * hands the request to a fake network. The control is the global `fetch`,
 * stubbed to record and refuse: the pre-fix transport, which sends no bearer.
 *
 * The uploads still sit outside the connection-state tracking (README,
 * "Connection state"): a refused upload moves nothing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectStackAdapter, type ConnectionStateEvent } from './index';
import { ObjectStackError } from './errors';
import { clearSharedDiscoveryCache } from './sharedDiscovery';

const BASE = 'http://fake-37506.test';
const STORAGE = `${BASE}/api/v1/storage`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** What reached the network: URL, method, the Authorization header and the JSON body. */
type Sent = { url: string; method: string; authorization: string | null; body: unknown };

/**
 * A fake ObjectStack server: discovery, the storage service's three presigned
 * steps, and a 404 `ENDPOINT_NOT_FOUND` for anything else under an upload path,
 * as the standard server answers `/api/data/<resource>/upload`.
 */
function fakeServer(opts: { uploadUrlOf?: (fileId: string) => string } = {}) {
  const sent: Sent[] = [];
  let refuseUploads = false;
  let refuseCompleteOf: string | null = null;
  let nextFile = 0;
  const network = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: unknown;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    sent.push({ url, method, authorization: new Headers(init?.headers).get('Authorization'), body });
    if (url.includes('/api/v1/discovery')) {
      return json({ success: true, data: { name: 'fake', routes: {} } });
    }
    if (url === `${STORAGE}/upload/presigned` && method === 'POST') {
      if (refuseUploads) throw new TypeError('Failed to fetch');
      nextFile++;
      const fileId = `file_${nextFile}`;
      return json({
        success: true,
        data: {
          uploadUrl: opts.uploadUrlOf ? opts.uploadUrlOf(fileId) : `/api/v1/storage/_local/raw/tok-${fileId}`,
          method: 'PUT',
          fileId,
          expiresIn: 3600,
          downloadUrl: `/api/v1/storage/files/${fileId}/url`,
        },
      });
    }
    if (method === 'PUT' && (url.includes('/_local/raw/') || url.startsWith('https://bucket.'))) {
      return json({ success: true, data: { key: 'k' } });
    }
    if (url === `${STORAGE}/upload/complete` && method === 'POST') {
      const fileId = (body as { fileId: string }).fileId;
      if (refuseCompleteOf === fileId) {
        return json(
          { success: false, error: { code: 'ATTACHMENT_PARENT_ACCESS', message: 'No edit access to the record' } },
          403,
        );
      }
      const attachTo = (body as { attachTo?: unknown }).attachTo;
      return json({ success: true, data: { id: fileId, ...(attachTo ? { attachmentId: `att_${fileId}` } : {}) } });
    }
    if (url.includes('/upload')) {
      return json({ success: false, error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' } }, 404);
    }
    return json({ success: true, data: {} });
  };
  // The host's authenticated fetch: the stored bearer beside whatever the caller set.
  const authenticatedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', 'Bearer stored-token-37506');
    return network(input, { ...init, headers });
  });
  const plainFetch = vi.fn(network);
  return {
    sent,
    authenticatedFetch,
    plainFetch,
    uploads: () => sent.filter((s) => !s.url.includes('/api/v1/discovery')),
    refuse: () => {
      refuseUploads = true;
    },
    refuseComplete: (fileId: string) => {
      refuseCompleteOf = fileId;
    },
  };
}

const file = (name: string, text = 'hello') => new File([text], name, { type: 'text/plain' });

let globalFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearSharedDiscoveryCache();
  // The control: the global fetch carries no bearer. Nothing may reach it.
  globalFetch = vi.fn(async () => {
    throw new Error('the global fetch was called: it sends the cookie alone');
  });
  vi.stubGlobal('fetch', globalFetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('data-objectstack uploads send through the injected fetch (objectstack#37506)', () => {
  it('uploadFile goes out through the injected fetch, carrying its bearer', async () => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    await expect(adapter.uploadFile('task', file('a.txt'), { recordId: 'r1' })).resolves.toMatchObject({
      id: 'file_1',
    });

    expect(host.uploads().map((s) => s.authorization)).toEqual([
      'Bearer stored-token-37506',
      'Bearer stored-token-37506',
      'Bearer stored-token-37506',
    ]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('uploadFiles goes out through the injected fetch, carrying its bearer', async () => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    await adapter.uploadFiles('task', [file('a.txt'), file('b.txt')]);

    const uploads = host.uploads();
    expect(uploads).toHaveLength(6);
    expect(uploads.every((s) => s.authorization === 'Bearer stored-token-37506')).toBe(true);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it('a refused upload still leaves the connection state where it was', async () => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });
    await adapter.connect();
    expect(adapter.getConnectionState()).toBe('connected');
    const events: ConnectionStateEvent[] = [];
    adapter.onConnectionStateChange((event) => events.push(event));

    host.refuse();
    await expect(adapter.uploadFile('task', file('a.txt'))).rejects.toBeInstanceOf(TypeError);
    const batch = await adapter.uploadFiles('task', [file('a.txt')]).catch((e: unknown) => e);
    expect(batch).toBeInstanceOf(ObjectStackError);
    expect((batch as ObjectStackError).details?.cause).toBeInstanceOf(TypeError);

    expect(adapter.getConnectionState()).toBe('connected');
    expect(events).toEqual([]);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

describe('data-objectstack uploads go to the storage service, the route the server serves (objectstack#38163)', () => {
  it('neither method sends a request to /api/data/<resource>/upload; each file is presigned, PUT and completed', async () => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    await adapter.uploadFile('task', file('a.txt'));
    await adapter.uploadFiles('task', [file('b.txt'), file('c.txt')]);

    const uploads = host.uploads();
    expect(uploads.filter((s) => /\/api\/(v\d+\/)?data\/[^/]+\/upload/.test(s.url))).toEqual([]);
    expect(uploads.map((s) => `${s.method} ${s.url.replace(BASE, '')}`)).toEqual([
      'POST /api/v1/storage/upload/presigned',
      'PUT /api/v1/storage/_local/raw/tok-file_1',
      'POST /api/v1/storage/upload/complete',
      'POST /api/v1/storage/upload/presigned',
      'PUT /api/v1/storage/_local/raw/tok-file_2',
      'POST /api/v1/storage/upload/complete',
      'POST /api/v1/storage/upload/presigned',
      'PUT /api/v1/storage/_local/raw/tok-file_3',
      'POST /api/v1/storage/upload/complete',
    ]);
  });

  it('recordId attaches the file to that record of the resource, in the completing call', async () => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    const result = await adapter.uploadFile('task', file('a.txt', 'hello'), { recordId: 'r1' });

    const [presign, , complete] = host.uploads();
    expect(presign.body).toEqual({ filename: 'a.txt', mimeType: 'text/plain', size: 5, scope: 'attachments' });
    expect(complete.body).toEqual({ fileId: 'file_1', attachTo: { parentObject: 'task', parentId: 'r1' } });
    expect(result).toEqual({
      id: 'file_1',
      filename: 'a.txt',
      mimeType: 'text/plain',
      size: 5,
      url: `${STORAGE}/files/file_1`,
      metadata: { fileId: 'file_1', scope: 'attachments', attachmentId: 'att_file_1' },
    });
  });

  it('without recordId the file is stored under the server default scope and attached to nothing', async () => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    const result = await adapter.uploadFile('task', file('a.txt'));

    const [presign, , complete] = host.uploads();
    expect(presign.body).toEqual({ filename: 'a.txt', mimeType: 'text/plain', size: 5 });
    expect(complete.body).toEqual({ fileId: 'file_1' });
    expect(result.metadata).toEqual({ fileId: 'file_1', scope: undefined });
  });

  it.each([
    ['fieldName', { fieldName: 'contract' }],
    ['metadata', { metadata: { source: 'scan' } }],
  ] as const)('%s is refused before any request: the presigned flow cannot carry it', async (key, options) => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    for (const call of [
      () => adapter.uploadFile('task', file('a.txt'), options),
      () => adapter.uploadFiles('task', [file('a.txt')], options),
    ]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ObjectStackError);
      expect((err as ObjectStackError).code).toBe('UNSUPPORTED_OPERATION');
      expect((err as ObjectStackError).message).toContain(key);
      expect((err as ObjectStackError).message).toContain('/api/v1/storage/upload/presigned');
    }
    expect(host.sent).toEqual([]);
  });

  it("the adapter's token signs every request to this server, and never a presigned URL on another origin", async () => {
    const host = fakeServer({ uploadUrlOf: (fileId) => `https://bucket.s3.example/${fileId}?X-Amz-Signature=s` });
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, token: 'config-token', fetch: host.plainFetch });

    await adapter.uploadFile('task', file('a.txt'));

    expect(host.uploads().map((s) => [s.method, s.url.startsWith(BASE), s.authorization])).toEqual([
      ['POST', true, 'Bearer config-token'],
      ['PUT', false, null],
      ['POST', true, 'Bearer config-token'],
    ]);
  });

  it.each([
    ['a protocol-relative', '//other.example/bucket/x'],
    ['a slash-backslash', '/\\other.example/x'],
    ['a double-backslash', '\\\\other.example/x'],
  ])('%s presigned URL is not treated as this server: it gets no token', async (_kind, uploadUrl) => {
    // Same-origin data source (`baseUrl: ''`): this server is the page's origin, and its own
    // requests are paths on it. The unit project runs in node, so the page is stubbed.
    vi.stubGlobal('location', { origin: 'http://app-38163.test' });
    const sent: Array<{ url: string; method: string; authorization: string | null }> = [];
    const network = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      sent.push({ url, method, authorization: new Headers(init?.headers).get('Authorization') });
      if (url.endsWith('/upload/presigned')) {
        return json({ success: true, data: { uploadUrl, method: 'PUT', fileId: 'file_1' } });
      }
      if (url.endsWith('/upload/complete')) return json({ success: true, data: { id: 'file_1' } });
      if (method === 'PUT') return json({ success: true, data: {} });
      return json({ success: true, data: { name: 'fake', routes: {} } });
    });
    const adapter = new ObjectStackAdapter({ baseUrl: '', token: 'config-token', fetch: network });

    await adapter.uploadFile('task', file('a.txt'));

    expect(sent.filter((s) => !s.url.includes('/api/v1/discovery'))).toEqual([
      { url: '/api/v1/storage/upload/presigned', method: 'POST', authorization: 'Bearer config-token' },
      { url: uploadUrl, method: 'PUT', authorization: null },
      { url: '/api/v1/storage/upload/complete', method: 'POST', authorization: 'Bearer config-token' },
    ]);
  });

  it('a refused storage request rejects UPLOAD_ERROR with the server status and code', async () => {
    const host = fakeServer();
    host.refuseComplete('file_1');
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    const err = await adapter.uploadFile('task', file('a.txt'), { recordId: 'r1' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ObjectStackError);
    expect((err as ObjectStackError).code).toBe('UPLOAD_ERROR');
    expect((err as ObjectStackError).statusCode).toBe(403);
    expect((err as ObjectStackError).details).toEqual({ serverCode: 'ATTACHMENT_PARENT_ACCESS' });
  });

  it('uploadFiles stops at the first refused file and reports what was already stored', async () => {
    const host = fakeServer();
    host.refuseComplete('file_2');
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    const err = await adapter
      .uploadFiles('task', [file('a.txt'), file('b.txt'), file('c.txt')], { recordId: 'r1' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ObjectStackError);
    const refusal = err as ObjectStackError;
    expect(refusal.code).toBe('UPLOAD_ERROR');
    expect(refusal.statusCode).toBe(403);
    expect(refusal.details?.failedIndex).toBe(1);
    expect(refusal.details?.serverCode).toBe('ATTACHMENT_PARENT_ACCESS');
    expect((refusal.details?.uploaded as Array<{ id: string }>).map((r) => r.id)).toEqual(['file_1']);
    // The third file is never sent.
    expect(host.uploads().filter((s) => s.url.endsWith('/upload/presigned'))).toHaveLength(2);
  });

  it('onProgress reports percent: 100 for one file, and across the batch for several', async () => {
    const host = fakeServer();
    const adapter = new ObjectStackAdapter({ baseUrl: BASE, fetch: host.authenticatedFetch });

    const one: number[] = [];
    await adapter.uploadFile('task', file('a.txt'), { onProgress: (p) => one.push(p) });
    const batch: number[] = [];
    await adapter.uploadFiles('task', [file('a.txt'), file('b.txt')], { onProgress: (p) => batch.push(p) });

    expect(one).toEqual([100]);
    expect(batch).toEqual([50, 100]);
  });
});
