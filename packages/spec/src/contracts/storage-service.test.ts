import { describe, it, expect } from 'vitest';
import type { IStorageService, StorageFileInfo } from './storage-service';

describe('Storage Service Contract', () => {
  it('should allow a minimal IStorageService implementation with required methods', () => {
    const storage: IStorageService = {
      upload: async (_key, _data, _options?) => {},
      download: async (_key) => Buffer.from(''),
      delete: async (_key) => {},
      exists: async (_key) => false,
      getInfo: async (key) => ({
        key,
        size: 0,
        lastModified: new Date(),
      }),
    };

    expect(typeof storage.upload).toBe('function');
    expect(typeof storage.download).toBe('function');
    expect(typeof storage.delete).toBe('function');
    expect(typeof storage.exists).toBe('function');
    expect(typeof storage.getInfo).toBe('function');
  });

  it('should allow a full implementation with optional methods', () => {
    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => false,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      getSignedUrl: async (_key, _expiresIn) => 'https://example.com/signed',
    };

    expect(storage.getSignedUrl).toBeDefined();
  });

  it('should upload and download files', async () => {
    const files = new Map<string, Buffer>();

    const storage: IStorageService = {
      upload: async (key, data) => {
        files.set(key, Buffer.isBuffer(data) ? data : Buffer.from('stream-data'));
      },
      download: async (key) => {
        const data = files.get(key);
        if (!data) throw new Error(`File not found: ${key}`);
        return data;
      },
      delete: async (key) => { files.delete(key); },
      exists: async (key) => files.has(key),
      getInfo: async (key) => ({
        key,
        size: files.get(key)?.length ?? 0,
        lastModified: new Date(),
      }),
    };

    const content = Buffer.from('Hello, World!');
    await storage.upload('docs/readme.txt', content, { contentType: 'text/plain' });

    expect(await storage.exists('docs/readme.txt')).toBe(true);

    const downloaded = await storage.download('docs/readme.txt');
    expect(downloaded.toString()).toBe('Hello, World!');
  });

  it('should delete files', async () => {
    const files = new Set<string>();

    const storage: IStorageService = {
      upload: async (key) => { files.add(key); },
      download: async () => Buffer.from(''),
      delete: async (key) => { files.delete(key); },
      exists: async (key) => files.has(key),
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
    };

    await storage.upload('temp/file.txt', Buffer.from('data'));
    expect(await storage.exists('temp/file.txt')).toBe(true);

    await storage.delete('temp/file.txt');
    expect(await storage.exists('temp/file.txt')).toBe(false);
  });

  it('should get file info', async () => {
    const now = new Date();

    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => true,
      getInfo: async (key): Promise<StorageFileInfo> => ({
        key,
        size: 2048,
        contentType: 'image/png',
        lastModified: now,
        metadata: { uploadedBy: 'user-1' },
      }),
    };

    const info = await storage.getInfo('images/logo.png');
    expect(info.key).toBe('images/logo.png');
    expect(info.size).toBe(2048);
    expect(info.contentType).toBe('image/png');
    expect(info.lastModified).toBe(now);
    expect(info.metadata?.uploadedBy).toBe('user-1');
  });

  // ---------------------------------------------------------------------
  // Retirement pin — `list?(prefix)` removed in #5540 (ADR-0049
  // enforce-or-remove; the two-dialect analysis is #5266).
  //
  // `IStorageService` is a pure TypeScript contract: nothing parses it, so
  // this retirement has no `retiredKey()` tombstone and no parse-time
  // prescription to assert (spec-property-retirement §2, "nothing parses it"
  // route). tsc is the only channel the removal has — and `tsconfig.test.json`
  // puts this file in front of tsc (#5286), so the two `@ts-expect-error`
  // directives below are real checks that go red the day the member returns,
  // not phantom ones. Restoring `list?()` to the interface turns both into
  // "unused '@ts-expect-error' directive".
  //
  // The test these replaced exercised the removed member itself; keeping it
  // green would have meant keeping the member.
  // ---------------------------------------------------------------------
  it('no longer declares list(prefix) — reading it is a type error', () => {
    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => true,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
    };

    // @ts-expect-error — `list` was removed from IStorageService (#5540).
    // Prefix enumeration returns cursor-shaped when a caller needs it:
    // `list(prefix, { cursor, limit })`. It is not on the contract today.
    const retired = storage.list;

    expect(retired).toBeUndefined();
  });

  it('no longer accepts an implementation that declares list(prefix)', () => {
    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => true,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      // @ts-expect-error — excess property: the contract has no `list` member,
      // so an adapter can no longer advertise one through it (#5540).
      list: async (_prefix: string): Promise<StorageFileInfo[]> => [],
    };

    expect(typeof storage.getInfo).toBe('function');
  });

  it('should generate signed URLs', async () => {
    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => true,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      getSignedUrl: async (key, expiresIn) =>
        `https://cdn.example.com/${key}?expires=${expiresIn}`,
    };

    const url = await storage.getSignedUrl!('docs/report.pdf', 3600);
    expect(url).toContain('docs/report.pdf');
    expect(url).toContain('expires=3600');
  });

  it('should allow implementation with chunked upload methods', () => {
    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => false,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      initiateChunkedUpload: async (_key, _options?) => 'upload_session_123',
      uploadChunk: async (_uploadId, _partNumber, _data) => '"etag-abc"',
      completeChunkedUpload: async (_uploadId, _parts) => 'uploads/final-file.bin',
      abortChunkedUpload: async (_uploadId) => {},
    };

    expect(storage.initiateChunkedUpload).toBeDefined();
    expect(storage.uploadChunk).toBeDefined();
    expect(storage.completeChunkedUpload).toBeDefined();
    expect(storage.abortChunkedUpload).toBeDefined();
  });

  it('should perform chunked upload lifecycle', async () => {
    const chunks = new Map<string, Map<number, { data: Buffer; eTag: string }>>();

    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => false,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      initiateChunkedUpload: async (key) => {
        const uploadId = `upload_${Date.now()}`;
        chunks.set(uploadId, new Map());
        return uploadId;
      },
      uploadChunk: async (uploadId, partNumber, data) => {
        const session = chunks.get(uploadId);
        if (!session) throw new Error(`Upload session not found: ${uploadId}`);
        const eTag = `"etag-part-${partNumber}"`;
        session.set(partNumber, { data, eTag });
        return eTag;
      },
      completeChunkedUpload: async (uploadId, parts) => {
        const session = chunks.get(uploadId);
        if (!session) throw new Error(`Upload session not found: ${uploadId}`);
        expect(parts.length).toBeGreaterThan(0);
        chunks.delete(uploadId);
        return 'uploads/assembled-file.bin';
      },
      abortChunkedUpload: async (uploadId) => {
        chunks.delete(uploadId);
      },
    };

    // 1. Initiate
    const uploadId = await storage.initiateChunkedUpload!('uploads/large-file.bin');
    expect(uploadId).toBeDefined();

    // 2. Upload chunks
    const etag1 = await storage.uploadChunk!(uploadId, 1, Buffer.from('chunk-1'));
    const etag2 = await storage.uploadChunk!(uploadId, 2, Buffer.from('chunk-2'));
    expect(etag1).toBe('"etag-part-1"');
    expect(etag2).toBe('"etag-part-2"');

    // 3. Complete
    const key = await storage.completeChunkedUpload!(uploadId, [
      { partNumber: 1, eTag: etag1 },
      { partNumber: 2, eTag: etag2 },
    ]);
    expect(key).toBe('uploads/assembled-file.bin');
  });

  it('should abort chunked upload', async () => {
    let aborted = false;

    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => false,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      abortChunkedUpload: async (_uploadId) => {
        aborted = true;
      },
    };

    await storage.abortChunkedUpload!('upload_to_abort');
    expect(aborted).toBe(true);
  });
});
