// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A chunked upload to S3 finds its object key in the upload session row, on
 * any process.
 *
 * S3 addresses a multipart upload by `(Key, UploadId)`, but the
 * `IStorageService` chunk and completion methods carry the `uploadId` alone.
 * The S3 adapter answers the key from its own `uploadId → key` map, which
 * `setUploadKey` fills. Two ways that map came up empty:
 *
 *   1. The plugin registers the SWAPPABLE proxy as the kernel's `storage`
 *      service, and the proxy did not forward `setUploadKey`, so the init
 *      door's call never reached the adapter. Chunk 0 answered 500 on a single
 *      replica.
 *   2. The map lives in one process. A chunk or completion served by another
 *      replica (or by the same replica after a restart or an adapter swap)
 *      had no entry, whatever the init door did.
 *
 * The durable record of the key is `sys_upload_session.key`, written by the
 * init door. The chunk and completion doors read that row before they reach
 * the backend, so they hand its key to the adapter on every call. These cases
 * drive the doors against an S3-compatible stand-in that, like S3, refuses a
 * part or a completion addressed to the wrong key.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fakeS3 = vi.hoisted(() => {
  const objects = new Map<string, Buffer>();
  const multipart = new Map<string, { key: string; parts: Map<number, Buffer> }>();
  let uploadSeq = 0;

  function noSuchUpload(): Error {
    const err = new Error('NoSuchUpload') as Error & { name: string; $metadata: { httpStatusCode: number } };
    err.name = 'NoSuchUpload';
    err.$metadata = { httpStatusCode: 404 };
    return err;
  }

  /** S3 matches BOTH halves of the address: an UploadId under another Key is no upload at all. */
  function upload(input: { Key?: string; UploadId?: string }) {
    const found = input.UploadId ? multipart.get(input.UploadId) : undefined;
    if (!found || found.key !== input.Key) throw noSuchUpload();
    return found;
  }

  function reset(): void {
    objects.clear();
    multipart.clear();
    uploadSeq = 0;
  }

  return { objects, multipart, upload, reset, nextUploadId: () => `s3-upload-${++uploadSeq}` };
});

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: Record<string, any>) {}
  }
  class CreateMultipartUploadCommand extends Command {}
  class UploadPartCommand extends Command {}
  class CompleteMultipartUploadCommand extends Command {}
  class AbortMultipartUploadCommand extends Command {}

  class S3Client {
    constructor(_config: unknown) {}
    async send(command: any): Promise<any> {
      const input = command.input;
      if (command instanceof CreateMultipartUploadCommand) {
        const uploadId = fakeS3.nextUploadId();
        fakeS3.multipart.set(uploadId, { key: input.Key, parts: new Map() });
        return { UploadId: uploadId };
      }
      if (command instanceof UploadPartCommand) {
        fakeS3.upload(input).parts.set(input.PartNumber, input.Body);
        return { ETag: `"etag-${input.PartNumber}"` };
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        const found = fakeS3.upload(input);
        const listed: Array<{ PartNumber: number }> = input.MultipartUpload.Parts;
        fakeS3.objects.set(input.Key, Buffer.concat(listed.map((p) => found.parts.get(p.PartNumber)!)));
        fakeS3.multipart.delete(input.UploadId);
        return {};
      }
      if (command instanceof AbortMultipartUploadCommand) {
        fakeS3.upload(input);
        fakeS3.multipart.delete(input.UploadId);
        return {};
      }
      throw new Error(`S3 stand-in: unhandled command ${command.constructor.name}`);
    }
  }

  return {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
  };
});

import type { IHttpRequest, IHttpResponse, IStorageService, RouteHandler } from '@objectstack/spec/contracts';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { S3StorageAdapter } from './s3-storage-adapter.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { SwappableStorageService } from './swappable-storage-service.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

const BASE = '/api/v1/storage';
const INIT = `${BASE}/upload/chunked`;
const CHUNK = `${BASE}/upload/chunked/:uploadId/chunk/:chunkIndex`;
const COMPLETE = `${BASE}/upload/chunked/:uploadId/complete`;

/** The smallest chunk the init door accepts (5 MiB), so two chunks are one full and one short. */
const CHUNK_SIZE = 5 * 1024 * 1024;
const FIRST = Buffer.alloc(CHUNK_SIZE, 0x61);
const SECOND = Buffer.from('tail');

/**
 * The stored object is the whole file, byte for byte. Compared with
 * `Buffer.equals` rather than `toEqual`, which walks 5 MiB one element at a time.
 */
function expectWhole(stored: Buffer | undefined): void {
  expect(stored?.length).toBe(FIRST.length + SECOND.length);
  expect(stored?.equals(Buffer.concat([FIRST, SECOND]))).toBe(true);
}

type Res = IHttpResponse & { _status: number; _json: any };

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

function createMockReq(overrides: Record<string, unknown>): IHttpRequest {
  return { params: {}, query: {}, body: undefined, headers: {}, method: 'GET', path: '/', ...overrides } as IHttpRequest;
}

/**
 * One server process: its own adapter instance (so its own in-process state)
 * mounted behind its own swappable proxy, the way `StorageServicePlugin`
 * composes it. Replicas share the metadata store (the database) and the bucket.
 */
