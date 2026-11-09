// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The commit door's `attachTo` arm (`POST …/upload/complete`): the record
// attachments surface's attach verb. With `attachTo`, the door hands the
// caller's own upload to the attacher `composeStorageRoutes` binds (the
// file-attachments service's `attachUploadAs`, as the caller) instead of
// committing it itself, and answers the committed file with its new
// `attachmentId`.
//
// Pinned here at the door: every gate the door already asked runs FIRST —
// the session, a malformed `attachTo`, a file that does not exist, the upload
// ownership rule, the bytes — and a refused request never reaches the
// attacher; the attacher's declared refusals are relayed with their code,
// status and details; a mount with no attacher bound refuses `attachTo` with
// `501`; and a completion without `attachTo` is unchanged. The attach verb's
// own checks and its one-file vouch are pinned in
// `file-attachment-service.test.ts`, and the whole flow on a real boot in the
// `attachments-browser-attach` dogfood.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import {
  registerStorageFamily,
  registerStorageRoutes,
  type StorageUploadAttacher,
  type StorageUploadSession,
} from './storage-routes.js';

const BASE = '/api/v1/storage';
const COMMIT = `${BASE}/upload/complete`;

type Res = IHttpResponse & { _status: number; _json: any };

function createMockHttpServer() {
  const routes = new Map<string, RouteHandler>();
  return {
    get: vi.fn((path: string, handler: RouteHandler) => { routes.set(`GET:${path}`, handler); }),
    post: vi.fn((path: string, handler: RouteHandler) => { routes.set(`POST:${path}`, handler); }),
    put: vi.fn((path: string, handler: RouteHandler) => { routes.set(`PUT:${path}`, handler); }),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    listen: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    handler(method: string, path: string): RouteHandler {
      const h = routes.get(`${method}:${path}`);
      if (!h) throw new Error(`no route ${method} ${path}`);
      return h;
    },
  };
}

function createMockRes(): Res {
  const res: any = {
    _status: 200,
    _json: null,
    json(data: any) { res._json = data; },
    send(data: any) { res._sent = data; },
    status(code: number) { res._status = code; return res; },
    header() { return res; },
  };
  return res;
}

const ALICE: StorageUploadSession = { userId: 'usr_alice' };
const BOB: StorageUploadSession = { userId: 'usr_bob' };
const BYTES = Buffer.from('hello');

let rootDir: string;
let storage: LocalStorageAdapter;
let store: StorageMetadataStore;
let server: ReturnType<typeof createMockHttpServer>;
let attacher: ReturnType<typeof vi.fn>;

/** A session per request, read off a test header — the door's `resolveSession`. */
const resolveSession = async (req: { headers?: unknown }) => {
  const who = (req.headers as Record<string, string> | undefined)?.['x-test-user'];
  return who === 'alice' ? ALICE : who === 'bob' ? BOB : null;
};

function mount(attach: StorageUploadAttacher | undefined) {
  server = createMockHttpServer();
  registerStorageFamily(server as any, storage, store, { basePath: BASE, resolveSession }, undefined, attach);
}

/** A pending upload of Alice's, its bytes held — what the presigned door and the raw PUT leave. */
async function seedUpload(over: { id?: string; owner?: string; bytes?: boolean } = {}) {
  const id = over.id ?? 'upl_alice';
  const key = `attachments/${id}.txt`;
  await store.createFile({
    id, key, name: 'notes.txt', mime_type: 'text/plain', size: BYTES.byteLength, scope: 'attachments',
    acl: 'private', status: 'pending', owner_id: over.owner ?? ALICE.userId,
  });
  if (over.bytes !== false) await storage.upload(key, BYTES, { contentType: 'text/plain' });
  return id;
}

async function complete(who: 'alice' | 'bob' | null, body: Record<string, unknown>): Promise<Res> {
  const res = createMockRes();
  const req = { params: {}, query: {}, body, headers: who ? { 'x-test-user': who } : {}, method: 'POST', path: COMMIT } as unknown as IHttpRequest;
  await server.handler('POST', COMMIT)(req, res);
  return res;
}

const ATTACH_TO = { parentObject: 'att_case', parentId: 'case_a' };

