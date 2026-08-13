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

/**
 * `resumeUpload` short-circuits on the expiry the progress poll already told it
 * about (#7870).
 *
 * Since #7667 a chunked session past its own `expires_at` is durably stamped
 * `expired`, `GET .../progress` reports that status, and a chunk PUT against it
 * answers 410 `UPLOAD_SESSION_EXPIRED`. `resumeUpload` polls progress FIRST but
 * read only the chunk counters off it, so it uploaded a full chunk into a
 * session the poll had already declared dead and learned that from the 410.
 *
 * What these pin is the pair a caller actually branches on — `code` AND
 * `httpStatus` — not merely that something threw: the point of the fix is that
 * the early exit is INDISTINGUISHABLE from the server's own refusal, so a
 * `catch` written against the 410 keeps matching. Asserting only "it throws"
 * would stay green if the short-circuit raised a bare `Error`, which is the one
 * outcome that would break every such caller.
 */
describe('storage.resumeUpload exits on an expired session before uploading (#7870)', () => {
  /** The progress body the server sends for a session past its deadline. */
  const expiredProgress = {
    success: true,
    data: {
      uploadId: 'up1',
      fileId: 'f1',
      filename: 'big.bin',
      totalSize: 16,
      uploadedSize: 8,
      totalChunks: 2,
      uploadedChunks: 1,
      percentComplete: 50,
      status: 'expired',
      startedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T01:00:00.000Z',
    },
  };

  it('throws the registered code and status the server answers a dead session with', async () => {
    const { client } = clientReturning(expiredProgress);

    // `.rejects.toThrow()` alone cannot see the difference between this and a
    // bare Error, so the envelope is asserted off the caught object.
    const err = await client.storage
      .resumeUpload('up1', new ArrayBuffer(16), 8, 'rtok')
      .then(() => null, (e: any) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('UPLOAD_SESSION_EXPIRED');
    expect(err.httpStatus).toBe(410);
    // The expiry instant is what tells a caller/operator WHICH deadline passed,
    // so it survives into both the human message and `details`.
    expect(err.message).toContain('2026-01-01T01:00:00.000Z');
    expect(err.details).toMatchObject({ uploadId: 'up1', expiresAt: '2026-01-01T01:00:00.000Z' });
  });

  it('sends no chunk PUT and no complete — the poll is the only request made', async () => {
    // The whole point of the card: the bytes never leave. If this regresses,
    // the throw above would still pass while the client had already spent a
    // chunk upload against a dead session.
    const { client, fetchMock } = clientReturning(expiredProgress);

    await client.storage.resumeUpload('up1', new ArrayBuffer(16), 8, 'rtok').catch(() => {});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/upload/chunked/up1/progress');
  });

  it('still resumes normally when the session is live', async () => {
    // The reverse direction: `=== 'expired'` must not swallow the happy path.
    // One mock, routed by URL — resume makes three hops (progress, chunk PUT,
    // complete) and they answer different bodies.
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.includes('/progress')
        ? { success: true, data: { ...expiredProgress.data, status: 'in_progress' } }
        : url.includes('/complete')
          ? { success: true, data: { fileId: 'f1', size: 16 } }
          : { success: true, data: { chunkIndex: 1, eTag: '"e2"', bytesReceived: 8 } };
      return { ok: true, status: 200, statusText: 'OK', json: async () => body, headers: new Headers() };
    });
    const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock as any });

    const res = await client.storage.resumeUpload('up1', new ArrayBuffer(16), 8, 'rtok');

    expect(res.success).toBe(true);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining('/upload/chunked/up1/progress'),
      expect.stringContaining('/upload/chunked/up1/chunk/1'),
      expect.stringContaining('/upload/chunked/up1/complete'),
    ]);
  });

  it('does not misfire when a server or fixture omits status entirely', async () => {
    // `status` is declared required, but the client is published separately
    // from the server it meets and the SDK's own URL-conformance fixture drives
    // this method with a counters-only body. An absent status must resume, not
    // abort — which is why the guard compares against 'expired' rather than
    // testing truthiness or absence.
    const fetchMock = vi.fn(async (url: string) => {
      const body = url.includes('/progress')
        ? { success: true, data: { totalChunks: 1, uploadedChunks: 0 } }
        : { success: true, data: { chunkIndex: 0, eTag: '"e1"', bytesReceived: 8 } };
      return { ok: true, status: 200, statusText: 'OK', json: async () => body, headers: new Headers() };
    });
    const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock as any });

    await expect(
      client.storage.resumeUpload('up1', new ArrayBuffer(8), 8, 'rtok'),
    ).resolves.toBeDefined();
  });
});
