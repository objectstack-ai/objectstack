// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Stored bytes are served by one rule (`served-bytes-policy.ts`): a type
// outside the inline allow-list is an `attachment`, every answer from the app
// origin carries `nosniff` and the sandbox CSP, and the S3 signed URL bakes the
// same type and disposition into its response parameters.
//
// An allow-listed type is previewed in place only when the stored bytes begin
// with that type's leading signature; any other body is an attachment.
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
  LEADING_SIGNATURES,
  STORED_BYTES_CONTENT_SECURITY_POLICY,
  STORED_MEDIA_CONTENT_SECURITY_POLICY,
  bytesBeginWithTheirTypeSignature,
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

const hex = (h: string) => Buffer.from(h.replace(/\s+/g, ''), 'hex');
const box = (type: string, ...brands: string[]) =>
  Buffer.concat([hex((8 + 4 * (brands.length + 1)).toString(16).padStart(8, '0')), Buffer.from(type), Buffer.from(brands[0]), hex('00000000'), ...brands.slice(1).map((b) => Buffer.from(b))]);
const riff = (form: string) => Buffer.concat([Buffer.from('RIFF'), hex('24000000'), Buffer.from(form), Buffer.from('fmt ')]);

/** The leading bytes of a file of each allow-listed type. */
const SIGNED: Record<string, Buffer> = {
  'image/png': hex('89504e470d0a1a0a 0000000d 49484452'),
  'image/jpeg': hex('ffd8ffe0 00104a46 494600'),
  'image/gif': Buffer.from('GIF89a\x01\x00\x01\x00', 'latin1'),
  'image/webp': riff('WEBP'),
  'image/avif': box('ftyp', 'avif', 'avif', 'mif1', 'miaf'),
  'image/bmp': Buffer.concat([Buffer.from('BM'), hex('3a000000 00000000')]),
  'application/pdf': Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n'),
  'text/plain': Buffer.from('plain words\n'),
  'audio/mpeg': Buffer.concat([Buffer.from('ID3'), hex('03000000000a')]),
  'audio/mp4': box('ftyp', 'M4A ', 'M4A ', 'isom'),
  'audio/aac': hex('fff15080 1bfffc'),
  'audio/ogg': Buffer.concat([Buffer.from('OggS'), hex('0002')]),
  'audio/wav': riff('WAVE'),
  'audio/wave': riff('WAVE'),
  'audio/x-wav': riff('WAVE'),
  'audio/webm': hex('1a45dfa3 9f4286'),
  'audio/flac': Buffer.concat([Buffer.from('fLaC'), hex('00000022')]),
  'video/mp4': box('ftyp', 'isom', 'isom', 'mp41'),
  'video/webm': hex('1a45dfa3 9f4286'),
  'video/ogg': Buffer.concat([Buffer.from('OggS'), hex('0002')]),
  'video/quicktime': box('ftyp', 'qt  ', 'qt  '),
};
/** The bytes a declared type is signed with here: its own signature when allow-listed, plain words otherwise. */
const signed = (declared: string | undefined) => SIGNED[servedContentType(declared).split(';')[0]] ?? SIGNED['text/plain'];
const WORDS = SIGNED['text/plain'];

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
      const headers = servedBytesHeaders({ contentType, filename: 'f', disposition: undefined, bytes: signed(contentType) });
      expect(headers['x-content-type-options']).toBe('nosniff');
      expect(headers['content-security-policy']).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
      expect(STORED_BYTES_CONTENT_SECURITY_POLICY.split(';')[0]).toBe('sandbox');
    }
    expect(servedBytesHeaders({ contentType: 'text/html', filename: undefined, disposition: undefined, bytes: WORDS })['content-disposition']).toBe(
      'attachment',
    );
  });

  it('allow-listed audio or video answered inline carries the media policy: still a sandbox, no script, media from its own origin', async () => {
    for (const contentType of ['audio/mpeg', 'audio/wav', 'video/mp4', 'VIDEO/WEBM; codecs=vp8']) {
      expect(servedBytesHeaders({ contentType, filename: 'f', disposition: undefined, bytes: signed(contentType) })['content-security-policy'], contentType).toBe(
        STORED_MEDIA_CONTENT_SECURITY_POLICY,
      );
    }
    const directives = STORED_MEDIA_CONTENT_SECURITY_POLICY.split(';').map((d) => d.trim());
    expect(directives[0]).toBe('sandbox allow-same-origin');
    expect(STORED_MEDIA_CONTENT_SECURITY_POLICY).not.toMatch(/allow-scripts|script-src/);
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("media-src 'self'");
  });

  it('every other answer carries the opaque-origin policy, audio asked for as an attachment included', async () => {
    for (const contentType of ['image/png', 'application/pdf', 'text/plain', 'text/html', 'image/svg+xml', 'audio/x-mpegurl', undefined]) {
      expect(servedBytesHeaders({ contentType, filename: 'f', disposition: undefined, bytes: signed(contentType) })['content-security-policy'], String(contentType)).toBe(
        STORED_BYTES_CONTENT_SECURITY_POLICY,
      );
    }
    expect(servedBytesHeaders({ contentType: 'audio/mpeg', filename: 'f', disposition: 'attachment', bytes: signed('audio/mpeg') })['content-security-policy']).toBe(
      STORED_BYTES_CONTENT_SECURITY_POLICY,
    );
  });
});

