// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Stored bytes are served by one rule (`served-bytes-policy.ts`): a type
// outside the inline allow-list is an `attachment`, every answer from the app
// origin carries `nosniff` and the sandbox CSP, and the S3 signed URL bakes the
// same type and disposition into its response parameters.
//
// The real-boot pin of the raw byte route lives in
// `packages/qa/dogfood/test/stored-bytes-served-disposition.dogfood.test.ts`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IHttpRequest, IHttpResponse, RouteHandler } from '@objectstack/spec/contracts';
import {
  INLINE_CONTENT_TYPES,
  STORED_BYTES_CONTENT_SECURITY_POLICY,
  servedBytesHeaders,
  servedContentType,
  servedDisposition,
} from './served-bytes-policy.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';
import { S3StorageAdapter } from './s3-storage-adapter.js';
import { StorageMetadataStore } from './metadata-store.js';
import { registerStorageRoutes } from './storage-routes.js';

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: Record<string, any>) {}
  }
  class GetObjectCommand extends Command {}
  class S3Client {
    constructor(_config: unknown) {}
    async send(): Promise<any> {
      return {};
    }
  }
  return { S3Client, GetObjectCommand };
});

// The signed URL carries the command's input, so a test reads what was baked in.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async (_client: unknown, command: any) =>
    `https://bucket.example/signed?input=${encodeURIComponent(JSON.stringify(command.input))}`,
}));

const ACTIVE = ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'text/xml', 'application/xml', 'text/javascript'];

describe('the inline allow-list', () => {
  it('SVG, HTML and every other active type are never on it', () => {
    for (const type of ACTIVE) expect(INLINE_CONTENT_TYPES.has(type), type).toBe(false);
  });

  it('a type outside the list, or no type, is an attachment whatever the caller asked', () => {
    for (const type of [...ACTIVE, 'application/octet-stream', 'application/zip', undefined, null, '', 'not a type']) {
      expect(servedDisposition(type, 'inline'), String(type)).toBe('attachment');
      expect(servedDisposition(type, undefined), String(type)).toBe('attachment');
    }
  });

  it('an allow-listed type is inline by default and an attachment when asked', () => {
    for (const type of ['image/png', 'image/jpeg', 'application/pdf', 'text/plain', 'audio/mpeg', 'video/mp4']) {
      expect(servedDisposition(type, undefined), type).toBe('inline');
      expect(servedDisposition(type, 'attachment'), type).toBe('attachment');
    }
  });

  it('the type is judged by its essence: case and parameters reach no other verdict', () => {
    expect(servedContentType('IMAGE/PNG; name=x')).toBe('image/png');
    expect(servedDisposition('Image/PNG ; q=1', undefined)).toBe('inline');
    expect(servedContentType('Text/HTML; charset=utf-8')).toBe('text/html');
    expect(servedDisposition('Text/HTML; charset=utf-8', undefined)).toBe('attachment');
    expect(servedContentType('text/plain; charset=UTF-8')).toBe('text/plain; charset=utf-8');
    expect(servedContentType('image/png, text/html')).toBe('application/octet-stream');
    expect(servedContentType(undefined)).toBe('application/octet-stream');
  });

  it('every answer carries nosniff and the sandbox CSP, inline or not', () => {
    for (const contentType of ['image/png', 'text/html']) {
      const headers = servedBytesHeaders({ contentType, filename: 'f', disposition: undefined });
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['content-security-policy']).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
      expect(STORED_BYTES_CONTENT_SECURITY_POLICY.split(';')[0]).toBe('sandbox');
    }
    expect(servedBytesHeaders({ contentType: 'text/html', filename: undefined, disposition: undefined })['content-disposition']).toBe(
      'attachment',
    );
  });
});

// ── The local adapter's raw byte route ──────────────────────────────────────

const BASE = '/api/v1/storage';
const RAW = `${BASE}/_local/raw/:token`;

