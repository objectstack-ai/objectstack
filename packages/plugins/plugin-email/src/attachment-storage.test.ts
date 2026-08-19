// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Out-of-row attachment content — the codec half (objectstack#5172).
//
// What these pin, in one sentence each:
//  - the key scheme is deterministic, path-safe, and says which row owns it;
//  - an offloaded element carries the PERMANENT audit metadata and a
//    reference, and no content;
//  - the round trip is byte- and type-exact, including the `string | Buffer`
//    arm, because the transport emits a different Content-Type for each;
//  - every way the content can fail to come back — outage, truncation,
//    substitution, reclaimed, no capability at all — is a REFUSAL, never a
//    message delivered without the attachment it declares;
//  - a partial upload cleans up after itself, because bytes no row will ever
//    reference are the one orphan class this design must not create.

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  EMAIL_ATTACHMENT_KEY_PREFIX,
  attachmentStorageKey,
  deleteAttachmentKeys,
  fetchAttachmentContent,
  offloadAttachmentsToStorage,
  type EmailAttachmentStore,
} from './attachment-storage.js';
import {
  decodeAttachmentsFromRow,
  decodeAttachmentsFromRowAsync,
  storageKeysInColumn,
  withContentReclaimed,
} from './sys-email-payload.js';

const sha = (s: string | Buffer) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

/** In-memory stand-in for the `storage` capability. */
function fakeStore(opts: { failUploadAt?: number; failDelete?: Set<string> } = {}) {
  const objects = new Map<string, Buffer>();
  let uploads = 0;
  const store = {
    objects,
    uploadCalls: [] as Array<{ key: string; contentType?: string }>,
    async upload(key: string, data: Buffer, options?: { contentType?: string }) {
      if (opts.failUploadAt !== undefined && uploads === opts.failUploadAt) {
        uploads++;
        throw new Error('bucket is on fire');
      }
      uploads++;
      store.uploadCalls.push({ key, ...(options?.contentType ? { contentType: options.contentType } : {}) });
      objects.set(key, Buffer.from(data));
    },
    async download(key: string) {
      const found = objects.get(key);
      if (!found) throw new Error(`NoSuchKey: ${key}`);
      return found;
    },
    async delete(key: string) {
      if (opts.failDelete?.has(key)) throw new Error('AccessDenied');
      objects.delete(key);
    },
  };
  return store satisfies EmailAttachmentStore & Record<string, unknown>;
}

describe('the storage key scheme', () => {
  it('names the owning object, groups by row, and orders by attachment index', () => {
    const k0 = attachmentStorageKey('row-1', 0, sha('a'));
    const k1 = attachmentStorageKey('row-1', 1, sha('b'));
    expect(k0.startsWith(`${EMAIL_ATTACHMENT_KEY_PREFIX}/row-1/`)).toBe(true);
    expect(k0).toMatch(/\/000-[0-9a-f]{16}$/);
    expect(k1).toMatch(/\/001-[0-9a-f]{16}$/);
    // Zero-padded so a bucket listing sorts the way the attachments do.
    expect([k1, k0].sort()).toEqual([k0, k1]);
  });

  it('is deterministic, so a retried send overwrites its own bytes instead of leaving a second copy', () => {
    expect(attachmentStorageKey('row-1', 0, sha('a'))).toBe(attachmentStorageKey('row-1', 0, sha('a')));
  });

  it('separates rows even for identical content', () => {
    expect(attachmentStorageKey('row-1', 0, sha('a'))).not.toBe(attachmentStorageKey('row-2', 0, sha('a')));
  });

  it('folds a row id that could escape the prefix — a key is a path on the local adapter', () => {
    const key = attachmentStorageKey('../../etc/passwd', 0, sha('a'));
    expect(key.startsWith(`${EMAIL_ATTACHMENT_KEY_PREFIX}/`)).toBe(true);
    expect(key).not.toContain('..');
    expect(key.split('/')).toHaveLength(4); // sys_email / attachments / <row> / <file>
  });

  it('never puts the filename in the key — filenames are author-supplied and live in the row', () => {
    const key = attachmentStorageKey('row-1', 0, sha('a'));
    expect(key).not.toContain('.');
  });
});

