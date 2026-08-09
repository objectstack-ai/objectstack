// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Adapter conformance — `list(prefix, { cursor, limit })` on BOTH shipped
 * backends (#6781).
 *
 * ## Why this file is the deliverable, not a nicety
 *
 * `list(prefix)` was retired (#5266 / #5540 / #5541) because one contract
 * method had two implementations that answered the same call differently, and
 * *nothing in the repository could tell*: the local adapter listed one level
 * deep and returned directories as files, the S3 adapter recursed and stopped
 * at 1000 objects. Each had tests. Each was green. Neither test ever compared
 * the two, so the divergence was invisible until a real caller would have hit
 * it on one deployment and not the other. An interface only one driver honours
 * is a second de-facto contract (AGENTS.md PD #12).
 *
 * So every behavioural case below runs against BOTH backends from one table,
 * and the last block compares them key-for-key and cursor-for-cursor on an
 * identical key set. A case that only one backend can express (a real
 * filesystem directory; an S3 zero-byte directory marker) is written as the
 * backend-specific half of the SAME semantic — "directories never appear" —
 * rather than left out.
 *
 * ## The S3 side is a fake bucket, and the fake is the load-bearing part
 *
 * There is no real S3 in CI, so `@aws-sdk/client-s3` is mocked with a bucket
 * that implements the documented `ListObjectsV2` contract rather than a
 * convenient one:
 *
 *   - keys answered in ascending (UTF-8 byte) order;
 *   - `Prefix` as a RAW STRING prefix — `Prefix: 'a'` matches `ab.txt`;
 *   - `MaxKeys` honoured **and capped at 1000**, the real service ceiling. This
 *     is what makes ">1000 objects enumerated via cursor" a real test: an
 *     adapter that issues one request per `list()` call cannot pass it;
 *   - `IsTruncated` + `NextContinuationToken` for intra-call paging, and
 *     `StartAfter` for resuming a later call;
 *   - the continuation token is an OPAQUE HANDLE (`ct-3`), deliberately NOT
 *     derived from a key. If the adapter ever leaked it out as the caller-facing
 *     `nextCursor`, the contract's `decodeStorageListCursor` would refuse it and
 *     the cross-backend cursor comparison would fail — which is the point.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { IStorageService } from '@objectstack/spec/contracts';
import {
  DEFAULT_STORAGE_LIST_LIMIT,
  encodeStorageListCursor,
} from '@objectstack/spec/contracts';

const fakeS3 = vi.hoisted(() => {
  /** The real `ListObjectsV2` ceiling on `MaxKeys`, whatever the caller asks. */
  const MAX_KEYS_CEILING = 1000;

  const objects = new Map<string, { size: number; lastModified: Date }>();
  const listInputs: Array<Record<string, unknown>> = [];
  const tokens = new Map<string, string>();
  let tokenSeq = 0;

  function listObjectsV2(input: Record<string, any>): Record<string, unknown> {
    listInputs.push(input);

    const prefix: string = input.Prefix ?? '';
    const maxKeys = Math.min(
      typeof input.MaxKeys === 'number' ? input.MaxKeys : MAX_KEYS_CEILING,
      MAX_KEYS_CEILING,
    );

    const all = [...objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

    // `ContinuationToken` wins over `StartAfter`, as the real service does.
    let after: string | undefined;
    if (input.ContinuationToken !== undefined) {
      after = tokens.get(input.ContinuationToken);
      if (after === undefined) {
        const err = new Error('The continuation token provided is incorrect') as Error & {
          name: string;
        };
        err.name = 'InvalidArgument';
        throw err;
      }
    } else if (input.StartAfter !== undefined) {
      after = input.StartAfter;
    }

    const start = after === undefined ? 0 : all.filter((key) => key <= after!).length;
    const window = all.slice(start, start + maxKeys);
    const isTruncated = start + window.length < all.length;

    let nextContinuationToken: string | undefined;
    if (isTruncated) {
      nextContinuationToken = `ct-${++tokenSeq}`;
      tokens.set(nextContinuationToken, window[window.length - 1]!);
    }

    return {
      Prefix: prefix,
      MaxKeys: maxKeys,
      KeyCount: window.length,
      IsTruncated: isTruncated,
      NextContinuationToken: nextContinuationToken,
      Contents: window.map((key) => ({
        Key: key,
        Size: objects.get(key)!.size,
        LastModified: objects.get(key)!.lastModified,
      })),
    };
  }

  function reset(): void {
    objects.clear();
    listInputs.length = 0;
    tokens.clear();
    tokenSeq = 0;
  }

  return { MAX_KEYS_CEILING, objects, listInputs, listObjectsV2, reset };
});

vi.mock('@aws-sdk/client-s3', () => {
  class ListObjectsV2Command {
    constructor(public readonly input: Record<string, unknown>) {}
  }
  class S3Client {
    constructor(_config: unknown) {}
    async send(command: unknown): Promise<unknown> {
      if (command instanceof ListObjectsV2Command) {
        return fakeS3.listObjectsV2(command.input);
      }
      throw new Error(
        `fake S3 bucket: this suite only serves ListObjectsV2, got ${(command as any)?.constructor?.name}`,
      );
    }
  }
  return {
    S3Client,
    ListObjectsV2Command,
    PutObjectCommand: class {},
    GetObjectCommand: class {},
    DeleteObjectCommand: class {},
    HeadObjectCommand: class {},
    CreateMultipartUploadCommand: class {},
    UploadPartCommand: class {},
    CompleteMultipartUploadCommand: class {},
    AbortMultipartUploadCommand: class {},
  };
});

// `vi.mock` is hoisted above every import in this file, so the lazy
// `await import('@aws-sdk/client-s3')` inside `S3StorageAdapter` resolves to the
// fake above no matter where these two sit.
import { LocalStorageAdapter } from './local-storage-adapter';
import { S3StorageAdapter } from './s3-storage-adapter';

// ---------------------------------------------------------------------------
// Backend harness
// ---------------------------------------------------------------------------

interface Backend {
  readonly adapter: IStorageService;
  seed(keys: string[]): Promise<void>;
  dispose(): Promise<void>;
}

async function makeLocalBackend(): Promise<Backend & { rootDir: string }> {
  const rootDir = join(tmpdir(), `os-list-conformance-${randomUUID()}`);
  await fs.mkdir(rootDir, { recursive: true });
  const adapter = new LocalStorageAdapter({ rootDir });
  const madeDirs = new Set<string>();

  return {
    adapter,
    rootDir,
    async seed(keys) {
      for (const key of keys) {
        const path = join(rootDir, key);
        const dir = dirname(path);
        if (!madeDirs.has(dir)) {
          await fs.mkdir(dir, { recursive: true });
          madeDirs.add(dir);
        }
        // Content is the key itself, so `size` is a value the assertions can
        // predict without reading the file back.
        await fs.writeFile(path, Buffer.from(key, 'utf8'));
      }
    },
    async dispose() {
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}

async function makeS3Backend(): Promise<Backend> {
  fakeS3.reset();
  const adapter = new S3StorageAdapter({ bucket: 'conformance-bucket', region: 'us-east-1' });

  return {
    adapter,
    async seed(keys) {
      for (const key of keys) {
        fakeS3.objects.set(key, {
          size: Buffer.byteLength(key, 'utf8'),
          lastModified: new Date('2026-01-01T00:00:00.000Z'),
        });
      }
    },
    async dispose() {
      fakeS3.reset();
    },
  };
}

const BACKENDS = [
  { name: 'local', make: makeLocalBackend },
  { name: 's3', make: makeS3Backend },
] as const;

/** Page a prefix to exhaustion, returning one entry per page. */
async function pageThrough(
  adapter: IStorageService,
  prefix: string,
  limit: number,
): Promise<Array<{ keys: string[]; nextCursor?: string }>> {
  const pages: Array<{ keys: string[]; nextCursor?: string }> = [];
  let cursor: string | undefined;
  let guard = 0;

  do {
    const page = await adapter.list!(prefix, { limit, cursor });
    pages.push({ keys: page.items.map((item) => item.key), nextCursor: page.nextCursor });
    cursor = page.nextCursor;
    if (++guard > 500) throw new Error('list() pagination did not terminate');
  } while (cursor !== undefined);

  return pages;
}

/** Capture a rejection's ADR-0112 envelope without asserting on a throw alone. */
async function captureRefusal(fn: () => Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  try {
    await fn();
  } catch (err) {
    return err as Error & { code?: string; status?: number };
  }
  // Reaching here means the call ANSWERED. Named explicitly, because "it did
  // not refuse at all" and "it refused with the wrong envelope" are two
  // different defects and a bare `rejects.toThrow()` cannot separate them.
  throw new Error('expected the call to be refused, but it resolved');
}

/**
 * `a.txt` earns its place: on the local backend `readdir` yields the directory
 * `a` BEFORE the file `a.txt`, yet `a.txt` sorts before every key inside `a/`
 * (`.` is 0x2E, `/` is 0x2F). So directory-traversal order and key order
 * disagree here and nowhere else in this fixture — without it, a local
 * implementation that simply emits keys as it walks them passes every
 * single-backend case and is caught only by the cross-backend comparison.
 * Measured, not reasoned: dropping the ordered insert turned exactly four
 * cross-backend cases red and left the local suite green until this key existed.
 */
const SMALL_SET = [
  'a.txt',
  'a/b/c.txt',
  'a/b/d.txt',
  'a/z.txt',
  'ab.txt',
  'b.txt',
];

/** 2500 keys — comfortably past the S3 `MaxKeys` ceiling of 1000. */
const BULK_SET = Array.from({ length: 2500 }, (_, i) => {
  const bucket = String(Math.floor(i / 100)).padStart(2, '0');
  return `bulk/${bucket}/${String(i).padStart(4, '0')}.bin`;
});

// ---------------------------------------------------------------------------
// Behaviour, asserted identically on every backend
// ---------------------------------------------------------------------------

describe.each(BACKENDS)('$name adapter — list() conformance', ({ make }) => {
  let backend: Backend;

  beforeAll(async () => {
    backend = await make();
    await backend.seed(SMALL_SET);
    await backend.seed(BULK_SET);
  }, 60_000);

  afterAll(async () => {
    await backend.dispose();
  });

  it('sees nested keys under a bare prefix (the local one-level dialect, #5266)', async () => {
    const page = await backend.adapter.list!('a');

    // `a/b/c.txt` is TWO levels below `a`. The retired local implementation
    // returned `a/b` — a directory — and never reached the file.
    expect(page.items.map((item) => item.key)).toEqual([
      'a.txt',
      'a/b/c.txt',
      'a/b/d.txt',
      'a/z.txt',
      'ab.txt',
    ]);
  });

  it('matches a RAW key prefix, so a trailing slash is what scopes to a folder', async () => {
    // `ab.txt` is in scope for `list('a')` and out of scope for `list('a/')`.
    // This is S3's meaning of "prefix", and the local adapter emulates it
    // rather than resolving the argument as a directory path.
    const bare = await backend.adapter.list!('a');
    const scoped = await backend.adapter.list!('a/');

    expect(bare.items.map((i) => i.key)).toContain('ab.txt');
    expect(scoped.items.map((i) => i.key)).toEqual(['a/b/c.txt', 'a/b/d.txt', 'a/z.txt']);
  });

  it('answers in ascending key order', async () => {
    const page = await backend.adapter.list!('a');
    const keys = page.items.map((i) => i.key);

    expect(keys).toEqual([...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
  });

  it('never returns a directory entry as a file', async () => {
    // `a/b` is a real directory on the local backend and has no object at all
    // on S3. Neither may surface: the retired local implementation stat'd it
    // into the result with a directory inode as `size`.
    const page = await backend.adapter.list!('');
    const keys = page.items.map((i) => i.key);

    expect(keys).not.toContain('a/b');
    expect(keys).not.toContain('a');
    expect(keys.every((key) => !key.endsWith('/'))).toBe(true);
  });

  it('reports a real byte size for each item', async () => {
    const page = await backend.adapter.list!('ab.txt');

    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.size).toBe(Buffer.byteLength('ab.txt', 'utf8'));
    expect(page.items[0]!.lastModified).toBeInstanceOf(Date);
  });

  it('pages a set larger than `limit` with an EXACT, non-overlapping union', async () => {
    const pages = await pageThrough(backend.adapter, 'bulk/', 400);
    const seen = pages.flatMap((page) => page.keys);

    // 1. Union is exactly the seeded set — nothing missed.
    expect(new Set(seen)).toEqual(new Set(BULK_SET));
    // 2. Non-overlapping — nothing returned twice.
    expect(seen).toHaveLength(BULK_SET.length);
    expect(new Set(seen).size).toBe(seen.length);
    // 3. Globally ordered across page boundaries, not merely within a page.
    expect(seen).toEqual([...BULK_SET].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)));
    // 4. Every page full except the last, and ONLY the last lacks a cursor.
    expect(pages).toHaveLength(Math.ceil(BULK_SET.length / 400));
    for (const page of pages.slice(0, -1)) {
      expect(page.keys).toHaveLength(400);
      expect(page.nextCursor).toBeDefined();
    }
    expect(pages.at(-1)!.keys).toHaveLength(BULK_SET.length % 400);
    expect(pages.at(-1)!.nextCursor).toBeUndefined();
  }, 60_000);

  it('fills one page past the backend\'s own page size (>1000 in a single call)', async () => {
    // The retired S3 implementation issued exactly ONE ListObjectsV2 and never
    // read `IsTruncated`, so it could not answer more than 1000 whatever the
    // caller asked. A short page here is that defect, restored.
    const page = await backend.adapter.list!('bulk/', { limit: 1500 });

    expect(page.items).toHaveLength(1500);
    expect(page.nextCursor).toBeDefined();
    expect(page.items.map((i) => i.key)).toEqual(BULK_SET.slice(0, 1500));
  }, 60_000);

  it('an OMITTED limit pages at the contract default instead of truncating', async () => {
    // The old defect in one sentence: 1000 objects came back and the caller had
    // no way to know there were 2500. Same number here, opposite meaning — the
    // page is capped AND says so.
    const first = await backend.adapter.list!('bulk/');

    expect(first.items).toHaveLength(DEFAULT_STORAGE_LIST_LIMIT);
    expect(first.nextCursor).toBeDefined();

    const seen = [...first.items.map((i) => i.key)];
    let cursor = first.nextCursor;
    while (cursor !== undefined) {
      const page: Awaited<ReturnType<NonNullable<IStorageService['list']>>> =
        await backend.adapter.list!('bulk/', { cursor });
      seen.push(...page.items.map((i) => i.key));
      cursor = page.nextCursor;
    }

    expect(seen).toHaveLength(BULK_SET.length);
    expect(new Set(seen)).toEqual(new Set(BULK_SET));
  }, 60_000);

  it('answers an empty page — never a cursor — for a prefix that matches nothing', async () => {
    const page = await backend.adapter.list!('no-such-prefix/');

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeUndefined();
  });

  it('refuses a non-positive-integer `limit` with the ADR-0112 envelope', async () => {
    for (const limit of [0, -1, 1.5, Number.NaN]) {
      const err = await captureRefusal(() => backend.adapter.list!('a', { limit }));

      // code AND status: the envelope is the contract, and a bare `toThrow()`
      // would pass on any incidental error from deeper in the backend.
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.status).toBe(400);
      expect(err.message).toContain(`'limit' must be a positive integer`);
    }
  });

  it('refuses a cursor it did not issue with the ADR-0112 envelope', async () => {
    // A silently-ignored bad cursor restarts the sweep from key zero, which for
    // a paging reclamation job is an infinite loop that looks like progress.
    const err = await captureRefusal(() => backend.adapter.list!('a', { cursor: 'not-a-cursor!' }));

    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.status).toBe(400);
    expect(err.message).toContain(`'cursor' is not a continuation token`);
  });

  it('issues a cursor the contract codec can read back', async () => {
    const page = await backend.adapter.list!('bulk/', { limit: 10 });

    expect(page.nextCursor).toBe(encodeStorageListCursor(page.items.at(-1)!.key));
  });
});

// ---------------------------------------------------------------------------
// The halves only one backend can express — same semantic, two shapes
// ---------------------------------------------------------------------------

describe('list() — backend-specific expressions of the shared semantics', () => {
  it('local: the adapter\'s own .parts multipart staging is not a stored object', async () => {
    const backend = await makeLocalBackend();
    try {
      await backend.seed(['real.bin']);
      // Written the way `initiateChunkedUpload` writes it, so this pins the
      // real staging layout rather than a stand-in.
      const uploadId = await backend.adapter.initiateChunkedUpload!('pending.bin');
      await backend.adapter.uploadChunk!(uploadId, 1, Buffer.from('chunk'));

      const page = await backend.adapter.list!('');

      expect(page.items.map((i) => i.key)).toEqual(['real.bin']);
    } finally {
      await backend.dispose();
    }
  });

  it('s3: a zero-byte directory marker is skipped, as a filesystem directory is', async () => {
    const backend = await makeS3Backend();
    try {
      await backend.seed(['a/b/c.txt']);
      // What the AWS console creates when you "make a folder". The local
      // backend cannot represent it at all, so returning it here would be a
      // per-backend dialect — the exact defect class that retired `list`.
      fakeS3.objects.set('a/', { size: 0, lastModified: new Date(0) });
      fakeS3.objects.set('a/b/', { size: 0, lastModified: new Date(0) });

      const page = await backend.adapter.list!('');

      expect(page.items.map((i) => i.key)).toEqual(['a/b/c.txt']);
    } finally {
      await backend.dispose();
    }
  });

  it('s3: one list() call loops ListObjectsV2 rather than truncating at MaxKeys', async () => {
    const backend = await makeS3Backend();
    try {
      await backend.seed(BULK_SET);
      fakeS3.listInputs.length = 0;

      const page = await backend.adapter.list!('bulk/', { limit: 1500 });

      expect(page.items).toHaveLength(1500);
      // 1000 (the ceiling) + 500. A single request here is the #5266 defect.
      expect(fakeS3.listInputs).toHaveLength(2);
      expect(fakeS3.listInputs[0]!.MaxKeys).toBe(1000);
      expect(fakeS3.listInputs[1]!.MaxKeys).toBe(500);
      // Intra-call paging uses the S3 continuation token...
      expect(fakeS3.listInputs[1]!.ContinuationToken).toBe('ct-1');
      // ...and that opaque handle never escapes as the caller-facing cursor.
      expect(page.nextCursor).not.toBe('ct-1');
      expect(page.nextCursor).toBe(encodeStorageListCursor(BULK_SET[1499]!));
    } finally {
      await backend.dispose();
    }
  }, 60_000);

  it('s3: a caller-supplied cursor resumes through StartAfter, not a leaked token', async () => {
    const backend = await makeS3Backend();
    try {
      await backend.seed(BULK_SET);
      const first = await backend.adapter.list!('bulk/', { limit: 5 });
      fakeS3.listInputs.length = 0;

      const second = await backend.adapter.list!('bulk/', { limit: 5, cursor: first.nextCursor });

      expect(fakeS3.listInputs[0]!.StartAfter).toBe(BULK_SET[4]);
      expect(fakeS3.listInputs[0]!.ContinuationToken).toBeUndefined();
      expect(second.items.map((i) => i.key)).toEqual(BULK_SET.slice(5, 10));
    } finally {
      await backend.dispose();
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The comparison the retired `list` never had: both backends, same key set
// ---------------------------------------------------------------------------

describe('local and s3 agree on an identical key set', () => {
  const KEYS = [
    'a/b/c.txt',
    'a/b/d.txt',
    'a/z.txt',
    'ab.txt',
    'a.txt',
    'b/1.txt',
    'b/2.txt',
    'c.txt',
  ];

  let local: Backend;
  let s3: Backend;

  beforeAll(async () => {
    local = await makeLocalBackend();
    s3 = await makeS3Backend();
    await local.seed(KEYS);
    await s3.seed(KEYS);
  });

  afterAll(async () => {
    await local.dispose();
    await s3.dispose();
  });

  it.each([
    ['everything', ''],
    ['a bare prefix that also matches siblings', 'a'],
    ['a folder-scoped prefix', 'a/'],
    ['a prefix matching one key', 'c.txt'],
    ['a prefix matching nothing', 'zzz'],
  ])('page-by-page equality for %s', async (_label, prefix) => {
    const localPages = await pageThrough(local.adapter, prefix, 2);
    const s3Pages = await pageThrough(s3.adapter, prefix, 2);

    // Keys AND cursors. Cursor equality is the strong half: it proves the two
    // backends encode the same continuation, so a `SwappableStorageService`
    // swap mid-sweep resumes where it left off instead of silently restarting.
    expect(localPages).toEqual(s3Pages);
  });

  it('the two backends observe the same total key set', async () => {
    const localKeys = (await local.adapter.list!('')).items.map((i) => i.key);
    const s3Keys = (await s3.adapter.list!('')).items.map((i) => i.key);

    expect(localKeys).toEqual(s3Keys);
    expect(new Set(localKeys)).toEqual(new Set(KEYS));
  });

  it('a cursor issued by one backend is accepted by the other', async () => {
    const fromLocal = await local.adapter.list!('', { limit: 3 });
    const continuedOnS3 = await s3.adapter.list!('', { limit: 3, cursor: fromLocal.nextCursor });

    const fromS3 = await s3.adapter.list!('', { limit: 3 });
    const continuedOnLocal = await local.adapter.list!('', { limit: 3, cursor: fromS3.nextCursor });

    expect(continuedOnS3.items.map((i) => i.key)).toEqual(
      continuedOnLocal.items.map((i) => i.key),
    );
    expect(continuedOnS3.items.map((i) => i.key)).toEqual(KEYS.slice().sort().slice(3, 6));
  });
});