function routeCapture() {
  const routes = new Map<string, RouteHandler>();
  const register = (method: string) => vi.fn((path: string, handler: RouteHandler) => void routes.set(`${method}:${path}`, handler));
  return {
    get: register('GET'),
    post: register('POST'),
    put: register('PUT'),
    delete: vi.fn(),
    patch: vi.fn(),
    use: vi.fn(),
    handler: (method: string, path: string) => routes.get(`${method}:${path}`)!,
  };
}

function served(): IHttpResponse & { status_: number; headers: Record<string, string>; body: unknown } {
  const res: any = {
    status_: 200,
    headers: {},
    body: undefined,
    status(code: number) { res.status_ = code; return res; },
    header(name: string, value: string) { res.headers[name.toLowerCase()] = value; return res; },
    json(data: unknown) { res.body = data; },
    send(data: unknown) { res.body = data; },
  };
  return res;
}

describe('the local raw byte route answers stored bytes by the allow-list rule', () => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;
  let server: ReturnType<typeof routeCapture>;

  beforeEach(async () => {
    rootDir = join(tmpdir(), `os-served-bytes-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir, signingSecret: 'served-bytes' });
    server = routeCapture();
    registerStorageRoutes(server as any, adapter, new StorageMetadataStore(null), { basePath: BASE });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  async function fetchRaw(contentType: string | undefined, filename: string | undefined, bytes = Buffer.from('<p>x</p>')) {
    await adapter.upload('k/file', bytes, { contentType });
    const { downloadUrl } = await adapter.getPresignedDownload('k/file', 60, { contentType, filename });
    const res = served();
    await server.handler('GET', RAW)({ params: { token: downloadUrl.slice(downloadUrl.lastIndexOf('/') + 1) }, query: {}, headers: {} } as unknown as IHttpRequest, res);
    expect(res.status_).toBe(200);
    return res;
  }

  it('a text/html file is an attachment, with nosniff and the sandbox CSP', async () => {
    const res = await fetchRaw('text/html', 'page.html');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
  });

  it('an image/svg+xml file is an attachment, with nosniff', async () => {
    const res = await fetchRaw('image/svg+xml', 'drawing.svg');
    expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('a link that names no file still answers an attachment for a type outside the list', async () => {
    const res = await fetchRaw('text/html', undefined);
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('control: a PNG and a PDF are inline under their type, with nosniff and the sandbox CSP', async () => {
    for (const [type, name] of [['image/png', 'pixel.png'], ['application/pdf', 'doc.pdf']]) {
      const res = await fetchRaw(type, name);
      expect(res.headers['content-type'], type).toBe(type);
      expect(res.headers['content-disposition'], type).toMatch(/^inline;/);
      expect(res.headers['x-content-type-options'], type).toBe('nosniff');
      expect(res.headers['content-security-policy'], type).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
    }
  });
});

// ── The S3 adapter's signed download URL ────────────────────────────────────

describe('the S3 signed download URL bakes in the same type and disposition', () => {
  const baked = async (contentType: string | undefined, filename: string | undefined) => {
    const s3 = new S3StorageAdapter({ bucket: 'served-bytes', region: 'us-east-1', keyPrefix: 'served-bytes' });
    const { downloadUrl } = await s3.getPresignedDownload('k/file', 60, { contentType, filename });
    return JSON.parse(new URL(downloadUrl).searchParams.get('input')!) as Record<string, string>;
  };

  it('a text/html or image/svg+xml file is signed as an attachment', async () => {
    for (const [type, name] of [['text/html', 'page.html'], ['image/svg+xml', 'drawing.svg']]) {
      const input = await baked(type, name);
      expect(input.ResponseContentDisposition, type).toMatch(/^attachment;/);
      expect(input.ResponseContentType, type).toBe(type);
    }
  });

  it('a type outside the list is signed as an attachment even when the link names no file', async () => {
    expect((await baked('text/html', undefined)).ResponseContentDisposition).toBe('attachment');
  });

  it('control: a PNG is signed inline under its type', async () => {
    const input = await baked('IMAGE/PNG', 'pixel.png');
    expect(input.ResponseContentDisposition).toMatch(/^inline;/);
    expect(input.ResponseContentType).toBe('image/png');
  });
});
