// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// EmailService — large attachments through the storage capability
// (objectstack#5172).
//
// The routing table these pin, exhaustively, because every cell of it used to
// collapse into one behaviour ("deliver inline, lose durability"):
//
//   attachments ≤ 256 KiB            → in the row, queued            (#5177)
//   > 256 KiB, queue + storage       → in storage, queued            (#5172)
//   > 256 KiB, queue, no storage     → inline, whole, said out loud
//   > 256 KiB, queue, upload failed  → inline, whole, said at `error`
//   > 256 KiB, no queue              → inline, whole, nothing uploaded
//
// And the two things that must never happen no matter which cell you are in:
// a message queued against a row that cannot rebuild it, and content uploaded
// that no row will ever reference.

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { IQueueService } from '@objectstack/spec/contracts';
import {
  EmailService,
  EMAIL_SEND_QUEUE,
  type EmailPersistence,
  type EmailQueueDelivery,
} from './email-service.js';
import { SYS_EMAIL_ATTACHMENT_LIMIT_BYTES } from './sys-email-payload.js';
import {
  EMAIL_ATTACHMENT_KEY_PREFIX,
  EMAIL_ATTACHMENT_RECLAIM_QUEUE,
  EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
  type EmailAttachmentStore,
} from './attachment-storage.js';

const sha = (b: Buffer) => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const MSG = { to: 'a@b.com', subject: 'Hi', text: 'hello' };
/** One byte over the in-row budget — the smallest message that needs #5172. */
const OVER = Buffer.alloc(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES + 1, 0x41);
/** Exactly at the budget — still an in-row attachment (the bound includes equality). */
const AT_LIMIT = Buffer.alloc(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES, 0x42);

function makePersistence(opts: { failInsert?: boolean } = {}) {
  const rows = new Map<string, Record<string, any>>();
  const p: EmailPersistence = {
    async insert(row) {
      if (opts.failInsert) throw new Error('sys_email is read-only right now');
      rows.set(row.id, { ...row });
      return { id: row.id };
    },
    async update(id, patch) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, ...patch });
    },
  };
  return { p, rows };
}

function makeQueue() {
  const published: Array<{ queue: string; data: any; options: any }> = [];
  const queue = {
    published,
    async publish(q: string, data: any, options: any) {
      published.push({ queue: q, data, options });
      return `msg-${published.length}`;
    },
    async subscribe() { /* the worker half lives in the plugin */ },
    async unsubscribe() { /* noop */ },
  };
  return queue as typeof queue & IQueueService;
}

function makeStore(opts: { failUpload?: boolean; failDelete?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  const store = {
    objects,
    async upload(key: string, data: Buffer) {
      if (opts.failUpload) throw new Error('bucket is on fire');
      objects.set(key, Buffer.from(data));
    },
    async download(key: string) {
      const found = objects.get(key);
      if (!found) throw new Error(`NoSuchKey: ${key}`);
      return found;
    },
    async delete(key: string) {
      if (opts.failDelete) throw new Error('AccessDenied');
      objects.delete(key);
    },
  };
  return store satisfies EmailAttachmentStore & Record<string, unknown>;
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const lines = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0])).join('\n');

function wiring(queue: IQueueService | undefined, maxAttempts = 1): EmailQueueDelivery {
  return { resolve: () => queue, maxAttempts, backoff: { type: 'exponential', delayMs: 1000 } };
}

interface SvcOpts {
  queue?: IQueueService;
  store?: EmailAttachmentStore;
  failInsert?: boolean;
  transportSend?: (m: any) => Promise<any>;
}

function makeService(o: SvcOpts = {}) {
  const log = logger();
  const transport = { send: vi.fn(o.transportSend ?? (async () => ({ messageId: '<m1@x>' }))) };
  const { p, rows } = makePersistence({ failInsert: o.failInsert });
  const svc = new EmailService({
    transport,
    defaultFrom: 'no@reply.com',
    persistence: p,
    logger: log,
    ...(o.queue !== undefined ? { queueDelivery: wiring(o.queue) } : {}),
    ...(o.store !== undefined ? { attachmentStorage: { resolve: () => o.store } } : {}),
  });
  return { svc, transport, rows, log };
}