describe('offloading content to storage', () => {
  const BIG = Buffer.alloc(300 * 1024, 0x41);

  it('stores the content and records a reference plus the PERMANENT audit metadata', async () => {
    const store = fakeStore();
    const res = await offloadAttachmentsToStorage(
      [{ filename: 'contract.pdf', content: BIG, contentType: 'application/pdf' }],
      'row-1',
      store,
    );

    expect(res.kind).toBe('storage');
    if (res.kind !== 'storage') return;
    const [el] = JSON.parse(res.json);
    // The audit half — this is what survives reclamation, forever.
    expect(el).toMatchObject({
      filename: 'contract.pdf',
      contentType: 'application/pdf',
      size: BIG.byteLength,
      hash: sha(BIG),
      contentForm: 'buffer',
    });
    // The delivery half — a reference, and NOT the content.
    expect(el.storageKey).toBe(res.keys[0]);
    expect(el.inline).toBeUndefined();
    expect(el.content).toBeUndefined();
    // The row is now tiny regardless of how big the attachment was.
    expect(res.json.length).toBeLessThan(400);
    expect(store.objects.get(res.keys[0])!.equals(BIG)).toBe(true);
    expect(store.uploadCalls[0].contentType).toBe('application/pdf');
  });

  it('round-trips through the async reader, byte- and type-exact for BOTH content arms', async () => {
    const store = fakeStore();
    const text = 'x'.repeat(300 * 1024); // string arm — charset matters on the wire
    const res = await offloadAttachmentsToStorage(
      [
        { filename: '对账单.txt', content: text, cid: 'stmt@inline' },
        { filename: 'b.bin', content: BIG },
      ],
      'row-1',
      store,
    );
    expect(res.kind).toBe('storage');
    if (res.kind !== 'storage') return;

    const rebuilt = await decodeAttachmentsFromRowAsync(res.json, (k) => store.download(k));
    expect(rebuilt).toHaveLength(2);
    expect(rebuilt![0]).toEqual({ filename: '对账单.txt', content: text, cid: 'stmt@inline' });
    expect(typeof rebuilt![0].content).toBe('string');
    expect(Buffer.isBuffer(rebuilt![1].content)).toBe(true);
    expect((rebuilt![1].content as Buffer).equals(BIG)).toBe(true);
  });

  it('deletes what it already uploaded when a later upload fails — no bytes without a referrer', async () => {
    const store = fakeStore({ failUploadAt: 1 });
    const res = await offloadAttachmentsToStorage(
      [{ filename: 'a.bin', content: BIG }, { filename: 'b.bin', content: BIG }],
      'row-1',
      store,
    );

    expect(res.kind).toBe('unavailable');
    if (res.kind !== 'unavailable') return;
    expect(res.detail).toContain("uploading attachment 'b.bin'");
    expect(res.detail).toContain('bucket is on fire');
    // The point of the case: nothing is left behind.
    expect([...store.objects.keys()]).toEqual([]);
  });

  it('reports content outside the EmailAttachment contract rather than uploading something odd', async () => {
    const store = fakeStore();
    const res = await offloadAttachmentsToStorage(
      [{ filename: 'odd.bin', content: new Uint8Array([1, 2, 3]) as unknown as Buffer }],
      'row-1',
      store,
    );
    expect(res.kind).toBe('unavailable');
    if (res.kind !== 'unavailable') return;
    expect(res.detail).toContain('neither a string nor a Buffer');
    expect(store.objects.size).toBe(0);
  });
});

describe('reading content back — every failure is a refusal, never a stripped message', () => {
  const BIG = Buffer.alloc(300 * 1024, 0x42);

  async function offloaded(store: EmailAttachmentStore) {
    const res = await offloadAttachmentsToStorage([{ filename: 'a.bin', content: BIG }], 'row-1', store);
    if (res.kind !== 'storage') throw new Error('fixture failed to offload');
    return res;
  }

  it('propagates a storage read outage instead of pretending the attachment was not there', async () => {
    const store = fakeStore();
    const res = await offloaded(store);
    const fetch = vi.fn(async () => { throw new Error('S3 unreachable'); });
    await expect(decodeAttachmentsFromRowAsync(res.json, fetch)).rejects.toThrow(/S3 unreachable/);
  });

  it('rejects a key the backend no longer holds', async () => {
    const store = fakeStore();
    const res = await offloaded(store);
    store.objects.clear();
    await expect(decodeAttachmentsFromRowAsync(res.json, (k) => store.download(k)))
      .rejects.toThrow(/NoSuchKey/);
  });

  it('rejects TRUNCATED storage content — size is verified on the way back in, not just on the way out', async () => {
    const store = fakeStore();
    const res = await offloaded(store);
    await expect(decodeAttachmentsFromRowAsync(res.json, async () => BIG.subarray(0, 10)))
      .rejects.toThrow(/is 10 byte\(s\) but the row records size 307200/);
  });

  it('rejects SUBSTITUTED storage content of the right length — the digest is the real check', async () => {
    const store = fakeStore();
    const res = await offloaded(store);
    await expect(decodeAttachmentsFromRowAsync(res.json, async () => Buffer.alloc(BIG.byteLength, 0x43)))
      .rejects.toThrow(/is not the content that was sent/);
  });

  it('rejects a non-Buffer answer from the capability, naming the key', async () => {
    const store = fakeStore();
    const res = await offloaded(store);
    const bad = {
      download: async () => 'not a buffer' as unknown as Buffer,
    } as unknown as EmailAttachmentStore;
    await expect(fetchAttachmentContent(bad, res.keys[0]))
      .rejects.toThrow(new RegExp(`non-Buffer value for attachment content key '${res.keys[0]}'`));
  });

  it('refuses when NO storage capability is mounted, naming what to mount', async () => {
    const store = fakeStore();
    const res = await offloaded(store);
    await expect(decodeAttachmentsFromRowAsync(res.json, undefined))
      .rejects.toThrow(/no storage capability is mounted on this process/);
    // …and the synchronous entry point says the same thing rather than
    // silently returning a message with one fewer attachment.
    expect(() => decodeAttachmentsFromRow(res.json))
      .toThrow(/no storage capability to fetch it from/);
  });
});

