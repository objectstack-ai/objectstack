// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalStorageAdapter } from './local-storage-adapter';
import type { IStorageService } from '@objectstack/spec/contracts';

describe('LocalStorageAdapter', () => {
  let rootDir: string;
  let adapter: LocalStorageAdapter;

  const createTempDir = async () => {
    rootDir = join(tmpdir(), `os-test-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });
    adapter = new LocalStorageAdapter({ rootDir });
  };

  afterEach(async () => {
    if (rootDir) {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('should implement IStorageService contract', async () => {
    await createTempDir();
    const storage: IStorageService = adapter;
    expect(typeof storage.upload).toBe('function');
    expect(typeof storage.download).toBe('function');
    expect(typeof storage.delete).toBe('function');
    expect(typeof storage.exists).toBe('function');
    expect(typeof storage.getInfo).toBe('function');
    // `list` is back, cursor-shaped (#6781). Its presence and shape are pinned
    // in `storage-adapter-list-contract.test.ts` (the flipped #5540/#5541
    // retirement pin) and its behaviour in
    // `storage-adapter-list.conformance.test.ts`, which asserts this backend
    // and the S3 one answer identically.
    expect(typeof storage.list).toBe('function');
  });

  it('should upload and download a file', async () => {
    await createTempDir();
    const content = Buffer.from('hello world');
    await adapter.upload('test.txt', content);

    const downloaded = await adapter.download('test.txt');
    expect(downloaded.toString()).toBe('hello world');
  });

  it('should create nested directories automatically', async () => {
    await createTempDir();
    await adapter.upload('deep/nested/file.txt', Buffer.from('nested'));
    const downloaded = await adapter.download('deep/nested/file.txt');
    expect(downloaded.toString()).toBe('nested');
  });

  it('should check file existence', async () => {
    await createTempDir();
    expect(await adapter.exists('missing.txt')).toBe(false);
    await adapter.upload('exists.txt', Buffer.from('yes'));
    expect(await adapter.exists('exists.txt')).toBe(true);
  });

  it('should delete a file', async () => {
    await createTempDir();
    await adapter.upload('deleteme.txt', Buffer.from('bye'));
    await adapter.delete('deleteme.txt');
    expect(await adapter.exists('deleteme.txt')).toBe(false);
  });

  it('should get file info', async () => {
    await createTempDir();
    await adapter.upload('info.txt', Buffer.from('metadata'));
    const info = await adapter.getInfo('info.txt');
    expect(info.key).toBe('info.txt');
    expect(info.size).toBe(8); // 'metadata'.length
    expect(info.lastModified).toBeInstanceOf(Date);
  });

  // The `should list files in a directory` and `should return empty array when
  // listing non-existent directory` cases were deleted with the method they
  // exercised (#5541). They pinned exactly the single-level, directories-as-files
  // behaviour the retirement removed — `docs/a.txt` + `docs/b.txt` are both one
  // level down, which is the only depth that implementation could see — so
  // keeping them green would have meant keeping the method.

  it('should reject path traversal', async () => {
    await createTempDir();
    await expect(adapter.upload('../escape.txt', Buffer.from('bad'))).rejects.toThrow('path traversal');
  });

  // =========================================================================
  // Presigned URLs
  // =========================================================================

  describe('presigned URLs', () => {
    it('should generate a presigned upload descriptor', async () => {
      await createTempDir();
      const desc = await adapter.getPresignedUpload!('uploads/file.txt', 60, { contentType: 'text/plain' });
      expect(desc.method).toBe('PUT');
      expect(desc.uploadUrl).toContain('/_local/raw/');
      expect(desc.headers?.['content-type']).toBe('text/plain');
      expect(desc.expiresIn).toBe(60);
    });

    it('should generate and verify tokens correctly', async () => {
      await createTempDir();
      const desc = await adapter.getPresignedUpload!('test/key.txt', 120);
      const token = desc.uploadUrl.split('/_local/raw/')[1];
      const payload = adapter.verifyToken(token, 'put');
      expect(payload.k).toBe('test/key.txt');
    });

    it('should reject expired tokens', async () => {
      await createTempDir();
      // Manually craft a token that's already expired by calling getPresignedUpload
      // with a 1-second TTL and then manipulating the time check
      const desc = await adapter.getPresignedUpload!('expired.txt', 60);
      const token = desc.uploadUrl.split('/_local/raw/')[1];
      // Tamper with the token payload to set exp in the past
      const [b64] = token.split('.');
      const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
      payload.exp = Math.floor(Date.now() / 1000) - 10; // expired 10s ago
      // Re-sign won't work, but we can test with the adapter's internal signer
      // Instead, just verify that a well-formed but expired token is rejected
      // by creating adapter with known secret and crafting manually
      const { createHmac } = await import('node:crypto');
      const adapter2 = new LocalStorageAdapter({ rootDir, signingSecret: 'test-secret' });
      const expiredPayload = JSON.stringify({ k: 'x.txt', exp: Math.floor(Date.now() / 1000) - 5, op: 'put' });
      const expB64 = Buffer.from(expiredPayload).toString('base64url');
      const sig = createHmac('sha256', 'test-secret').update(expB64).digest('base64url');
      expect(() => adapter2.verifyToken(`${expB64}.${sig}`, 'put')).toThrow('expired');
    });

    it('should reject wrong op tokens', async () => {
      await createTempDir();
      const desc = await adapter.getPresignedUpload!('file.txt', 60);
      const token = desc.uploadUrl.split('/_local/raw/')[1];
      expect(() => adapter.verifyToken(token, 'get')).toThrow('mismatch');
    });

    it('should generate presigned download URL', async () => {
      await createTempDir();
      await adapter.upload('dl.txt', Buffer.from('hello'));
      const desc = await adapter.getPresignedDownload!('dl.txt', 60);
      expect(desc.downloadUrl).toContain('/_local/raw/');
      expect(desc.expiresIn).toBe(60);
    });

    it('carries filename + content-type into the download token (so the browser saves the real name)', async () => {
      await createTempDir();
      await adapter.upload('attachments/abc.pdf', Buffer.from('%PDF-'));
      const desc = await adapter.getPresignedDownload!('attachments/abc.pdf', 60, {
        filename: 'signed-contract.pdf',
        contentType: 'application/pdf',
        disposition: 'inline',
      });
      const token = desc.downloadUrl.split('/_local/raw/')[1];
      const payload = adapter.verifyToken(token, 'get');
      expect(payload.n).toBe('signed-contract.pdf');
      expect(payload.ct).toBe('application/pdf');
      expect(payload.d).toBe('inline');
    });
  });

  // =========================================================================
  // Chunked upload
  // =========================================================================

  describe('chunked upload', () => {
    it('should initiate, upload chunks, and complete', async () => {
      await createTempDir();
      const uploadId = await adapter.initiateChunkedUpload!('final/output.bin', { contentType: 'application/octet-stream' });
      expect(uploadId).toBeTruthy();

      const chunk1 = Buffer.from('aaaa');
      const chunk2 = Buffer.from('bbbb');
      const eTag1 = await adapter.uploadChunk!(uploadId, 1, chunk1);
      const eTag2 = await adapter.uploadChunk!(uploadId, 2, chunk2);
      expect(eTag1).toBeTruthy();
      expect(eTag2).toBeTruthy();

      const key = await adapter.completeChunkedUpload!(uploadId, [
        { partNumber: 1, eTag: eTag1 },
        { partNumber: 2, eTag: eTag2 },
      ]);
      expect(key).toBe('final/output.bin');

      const result = await adapter.download('final/output.bin');
      expect(result.toString()).toBe('aaaabbbb');
    });

    it('should abort and cleanup parts', async () => {
      await createTempDir();
      const uploadId = await adapter.initiateChunkedUpload!('abort.bin');
      await adapter.uploadChunk!(uploadId, 1, Buffer.from('will abort'));
      await adapter.abortChunkedUpload!(uploadId);

      const partsDir = join(rootDir, '.parts', uploadId);
      await expect(fs.access(partsDir)).rejects.toThrow();
    });

    it('should reject invalid part numbers', async () => {
      await createTempDir();
      const uploadId = await adapter.initiateChunkedUpload!('invalid.bin');
      await expect(adapter.uploadChunk!(uploadId, 0, Buffer.from('bad'))).rejects.toThrow('positive integer');
    });
  });
});