// ── the boundary, from both sides ──────────────────────────────────────────

describe('the 256 KiB boundary decides in-row vs in-storage, and includes equality', () => {
  it('EXACTLY at the limit stays in the row and never touches storage', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const { svc, rows } = makeService({ queue, store });

    const res = await svc.send({ ...MSG, attachments: [{ filename: 'at.bin', content: AT_LIMIT }] });

    expect(res.status).toBe('queued');
    const [el] = JSON.parse(String(rows.get(res.id)!.attachments_json));
    expect(el.inline).toBeDefined();
    expect(el.storageKey).toBeUndefined();
    expect(store.objects.size).toBe(0);
  });

  it('ONE BYTE over goes to storage, and the row carries a reference instead of content', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const { svc, rows, transport } = makeService({ queue, store });

    const res = await svc.send({
      ...MSG,
      attachments: [{ filename: 'contract.pdf', content: OVER, contentType: 'application/pdf' }],
    });

    // Durable: the caller is told `queued`, the row is committed, the job
    // references it. This is the cell #5172 exists to fill.
    expect(res.status).toBe('queued');
    expect(transport.send).not.toHaveBeenCalled();
    const row = rows.get(res.id)!;
    const [el] = JSON.parse(String(row.attachments_json));
    expect(el).toMatchObject({
      filename: 'contract.pdf',
      contentType: 'application/pdf',
      size: OVER.byteLength,
      hash: sha(OVER),
      contentForm: 'buffer',
    });
    expect(el.storageKey).toContain(`${EMAIL_ATTACHMENT_KEY_PREFIX}/${res.id}/`);
    expect(el.inline).toBeUndefined();
    // The row stays small no matter how big the attachment was.
    expect(String(row.attachments_json).length).toBeLessThan(400);
    expect(store.objects.get(el.storageKey)!.equals(OVER)).toBe(true);
    expect(queue.published[0]).toMatchObject({ queue: EMAIL_SEND_QUEUE, data: { rowId: res.id } });
  });

  it('counts the budget across ALL attachments, then stores them all out of row', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const { svc, rows } = makeService({ queue, store });
    const half = Buffer.alloc(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES / 2 + 1, 0x43);

    const res = await svc.send({
      ...MSG,
      attachments: [{ filename: 'a.bin', content: half }, { filename: 'b.bin', content: half }],
    });

    const els = JSON.parse(String(rows.get(res.id)!.attachments_json));
    expect(els.map((e: any) => e.storageKey)).toEqual([...store.objects.keys()]);
    expect(store.objects.size).toBe(2);
  });
});

// ── the loud fallbacks ─────────────────────────────────────────────────────

