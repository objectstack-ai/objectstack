// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `S3StorageAdapterOptions.keyPrefix` — the object-storage key namespace
 * (#17571).
 *
 * ## What is being asserted, and why it is a STRUCTURAL claim
 *
 * A shared bucket with no key namespace has exactly one thing keeping tenant A
 * out of tenant B's objects: that every `sys_file` metadata check upstream of
 * the adapter was written correctly. On the doors that take an identifier
 * straight out of a request, one missed check is a cross-tenant read — and the
 * object store cannot refuse it, because what it sees is a well-formed key.
 *
 * A prefix moves that from "every check is correct" to "a caller cannot express
 * the request". The claim is therefore not "the adapter prepends a string"; it
 * is **a caller holding this adapter has no door through which it can reach an
 * unprefixed key** — so the cases below walk the doors rather than the
 * implementation:
 *
 *   - every S3 command the adapter can issue, checked on the `Key` / `Prefix`
 *     the fake bucket actually received (`bucketKeysSeen`);
 *   - the acceptance criterion from the card, driven end to end: two adapters,
 *     one bucket, two prefixes, and B cannot read, head, delete or list what A
 *     wrote under the same caller key;
 *   - the return path, which is the half that is easy to leave out: keys and
 *     the `list()` cursor come back unprefixed, so the namespace is invisible in
 *     both directions.
 *
 * ## The delimiter case is not tidiness
 *
 * S3 `Prefix` is a raw string match. `tenant_1` matches `tenant_10/x.pdf`, so a
 * host that wrote environment ids without a trailing `/` would have one
 * environment enumerate another's objects THROUGH the isolation mechanism
 * itself. `refuses to let one namespace see into a neighbouring one` pins the
 * normalisation that prevents it.
 *
 * ## Empty is refused rather than treated as "no prefix"
 *
 * `keyPrefix: ''` is what an unset environment variable looks like after string
 * interpolation. Accepting it as bucket-root is the silent failure this whole
 * option exists to remove, so it throws; `null` is the written, greppable way to
 * ask for bucket-root keys.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const fakeS3 = vi.hoisted(() => {
  const objects = new Map<string, { size: number; body: Buffer }>();
  /** Every `Key` / `Prefix` the bucket was addressed with, per command name. */
  const bucketKeysSeen: Array<{ command: string; key: string }> = [];
  const multipart = new Map<string, { key: string; parts: Buffer[] }>();
  let uploadSeq = 0;

  function notFound(): never {
    const err = new Error('NotFound') as Error & { name: string; $metadata: { httpStatusCode: number } };
    err.name = 'NotFound';
    err.$metadata = { httpStatusCode: 404 };
    throw err;
  }

  function reset(): void {
    objects.clear();
    bucketKeysSeen.length = 0;
    multipart.clear();
    uploadSeq = 0;
  }

  return { objects, bucketKeysSeen, multipart, notFound, reset, nextUploadId: () => `upload-${++uploadSeq}` };
});

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public readonly input: Record<string, any>) {}
  }
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class HeadObjectCommand extends Command {}
  class ListObjectsV2Command extends Command {}
  class CreateMultipartUploadCommand extends Command {}
  class UploadPartCommand extends Command {}
  class CompleteMultipartUploadCommand extends Command {}
  class AbortMultipartUploadCommand extends Command {}

  class S3Client {
    constructor(_config: unknown) {}
    async send(command: any): Promise<any> {
      const name = command.constructor.name;
      const addressed = command.input.Key ?? command.input.Prefix;
      if (typeof addressed === 'string') {
        fakeS3.bucketKeysSeen.push({ command: name, key: addressed });
      }

      if (command instanceof PutObjectCommand) {
        const body: Buffer = command.input.Body;
        fakeS3.objects.set(command.input.Key, { size: body.length, body });
        return {};
      }
      if (command instanceof GetObjectCommand) {
        const found = fakeS3.objects.get(command.input.Key);
        if (!found) fakeS3.notFound();
        return { Body: found.body };
      }
      if (command instanceof DeleteObjectCommand) {
        fakeS3.objects.delete(command.input.Key);
        return {};
      }
      if (command instanceof HeadObjectCommand) {
        const found = fakeS3.objects.get(command.input.Key);
        if (!found) fakeS3.notFound();
        return { ContentLength: found.size, LastModified: new Date('2026-01-01T00:00:00.000Z') };
      }
      if (command instanceof ListObjectsV2Command) {
        const prefix: string = command.input.Prefix ?? '';
        // `ContinuationToken` wins over `StartAfter`, as the real service does.
        // The token is opaque to the adapter; here it is simply the key the
        // previous window ended on.
        const after: string | undefined = command.input.ContinuationToken ?? command.input.StartAfter;
        const all = [...fakeS3.objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .filter((key) => after === undefined || key > after)
          .sort();
        const window = all.slice(0, command.input.MaxKeys ?? 1000);
        const isTruncated = window.length < all.length;
        return {
          IsTruncated: isTruncated,
          NextContinuationToken: isTruncated ? window[window.length - 1] : undefined,
          Contents: window.map((key) => ({
            Key: key,
            Size: fakeS3.objects.get(key)!.size,
            LastModified: new Date('2026-01-01T00:00:00.000Z'),
          })),
        };
      }
      if (command instanceof CreateMultipartUploadCommand) {
        const uploadId = fakeS3.nextUploadId();
        fakeS3.multipart.set(uploadId, { key: command.input.Key, parts: [] });
        return { UploadId: uploadId };
      }
      if (command instanceof UploadPartCommand) {
        fakeS3.multipart.get(command.input.UploadId)!.parts.push(command.input.Body);
        return { ETag: `etag-${command.input.PartNumber}` };
      }
      if (command instanceof CompleteMultipartUploadCommand) {
        const session = fakeS3.multipart.get(command.input.UploadId)!;
        const body = Buffer.concat(session.parts);
        fakeS3.objects.set(command.input.Key, { size: body.length, body });
        fakeS3.multipart.delete(command.input.UploadId);
        return {};
      }
      if (command instanceof AbortMultipartUploadCommand) {
        fakeS3.multipart.delete(command.input.UploadId);
        return {};
      }
      throw new Error(`fake S3 bucket: unhandled command ${name}`);
    }
  }

  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand,
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  // The presigned doors are asserted on the KEY the command carries, which the
  // fake signer echoes back; signing itself is the AWS SDK's business.
  getSignedUrl: async (_client: unknown, command: any) =>
    `https://signed.example/${encodeURIComponent(command.input.Key)}`,
}));

