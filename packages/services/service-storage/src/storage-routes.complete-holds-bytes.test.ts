// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24548] The single-shot commit door (`POST …/upload/complete`) commits only
// a file whose bytes the storage backend holds.
//
// `committed` is the download doors' one servability rule (`committed` →
// servable; `pending` → "an upload that was never completed has no bytes to
// promise"). The commit door used to set it without asking the backend, so a
// presigned upload whose byte PUT failed, or was never sent, committed with
// the size it declared: the signed download URL was handed out and the
// download failed `500`. The chunked sibling already refuses that state with
// `409 RESOURCE_CONFLICT` (#22313); the single-shot door now gives the same
// answer, leaves the row `pending`, and the uploader can PUT the bytes and
// complete again.
//
// Driven through the three compositions a host hands the doors: the local
// adapter, the `SwappableStorageService` wrapper the storage plugin mounts,
// and the S3 adapter over a fake bucket (the browser's direct PUT to S3 is the
// adapter's own `PutObject`, which is where the bytes land either way).
//
// The local raw byte route's answer for a key that holds no file is pinned
// here too: `404 FILE_NOT_FOUND`, where it used to answer `500 Download
// failed`. Every other read failure keeps its `500`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IHttpRequest, IHttpResponse, IStorageService, RouteHandler } from '@objectstack/spec/contracts';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { SwappableStorageService } from './swappable-storage-service.js';
import { S3StorageAdapter } from './s3-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

const fakeBucket = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  function notFound(): Error {
    const err = new Error('NotFound') as Error & { $metadata: { httpStatusCode: number } };
    err.name = 'NotFound';
    err.$metadata = { httpStatusCode: 404 };
    return err;
  }
  return { objects, notFound };
});

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: Record<string, any>) {}
  }
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class HeadObjectCommand extends Command {}
  class S3Client {
    constructor(_config: unknown) {}
    async send(command: any): Promise<any> {
      if (command instanceof PutObjectCommand) {
        fakeBucket.objects.set(command.input.Key, command.input.Body);
        return {};
      }
      const found = fakeBucket.objects.get(command.input.Key);
      if (command instanceof HeadObjectCommand) {
        if (!found) throw fakeBucket.notFound();
        return { ContentLength: found.length, LastModified: new Date('2026-01-01T00:00:00.000Z') };
      }
      if (command instanceof GetObjectCommand) {
        if (!found) throw fakeBucket.notFound();
        return { Body: found };
      }
      throw new Error(`fake S3 bucket: unhandled command ${command.constructor.name}`);
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_client: unknown, command: any) => `https://signed.example/${encodeURIComponent(command.input.Key)}`,
}));

const BASE = '/api/v1/storage';
const PRESIGNED = `${BASE}/upload/presigned`;
const COMMIT = `${BASE}/upload/complete`;
const DOWNLOAD_URL = `${BASE}/files/:fileId/url`;
const RAW = `${BASE}/_local/raw/:token`;

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

function createMockReq(overrides: Partial<IHttpRequest> & Record<string, unknown> = {}): IHttpRequest {
  return { params: {}, query: {}, body: undefined, headers: {}, method: 'GET', path: '/', ...overrides } as IHttpRequest;
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

/** The token a local presigned URL carries — its last path segment. */
const tokenOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1);

interface Composition {
  /** The storage the doors are mounted on. */
  storage: IStorageService;
  /** Send the upload's bytes the way a client does, to the URL the presigned door answered. */
  putBytes(server: ReturnType<typeof createMockHttpServer>, uploadUrl: string, key: string, bytes: Buffer): Promise<void>;
}

let rootDir: string;

/** The client's PUT to a local presigned URL: the `_local/raw/:token` byte route. */
async function putThroughRawRoute(server: ReturnType<typeof createMockHttpServer>, uploadUrl: string, _key: string, bytes: Buffer) {
  const res = createMockRes();
  await server.handler('PUT', RAW)(createMockReq({ params: { token: tokenOf(uploadUrl) }, rawBody: async () => bytes }), res);
  expect(res._status, JSON.stringify(res._json)).toBe(200);
}

/** Built per test, inside `beforeEach`, once `rootDir` exists. */
const COMPOSITIONS: Array<{ name: string; make: () => Composition }> = [
  {
    name: 'LocalStorageAdapter',
    make: () => ({
      storage: new LocalStorageAdapter({ rootDir, signingSecret: 'complete-holds-bytes' }),
      putBytes: putThroughRawRoute,
    }),
  },
  {
    name: 'SwappableStorageService over the local adapter',
    make: () => ({
      storage: new SwappableStorageService(new LocalStorageAdapter({ rootDir, signingSecret: 'complete-holds-bytes' })),
      putBytes: putThroughRawRoute,
    }),
  },
  {
    name: 'S3StorageAdapter (fake bucket)',
    make: () => {
      const s3 = new S3StorageAdapter({ bucket: 'complete-holds-bytes', region: 'us-east-1', keyPrefix: 'env-24548' });
      return {
        storage: s3,
        // The browser PUTs straight to the bucket; the object lands under the
        // file's key exactly as the adapter's own PutObject puts it.
        putBytes: async (_server, _url, key, bytes) => { await s3.upload(key, bytes); },
      };
    },
  },
];

