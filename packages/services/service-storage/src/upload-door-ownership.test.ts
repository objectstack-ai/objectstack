// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22046 (ruling B) — the three upload doors that act on an id the caller
// names consult ONE ownership rule, `isFileUploader` (`upload-ownership.ts`),
// right after their by-id read and before any write or disclosure.
//
// Per door this file carries:
//   - a POSITIVE pin: the uploader passes;
//   - a SAME-ORGANIZATION negative pin: a caller who is not the uploader gets
//     `403 PERMISSION_DENIED`, and nothing about the row is written or shown;
//   - a CROSS-ORGANIZATION negative pin at this altitude: a caller acting in
//     another organization gets the identical body. (The same pin on a booted
//     organization wall is a separate measurement; see the PR.)
//
// Plus the ruled edges: an empty `owner_id` is refused, a session whose file
// row is gone is refused, there is no administrator exception, and the
// not-found answers the doors gave before are unchanged.
//
// The store here is the engine-absent stand-in, whose writes are NOT tenant
// scoped — so a door that skipped the rule would visibly change the row, which
// is what makes every "row unchanged" assertion below able to fail.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';
import type { StorageUploadSession } from './storage-routes.js';
import { isFileUploader } from './upload-ownership.js';

const BASE = '/api/v1/storage';
const COMMIT = `${BASE}/upload/complete`;
const CHUNKED_COMPLETE = `${BASE}/upload/chunked/:uploadId/complete`;
const PROGRESS = `${BASE}/upload/chunked/:uploadId/progress`;

/** The uploader. */
const ALICE: StorageUploadSession = { userId: 'u_alice', organizationId: 'org_a' };
/** Same organization as the uploader, not the uploader. */
const BOB: StorageUploadSession = { userId: 'u_bob', organizationId: 'org_a' };
/** Another organization entirely. */
const CAROL: StorageUploadSession = { userId: 'u_carol', organizationId: 'org_b' };
/** A caller holding an administrator role — the rule has no exception for one. */
const ADMIN: StorageUploadSession = { userId: 'u_admin', organizationId: 'org_a' };

const SESSIONS: Record<string, StorageUploadSession> = {
  alice: ALICE,
  bob: BOB,
  carol: CAROL,
  admin: ADMIN,
};
type Who = keyof typeof SESSIONS;

interface Answer {
  status: number;
  body: any;
}

function mount(
  adapter: LocalStorageAdapter,
  store: StorageMetadataStore,
  opts: { open?: boolean } = {},
): Map<string, RouteHandler> {
  const routes = new Map<string, RouteHandler>();
  const http = {
    get: (p: string, h: RouteHandler) => { routes.set(`GET:${p}`, h); },
    post: (p: string, h: RouteHandler) => { routes.set(`POST:${p}`, h); },
    put: (p: string, h: RouteHandler) => { routes.set(`PUT:${p}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
    listen: async () => {},
    close: async () => {},
  };
  registerStorageRoutes(http as any, adapter, store, {
    basePath: BASE,
    ...(opts.open
      ? {}
      : {
          resolveSession: async (req: IHttpRequest) =>
            SESSIONS[String(req.headers['x-test-user'] ?? '')] ?? null,
        }),
  });
  return routes;
}

async function call(
  routes: Map<string, RouteHandler>,
  method: string,
  path: string,
  who: Who | null,
  req: Partial<IHttpRequest> = {},
): Promise<Answer> {
  const handler = routes.get(`${method}:${path}`);
  if (!handler) throw new Error(`no handler for ${method} ${path}`);
  const answer: Answer = { status: 200, body: undefined };
  const res: any = {
    json(data: any) { answer.body = data; },
    send() {},
    status(code: number) { answer.status = code; return res; },
    header() { return res; },
  };
  await handler(
    {
      params: {},
      query: {},
      body: undefined,
      method,
      path,
      ...req,
      headers: { ...(who ? { 'x-test-user': who } : {}), ...(req.headers ?? {}) },
    } as IHttpRequest,
    res as IHttpResponse,
  );
  return answer;
}

/** The refusal every non-uploader gets — code and status, never the prose. */
function expectNotUploader(answer: Answer, label: string): void {
  expect(answer.status, label).toBe(403);
  expect(answer.body?.success, label).toBe(false);
  expect(answer.body?.error?.code, label).toBe('PERMISSION_DENIED');
}

/** Nothing about the row the caller named reached the refusal body. */
function expectDisclosesNothing(answer: Answer, secrets: string[], label: string): void {
  expect(answer.body?.data, label).toBeUndefined();
  const text = JSON.stringify(answer.body);
  for (const s of secrets) expect(text.includes(s), `${label}: ${s}`).toBe(false);
}

let rootDir: string;
let adapter: LocalStorageAdapter;
let store: StorageMetadataStore;
let routes: Map<string, RouteHandler>;

beforeEach(async () => {
  rootDir = join(tmpdir(), `os-22046-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
  store = new StorageMetadataStore(null);
  routes = mount(adapter, store);
});

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true });
});