describe('an allow-listed type is previewed in place only when the bytes begin with its signature', () => {
  const MEDIA = [...INLINE_CONTENT_TYPES].filter((type) => /^(audio|video)\//.test(type));

  it('the signature table covers every allow-listed type, the 13 audio and video types among them', () => {
    expect(MEDIA).toHaveLength(13);
    expect([...LEADING_SIGNATURES.keys()].sort()).toEqual([...INLINE_CONTENT_TYPES].sort());
    expect(Object.keys(SIGNED).sort()).toEqual([...INLINE_CONTENT_TYPES].sort());
  });

  it('each type matches its own leading bytes, and an empty body matches none', () => {
    for (const type of INLINE_CONTENT_TYPES) {
      expect(bytesBeginWithTheirTypeSignature(type, SIGNED[type]), type).toBe(true);
      expect(bytesBeginWithTheirTypeSignature(type, new Uint8Array()), type).toBe(false);
    }
  });

  it('each type but plain text refuses plain words, and each but PNG refuses the bytes of a PNG', () => {
    for (const type of INLINE_CONTENT_TYPES) {
      if (type !== 'text/plain') expect(bytesBeginWithTheirTypeSignature(type, WORDS), type).toBe(false);
      if (type !== 'image/png') expect(bytesBeginWithTheirTypeSignature(type, SIGNED['image/png']), type).toBe(false);
    }
    expect(bytesBeginWithTheirTypeSignature('image/png', SIGNED['image/jpeg'])).toBe(false);
  });

  it('an ISO media file is AVIF only when its brands name it', () => {
    expect(bytesBeginWithTheirTypeSignature('image/avif', SIGNED['video/mp4'])).toBe(false);
  });

  it('plain text is any body that opens with a byte-order mark or carries no binary data byte', () => {
    expect(bytesBeginWithTheirTypeSignature('text/plain; charset=utf-8', Buffer.from('<p>markup is text</p>\r\n\t'))).toBe(true);
    expect(bytesBeginWithTheirTypeSignature('text/plain', hex('fffe 6800 6900'))).toBe(true);
    expect(bytesBeginWithTheirTypeSignature('text/plain', hex('68 69 00 21'))).toBe(false);
    expect(bytesBeginWithTheirTypeSignature('text/plain', Buffer.concat([Buffer.alloc(1445, 0x61), hex('00')]))).toBe(true);
  });

  it('a type off the allow-list matches no signature', () => {
    for (const type of [...ACTIVE, 'application/octet-stream', undefined]) {
      expect(bytesBeginWithTheirTypeSignature(type, WORDS), String(type)).toBe(false);
    }
  });

  it('a body without its signature is an attachment under the default policy, media types included', () => {
    for (const contentType of INLINE_CONTENT_TYPES) {
      const other = contentType === 'image/png' ? SIGNED['image/jpeg'] : SIGNED['image/png'];
      const headers = servedBytesHeaders({ contentType, filename: undefined, disposition: 'inline', bytes: other });
      expect(headers['content-disposition'], contentType).toBe('attachment');
      expect(headers['content-security-policy'], contentType).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
      expect(headers['x-content-type-options'], contentType).toBe('nosniff');
    }
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

  async function fetchRaw(contentType: string | undefined, filename: string | undefined, bytes: Buffer = signed(contentType)) {
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

  it('control: an ordinary PNG and PDF still preview, inline under their own type', async () => {
    for (const [type, name] of [['image/png', 'pixel.png'], ['application/pdf', 'doc.pdf']]) {
      const res = await fetchRaw(type, name);
      expect(res.headers['content-type'], type).toBe(type);
      expect(res.headers['content-disposition'], type).toMatch(/^inline;/);
    }
  });

  it('an allow-listed WAV is inline with nosniff and the media policy', async () => {
    const res = await fetchRaw('audio/wav', 'tone.wav');
    expect(res.headers['content-disposition']).toMatch(/^inline;/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe(STORED_MEDIA_CONTENT_SECURITY_POLICY);
  });

  it('an allow-listed PNG or PDF is inline with nosniff and the sandbox CSP', async () => {
    for (const [type, name] of [['image/png', 'pixel.png'], ['application/pdf', 'doc.pdf']]) {
      const res = await fetchRaw(type, name);
      expect(res.headers['content-disposition'], type).toMatch(/^inline;/);
      expect(res.headers['x-content-type-options'], type).toBe('nosniff');
      expect(res.headers['content-security-policy'], type).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
    }
  });

  it('a raster file whose bytes lack its signature downloads; one that begins with it previews', async () => {
    const mismatched = await fetchRaw('image/png', 'pixel.png', WORDS);
    expect(mismatched.headers['content-disposition']).toMatch(/^attachment;/);
    expect(mismatched.headers['content-type']).toBe('image/png');
    expect(mismatched.headers['x-content-type-options']).toBe('nosniff');
    expect(mismatched.headers['content-security-policy']).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
    expect(mismatched.body).toEqual(WORDS);
    const matching = await fetchRaw('image/png', 'pixel.png', SIGNED['image/png']);
    expect(matching.headers['content-disposition']).toMatch(/^inline;/);
  });

  it('an audio or video file whose bytes lack its signature downloads under the default policy; one that begins with it previews', async () => {
    for (const [type, name] of [['audio/mpeg', 'tone.mp3'], ['video/mp4', 'clip.mp4']]) {
      const mismatched = await fetchRaw(type, name, WORDS);
      expect(mismatched.headers['content-disposition'], type).toMatch(/^attachment;/);
      expect(mismatched.headers['x-content-type-options'], type).toBe('nosniff');
      expect(mismatched.headers['content-security-policy'], type).toBe(STORED_BYTES_CONTENT_SECURITY_POLICY);
      const matching = await fetchRaw(type, name, SIGNED[type]);
      expect(matching.headers['content-disposition'], type).toMatch(/^inline;/);
      expect(matching.headers['content-security-policy'], type).toBe(STORED_MEDIA_CONTENT_SECURITY_POLICY);
    }
  });

  it('a plain-text file whose bytes are binary downloads; plain words preview', async () => {
    expect((await fetchRaw('text/plain', 'notes.txt', SIGNED['image/png'])).headers['content-disposition']).toMatch(/^attachment;/);
    expect((await fetchRaw('text/plain', 'notes.txt', WORDS)).headers['content-disposition']).toMatch(/^inline;/);
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

  it('control: an ordinary PNG is still signed inline under its type', async () => {
    const input = await baked('image/png', 'pixel.png');
    expect(input.ResponseContentDisposition).toMatch(/^inline;/);
    expect(input.ResponseContentType).toBe('image/png');
  });

  it('the type is baked by its essence, and is baked even when the caller names none', async () => {
    expect((await baked('IMAGE/PNG; x=1', 'pixel.png')).ResponseContentType).toBe('image/png');
    const none = await baked(undefined, 'blob');
    expect(none.ResponseContentType).toBe('application/octet-stream');
    expect(none.ResponseContentDisposition).toMatch(/^attachment;/);
  });
});