import { decodeStorageListCursor } from '@objectstack/spec/contracts';
import { S3StorageAdapter, normalizeStorageKeyPrefix } from './s3-storage-adapter.js';

const BUCKET = 'shared-bucket';

function adapterWith(keyPrefix: string | null): S3StorageAdapter {
  return new S3StorageAdapter({ bucket: BUCKET, region: 'us-east-1', keyPrefix });
}

beforeEach(() => {
  fakeS3.reset();
});

// ---------------------------------------------------------------------------
// The card's acceptance criterion, driven end to end
// ---------------------------------------------------------------------------

describe('two adapters on one bucket are two disjoint namespaces', () => {
  const KEY = 'user/9d1e-report.pdf';

  it('B cannot download, head, getInfo, delete or list what A wrote under the same caller key', async () => {
    const a = adapterWith('env_a');
    const b = adapterWith('env_b');

    await a.upload(KEY, Buffer.from('tenant A payroll'));

    // A itself is unaffected: its own key round-trips.
    expect((await a.download(KEY)).toString()).toBe('tenant A payroll');
    expect(await a.exists(KEY)).toBe(true);
    expect((await a.list('')).items.map((i) => i.key)).toEqual([KEY]);

    // B addresses the identical caller key and reaches nothing.
    expect(await b.exists(KEY)).toBe(false);
    await expect(b.download(KEY)).rejects.toThrow(/NotFound/);
    await expect(b.getInfo(KEY)).rejects.toThrow(/NotFound/);
    expect((await b.list('')).items).toEqual([]);

    // ...and B's delete cannot reach A's object either. A `DeleteObject` on a
    // missing key is a no-op in S3, so the assertion that matters is that A's
    // object SURVIVES it — a delete that silently hit the neighbour would look
    // identical from B's side.
    await b.delete(KEY);
    expect(await a.exists(KEY)).toBe(true);
  });

  it('refuses to let one namespace see into a neighbouring one whose id shares a leading run', async () => {
    // The raw-string-prefix trap: without the normalised trailing delimiter,
    // `tenant_1`'s Prefix also matches every `tenant_10/...` key.
    const one = adapterWith('tenant_1');
    const ten = adapterWith('tenant_10');

    await ten.upload('invoice.pdf', Buffer.from('tenant 10'));
    await one.upload('invoice.pdf', Buffer.from('tenant 1'));

    expect((await one.list('')).items.map((i) => i.key)).toEqual(['invoice.pdf']);
    expect((await one.download('invoice.pdf')).toString()).toBe('tenant 1');
    expect((await ten.download('invoice.pdf')).toString()).toBe('tenant 10');
    // Both objects exist, under distinct bucket keys.
    expect([...fakeS3.objects.keys()].sort()).toEqual([
      'tenant_10/invoice.pdf',
      'tenant_1/invoice.pdf',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Every door, on the key the bucket actually received
// ---------------------------------------------------------------------------

describe('the prefix is applied at every door', () => {
  it('prepends it on write, read, delete and head', async () => {
    const adapter = adapterWith('env_7');

    await adapter.upload('a/b.txt', Buffer.from('x'));
    await adapter.download('a/b.txt');
    await adapter.exists('a/b.txt');
    await adapter.getInfo('a/b.txt');
    await adapter.delete('a/b.txt');

    expect(fakeS3.bucketKeysSeen).toEqual([
      { command: 'PutObjectCommand', key: 'env_7/a/b.txt' },
      { command: 'GetObjectCommand', key: 'env_7/a/b.txt' },
      { command: 'HeadObjectCommand', key: 'env_7/a/b.txt' },
      { command: 'HeadObjectCommand', key: 'env_7/a/b.txt' },
      { command: 'DeleteObjectCommand', key: 'env_7/a/b.txt' },
    ]);
  });

  it("prepends it into list()'s Prefix, so list('') cannot escape the namespace", async () => {
    const adapter = adapterWith('env_7');

    await adapter.list('');
    await adapter.list('user/');

    expect(fakeS3.bucketKeysSeen).toEqual([
      { command: 'ListObjectsV2Command', key: 'env_7/' },
      { command: 'ListObjectsV2Command', key: 'env_7/user/' },
    ]);
  });

  it('prepends it on both presigned doors', async () => {
    const adapter = adapterWith('env_7');

    const upload = await adapter.getPresignedUpload('put.bin', 60);
    const download = await adapter.getSignedUrl('get.bin', 60);

    // Asserted on the URL rather than on `bucketKeysSeen`: a presigned command
    // is handed to the SIGNER, never sent through the client, so the key it
    // carries is observable only in what comes back. That is also the reason
    // this door is easy to leave unprefixed — nothing else in the suite would
    // have noticed.
    expect(upload.uploadUrl).toContain(encodeURIComponent('env_7/put.bin'));
    expect(download).toContain(encodeURIComponent('env_7/get.bin'));
  });

  it('prepends it on every multipart door, and still returns the CALLER key', async () => {
    const adapter = adapterWith('env_7');

    const uploadId = await adapter.initiateChunkedUpload('big.bin');
    adapter.setUploadKey(uploadId, 'big.bin');
    await adapter.uploadChunk(uploadId, 1, Buffer.from('one'));
    const completed = await adapter.completeChunkedUpload(uploadId, [{ partNumber: 1, eTag: 'etag-1' }]);

    // `setUploadKey` is given the CALLER key — the plugin has no other one —
    // and the prefix is applied on the way to the bucket, not stored in it.
    expect(completed).toBe('big.bin');
    expect(fakeS3.bucketKeysSeen.map((s) => s.key)).toEqual([
      'env_7/big.bin',
      'env_7/big.bin',
      'env_7/big.bin',
    ]);
    expect([...fakeS3.objects.keys()]).toEqual(['env_7/big.bin']);
  });

  it('prepends it on abort', async () => {
    const adapter = adapterWith('env_7');

    const uploadId = await adapter.initiateChunkedUpload('scrap.bin');
    adapter.setUploadKey(uploadId, 'scrap.bin');
    await adapter.abortChunkedUpload(uploadId);

    expect(fakeS3.bucketKeysSeen.map((s) => s.key)).toEqual(['env_7/scrap.bin', 'env_7/scrap.bin']);
  });

  it('treats a caller key that looks like an escape as a literal key inside the namespace', async () => {
    // Keys are CONCATENATED, never path-joined, so S3 stores this verbatim
    // rather than resolving it upward the way a filesystem would.
    const adapter = adapterWith('env_7');

    await adapter.upload('../env_8/steal.txt', Buffer.from('x'));

    expect([...fakeS3.objects.keys()]).toEqual(['env_7/../env_8/steal.txt']);
  });
});

// ---------------------------------------------------------------------------
// The return path — the namespace is invisible coming back, too
// ---------------------------------------------------------------------------

describe('keys and cursors come back unprefixed', () => {
  it('list() strips the prefix off every key', async () => {
    const adapter = adapterWith('env_7');
    await adapter.upload('a.txt', Buffer.from('1'));
    await adapter.upload('b/c.txt', Buffer.from('2'));

    const page = await adapter.list('');

    expect(page.items.map((i) => i.key)).toEqual(['a.txt', 'b/c.txt']);
  });

  it('the cursor encodes an unprefixed key and resumes from it', async () => {
    const adapter = adapterWith('env_7');
    for (const key of ['a.txt', 'b.txt', 'c.txt']) {
      await adapter.upload(key, Buffer.from(key));
    }

    const first = await adapter.list('', { limit: 2 });

    expect(first.items.map((i) => i.key)).toEqual(['a.txt', 'b.txt']);
    // The strong half: a cursor carrying `env_7/b.txt` would be a namespace
    // leak AND would not resume correctly once re-prefixed.
    expect(decodeStorageListCursor(first.nextCursor!)).toBe('b.txt');

    fakeS3.bucketKeysSeen.length = 0;
    const second = await adapter.list('', { limit: 2, cursor: first.nextCursor });

    expect(second.items.map((i) => i.key)).toEqual(['c.txt']);
  });

  it('getInfo answers the caller key it was given', async () => {
    const adapter = adapterWith('env_7');
    await adapter.upload('a.txt', Buffer.from('12345'));

    const info = await adapter.getInfo('a.txt');

    expect(info.key).toBe('a.txt');
    expect(info.size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Construction: what is accepted, what is normalised, what is refused
// ---------------------------------------------------------------------------

describe('keyPrefix construction', () => {
  it('null means bucket-root keys, byte-for-byte as before this option existed', async () => {
    const adapter = adapterWith(null);

    await adapter.upload('user/a.txt', Buffer.from('x'));
    await adapter.list('user/');

    expect([...fakeS3.objects.keys()]).toEqual(['user/a.txt']);
    expect(fakeS3.bucketKeysSeen.map((s) => s.key)).toEqual(['user/a.txt', 'user/']);
  });

  it('normalises a missing trailing delimiter, so both spellings are one namespace', async () => {
    const bare = adapterWith('env_7');
    const slashed = adapterWith('env_7/');

    await bare.upload('a.txt', Buffer.from('written by bare'));

    expect((await slashed.download('a.txt')).toString()).toBe('written by bare');
    expect([...fakeS3.objects.keys()]).toEqual(['env_7/a.txt']);
  });

  it('refuses an empty or whitespace-only prefix rather than falling back to bucket-root', () => {
    // The unset-environment-variable shape. Silently writing to the bucket root
    // here is exactly the gap the option exists to close.
    expect(() => adapterWith('')).toThrow(/non-empty string or null/);
    expect(() => adapterWith('   ')).toThrow(/non-empty string or null/);
  });

  it('refuses a leading slash and a `..` segment', () => {
    expect(() => adapterWith('/env_7')).toThrow(/must not start with/);
    expect(() => adapterWith('env_7/../env_8')).toThrow(/must not contain a ".." segment/);
  });

  it('normalizeStorageKeyPrefix is the single normalisation both this adapter and the swap target read', () => {
    expect(normalizeStorageKeyPrefix(null)).toBe('');
    expect(normalizeStorageKeyPrefix('env_7')).toBe('env_7/');
    expect(normalizeStorageKeyPrefix('env_7/')).toBe('env_7/');
    expect(normalizeStorageKeyPrefix('a/b')).toBe('a/b/');
  });
});
