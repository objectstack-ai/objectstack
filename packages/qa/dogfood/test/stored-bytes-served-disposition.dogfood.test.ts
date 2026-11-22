// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Stored bytes are answered under one rule on a REAL boot with the local
// storage adapter: a type outside the inline allow-list is served as an
// `attachment`, every answer carries `nosniff` and the sandbox CSP, and an
// allow-listed type is still served `inline`.
//
// The package suite (`service-storage/src/served-bytes-policy.test.ts`) pins
// the rule and the S3 signed-URL parameters; this file runs the whole path a
// browser takes — presign, the byte PUT, commit, the download door's signed
// URL, and the raw byte route that answers it — through the real Hono app.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './fixtures/attachments-fixture.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a6a30000000049454e44ae426082', 'hex');
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const HTML = Buffer.from('<!doctype html><title>t</title><p>stored page</p>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>');
const TEXT = Buffer.from('plain words\n');

const SANDBOX_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

describe('stored bytes are served by the inline allow-list rule on a real boot', () => {
  let stack: VerifyStack;
  let token: string;

  const authed = (extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${token}`, ...extra });

  /** Upload through the presigned door and answer the raw byte route's response for the file. */
  async function uploadAndFetch(filename: string, mimeType: string, bytes: Buffer): Promise<Response> {
    const presign = await stack.api('/storage/upload/presigned', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ filename, mimeType, size: bytes.byteLength, scope: 'user' }),
    });
    expect(presign.status, await presign.clone().text()).toBe(200);
    const { data } = (await presign.json()) as any;

    const put = await stack.raw(String(data.uploadUrl).replace(/^https?:\/\/[^/]+/, ''), {
      method: 'PUT',
      headers: { 'content-type': mimeType },
      body: new Uint8Array(bytes),
    });
    expect(put.status, await put.clone().text()).toBeLessThan(300);

    const complete = await stack.api('/storage/upload/complete', {
      method: 'POST',
      headers: authed({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ fileId: data.fileId }),
    });
    expect(complete.status, await complete.clone().text()).toBe(200);

    const link = await stack.api(`/storage/files/${data.fileId}/url`, { headers: authed() });
    expect(link.status, await link.clone().text()).toBe(200);
    const url = String(((await link.json()) as any).data.url);
    // The signed link is the app's own raw byte route: it is answered on the app origin.
    expect(url).toMatch(/\/api\/v1\/storage\/_local\/raw\//);
    const served = await stack.raw(url.replace(/^https?:\/\/[^/]+/, ''));
    expect(served.status).toBe(200);
    return served;
  }

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'served-bytes-dogfood-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      extraPlugins: [new StorageServicePlugin({ adapter: 'local', local: { rootDir } })],
    });
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a text/html upload is served as an attachment, with nosniff and the sandbox CSP', async () => {
    const res = await uploadAndFetch('page.html', 'text/html', HTML);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe(SANDBOX_CSP);
  });

  it('an image/svg+xml upload is served as an attachment, with nosniff', async () => {
    const res = await uploadAndFetch('drawing.svg', 'image/svg+xml', SVG);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('a declared type is answered by its essence, so no spelling of it reaches inline', async () => {
    const res = await uploadAndFetch('odd.html', 'Text/HTML ; charset=utf-8', HTML);
    expect(res.headers.get('content-type')).toBe('text/html');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('a declared type that is not a media type is served as opaque bytes, as an attachment', async () => {
    const res = await uploadAndFetch('odd.bin', 'not a type', HTML);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
  });

  it('control: an allow-listed PNG is still served inline under its type, with nosniff and the sandbox CSP', async () => {
    const res = await uploadAndFetch('pixel.png', 'image/png', PNG);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe(SANDBOX_CSP);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG), 'the stored bytes, unchanged').toBe(true);
  });

  it('control: an allow-listed PDF and plain text are served inline, with nosniff and the sandbox CSP', async () => {
    for (const [name, type, bytes] of [['doc.pdf', 'application/pdf', PDF], ['notes.txt', 'text/plain', TEXT]] as const) {
      const res = await uploadAndFetch(name, type, bytes);
      expect(res.headers.get('content-type'), name).toBe(type);
      expect(res.headers.get('content-disposition'), name).toMatch(/^inline;/);
      expect(res.headers.get('x-content-type-options'), name).toBe('nosniff');
      expect(res.headers.get('content-security-policy'), name).toBe(SANDBOX_CSP);
    }
  });
});
