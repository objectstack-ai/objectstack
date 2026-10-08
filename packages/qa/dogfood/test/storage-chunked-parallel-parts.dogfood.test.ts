// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22332] Chunk PUTs sent in parallel to one upload each record their part —
// over the HTTP doors of a REAL boot.
//
// The package suite (`service-storage/src/chunk-part-record-concurrency.test.ts`)
// pins the rule at the route handlers, over the engine-absent stand-in and a
// real ObjectQL on SqlDriver. This file sends the chunks the way a parallel
// (S3-style) uploader does — every PUT in flight at once — through the booted
// stack's own engine and driver, then reads the progress back and completes the
// upload listing every part. Before the fix both PUTs answered `200`, the
// progress counted one chunk, and the completion was refused `409` naming the
// chunk the record had lost.
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

describe('[#22332] parallel chunk PUTs each record their part, over a real boot', () => {
  let stack: VerifyStack;
  let token: string;

  const json = { 'Content-Type': 'application/json' };
  const auth = () => ({ Authorization: `Bearer ${token}` });

  const init = async (totalSize: number) => {
    const res = await stack.api('/storage/upload/chunked', {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({ filename: 'parallel.bin', mimeType: 'application/octet-stream', totalSize }),
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

  const fill = (byte: number, n: number) => new Uint8Array(n).fill(byte);

  beforeAll(async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'chunked-parallel-dogfood-'));
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

  it('two chunks sent at once are both recorded, and the upload completes with the whole file', async () => {
    const chunk0 = fill(0x61, MIN_CHUNK);
    const chunk1 = fill(0x62, 10);
    const { uploadId, resumeToken, fileId } = await init(MIN_CHUNK + 10);

    const [eTag0, eTag1] = await Promise.all([
      putChunk(uploadId, resumeToken, 0, chunk0),
      putChunk(uploadId, resumeToken, 1, chunk1),
    ]);

    expect(await progress(uploadId)).toMatchObject({ uploadedChunks: 2, uploadedSize: MIN_CHUNK + 10 });
    const res = await stack.api(`/storage/upload/chunked/${uploadId}/complete`, {
      method: 'POST',
      headers: { ...json, ...auth() },
      body: JSON.stringify({
        uploadId,
        parts: [
          { chunkIndex: 0, eTag: eTag0 },
          { chunkIndex: 1, eTag: eTag1 },
        ],
      }),
    });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as any).data).toMatchObject({ fileId, size: MIN_CHUNK + 10 });
  });

  it('eight chunks sent at once are all recorded', async () => {
    const { uploadId, resumeToken, totalChunks } = await init(8 * MIN_CHUNK);
    expect(totalChunks).toBe(8);
    // Small, distinct sizes: the chunk door records what it is sent, and a lost
    // part shows in both counts.
    const chunks = Array.from({ length: 8 }, (_, i) => fill(0x61 + i, 10 + i));

    await Promise.all(chunks.map((bytes, i) => putChunk(uploadId, resumeToken, i, bytes)));

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    expect(await progress(uploadId)).toMatchObject({ uploadedChunks: 8, uploadedSize: total });
  });
});