describe('reclaiming the column (the row keeps the audit metadata)', () => {
  const column = JSON.stringify([
    {
      filename: 'contract.pdf',
      contentType: 'application/pdf',
      size: 307200,
      hash: sha('anything'),
      cid: 'c@x',
      contentForm: 'buffer',
      storageKey: 'sys_email/attachments/row-1/000-abcdef0123456789',
    },
  ]);

  it('drops storageKey, stamps contentReclaimedAt, and touches nothing else', () => {
    const next = withContentReclaimed(column, '2026-08-05T00:00:00.000Z');
    expect(next).toBeDefined();
    const [el] = JSON.parse(next!);
    expect(el).toEqual({
      filename: 'contract.pdf',
      contentType: 'application/pdf',
      size: 307200,
      hash: sha('anything'),
      cid: 'c@x',
      contentForm: 'buffer',
      contentReclaimedAt: '2026-08-05T00:00:00.000Z',
    });
  });

  it('is a no-op the second time — a reclaimed row is not re-stamped', () => {
    const once = withContentReclaimed(column, '2026-08-05T00:00:00.000Z')!;
    expect(withContentReclaimed(once, '2026-08-09T00:00:00.000Z')).toBeUndefined();
  });

  it('leaves an inline (small-attachment) row alone — its content is not out of the row', () => {
    const inlineCol = JSON.stringify([
      { filename: 'a.txt', size: 2, hash: sha('hi'), contentForm: 'string', inline: Buffer.from('hi').toString('base64') },
    ]);
    expect(withContentReclaimed(inlineCol, '2026-08-05T00:00:00.000Z')).toBeUndefined();
  });

  it('refuses to re-send a reclaimed row, and says the content was reclaimed rather than lost', async () => {
    const next = withContentReclaimed(column, '2026-08-05T00:00:00.000Z')!;
    await expect(decodeAttachmentsFromRowAsync(next, async () => Buffer.alloc(0)))
      .rejects.toThrow(/had its out-of-row content reclaimed at 2026-08-05T00:00:00.000Z/);
  });
});

describe('storageKeysInColumn — deliberately tolerant, because it feeds DELETION', () => {
  it('lists the keys of a well-formed column, in element order', () => {
    const col = JSON.stringify([
      { filename: 'a', size: 1, hash: 'h', contentForm: 'buffer', storageKey: 'k0' },
      { filename: 'b', size: 1, hash: 'h', contentForm: 'buffer', storageKey: 'k1' },
    ]);
    expect(storageKeysInColumn(col)).toEqual(['k0', 'k1']);
  });

  it('still names the keys of a column too damaged to deliver from', () => {
    // No `hash`, no `contentForm` — the strict decoder rejects this outright.
    const col = JSON.stringify([{ filename: '', storageKey: 'k0' }, { junk: true }]);
    expect(() => decodeAttachmentsFromRow(col)).toThrow();
    // Refusing to parse here would strand those bytes forever; the failure
    // mode has no upside, so this one path reads what it can.
    expect(storageKeysInColumn(col)).toEqual(['k0']);
  });

  it('answers empty for absent, unparseable, and inline-only columns', () => {
    expect(storageKeysInColumn(null)).toEqual([]);
    expect(storageKeysInColumn('')).toEqual([]);
    expect(storageKeysInColumn('{not json')).toEqual([]);
    expect(storageKeysInColumn(JSON.stringify([{ filename: 'a', inline: 'aGk=' }]))).toEqual([]);
  });
});

describe('deleteAttachmentKeys', () => {
  it('reports which keys survived, so a byte leak is never silent', async () => {
    const store = fakeStore({ failDelete: new Set(['k1']) });
    store.objects.set('k0', Buffer.from('a'));
    store.objects.set('k1', Buffer.from('b'));

    const res = await deleteAttachmentKeys(store, ['k0', 'k1']);

    expect(res.deleted).toEqual(['k0']);
    expect(res.failed).toEqual([{ key: 'k1', error: 'AccessDenied' }]);
    expect(store.objects.has('k1')).toBe(true);
  });
});
