// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Presigned URLs carry no flexible-checksum parameters (#21147).
 *
 * ## What is being asserted, and why it needs the REAL SDK
 *
 * Since the AWS SDK v3 flexible-checksum default (`WHEN_SUPPORTED`), a client
 * built without `requestChecksumCalculation` stamps a CRC32 into every
 * `PutObjectCommand` it prepares — and a presign prepares the command with NO
 * body, so the value it bakes into the signed query is the CRC32 of the EMPTY
 * body (`x-amz-checksum-crc32=AAAAAA==`, plus `x-amz-sdk-checksum-algorithm=
 * CRC32`). The browser then PUTs real bytes to that URL. A store that enforces
 * a query-signed checksum against the uploaded body refuses every one of them
 * with a checksum mismatch, while server-side `upload()` — which does compute
 * the checksum over real bytes — keeps working: "presign 200, upload never
 * lands".
 *
 * The defect lives in the SDK's own request pipeline, not in anything the
 * adapter writes itself, so a test that mocks `@aws-sdk/client-s3` (as
 * `s3-storage-adapter.key-prefix.test.ts` does, deliberately, to watch the
 * commands) can never see it: the fake `S3Client` has no checksum middleware.
 * This file therefore drives the REAL `S3Client` and the REAL presigner — still
 * fully offline, because presigning is pure local computation over the fake
 * credentials and the fixed endpoint below; nothing here opens a socket.
 *
 * ## The two options are a pair, and the cases below hold both halves
 *
 * `requestChecksumCalculation` governs the upload URL (the card). The adapter
 * also sets `responseChecksumValidation`, and its observable footprint is on
 * the download URL: the default bakes `x-amz-checksum-mode=ENABLED` into a
 * presigned GET, which asks the store to answer with checksum headers.
 *
 * They cannot be set one at a time. Measured on `@aws-sdk/client-s3` 3.1090.0,
 * presigning with each combination (query names that start `x-amz-checksum` or
 * `x-amz-sdk-checksum`):
 *
 *   request / response       PUT URL                    GET URL
 *   default  / default       crc32, sdk-...-algorithm   mode
 *   REQUIRED / default       (none)                     mode
 *   default  / REQUIRED      crc32, sdk-...-algorithm   crc32   <- worse than default
 *   REQUIRED / REQUIRED      (none)                     (none)
 *
 * so setting only the response option would put a CRC32 on a GET URL that had
 * none. The upload case goes red when the request option is dropped, the
 * download case when either is.
 */

import { describe, it, expect } from 'vitest';
import { S3StorageAdapter } from './s3-storage-adapter.js';

const ENDPOINT = 'http://127.0.0.1:9000';
const BUCKET = 'test-bucket';

/**
 * Every query-string name the SDK's flexible-checksum feature can put on a
 * presigned URL: the `x-amz-checksum-*` family (`-crc32`, `-sha256`, `-mode`,
 * ...) and the `x-amz-sdk-checksum-algorithm` selector that travels with it.
 * SigV4 query parameter names are case-insensitive on the wire, so the match is.
 */
const CHECKSUM_PARAM = /^x-amz-(checksum-|sdk-checksum-algorithm$)/i;

function checksumParams(url: string): string[] {
  return [...new URL(url).searchParams.keys()].filter((name) => CHECKSUM_PARAM.test(name));
}

function makeAdapter(): S3StorageAdapter {
  return new S3StorageAdapter({
    bucket: BUCKET,
    region: 'us-east-1',
    keyPrefix: null,
    endpoint: ENDPOINT,
    forcePathStyle: true,
    accessKeyId: 'AKIAFAKEFAKEFAKEFAKE',
    secretAccessKey: 'fake-secret-access-key',
  });
}

describe('S3StorageAdapter presigned URLs carry no flexible-checksum parameters', () => {
  it('getPresignedUpload: the signed PUT URL has no x-amz-checksum-* / x-amz-sdk-checksum-algorithm parameter', async () => {
    const desc = await makeAdapter().getPresignedUpload('uploads/a.txt', 300, {
      contentType: 'text/plain',
      metadata: { owner: 'u1' },
    });

    // The URL is a real presigned PUT for THIS bucket/key at THIS endpoint —
    // without this the absence below could be the absence of any URL at all.
    const url = new URL(desc.uploadUrl);
    expect(url.origin).toBe(ENDPOINT);
    expect(url.pathname).toBe(`/${BUCKET}/uploads/a.txt`);
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(desc.method).toBe('PUT');

    expect(checksumParams(desc.uploadUrl)).toEqual([]);
  });

  it('getPresignedDownload / getSignedUrl: the signed GET URL has no x-amz-checksum-mode parameter', async () => {
    const adapter = makeAdapter();
    const desc = await adapter.getPresignedDownload('uploads/a.txt', 300, {
      contentType: 'text/plain',
      filename: 'a.txt',
    });

    const url = new URL(desc.downloadUrl);
    expect(url.origin).toBe(ENDPOINT);
    expect(url.pathname).toBe(`/${BUCKET}/uploads/a.txt`);
    expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);

    expect(checksumParams(desc.downloadUrl)).toEqual([]);
    expect(checksumParams(await adapter.getSignedUrl('uploads/a.txt', 300))).toEqual([]);
  });
});