beforeEach(async () => {
  rootDir = join(tmpdir(), `os-complete-attach-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  storage = new LocalStorageAdapter({ rootDir, signingSecret: 'complete-attach' });
  store = new StorageMetadataStore(null);
  attacher = vi.fn(async () => ({ attachmentId: 'att_1' }));
  mount(attacher as unknown as StorageUploadAttacher);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe('POST /storage/upload/complete with attachTo — the attach verb at the door', () => {
  it('hands the caller’s own upload to the attacher, does not commit it itself, and answers the file with its attachmentId', async () => {
    const fileId = await seedUpload();
    const res = await complete('alice', { fileId, eTag: 'etag-1', attachTo: ATTACH_TO });
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    expect(attacher).toHaveBeenCalledTimes(1);
    expect(attacher.mock.calls[0][1]).toEqual({ fileId, ...ATTACH_TO, eTag: 'etag-1' });
    expect(res._json).toMatchObject({ success: true, data: { fileId, name: 'notes.txt', attachmentId: 'att_1' } });
    // The commit is the attacher's (one unit with the insert): this stand-in
    // committed nothing, and the door wrote nothing of its own.
    expect((await store.getFile(fileId))?.status).toBe('pending');
  });

  it('control: another user’s upload is refused by the upload ownership rule before the attacher is asked', async () => {
    const fileId = await seedUpload({ owner: BOB.userId });
    const res = await complete('alice', { fileId, attachTo: ATTACH_TO });
    expect([res._status, res._json?.error?.code]).toEqual([403, 'PERMISSION_DENIED']);
    expect(attacher).not.toHaveBeenCalled();
    expect((await store.getFile(fileId))?.status).toBe('pending');
  });

  it('control: an id that names no file is refused FILE_NOT_FOUND / 404 before the attacher is asked', async () => {
    const res = await complete('alice', { fileId: 'upl_nowhere', attachTo: ATTACH_TO });
    expect([res._status, res._json?.error?.code]).toEqual([404, 'FILE_NOT_FOUND']);
    expect(attacher).not.toHaveBeenCalled();
  });

  it('control: an anonymous request is refused AUTH_REQUIRED / 401 before anything is read', async () => {
    const fileId = await seedUpload();
    const res = await complete(null, { fileId, attachTo: ATTACH_TO });
    expect([res._status, res._json?.error?.code]).toEqual([401, 'AUTH_REQUIRED']);
    expect(attacher).not.toHaveBeenCalled();
  });

  it('control: an upload whose bytes are not held is refused RESOURCE_CONFLICT / 409 before the attacher is asked', async () => {
    const fileId = await seedUpload({ bytes: false });
    const res = await complete('alice', { fileId, attachTo: ATTACH_TO });
    expect([res._status, res._json?.error?.code]).toEqual([409, 'RESOURCE_CONFLICT']);
    expect(attacher).not.toHaveBeenCalled();
  });

  for (const [what, attachTo] of [
    ['a missing parentId', { parentObject: 'att_case' }],
    ['an empty parentObject', { parentObject: '', parentId: 'case_a' }],
    ['a key attachTo does not declare', { ...ATTACH_TO, file_id: 'other' }],
    ['an array', [ATTACH_TO]],
    ['null', null],
  ] as const) {
    it(`control: attachTo with ${what} is refused INVALID_REQUEST / 400, and nothing is read, attached or committed`, async () => {
      const fileId = await seedUpload();
      const res = await complete('alice', { fileId, attachTo });
      expect([res._status, res._json?.error?.code]).toEqual([400, 'INVALID_REQUEST']);
      expect(attacher).not.toHaveBeenCalled();
      expect((await store.getFile(fileId))?.status).toBe('pending');
    });
  }

  it('relays the attacher’s declared refusal with its code and status, and the upload is left pending', async () => {
    attacher.mockRejectedValueOnce(Object.assign(new Error('Cannot attach to att_case/case_a'), { code: 'ATTACHMENT_PARENT_ACCESS', status: 403 }));
    const fileId = await seedUpload();
    const res = await complete('alice', { fileId, attachTo: ATTACH_TO });
    expect([res._status, res._json?.error?.code]).toEqual([403, 'ATTACHMENT_PARENT_ACCESS']);
    expect(res._json.error.message).toBe('Cannot attach to att_case/case_a');
    expect((await store.getFile(fileId))?.status).toBe('pending');
  });

  it('relays a validation refusal from the insert as VALIDATION_FAILED / 400 with its field details', async () => {
    const validation = Object.assign(new Error('file_id: reference not found'), {
      name: 'ValidationError',
      fields: [{ field: 'file_id', code: 'reference_not_found', message: 'reference not found' }],
    });
    attacher.mockRejectedValueOnce(validation);
    const fileId = await seedUpload();
    const res = await complete('alice', { fileId, attachTo: ATTACH_TO });
    expect([res._status, res._json?.error?.code]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('an undeclared fault is a 500 with the door’s generic text, never the thrown message', async () => {
    attacher.mockRejectedValueOnce(new Error('engine said something about the host'));
    const fileId = await seedUpload();
    const res = await complete('alice', { fileId, attachTo: ATTACH_TO });
    expect(res._status).toBe(500);
    expect(res._json.error.message).not.toContain('engine said');
  });

  it('a mount with no attacher bound (the public registrar, a bare kernel) refuses attachTo NOT_IMPLEMENTED / 501 and commits nothing', async () => {
    server = createMockHttpServer();
    registerStorageRoutes(server as any, storage, store, { basePath: BASE, resolveSession });
    const fileId = await seedUpload();
    const res = await complete('alice', { fileId, attachTo: ATTACH_TO });
    expect([res._status, res._json?.error?.code]).toEqual([501, 'NOT_IMPLEMENTED']);
    expect((await store.getFile(fileId))?.status).toBe('pending');
  });

  it('control: a completion without attachTo commits as before and never asks the attacher', async () => {
    const fileId = await seedUpload();
    const res = await complete('alice', { fileId });
    expect(res._status).toBe(200);
    expect(res._json.data.attachmentId).toBeUndefined();
    expect((await store.getFile(fileId))?.status).toBe('committed');
    expect(attacher).not.toHaveBeenCalled();
  });
});
