// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22313] A chunked upload completes with the file it was sent, or not at all —
// over the HTTP doors of a REAL boot.
//
// The package suite (`service-storage/src/chunked-upload-integrity.test.ts`)
// pins every rule at the route handlers. This file drives the four chunked
// doors the way the SDK's `resumeUpload` drives them (`packages/client`):
// progress first, then the chunks from `uploadedChunks` on, then a completion
// listing only what that pass sent — and reads the stored object back through
// the download door, because "200 with the declared size" is exactly what the
// short file looked like.
//
// Not eligible for the shared showcase project: it boots its own storage root.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { attachmentsFixtureStack, attachmentsFixtureSecurity } from './fixtures/attachments-fixture.js';

const MIB = 1024 * 1024;
/** The chunk size the init door floors every upload at. */
const MIN_CHUNK = 5 * MIB;

describe('[#22313] a chunked upload completes with the file it was sent, over a real boot', () => {
  let stack: VerifyStack;
  let token: string;

  const json = { 'Content-Type': 'application/json' };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const init = async (totalSize: number) => {
    const res = await stack.api('/storage/upload/chunked', {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ filename: 'resume.bin', mimeType: 'application/octet-stream', totalSize }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as any).data as { uploadId: string; resumeToken: string; fileId: string; totalChunks: number };
  };

  const putChunk = async (uploadId: string, resumeToken: string, chunkIndex: number, bytes: Uint8Array<ArrayBuffer>) => {
    const res = await stack.api(`/storage/upload/chunked/${uploadId}/chunk/${chunkIndex}`, {
      method: 'PUT',
      headers: { ...auth(), 'Content-Type': 'application/octet-stream', 'x-resume-token': resumeToken },
      body: bytes,
    });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as any).data.eTag as string;
  };

  const progress = async (uploadId: string) => {
    const res = await stack.api(`/storage/upload/chunked/${uploadId}/progress`, { headers: auth() });
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as any).data as Record<string, unknown>;
  };

  const complete = (uploadId: string, parts: Array<{ chunkIndex: number; eTag: string }>) =>
    stack.api(`/storage/upload/chunked/${uploadId}/complete`, {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ uploadId, parts }),
    });

  /** The stored object, read back through the public download door. */
  const download = async (fileId: string): Promise<Uint8Array> => {
    const res = await stack.api(`/storage/files/${fileId}/url`, { headers: auth() });
    expect(res.status, await res.clone().text()).toBe(200);
    const url = String(((await res.json()) as any).data.url).replace(/^https?:\/\/[^/]+/, '');
    const bytes = await stack.raw(url);
    expect(bytes.status).toBe(200);
    return new Uint8Array(await bytes.arrayBuffer());
  };

  const fill = (byte: number, n: number) => new Uint8Array(n).fill(byte);
  const concat = (a: Uint8Array, b: Uint8Array) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'chunked-resume-dogfood-'));
    stack = await bootStack(attachmentsFixtureStack as never, {
      security: attachmentsFixtureSecurity(),
      // `bindToSettings:false` keeps the constructor rootDir; the size limit is
      // not what this file is about.
      extraPlugins: [new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false })],
    });
    token = await stack.signIn();
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a RESUMED upload, driven as resumeUpload drives it, completes with the FULL file', async () => {
    const chunk0 = fill(0x61, MIN_CHUNK);
    const chunk1 = fill(0x62, 10);
    const { uploadId, resumeToken, fileId, totalChunks } = await init(MIN_CHUNK + 10);
    expect(totalChunks).toBe(2);

    // First pass: chunk 0 lands, then the client goes away.
    await putChunk(uploadId, resumeToken, 0, chunk0);

    // The resume: progress, the chunks from `uploadedChunks` on, and a
    // completion listing only the part this pass sent.
    const before = await progress(uploadId);
    expect(before.uploadedChunks).toBe(1);
    const eTag1 = await putChunk(uploadId, resumeToken, 1, chunk1);
    const res = await complete(uploadId, [{ chunkIndex: 1, eTag: eTag1 }]);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as any).data.size).toBe(MIN_CHUNK + 10);
    const stored = await download(fileId);
    expect(stored.length, 'the stored object is the whole file, not the resumed chunk alone').toBe(MIN_CHUNK + 10);
    expect(Buffer.from(stored).equals(Buffer.from(concat(chunk0, chunk1)))).toBe(true);
  });

  it('REFUSED: an upload that does not hold a declared chunk is refused 409 RESOURCE_CONFLICT naming it', async () => {
    const { uploadId, resumeToken } = await init(MIN_CHUNK + 10);
    const eTag1 = await putChunk(uploadId, resumeToken, 1, fill(0x62, 10));

    const res = await complete(uploadId, [{ chunkIndex: 1, eTag: eTag1 }]);

    expect(res.status, await res.clone().text()).toBe(409);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RESOURCE_CONFLICT');
    expect(body.error.details.missingChunks).toEqual([0]);
    // Still resumable: nothing was assembled and the session is in flight.
    expect((await progress(uploadId)).status).toBe('in_progress');
  });

  it('a RE-SENT chunk leaves the progress unchanged', async () => {
    const { uploadId, resumeToken } = await init(MIB);
    const chunk = fill(0x61, 600 * 1024);

    await putChunk(uploadId, resumeToken, 0, chunk);
    const once = await progress(uploadId);
    await putChunk(uploadId, resumeToken, 0, chunk);
    const twice = await progress(uploadId);

    expect(once).toMatchObject({ uploadedSize: 600 * 1024, uploadedChunks: 1, percentComplete: 59 });
    expect({ uploadedSize: twice.uploadedSize, uploadedChunks: twice.uploadedChunks, percentComplete: twice.percentComplete })
      .toEqual({ uploadedSize: once.uploadedSize, uploadedChunks: once.uploadedChunks, percentComplete: once.percentComplete });
  });

  it('CONTROL: a clean one-pass upload listing every part is unchanged', async () => {
    const chunk0 = fill(0x61, MIN_CHUNK);
    const chunk1 = fill(0x62, 10);
    const { uploadId, resumeToken, fileId } = await init(MIN_CHUNK + 10);
    const eTag0 = await putChunk(uploadId, resumeToken, 0, chunk0);
    const eTag1 = await putChunk(uploadId, resumeToken, 1, chunk1);

    const res = await complete(uploadId, [
      { chunkIndex: 0, eTag: eTag0 },
      { chunkIndex: 1, eTag: eTag1 },
    ]);

    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as any).data).toMatchObject({ fileId, size: MIN_CHUNK + 10 });
    expect(Buffer.from(await download(fileId)).equals(Buffer.from(concat(chunk0, chunk1)))).toBe(true);
  });
});
