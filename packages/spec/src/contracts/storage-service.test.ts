import { describe, it, expect } from 'vitest';
import type {
  IStorageService,
  StorageFileInfo,
  StorageListPage,
} from './storage-service';
import {
  DEFAULT_STORAGE_LIST_LIMIT,
  decodeStorageListCursor,
  encodeStorageListCursor,
  resolveStorageListLimit,
} from './storage-service';

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
  // Contract pin — `list(prefix, { cursor, limit })`.
  //
  // These three cases are the FLIP of the #5540 retirement pins that stood
  // here (#6781): the single-argument `list?(prefix)` stayed retired, and the
  // cursor-shaped member the retirement notes reserved took its place. The
  // pins are kept rather than deleted because the load they bear only moved —
  // it used to be "the retired shape has not crept back", it is now "the
  // restored shape is the cursor one and NOT the array one".
  //
  // `IStorageService` is a pure TypeScript contract: nothing parses it, so
  // tsc is the only channel it has — and `tsconfig.test.json` puts this file
  // in front of tsc (#5286), so the `@ts-expect-error` directive below is a
  // real check that goes red the day the old array shape returns, not a
  // phantom one.
  // ---------------------------------------------------------------------
  it('declares list(prefix, { cursor, limit }) returning a page plus a cursor', async () => {
    const stored = ['a/b/c.txt', 'a/b/d.txt', 'ab.txt'];

    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => true,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      list: async (prefix, options): Promise<StorageListPage> => {
        const limit = resolveStorageListLimit(options?.limit);
        const after = options?.cursor ? decodeStorageListCursor(options.cursor) : undefined;
        const matched = stored
          .filter((key) => key.startsWith(prefix))
          .filter((key) => after === undefined || key > after)
          .sort();
        const page = matched.slice(0, limit);
        const items = page.map((key) => ({ key, size: 0, lastModified: new Date() }));
        return matched.length > limit
          ? { items, nextCursor: encodeStorageListCursor(page[page.length - 1]!) }
          : { items };
      },
    };

    const first = await storage.list!('a', { limit: 2 });
    expect(first.items.map((i) => i.key)).toEqual(['a/b/c.txt', 'a/b/d.txt']);
    expect(first.nextCursor).toBeDefined();

    const second = await storage.list!('a', { limit: 2, cursor: first.nextCursor });
    // `list('a')` is a RAW prefix match, so `ab.txt` is in scope — the one
    // semantic a caller most often assumes away.
    expect(second.items.map((i) => i.key)).toEqual(['ab.txt']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('still rejects the retired array shape — list(prefix) returning StorageFileInfo[]', () => {
    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => true,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
      // @ts-expect-error — the restored member is cursor-shaped. An adapter
      // carrying the #5540-retired `(prefix) => StorageFileInfo[]` is a type
      // error, not a tolerated dialect (#6781).
      list: async (_prefix: string): Promise<StorageFileInfo[]> => [],
    };

    expect(typeof storage.getInfo).toBe('function');
  });

  it('list stays OPTIONAL — an adapter that cannot enumerate still satisfies the contract', () => {
    // The restoration is additive (minor). Making `list` required would break
    // every third-party adapter, which is a major-version act this card is not.
    const storage: IStorageService = {
      upload: async () => {},
      download: async () => Buffer.from(''),
      delete: async () => {},
      exists: async () => true,
      getInfo: async (key) => ({ key, size: 0, lastModified: new Date() }),
    };

    expect(storage.list).toBeUndefined();
  });

  // ---------------------------------------------------------------------
  // The shared argument discipline. It lives on the CONTRACT precisely so
  // two adapters cannot answer the same bad argument two ways — the failure
  // mode that retired the old `list` (#5266).
  // ---------------------------------------------------------------------
  describe('resolveStorageListLimit', () => {
    it('defaults an omitted limit to DEFAULT_STORAGE_LIST_LIMIT', () => {
      expect(resolveStorageListLimit(undefined)).toBe(DEFAULT_STORAGE_LIST_LIMIT);
      expect(DEFAULT_STORAGE_LIST_LIMIT).toBe(1000);
    });

    it('passes a positive integer through', () => {
      expect(resolveStorageListLimit(1)).toBe(1);
      expect(resolveStorageListLimit(2500)).toBe(2500);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
      ['fractional', 1.5],
      ['NaN', Number.NaN],
      ['Infinity', Number.POSITIVE_INFINITY],
    ])('refuses a %s limit with the ADR-0112 envelope', (_label, limit) => {
      // Rejection-class: assert the ENVELOPE (code + status), not merely that
      // something threw. A bare `toThrow()` cannot tell a refusal apart from a
      // clamp that later blew up somewhere else.
      let caught: (Error & { code?: string; status?: number }) | undefined;
      try {
        resolveStorageListLimit(limit);
      } catch (err) {
        caught = err as Error & { code?: string; status?: number };
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught?.code).toBe('VALIDATION_ERROR');
      expect(caught?.status).toBe(400);
      expect(caught?.message).toContain(`'limit' must be a positive integer`);
    });
  });

  describe('storage list cursor codec', () => {
    it('round-trips a key', () => {
      for (const key of ['a/b/c.txt', 'tenants/t-1/файл.bin', 'x'.repeat(300)]) {
        expect(decodeStorageListCursor(encodeStorageListCursor(key))).toBe(key);
      }
    });

    it('refuses a token it did not issue with the ADR-0112 envelope', () => {
      // Node's base64url decoder DROPS characters it does not recognise, so a
      // corrupted token would otherwise decode to a different key and resume
      // the sweep in the wrong place. Re-encoding catches that.
      for (const bogus of ['not a cursor', '', 'YQ==', '!!!!']) {
        let caught: (Error & { code?: string; status?: number }) | undefined;
        try {
          decodeStorageListCursor(bogus);
        } catch (err) {
          caught = err as Error & { code?: string; status?: number };
        }

        expect(caught, `expected "${bogus}" to be refused`).toBeInstanceOf(Error);
        expect(caught?.code).toBe('VALIDATION_ERROR');
        expect(caught?.status).toBe(400);
        expect(caught?.message).toContain(`'cursor' is not a continuation token`);
      }
    });
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
