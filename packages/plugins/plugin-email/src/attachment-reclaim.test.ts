// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Reclaiming out-of-row attachment content (objectstack#5172).
//
// The three things these exist to prove:
//
//  1. **Content dies with the delivery, metadata does not.** A terminal row
//     past its grace window loses its bytes and keeps filename / contentType /
//     size / hash — forever. That asymmetry is the whole feature.
//  2. **A deleted row cannot orphan content.** The job carries the storage
//     keys, so it deletes them even when the `sys_email` row is gone by the
//     time it fires — which is exactly what a future declarative `retention`
//     policy in the #5192 shape would do to it.
//  3. **Nothing is deleted early.** A row still in flight, or one touched
//     inside the grace window, re-arms the job instead of deleting the content
//     a retry may still need. And when it cannot re-arm, it SAYS so at
//     `error`, because bytes that were supposed to be temporary have just
//     become permanent.

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import {
  reclaimAttachmentContent,
  RECLAIM_OBJECT,
  type AttachmentReclaimEngine,
} from './attachment-reclaim.js';
import {
  EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
  type EmailAttachmentStore,
} from './attachment-storage.js';

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3600_000;
const sha = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`;

const KEYS = ['sys_email/attachments/row-1/000-aaaaaaaaaaaaaaaa'];

/** `attachments_json` as `send()` writes it for a storage-backed message. */
const storageColumn = JSON.stringify([{
  filename: 'contract.pdf',
  contentType: 'application/pdf',
  size: 307200,
  hash: sha('contract'),
  contentForm: 'buffer',
  storageKey: KEYS[0],
}]);

function fakeEngine(rows: Array<Record<string, any>>) {
  const tables = new Map<string, any[]>([[RECLAIM_OBJECT, rows.map((r) => ({ ...r }))]]);
  const rowsOf = (t: string) => tables.get(t) ?? [];
  const engine = {
    rows: (t = RECLAIM_OBJECT) => [...rowsOf(t)],
    updates: [] as Array<Record<string, any>>,
    async find(table: string, o: any = {}) {
      const where = o?.where ?? {};
      let out = rowsOf(table).filter((r) => Object.entries(where).every(([k, v]) => { if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`); return r[k] === v; }));
      if (o.limit) out = out.slice(0, o.limit);
      return out;
    },
    async update(table: string, patch: any) {
      engine.updates.push({ table, ...patch });
      const r = rowsOf(table).find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not found in ${table}`);
      Object.assign(r, patch);
      return r;
    },
    async delete(table: string, o: any) {
      // [#4550/#5197] Pinned to ObjectQL.delete's own dispatch predicate — a
      // double looser than the engine it stands in for turns a green suite
      // into no suite at all.
      const dispatch = assertEngineDeleteDispatch(o);
      if (dispatch.kind === 'multi') {
        const survivors = rowsOf(table).filter(
          (r) =>
            !Object.entries(o?.where ?? {}).every(([k, v]) => {
              if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
              return r[k] === v;
            }),
        );
        const deleted = rowsOf(table).length - survivors.length;
        tables.set(table, survivors);
        return { deleted };
      }
      tables.set(table, rowsOf(table).filter((r) => r.id !== dispatch.id));
      return { id: dispatch.id };
    },
  };
  return engine satisfies AttachmentReclaimEngine & Record<string, unknown>;
}

function fakeStore(present: string[] = KEYS, opts: { failDelete?: boolean } = {}) {
  const objects = new Set(present);
  return {
    objects,
    deleted: [] as string[],
    async upload() { /* not used here */ },
    async download() { return Buffer.alloc(0); },
    async delete(key: string) {
      if (opts.failDelete) throw new Error('AccessDenied');
      // Both shipped adapters delete idempotently (local swallows ENOENT, S3's
      // DeleteObject is idempotent), so a retry must not fail on keys the
      // previous attempt already removed.
      objects.delete(key);
      (this as any).deleted.push(key);
    },
  } as EmailAttachmentStore & { objects: Set<string>; deleted: string[] };
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

const terminalRow = (over: Record<string, any> = {}) => ({
  id: 'row-1',
  status: 'sent',
  message_id: '<m@x>',
  subject: 'Your contract',
  attachments_json: storageColumn,
  created_at: ago(30 * HOUR),
  updated_at: ago(30 * HOUR),
  ...over,
});

describe('a terminal row past the grace window', () => {
  it('deletes the content and rewrites the column, keeping every audit field', async () => {
    const engine = fakeEngine([terminalRow()]);
    const store = fakeStore();

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW, logger: logger(),
    });

    expect(out).toMatchObject({ kind: 'reclaimed', rowId: 'row-1' });
    expect(store.objects.size).toBe(0);

    const [el] = JSON.parse(engine.rows()[0].attachments_json);
    // The delivery artifact is gone…
    expect(el.storageKey).toBeUndefined();
    expect(el.contentReclaimedAt).toBe(new Date(NOW).toISOString());
    // …and the audit artifact is exactly as it was.
    expect(el).toMatchObject({
      filename: 'contract.pdf',
      contentType: 'application/pdf',
      size: 307200,
      hash: sha('contract'),
      contentForm: 'buffer',
    });
    // Nothing else about the row moved.
    expect(engine.rows()[0]).toMatchObject({ status: 'sent', message_id: '<m@x>', subject: 'Your contract' });
  });

  it('treats a terminal `failed` row the same way — a message nobody will retry is done too', async () => {
    const engine = fakeEngine([terminalRow({ status: 'failed', message_id: undefined, error: '550 nope' })]);
    const store = fakeStore();

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW,
    });

    expect(out.kind).toBe('reclaimed');
    expect(store.objects.size).toBe(0);
    expect(engine.rows()[0].error).toBe('550 nope');
  });

  it('is idempotent — running again finds no storageKey and writes nothing', async () => {
    const engine = fakeEngine([terminalRow()]);
    const store = fakeStore();
    await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, { engine, store, now: () => NOW });
    const writesAfterFirst = engine.updates.length;

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, { engine, store, now: () => NOW });

    expect(out.kind).toBe('reclaimed');
    expect(engine.updates.length).toBe(writesAfterFirst);
  });
});

describe('a row that is gone — the orphan case #5192 warns about', () => {
  it('deletes the content from the payload alone, because the job carries the keys', async () => {
    // The row a declarative `retention` policy (or a purge) removed. Nothing
    // anywhere still points at these bytes.
    const engine = fakeEngine([]);
    const store = fakeStore();
    const log = logger();

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW, logger: log,
    });

    expect(out).toMatchObject({ kind: 'orphan-reclaimed', rowId: 'row-1', keys: KEYS });
    expect(store.objects.size).toBe(0);
    expect(String(log.info.mock.calls[0][0])).toContain('no longer exists');
  });

  it('does not need the row to be readable at all — the keys are the authority', async () => {
    const engine = {
      async find() { return []; },
      async update() { throw new Error('the table is gone too'); },
    } satisfies AttachmentReclaimEngine;
    const store = fakeStore();

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW,
    });

    expect(out.kind).toBe('orphan-reclaimed');
    expect(store.objects.size).toBe(0);
  });
});

describe('nothing is deleted early', () => {
  it('re-arms for a row still at `queued` — that message has a delivery ahead of it', async () => {
    const engine = fakeEngine([terminalRow({ status: 'queued', message_id: undefined })]);
    const store = fakeStore();
    const rearm = vi.fn(async () => true);

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW, rearm,
    });

    expect(out).toMatchObject({ kind: 'rearmed', delayMs: EMAIL_ATTACHMENT_RECLAIM_GRACE_MS });
    expect((out as any).reason).toContain("still at 'queued'");
    expect(store.objects.size).toBe(1);
    expect(engine.updates).toHaveLength(0);
  });

  it('re-arms for the REMAINDER when a terminal row was touched inside the grace window', async () => {
    // A queue retry re-stamped the row two hours ago; 22h of grace are left.
    const engine = fakeEngine([terminalRow({ status: 'failed', updated_at: ago(2 * HOUR) })]);
    const store = fakeStore();
    const rearm = vi.fn(async () => true);

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW, rearm,
    });

    expect(out.kind).toBe('rearmed');
    expect((out as any).delayMs).toBe(EMAIL_ATTACHMENT_RECLAIM_GRACE_MS - 2 * HOUR);
    expect(rearm).toHaveBeenCalledWith(EMAIL_ATTACHMENT_RECLAIM_GRACE_MS - 2 * HOUR);
    expect(store.objects.size).toBe(1);
  });

  it('re-arms rather than deleting when the storage capability is not mounted here', async () => {
    const engine = fakeEngine([terminalRow()]);
    const rearm = vi.fn(async () => true);

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store: undefined, now: () => NOW, rearm,
    });

    expect(out.kind).toBe('rearmed');
    expect((out as any).reason).toContain('file-storage capability is not mounted');
  });

  it('states the consequence at `error` when it cannot re-arm — those bytes are now permanent', async () => {
    const engine = fakeEngine([terminalRow({ status: 'queued', message_id: undefined })]);
    const store = fakeStore();
    const log = logger();

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW, logger: log, rearm: async () => false,
    });

    expect(out.kind).toBe('stalled');
    expect(log.warn).not.toHaveBeenCalled();
    const line = String(log.error.mock.calls[0][0]);
    expect(line).toContain('could NOT be reclaimed');
    expect(line).toContain('stay in the backend forever'); // the consequence
    expect(line).toContain('@objectstack/service-storage');  // the fix
    expect(store.objects.size).toBe(1);
  });
});

describe('failure handling', () => {
  it('throws (so the job retries) when a delete does not land, and leaves the column pointing at it', async () => {
    const engine = fakeEngine([terminalRow()]);
    const store = fakeStore(KEYS, { failDelete: true });

    await expect(reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW,
    })).rejects.toThrow(/could not delete 1 of 1 storage object\(s\)/);

    // Bytes first, row second: the column must NOT be rewritten while the
    // content is still there, or the last pointer to it is gone.
    expect(JSON.parse(engine.rows()[0].attachments_json)[0].storageKey).toBe(KEYS[0]);
    expect(engine.updates).toHaveLength(0);
  });

  it('does nothing at all for a payload that names no keys', async () => {
    const engine = fakeEngine([terminalRow()]);
    const store = fakeStore();

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: [] }, {
      engine, store, now: () => NOW,
    });

    expect(out).toEqual({ kind: 'noop', rowId: 'row-1' });
    expect(store.objects.size).toBe(1);
  });

  it('deletes each key once even if the payload repeats one', async () => {
    const engine = fakeEngine([terminalRow()]);
    const store = fakeStore();

    await reclaimAttachmentContent({ rowId: 'row-1', keys: [KEYS[0], KEYS[0]] }, {
      engine, store, now: () => NOW,
    });

    expect(store.deleted).toEqual(KEYS);
  });

  it('reclaims a row whose timestamps are unreadable — the job delay already bought the grace', async () => {
    const engine = fakeEngine([terminalRow({ created_at: 'not-a-date', updated_at: null, sent_at: null })]);
    const store = fakeStore();

    const out = await reclaimAttachmentContent({ rowId: 'row-1', keys: KEYS }, {
      engine, store, now: () => NOW,
    });

    expect(out.kind).toBe('reclaimed');
  });
});
