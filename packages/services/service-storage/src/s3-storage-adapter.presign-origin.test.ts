// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `getPresignedUploadOrigin()` answers the origin every presigned upload URL
 * carries.
 *
 * The Console document's `connect-src` names this origin so the browser may
 * `PUT` a file straight to the store. An origin assembled beside the presigner
 * would drift from it: S3 puts a DNS-compatible bucket in the host name
 * (virtual-hosted), templates the region into the AWS host, and falls back to
 * the path for a bucket a host name cannot carry. So every case below compares
 * the answer with the origin of a REAL presigned upload URL from the same
 * adapter, through the REAL SDK, fully offline: presigning is local
 * computation over the fake credentials, and nothing here opens a socket.
 */

import { describe, it, expect } from 'vitest';
import { S3StorageAdapter, type S3StorageAdapterOptions } from './s3-storage-adapter.js';
import { SwappableStorageService } from './swappable-storage-service.js';
import { LocalStorageAdapter } from './local-storage-adapter.js';

const CREDENTIALS = { accessKeyId: 'AKIAFAKEFAKEFAKEFAKE', secretAccessKey: 'fake-secret-access-key' };

async function presignedUploadOrigin(options: S3StorageAdapterOptions): Promise<string> {
  const adapter = new S3StorageAdapter({ ...CREDENTIALS, ...options });
  const presigned = await adapter.getPresignedUpload('dir/file.txt', 60, { contentType: 'text/plain' });
  return new URL(presigned.uploadUrl).origin;
}

describe('S3StorageAdapter.getPresignedUploadOrigin', () => {
  it.each<[string, S3StorageAdapterOptions, string]>([
    [
      'an S3-compatible endpoint, virtual-hosted',
      { bucket: 'uploads', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', keyPrefix: 'projects/env_1' },
      'https://uploads.acct123.r2.cloudflarestorage.com',
    ],
    [
      'an S3-compatible endpoint, path-style',
      { bucket: 'uploads', region: 'auto', endpoint: 'https://acct123.r2.cloudflarestorage.com', keyPrefix: null, forcePathStyle: true },
      'https://acct123.r2.cloudflarestorage.com',
    ],
    [
      'a self-hosted endpoint on a port',
      { bucket: 'uploads', region: 'us-east-1', endpoint: 'http://127.0.0.1:9000', keyPrefix: null, forcePathStyle: true },
      'http://127.0.0.1:9000',
    ],
    [
      'AWS, region-templated',
      { bucket: 'uploads', region: 'eu-west-2', keyPrefix: null },
      'https://uploads.s3.eu-west-2.amazonaws.com',
    ],
    [
      'AWS, a bucket a host name cannot carry',
      { bucket: 'uploads.example.com', region: 'us-east-1', keyPrefix: null },
      'https://s3.us-east-1.amazonaws.com',
    ],
  ])('answers the origin of a real presigned upload URL: %s', async (_name, options, expected) => {
    const adapter = new S3StorageAdapter(options);
    expect(await adapter.getPresignedUploadOrigin()).toBe(await presignedUploadOrigin(options));
    expect(await adapter.getPresignedUploadOrigin()).toBe(expected);
  });

  it('needs no credentials, so it never consults the SDK credential chain', async () => {
    const adapter = new S3StorageAdapter({ bucket: 'uploads', region: 'eu-west-2', keyPrefix: null });
    expect(await adapter.getPresignedUploadOrigin()).toBe('https://uploads.s3.eu-west-2.amazonaws.com');
  });

  it.each([['not a url'], ['ftp://store.example.com']])('rejects on an endpoint the SDK refuses: %j', async (endpoint) => {
    const adapter = new S3StorageAdapter({ bucket: 'uploads', region: 'us-east-1', endpoint, keyPrefix: null });
    await expect(adapter.getPresignedUploadOrigin()).rejects.toThrow();
  });
});

describe('SwappableStorageService.getPresignedUploadOrigin', () => {
  it('answers the active adapter\'s origin, and follows a swap', async () => {
    const storage = new SwappableStorageService(
      new S3StorageAdapter({ bucket: 'uploads', region: 'eu-west-2', keyPrefix: null }),
    );
    expect(await storage.getPresignedUploadOrigin()).toBe('https://uploads.s3.eu-west-2.amazonaws.com');
    storage.swap(new S3StorageAdapter({
      bucket: 'moved', region: 'auto', endpoint: 'https://acct456.r2.cloudflarestorage.com', keyPrefix: null, forcePathStyle: true,
    }));
    expect(await storage.getPresignedUploadOrigin()).toBe('https://acct456.r2.cloudflarestorage.com');
  });

  it('answers undefined for the local adapter, whose uploads go to the server itself', async () => {
    const storage = new SwappableStorageService(new LocalStorageAdapter({ rootDir: '/nonexistent-never-written' }));
    expect(await storage.getPresignedUploadOrigin()).toBeUndefined();
  });
});