describe('when the content cannot be stored, the message still goes out WHOLE — and it is said out loud', () => {
  it('no storage capability: delivers inline, names what to mount, stores nothing', async () => {
    const queue = makeQueue();
    const { svc, rows, transport, log } = makeService({ queue }); // no store wired

    const res = await svc.send({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });

    // Whole, through the transport, exactly as before #5172.
    expect(res.status).toBe('sent');
    expect(transport.send).toHaveBeenCalledTimes(1);
    const sent = transport.send.mock.calls[0][0];
    expect((sent.attachments[0].content as Buffer).equals(OVER)).toBe(true);
    // Nothing queued, nothing written to the column.
    expect(queue.published).toHaveLength(0);
    expect(rows.get(res.id)!.attachments_json).toBeUndefined();
    // Loud: the one line the operator sees names the obstacle and the fix.
    const info = lines(log.info);
    expect(info).toContain('queue delivery skipped for one message');
    expect(info).toContain('no storage capability is mounted');
    expect(info).toContain('@objectstack/service-storage');
    expect(info).toContain(String(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES));
  });

  it('upload failed: delivers inline, and reports the DURABILITY loss at `error`, once', async () => {
    const queue = makeQueue();
    const store = makeStore({ failUpload: true });
    const { svc, rows, transport, log } = makeService({ queue, store });

    const first = await svc.send({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });
    await svc.send({ ...MSG, attachments: [{ filename: 'big2.bin', content: OVER }] });

    expect(first.status).toBe('sent');
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(queue.published).toHaveLength(0);
    expect(rows.get(first.id)!.attachments_json).toBeUndefined();
    // `error`, not `warn`: everything looks normal and the durability the
    // operator paid for is not in force. Said ONCE, at the first degradation.
    expect(log.error).toHaveBeenCalledTimes(1);
    const err = lines(log.error);
    expect(err).toContain('could not be stored out of row');
    expect(err).toContain('bucket is on fire');
    expect(err).toContain('still SENT, inline and whole');
    expect(err).toContain('@objectstack/service-storage');
    // …and the per-message info line names the same cause.
    expect(lines(log.info)).toContain('bucket is on fire');
  });

  it('re-arms the one-shot report when the operator re-wires storage', async () => {
    const queue = makeQueue();
    const { svc, log } = makeService({ queue, store: makeStore({ failUpload: true }) });
    await svc.send({ ...MSG, attachments: [{ filename: 'a.bin', content: OVER }] });
    expect(log.error).toHaveBeenCalledTimes(1);

    svc.setAttachmentStorage({ resolve: () => makeStore({ failUpload: true }) });
    await svc.send({ ...MSG, attachments: [{ filename: 'b.bin', content: OVER }] });

    expect(log.error).toHaveBeenCalledTimes(2);
  });

  it('queue delivery off: never uploads at all — storage exists to make QUEUED delivery possible', async () => {
    const store = makeStore();
    const { svc, transport } = makeService({ store }); // no queueDelivery

    const res = await svc.send({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });

    expect(res.status).toBe('sent');
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(store.objects.size).toBe(0);
  });

  it('sendInline() never uploads either — the "send test email" button must not write to a bucket', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const { svc } = makeService({ queue, store });

    await svc.sendInline({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });

    expect(store.objects.size).toBe(0);
    expect(queue.published).toHaveLength(0);
  });

  it('deletes uploaded content when the row it belongs to cannot be persisted', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const { svc, log } = makeService({ queue, store, failInsert: true });

    await svc.send({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });

    // The one orphan class this design must not create: bytes in the bucket
    // that no row references and no reclaim job knows about.
    expect(store.objects.size).toBe(0);
    expect(lines(log.warn)).toContain('sys_email persist failed');
  });

  it('reports at `error` when orphaned content cannot even be deleted', async () => {
    const store = makeStore({ failDelete: true });
    const queue = makeQueue();
    const { svc, log } = makeService({ queue, store, failInsert: true });

    await svc.send({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });

    const err = lines(log.error);
    expect(err).toContain('could not be deleted again');
    expect(err).toContain('nothing will ever reclaim them');
    expect(store.objects.size).toBe(1);
  });
});

// ── the worker's half: rebuild from the row ────────────────────────────────

describe('rebuilding a stored-content row for delivery', () => {
  /** Queue a big-attachment message and hand back the committed row. */
  async function queuedRow(o: SvcOpts & { store: EmailAttachmentStore }) {
    const h = makeService(o);
    const res = await h.svc.send({
      ...MSG,
      attachments: [{ filename: 'contract.pdf', content: OVER, contentType: 'application/pdf' }],
    });
    return { ...h, rowId: res.id, row: () => ({ ...h.rows.get(res.id)! }) };
  }

  it('fetches the content back and hands the transport the WHOLE message', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const h = await queuedRow({ queue, store });

    const out = await h.svc.deliverPersistedRow(h.row(), { maxAttempts: 1, priorAttempts: 0 });

    expect(out.status).toBe('sent');
    const sent = h.transport.send.mock.calls[0][0];
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0]).toMatchObject({ filename: 'contract.pdf', contentType: 'application/pdf' });
    expect((sent.attachments[0].content as Buffer).equals(OVER)).toBe(true);
  });

  it('FAILS the row and sends nothing when the content cannot be fetched (outage)', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const h = await queuedRow({ queue, store });
    store.objects.clear(); // the object is unreachable

    const out = await h.svc.deliverPersistedRow(h.row(), { maxAttempts: 1, priorAttempts: 2 });

    // `declared ≠ delivered` is the outcome that is not allowed: no stripped
    // message goes out, and the row records why.
    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/NoSuchKey/);
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.rows.get(h.rowId)).toMatchObject({ status: 'failed', attempt_count: 2 });
  });

  it('FAILS the row when no storage capability is mounted on the delivering process', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const h = await queuedRow({ queue, store });
    const row = h.row();
    h.svc.setAttachmentStorage(undefined); // e.g. a worker process without it

    const out = await h.svc.deliverPersistedRow(row, { maxAttempts: 1 });

    expect(out.status).toBe('failed');
    expect(out.error).toContain('no storage capability is mounted on this process');
    expect(h.transport.send).not.toHaveBeenCalled();
  });

  it('FAILS the row rather than trusting truncated storage content', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const h = await queuedRow({ queue, store });
    const key = [...store.objects.keys()][0];
    store.objects.set(key, OVER.subarray(0, 100));

    const out = await h.svc.deliverPersistedRow(h.row(), { maxAttempts: 1 });

    expect(out.status).toBe('failed');
    expect(out.error).toMatch(/is 100 byte\(s\) but the row records size/);
    expect(h.transport.send).not.toHaveBeenCalled();
  });
});