function replica(store: StorageMetadataStore, inner: IStorageService) {
  const routes = new Map<string, RouteHandler>();
  const server = {
    get: (path: string, h: RouteHandler) => { routes.set(`GET:${path}`, h); },
    post: (path: string, h: RouteHandler) => { routes.set(`POST:${path}`, h); },
    put: (path: string, h: RouteHandler) => { routes.set(`PUT:${path}`, h); },
    delete: () => {},
    patch: () => {},
    use: () => {},
  };
  registerStorageRoutes(server as any, new SwappableStorageService(inner), store, { basePath: BASE });
  const call = async (method: string, path: string, req: Record<string, unknown>): Promise<Res> => {
    const res = createMockRes();
    await routes.get(`${method}:${path}`)!(createMockReq(req), res);
    return res;
  };
  return {
    init: () =>
      call('POST', INIT, {
        body: { filename: 'big.bin', mimeType: 'application/octet-stream', totalSize: FIRST.length + SECOND.length, chunkSize: CHUNK_SIZE },
      }),
    chunk: (uploadId: string, resumeToken: string, chunkIndex: number, bytes: Buffer) =>
      call('PUT', CHUNK, {
        params: { uploadId, chunkIndex: String(chunkIndex) },
        headers: { 'x-resume-token': resumeToken },
        rawBody: async () => bytes,
      }),
    complete: (uploadId: string, parts: Array<{ chunkIndex: number; eTag: string }>) =>
      call('POST', COMPLETE, { params: { uploadId }, body: { uploadId, parts } }),
  };
}

const s3 = () => new S3StorageAdapter({ bucket: 'uploads', region: 'us-east-1', keyPrefix: null });

/** Drive one upload: init on `a`, chunk 0 on `b`, chunk 1 and completion on `c`. */
async function drive(a: ReturnType<typeof replica>, b: ReturnType<typeof replica>, c: ReturnType<typeof replica>) {
  const init = await a.init();
  expect(init._status, JSON.stringify(init._json)).toBe(200);
  const { uploadId, resumeToken } = init._json.data;

  const first = await b.chunk(uploadId, resumeToken, 0, FIRST);
  expect(first._status, JSON.stringify(first._json)).toBe(200);
  const second = await c.chunk(uploadId, resumeToken, 1, SECOND);
  expect(second._status, JSON.stringify(second._json)).toBe(200);

  const done = await c.complete(uploadId, [
    { chunkIndex: 0, eTag: first._json.data.eTag },
    { chunkIndex: 1, eTag: second._json.data.eTag },
  ]);
  expect(done._status, JSON.stringify(done._json)).toBe(200);
  return done._json.data as { fileId: string; key: string; size: number };
}

beforeEach(() => {
  fakeS3.reset();
});

describe('a chunked upload through the swappable proxy reaches the S3 object it started', () => {
  it('completes on a single replica', async () => {
    const one = replica(new StorageMetadataStore(null), s3());

    const done = await drive(one, one, one);

    expect(done.size).toBe(FIRST.length + SECOND.length);
    expectWhole(fakeS3.objects.get(done.key));
    expect(fakeS3.multipart.size).toBe(0);
  });

  it('resumes on a fresh adapter instance: another process finds the key in the session row', async () => {
    // One database and one bucket; three processes, none sharing memory. The
    // replica that serves a chunk or the completion has never seen the init.
    const store = new StorageMetadataStore(null);
    const a = replica(store, s3());
    const b = replica(store, s3());
    const c = replica(store, s3());

    const done = await drive(a, b, c);

    expectWhole(fakeS3.objects.get(done.key));
    expect(fakeS3.multipart.size).toBe(0);
    // The key the object landed under is the one the session row recorded.
    const file = await store.getFile(done.fileId);
    expect(file?.key).toBe(done.key);
    expect(file?.status).toBe('committed');
  });
});

describe('adapters that do not track upload keys are untouched', () => {
  let rootDir: string;

  afterEach(async () => {
    if (rootDir) await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('local: the assembled file holds the bytes sent, across two adapter instances on one root', async () => {
    rootDir = join(tmpdir(), `os-chunk-session-key-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    const store = new StorageMetadataStore(null);
    const local = () => new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
    const reader = local();

    const done = await drive(replica(store, local()), replica(store, local()), replica(store, local()));

    expectWhole(await reader.download(done.key));
  });

  it('an adapter with no setUploadKey receives exactly the contract calls, with the arguments it did before', async () => {
    const calls: unknown[][] = [];
    const parts = new Map<string, Buffer[]>();
    const memory: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.alloc(0),
      delete: async () => {},
      exists: async () => false,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date(0) }),
      initiateChunkedUpload: async (key) => {
        calls.push(['initiateChunkedUpload', key]);
        parts.set('mem-1', []);
        return 'mem-1';
      },
      uploadChunk: async (uploadId, partNumber, data) => {
        calls.push(['uploadChunk', uploadId, partNumber, data.length]);
        parts.get(uploadId)!.push(data);
        return `m${partNumber}`;
      },
      completeChunkedUpload: async (uploadId, listed) => {
        calls.push(['completeChunkedUpload', uploadId, listed]);
        return 'assembled-key';
      },
    };

    const one = replica(new StorageMetadataStore(null), memory);
    const done = await drive(one, one, one);

    expect(done.key).toBe('assembled-key');
    expect(calls).toEqual([
      ['initiateChunkedUpload', expect.stringMatching(/^user\/.+\.bin$/)],
      ['uploadChunk', 'mem-1', 1, FIRST.length],
      ['uploadChunk', 'mem-1', 2, SECOND.length],
      ['completeChunkedUpload', 'mem-1', [{ partNumber: 1, eTag: 'm1' }, { partNumber: 2, eTag: 'm2' }]],
    ]);
  });
});