beforeEach(async () => {
  rootDir = join(tmpdir(), `os-complete-holds-bytes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(rootDir, { recursive: true });
  fakeBucket.objects.clear();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(rootDir, { recursive: true, force: true });
});

describe.each(COMPOSITIONS)('[#24548] the commit door asks the backend — $name', ({ make }) => {
  let comp: Composition;
  let store: StorageMetadataStore;
  let server: ReturnType<typeof createMockHttpServer>;

  beforeEach(() => {
    comp = make();
    store = new StorageMetadataStore(null);
    server = createMockHttpServer();
    registerStorageRoutes(server as any, comp.storage, store, { basePath: BASE });
  });

  async function presign(size: number) {
    const res = createMockRes();
    await server.handler('POST', PRESIGNED)(
      createMockReq({ body: { filename: 'ghost.txt', mimeType: 'text/plain', size } }),
      res,
    );
    expect(res._status, JSON.stringify(res._json)).toBe(200);
    const { fileId, uploadUrl } = res._json.data as { fileId: string; uploadUrl: string };
    const key = (await store.getFile(fileId))!.key;
    return { fileId, uploadUrl, key };
  }

  async function commit(fileId: string): Promise<Res> {
    const res = createMockRes();
    await server.handler('POST', COMMIT)(createMockReq({ body: { fileId } }), res);
    return res;
  }

  async function downloadUrl(fileId: string): Promise<Res> {
    const res = createMockRes();
    await server.handler('GET', DOWNLOAD_URL)(createMockReq({ params: { fileId } }), res);
    return res;
  }

  it('no bytes stored → 409 RESOURCE_CONFLICT, the row stays pending, nothing is servable', async () => {
    const { fileId } = await presign(5);

    const res = await commit(fileId);

    expect(res._status, JSON.stringify(res._json)).toBe(409);
    expect(res._json?.success).toBe(false);
    expect(res._json?.error?.code).toBe('RESOURCE_CONFLICT');
    expect((await store.getFile(fileId))?.status).toBe('pending');
    // …so the download door does not hand out a URL for bytes nobody holds.
    expect((await downloadUrl(fileId))._status).toBe(404);
  });

  it('bytes of the declared size stored → 200, committed, and servable', async () => {
    const { fileId, uploadUrl, key } = await presign(5);
    await comp.putBytes(server, uploadUrl, key, Buffer.from('hello'));

    const res = await commit(fileId);

    expect(res._status, JSON.stringify(res._json)).toBe(200);
    expect(res._json?.data?.fileId).toBe(fileId);
    expect(res._json?.data?.size).toBe(5);
    expect((await store.getFile(fileId))?.status).toBe('committed');
    expect((await downloadUrl(fileId))._status).toBe(200);
  });

  it('bytes of another size stored → 409 RESOURCE_CONFLICT and pending; the right bytes then commit', async () => {
    const { fileId, uploadUrl, key } = await presign(5);
    await comp.putBytes(server, uploadUrl, key, Buffer.from('hel'));

    const refused = await commit(fileId);
    expect(refused._status, JSON.stringify(refused._json)).toBe(409);
    expect(refused._json?.error?.code).toBe('RESOURCE_CONFLICT');
    expect((await store.getFile(fileId))?.status).toBe('pending');

    // Recoverable, as the refusal says: send the whole file, complete again.
    await comp.putBytes(server, uploadUrl, key, Buffer.from('hello'));
    const committed = await commit(fileId);
    expect(committed._status, JSON.stringify(committed._json)).toBe(200);
    expect((await store.getFile(fileId))?.status).toBe('committed');
  });
});

describe('[#24548] the local raw byte route: a key that holds no file is 404, not 500', () => {
  let adapter: LocalStorageAdapter;
  let server: ReturnType<typeof createMockHttpServer>;

  beforeEach(() => {
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'complete-holds-bytes' });
    server = createMockHttpServer();
    registerStorageRoutes(server as any, adapter, new StorageMetadataStore(null), { basePath: BASE });
  });

  async function rawGet(key: string): Promise<Res> {
    const { downloadUrl } = await adapter.getPresignedDownload(key, 600);
    const res = createMockRes();
    await server.handler('GET', RAW)(createMockReq({ params: { token: tokenOf(downloadUrl) } }), res);
    return res;
  }

  it('a signed GET for a key with no file answers 404 FILE_NOT_FOUND', async () => {
    const res = await rawGet('user/never-uploaded.txt');

    expect(res._status, JSON.stringify(res._json)).toBe(404);
    expect(res._json?.success).toBe(false);
    expect(res._json?.error?.code).toBe('FILE_NOT_FOUND');
  });

  it('every other read failure keeps its 500 (a key that names a directory)', async () => {
    await fs.mkdir(join(rootDir, 'user', 'a-directory'), { recursive: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await rawGet('user/a-directory');

    expect(res._status, JSON.stringify(res._json)).toBe(500);
    expect(res._json?.error?.code).toBe('INTERNAL');
  });

  it('a stored file is served', async () => {
    await adapter.upload('user/held.txt', Buffer.from('held'));

    const res = (await rawGet('user/held.txt')) as Res & { _sent?: Buffer };

    expect(res._status).toBe(200);
    expect(String(res._sent)).toBe('held');
  });
});
