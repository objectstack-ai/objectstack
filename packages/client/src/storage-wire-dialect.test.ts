// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Storage wire-dialect proof (#3689) — the SDK's storage methods against the
 * envelope `service-storage` actually emits, and against the one it emitted
 * before.
 *
 * The gap this pins: `storage.zod.ts` declared every storage response as
 * `BaseResponseSchema.extend({ data })`, `PresignedUrlResponse` and friends are
 * `z.infer`red from those schemas and published as these methods' return types
 * — and the methods returned `res.json()` raw. `res.json()` is `any`, so the
 * declaration could say `success: boolean` while the wire said nothing at all
 * and TypeScript would never know. `getDownloadUrl` was the one method that
 * read INTO a body, and it read `data.url` off a bare `{ url }`.
 *
 * #3689 moved the wire onto the declaration. This SDK ships as its own npm
 * package, so it meets servers on both sides of that change: the enveloped and
 * the bare body are both asserted here, and `unwrapResponse` — the client's one
 * standard envelope seam, not a fallback grown for this route — is what spans
 * them.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

function clientReturning(body: any) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    headers: new Headers(),
  });
  const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
  return { client, fetchMock };
}

describe('storage.getDownloadUrl reads the signed URL off either dialect (#3689)', () => {
  it('resolves from the declared { success: true, data: { url } } envelope', async () => {
    const { client, fetchMock } = clientReturning({
      success: true,
      data: { url: '/api/v1/storage/_local/raw/eyJrIjoi.c2ln' },
    });

    await expect(client.storage.getDownloadUrl('f1')).resolves.toBe(
      '/api/v1/storage/_local/raw/eyJrIjoi.c2ln',
    );
    expect(fetchMock.mock.calls[0][0]).toContain('/api/v1/storage/files/f1/url');
  });

  it('still resolves from the bare { url } an older server answers', async () => {
    // Not a tolerated dialect going forward — a version-skew allowance. The
    // client is published separately from the server it talks to, so a build
    // predating the #3689 rollout must keep resolving downloads.
    const { client } = clientReturning({ url: 'https://bucket.s3.amazonaws.com/user/f1.png?sig=abc' });

    await expect(client.storage.getDownloadUrl('f1')).resolves.toBe(
      'https://bucket.s3.amazonaws.com/user/f1.png?sig=abc',
    );
  });

  it('resolves an absolute S3-style URL out of the envelope unchanged', async () => {
    const { client } = clientReturning({
      success: true,
      data: { url: 'https://bucket.s3.amazonaws.com/user/f1.png?X-Amz-Signature=abc' },
    });

    await expect(client.storage.getDownloadUrl('f1')).resolves.toBe(
      'https://bucket.s3.amazonaws.com/user/f1.png?X-Amz-Signature=abc',
    );
  });
});

describe('the enveloped storage responses match their declared return types (#3689)', () => {
  /**
   * These methods hand back the whole envelope by design — their declared
   * return types ARE `BaseResponseSchema.extend({ data })`. Before #3689 the
   * `success` half of that declaration was fiction. Asserting it here is what
   * makes the published type honest, since `res.json()` erases to `any` and
   * the compiler cannot.
   */
  it('getPresignedUrl carries success alongside data', async () => {
    const { client } = clientReturning({
      success: true,
      data: {
        uploadUrl: '/api/v1/storage/_local/raw/tok',
        method: 'PUT',
        fileId: 'f1',
        expiresIn: 3600,
        downloadUrl: '/api/v1/storage/files/f1/url',
      },
    });

    const res = await client.storage.getPresignedUrl({
      filename: 'a.png',
      mimeType: 'image/png',
      size: 10,
      scope: 'user',
    });
    expect(res.success).toBe(true);
    expect(res.data.fileId).toBe('f1');
  });

  it('initChunkedUpload carries success alongside data', async () => {
    const { client } = clientReturning({
      success: true,
      data: {
        uploadId: 'up1',
        resumeToken: 'tok',
        fileId: 'f1',
        totalChunks: 1,
        chunkSize: 5242880,
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    });

    const res = await client.storage.initChunkedUpload({
      filename: 'big.bin',
      mimeType: 'application/octet-stream',
      totalSize: 100,
      chunkSize: 5242880,
      scope: 'user',
    });
    expect(res.success).toBe(true);
    expect(res.data.uploadId).toBe('up1');
  });

  it('uploadPart carries success alongside data', async () => {
    const { client } = clientReturning({
      success: true,
      data: { chunkIndex: 0, eTag: '"abc"', bytesReceived: 100 },
    });

    const res = await client.storage.uploadPart('up1', 0, 'tok', Buffer.from('x'));
    expect(res.success).toBe(true);
    expect(res.data.eTag).toBe('"abc"');
  });
});