/** Alice starts a presigned upload through the real start door. */
async function alicePresigns(filename = 'alice-plan.txt'): Promise<string> {
  const res = await call(routes, 'POST', `${BASE}/upload/presigned`, 'alice', {
    body: { filename, mimeType: 'text/plain', size: 5 },
  });
  expect(res.status).toBe(200);
  return res.body.data.fileId as string;
}

/** Alice starts a chunked upload through the real start door. */
async function aliceStartsChunked(
  filename = 'alice-chunked.bin',
): Promise<{ uploadId: string; fileId: string }> {
  const res = await call(routes, 'POST', `${BASE}/upload/chunked`, 'alice', {
    body: { filename, mimeType: 'application/octet-stream', totalSize: 10 },
  });
  expect(res.status).toBe(200);
  return { uploadId: res.body.data.uploadId, fileId: res.body.data.fileId };
}

// ---------------------------------------------------------------------------
// The predicate
// ---------------------------------------------------------------------------

describe('isFileUploader — the one rule', () => {
  it('allows the uploader', () => {
    expect(isFileUploader('u_alice', { owner_id: 'u_alice' })).toBe(true);
  });

  it('refuses anyone else', () => {
    expect(isFileUploader('u_bob', { owner_id: 'u_alice' })).toBe(false);
  });

  it('refuses an empty owner — it never guesses one', () => {
    expect(isFileUploader('u_alice', {})).toBe(false);
    expect(isFileUploader('u_alice', { owner_id: undefined })).toBe(false);
    expect(isFileUploader('u_alice', { owner_id: '' })).toBe(false);
    expect(isFileUploader('u_alice', { owner_id: null as unknown as string })).toBe(false);
  });

  it('refuses a missing file row, and a caller with no user id', () => {
    expect(isFileUploader('u_alice', null)).toBe(false);
    expect(isFileUploader('u_alice', undefined)).toBe(false);
    expect(isFileUploader(undefined, { owner_id: 'u_alice' })).toBe(false);
    expect(isFileUploader('', { owner_id: '' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The commit door
// ---------------------------------------------------------------------------

describe('the commit door (POST /upload/complete)', () => {
  it('POSITIVE: the uploader commits their own upload', async () => {
    const fileId = await alicePresigns();
    const res = await call(routes, 'POST', COMMIT, 'alice', { body: { fileId, eTag: 'etag-alice' } });
    expect(res.status).toBe(200);
    expect(res.body.data.fileId).toBe(fileId);
    const row = await store.getFile(fileId);
    expect(row?.status).toBe('committed');
    expect(row?.etag).toBe('etag-alice');
  });

  it('SAME ORGANIZATION: a non-uploader is refused 403 PERMISSION_DENIED, and the row is untouched', async () => {
    const fileId = await alicePresigns();
    const res = await call(routes, 'POST', COMMIT, 'bob', { body: { fileId, eTag: 'etag-bob' } });
    expectNotUploader(res, 'bob');
    expectDisclosesNothing(res, ['alice-plan', 'u_alice', 'org_a', fileId], 'bob');
    const row = await store.getFile(fileId);
    expect(row?.status).toBe('pending');
    expect(row?.etag).toBeUndefined();
  });

  it('ANOTHER ORGANIZATION: the identical refusal, and the row is untouched', async () => {
    const fileId = await alicePresigns();
    const same = await call(routes, 'POST', COMMIT, 'bob', { body: { fileId, eTag: 'etag-bob' } });
    const cross = await call(routes, 'POST', COMMIT, 'carol', { body: { fileId, eTag: 'etag-carol' } });
    expectNotUploader(cross, 'carol');
    expect(cross).toEqual(same);
    const row = await store.getFile(fileId);
    expect(row?.status).toBe('pending');
    expect(row?.etag).toBeUndefined();
  });

  it('no administrator exception', async () => {
    const fileId = await alicePresigns();
    expectNotUploader(await call(routes, 'POST', COMMIT, 'admin', { body: { fileId } }), 'admin');
    expect((await store.getFile(fileId))?.status).toBe('pending');
  });

  it('an empty owner_id is refused — even to a caller who would otherwise pass', async () => {
    for (const owner of [undefined, '']) {
      const id = `f_ownerless_${owner === undefined ? 'unset' : 'empty'}`;
      await store.createFile({ id, key: `user/${id}.txt`, name: `${id}.txt`, status: 'pending', owner_id: owner });
      expectNotUploader(await call(routes, 'POST', COMMIT, 'alice', { body: { fileId: id } }), id);
      expect((await store.getFile(id))?.status).toBe('pending');
    }
  });

  it('the not-found answer is unchanged', async () => {
    const res = await call(routes, 'POST', COMMIT, 'alice', { body: { fileId: 'f_no_such_file' } });
    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe('FILE_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// The chunked-completion door
// ---------------------------------------------------------------------------

describe('the chunked-completion door (POST /upload/chunked/:uploadId/complete)', () => {
  it('POSITIVE: the uploader completes their own upload', async () => {
    const { uploadId, fileId } = await aliceStartsChunked();
    const res = await call(routes, 'POST', CHUNKED_COMPLETE, 'alice', {
      params: { uploadId },
      body: { parts: [] },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.fileId).toBe(fileId);
    expect((await store.getSession(uploadId))?.status).toBe('completed');
    expect((await store.getFile(fileId))?.status).toBe('committed');
  });

  it('SAME ORGANIZATION: a non-uploader is refused 403 PERMISSION_DENIED, and neither row moves', async () => {
    const { uploadId, fileId } = await aliceStartsChunked();
    const res = await call(routes, 'POST', CHUNKED_COMPLETE, 'bob', {
      params: { uploadId },
      body: { parts: [] },
    });
    expectNotUploader(res, 'bob');
    expectDisclosesNothing(res, ['alice-chunked', 'u_alice', 'org_a', fileId], 'bob');
    expect((await store.getSession(uploadId))?.status).toBe('in_progress');
    expect((await store.getFile(fileId))?.status).toBe('pending');
  });

  it('ANOTHER ORGANIZATION: the identical refusal, and neither row moves', async () => {
    const { uploadId, fileId } = await aliceStartsChunked();
    const same = await call(routes, 'POST', CHUNKED_COMPLETE, 'bob', { params: { uploadId }, body: { parts: [] } });
    const cross = await call(routes, 'POST', CHUNKED_COMPLETE, 'carol', { params: { uploadId }, body: { parts: [] } });
    expectNotUploader(cross, 'carol');
    expect(cross).toEqual(same);
    expect((await store.getSession(uploadId))?.status).toBe('in_progress');
    expect((await store.getFile(fileId))?.status).toBe('pending');
  });

  it('the rule runs BEFORE the expiry check: a non-uploader neither learns of nor stamps the expiry', async () => {
    const { uploadId } = await aliceStartsChunked();
    const past = new Date(Date.now() - 60_000).toISOString();
    await store.updateSession(uploadId, { expires_at: past });
    const res = await call(routes, 'POST', CHUNKED_COMPLETE, 'bob', { params: { uploadId }, body: { parts: [] } });
    expectNotUploader(res, 'bob');
    expect((await store.getSession(uploadId))?.status).toBe('in_progress');
    // Control: the uploader reaches the expiry branch, which does write.
    const own = await call(routes, 'POST', CHUNKED_COMPLETE, 'alice', { params: { uploadId }, body: { parts: [] } });
    expect(own.status).toBe(410);
    expect((await store.getSession(uploadId))?.status).toBe('expired');
  });

  it('a session whose file row is gone is refused — no uploader to match, none is guessed', async () => {
    const { uploadId, fileId } = await aliceStartsChunked();
    await store.deleteFile(fileId);
    expectNotUploader(
      await call(routes, 'POST', CHUNKED_COMPLETE, 'alice', { params: { uploadId }, body: { parts: [] } }),
      'alice',
    );
    expect((await store.getSession(uploadId))?.status).toBe('in_progress');
  });

  it('the not-found answer is unchanged', async () => {
    const res = await call(routes, 'POST', CHUNKED_COMPLETE, 'alice', { params: { uploadId: 'no_such_upload' } });
    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe('UPLOAD_SESSION_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// The progress door
// ---------------------------------------------------------------------------

describe('the progress door (GET /upload/chunked/:uploadId/progress)', () => {
  it('POSITIVE: the uploader reads their own progress', async () => {
    const { uploadId, fileId } = await aliceStartsChunked();
    const res = await call(routes, 'GET', PROGRESS, 'alice', { params: { uploadId } });
    expect(res.status).toBe(200);
    expect(res.body.data.fileId).toBe(fileId);
    expect(res.body.data.filename).toBe('alice-chunked.bin');
  });

  it('SAME ORGANIZATION: a non-uploader is refused 403 PERMISSION_DENIED and shown nothing', async () => {
    const { uploadId, fileId } = await aliceStartsChunked();
    const res = await call(routes, 'GET', PROGRESS, 'bob', { params: { uploadId } });
    expectNotUploader(res, 'bob');
    expectDisclosesNothing(res, ['alice-chunked', 'u_alice', 'org_a', fileId], 'bob');
  });

  it('ANOTHER ORGANIZATION: the identical refusal, shown nothing', async () => {
    const { uploadId, fileId } = await aliceStartsChunked();
    const same = await call(routes, 'GET', PROGRESS, 'bob', { params: { uploadId } });
    const cross = await call(routes, 'GET', PROGRESS, 'carol', { params: { uploadId } });
    expectNotUploader(cross, 'carol');
    expect(cross).toEqual(same);
    expectDisclosesNothing(cross, ['alice-chunked', 'u_alice', 'org_a', fileId], 'carol');
  });

  it('the rule runs BEFORE the expiry write: a non-uploader cannot stamp the row expired', async () => {
    const { uploadId } = await aliceStartsChunked();
    const past = new Date(Date.now() - 60_000).toISOString();
    await store.updateSession(uploadId, { expires_at: past });
    expectNotUploader(await call(routes, 'GET', PROGRESS, 'bob', { params: { uploadId } }), 'bob');
    expect((await store.getSession(uploadId))?.status).toBe('in_progress');
    // Control: the same read by the uploader does write the expiry.
    const own = await call(routes, 'GET', PROGRESS, 'alice', { params: { uploadId } });
    expect(own.status).toBe(200);
    expect(own.body.data.status).toBe('expired');
    expect((await store.getSession(uploadId))?.status).toBe('expired');
  });

  it('no administrator exception', async () => {
    const { uploadId } = await aliceStartsChunked();
    expectNotUploader(await call(routes, 'GET', PROGRESS, 'admin', { params: { uploadId } }), 'admin');
  });

  it('the not-found answer is unchanged', async () => {
    const res = await call(routes, 'GET', PROGRESS, 'alice', { params: { uploadId: 'no_such_upload' } });
    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe('UPLOAD_SESSION_NOT_FOUND');
  });
});

// ---------------------------------------------------------------------------
// Open mode — no session resolver wired (bare kernels): no identity to compare
// ---------------------------------------------------------------------------

describe('open mode (no session resolver) is unchanged', () => {
  it('all three doors still answer an unauthenticated caller, as the open mode declares', async () => {
    const open = mount(adapter, store, { open: true });
    const presign = await call(open, 'POST', `${BASE}/upload/presigned`, null, {
      body: { filename: 'open.txt', mimeType: 'text/plain', size: 5 },
    });
    expect(presign.status).toBe(200);
    expect((await call(open, 'POST', COMMIT, null, { body: { fileId: presign.body.data.fileId } })).status).toBe(200);

    const start = await call(open, 'POST', `${BASE}/upload/chunked`, null, {
      body: { filename: 'open.bin', mimeType: 'application/octet-stream', totalSize: 10 },
    });
    expect(start.status).toBe(200);
    const uploadId = start.body.data.uploadId;
    expect((await call(open, 'GET', PROGRESS, null, { params: { uploadId } })).status).toBe(200);
    expect(
      (await call(open, 'POST', CHUNKED_COMPLETE, null, { params: { uploadId }, body: { parts: [] } })).status,
    ).toBe(200);
  });
});