// ── scheduling reclamation ─────────────────────────────────────────────────

describe('scheduling the content reclaim', () => {
  async function deliverBig(o: { transportSend?: (m: any) => Promise<any> } = {}) {
    const store = makeStore();
    const queue = makeQueue();
    const h = makeService({ queue, store, ...o });
    const res = await h.svc.send({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });
    const row = { ...h.rows.get(res.id)! };
    const out = await h.svc.deliverPersistedRow(row, { maxAttempts: 1 });
    const reclaim = queue.published.filter((p) => p.queue === EMAIL_ATTACHMENT_RECLAIM_QUEUE);
    return { ...h, store, queue, rowId: res.id, out, reclaim };
  }

  it('publishes ONE delayed job per row, carrying the keys — not just the row id', async () => {
    const h = await deliverBig();

    expect(h.out.status).toBe('sent');
    expect(h.reclaim).toHaveLength(1);
    expect(h.reclaim[0].data).toEqual({ rowId: h.rowId, keys: [...h.store.objects.keys()] });
    // Carrying the keys is what makes a later row deletion reclaim the content
    // instead of orphaning it.
    expect(h.reclaim[0].data.keys[0]).toContain(EMAIL_ATTACHMENT_KEY_PREFIX);
  });

  it('delays by the grace window and dedups per row', async () => {
    const h = await deliverBig();
    expect(h.reclaim[0].options).toMatchObject({
      delay: EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
      idempotencyKey: `sys_email_attachments:${h.rowId}`,
      metadata: { object: 'sys_email', rowId: h.rowId },
    });
  });

  it('schedules on a FAILED terminal transition too — the queue may still retry, the job re-checks', async () => {
    const h = await deliverBig({ transportSend: async () => { throw new Error('550 mailbox full'); } });
    expect(h.out.status).toBe('failed');
    expect(h.reclaim).toHaveLength(1);
    expect(h.reclaim[0].data.keys).toHaveLength(1);
  });

  it('schedules nothing for a message whose content is IN the row', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const { svc, rows } = makeService({ queue, store });
    const res = await svc.send({ ...MSG, attachments: [{ filename: 'small.txt', content: 'hi' }] });

    await svc.deliverPersistedRow({ ...rows.get(res.id)! }, { maxAttempts: 1 });

    expect(queue.published.filter((p) => p.queue === EMAIL_ATTACHMENT_RECLAIM_QUEUE)).toHaveLength(0);
  });

  it('reports at `error` when the reclaim job cannot be published — those bytes become permanent', async () => {
    const store = makeStore();
    const queue = makeQueue();
    const h = makeService({ queue, store });
    const res = await h.svc.send({ ...MSG, attachments: [{ filename: 'big.bin', content: OVER }] });
    const row = { ...h.rows.get(res.id)! };
    queue.publish = async () => { throw new Error('queue table is gone'); };

    await h.svc.deliverPersistedRow(row, { maxAttempts: 1 });

    const err = lines(h.log.error);
    expect(err).toContain('could not publish the attachment-reclaim job');
    expect(err).toContain('stay in the backend');
  });
});
