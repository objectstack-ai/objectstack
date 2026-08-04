// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// EmailService — durable queue delivery (#5160).
//
// What these pin, in one sentence each:
//  - the DEFAULT is untouched: with no `queueDelivery` wiring nothing is ever
//    published and the inline path runs exactly as before;
//  - with it wired, `send()` persists the row, publishes a job that REFERENCES
//    that row, and returns `queued` without touching the transport;
//  - the retry budget exists once — `retries` either drives the inline loop or
//    becomes the queue's `maxAttempts`, never both;
//  - every way queue delivery can be unavailable degrades to inline delivery
//    and SAYS SO at `error`, once. Mail must not stop because a queue is
//    missing; the operator must not be left thinking it is durable when it is
//    not.

import { describe, it, expect, vi } from 'vitest';
import type { IQueueService } from '@objectstack/spec/contracts';
import {
  EmailService,
  EMAIL_SEND_QUEUE,
  type EmailPersistence,
  type EmailQueueDelivery,
} from './email-service.js';

interface Published {
  queue: string;
  data: any;
  options: any;
}

function makePersistence() {
  const rows = new Map<string, Record<string, any>>();
  const p: EmailPersistence = {
    async insert(row) { rows.set(row.id, { ...row }); return { id: row.id }; },
    async update(id, patch) {
      const cur = rows.get(id);
      if (cur) rows.set(id, { ...cur, ...patch });
    },
  };
  return { p, rows };
}

/** A queue that records publishes and never delivers on its own. */
function makeQueue() {
  const published: Published[] = [];
  const queue = {
    published,
    async publish(queue: string, data: any, options: any) {
      published.push({ queue, data, options });
      return `msg-${published.length}`;
    },
    async subscribe() { /* the worker half lives in the plugin */ },
    async unsubscribe() { /* noop */ },
  };
  return queue as typeof queue & IQueueService;
}

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function wiring(queue: IQueueService | undefined, maxAttempts = 1): EmailQueueDelivery {
  return {
    resolve: () => queue,
    maxAttempts,
    backoff: { type: 'exponential', delayMs: 1000, maxDelayMs: 300_000 },
  };
}

const MSG = { to: 'a@b.com', subject: 'Hi', text: 'hello' };

describe('EmailService — queue delivery off (default)', () => {
  it('never publishes and delivers inline, exactly as before', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<m1@x>' })) };
    const queue = makeQueue();
    const { p, rows } = makePersistence();
    const svc = new EmailService({ transport, defaultFrom: 'no@reply.com', persistence: p });

    const res = await svc.send(MSG);

    expect(res).toMatchObject({ status: 'sent', messageId: '<m1@x>' });
    expect(queue.published).toHaveLength(0);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(rows.get(res.id)).toMatchObject({ status: 'sent', attempt_count: 1 });
  });
});

describe('EmailService — queue delivery on', () => {
  it('persists the row, publishes a job REFERENCING it, and returns queued without sending', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<never@x>' })) };
    const queue = makeQueue();
    const { p, rows } = makePersistence();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, queueDelivery: wiring(queue),
    });

    const res = await svc.send({ ...MSG, relatedObject: 'lead', relatedId: 'L1' });

    // The claim `send()` makes to its caller.
    expect(res).toMatchObject({ status: 'queued' });
    expect(res.messageId).toBeUndefined();
    // …and the two facts that make it true.
    expect(rows.get(res.id)).toMatchObject({
      status: 'queued',
      to_addresses: 'a@b.com',
      subject: 'Hi',
      related_object: 'lead',
      attempt_count: 0,
    });
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0].queue).toBe(EMAIL_SEND_QUEUE);
    // The payload is the ROW ID, never the message — that is what keeps N
    // retries on one row instead of inserting N rows.
    expect(queue.published[0].data).toEqual({ rowId: res.id });
    // Nothing was sent yet: a worker does that.
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('publishes with the retry budget derived from `retries`, plus backoff and idempotency', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<x>' })) };
    const queue = makeQueue();
    const { p } = makePersistence();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p,
      // `retries: 4` ⇒ 5 total attempts, whichever mode delivers them.
      retries: 4, queueDelivery: wiring(queue, 5),
    });

    const res = await svc.send(MSG);

    expect(queue.published[0].options).toMatchObject({
      maxAttempts: 5,
      // Both spellings, consistently: `maxAttempts` is canonical, `retries` is
      // the legacy field MemoryQueueAdapter reads. Publishing only one leaves
      // some adapters silently doing a single attempt.
      retries: 4,
      backoff: { type: 'exponential', delayMs: 1000, maxDelayMs: 300_000 },
      idempotencyKey: `sys_email:${res.id}`,
    });
  });

  it('routes sendTemplate through the queue too', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<x>' })) };
    const queue = makeQueue();
    const { p } = makePersistence();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, queueDelivery: wiring(queue),
      templateLoader: {
        async load() {
          return { name: 'welcome', locale: 'en-US', subject: 'Welcome {{name}}', body_html: '<p>Hi {{name}}</p>' };
        },
      },
    });

    const res = await svc.sendTemplate({ template: 'welcome', to: 'a@b.com', data: { name: 'Ada' } });

    expect(res.status).toBe('queued');
    expect(queue.published).toHaveLength(1);
    expect(queue.published[0].data).toEqual({ rowId: res.id });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('still marks its row managed during the insert, so the drain hook skips it', async () => {
    // The afterInsert outbox drain fires inside persistence.insert. In queue
    // mode the row IS still `queued` when it fires, so without the managed
    // flag the hook and the queue worker would both deliver it.
    let managedAtInsert: boolean | undefined;
    const queue = makeQueue();
    const transport = { send: vi.fn(async () => ({ messageId: '<x>' })) };
    let svc!: EmailService;
    const persistence: EmailPersistence = {
      async insert(row) {
        managedAtInsert = svc.isServiceManaged(String(row.id));
        return { id: row.id };
      },
      async update() { /* noop */ },
    };
    svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence, queueDelivery: wiring(queue),
    });

    const res = await svc.send(MSG);

    expect(res.status).toBe('queued');
    expect(managedAtInsert).toBe(true);
    expect(svc.isServiceManaged(res.id)).toBe(false);
  });

  it('sendInline() bypasses the queue — the mail/test path', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<live@x>' })) };
    const queue = makeQueue();
    const { p } = makePersistence();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, queueDelivery: wiring(queue),
    });

    const res = await svc.sendInline(MSG);

    expect(res).toMatchObject({ status: 'sent', messageId: '<live@x>' });
    expect(queue.published).toHaveLength(0);
  });

  it('delivers a message with attachments inline rather than queueing it stripped', async () => {
    // sys_email has no attachment / header columns, so a row cannot rebuild
    // them. Queueing such a message would deliver it WITHOUT the attachment —
    // silent data loss wearing durability's clothes.
    const transport = { send: vi.fn(async () => ({ messageId: '<with-att@x>' })) };
    const queue = makeQueue();
    const { p } = makePersistence();
    const logger = makeLogger();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, logger, queueDelivery: wiring(queue),
    });

    const res = await svc.send({ ...MSG, attachments: [{ filename: 'a.txt', content: 'hi' }] });

    expect(res.status).toBe('sent');
    expect(queue.published).toHaveLength(0);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{ filename: 'a.txt', content: 'hi' }],
    }));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('attachments'));
    // A capability gap, not a failure: nothing is logged at error.
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('does the same for custom headers', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<hdr@x>' })) };
    const queue = makeQueue();
    const { p } = makePersistence();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, queueDelivery: wiring(queue),
    });

    const res = await svc.send({ ...MSG, headers: { 'X-Campaign': 'spring' } });

    expect(res.status).toBe('sent');
    expect(queue.published).toHaveLength(0);
  });
});

describe('EmailService — queue delivery enabled but unavailable', () => {
  it('falls back to inline delivery and reports the lost durability ONCE, at error', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<inline@x>' })) };
    const { p, rows } = makePersistence();
    const logger = makeLogger();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, logger,
      queueDelivery: wiring(undefined),
    });

    const first = await svc.send(MSG);
    const second = await svc.send(MSG);

    // Degrading persistence must never degrade DELIVERY.
    expect(first).toMatchObject({ status: 'sent' });
    expect(second).toMatchObject({ status: 'sent' });
    expect(rows.get(first.id)).toMatchObject({ status: 'sent' });

    // Said once, not once per send.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = String(logger.error.mock.calls[0][0]);
    expect(line).toMatch(/no durable queue service/);
    // Consequence AND fix, in the first line (AGENTS.md degradation-log-level).
    expect(line).toMatch(/lost if it dies/);
    expect(line).toMatch(/service-queue/);
  });

  it('reports the same way when persistence is off — no row, nothing to reference', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<inline@x>' })) };
    const queue = makeQueue();
    const logger = makeLogger();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', logger, queueDelivery: wiring(queue),
    });

    const res = await svc.send(MSG);

    expect(res.status).toBe('sent');
    expect(queue.published).toHaveLength(0);
    expect(String(logger.error.mock.calls[0][0])).toMatch(/persistence is disabled/);
  });

  it('delivers inline when publish() throws, rather than stranding a committed row', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<rescued@x>' })) };
    const { p, rows } = makePersistence();
    const logger = makeLogger();
    const broken = {
      async publish() { throw new Error('sys_job_queue write failed'); },
      async subscribe() { /* noop */ },
      async unsubscribe() { /* noop */ },
    } as unknown as IQueueService;
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, logger, queueDelivery: wiring(broken),
    });

    const res = await svc.send(MSG);

    // The row was already committed at `queued`; leaving it for a job that was
    // never created is precisely the stuck-forever state this feature exists
    // to remove.
    expect(res).toMatchObject({ status: 'sent', messageId: '<rescued@x>' });
    expect(rows.get(res.id)).toMatchObject({ status: 'sent' });
    expect(String(logger.error.mock.calls[0][0])).toMatch(/sys_job_queue write failed/);
  });

  it('speaks again after the toggle is switched off and back on', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<x>' })) };
    const { p } = makePersistence();
    const logger = makeLogger();
    const svc = new EmailService({
      transport, defaultFrom: 'no@reply.com', persistence: p, logger,
      queueDelivery: wiring(undefined),
    });

    await svc.send(MSG);
    expect(logger.error).toHaveBeenCalledTimes(1);

    svc.setQueueDelivery(undefined);
    await svc.send(MSG);
    expect(logger.error).toHaveBeenCalledTimes(1);   // off ⇒ nothing to report

    svc.setQueueDelivery(wiring(undefined));
    await svc.send(MSG);
    expect(logger.error).toHaveBeenCalledTimes(2);   // re-enabled ⇒ re-armed
  });
});

describe('EmailService.deliverPersistedRow — attempt accounting', () => {
  const row = () => ({
    id: 'row-1', status: 'queued', from_address: 'no@reply.com',
    to_addresses: 'a@b.com', subject: 'Hi', body_text: 'hello',
  });

  it('defaults are unchanged: retries+1 attempts, attempt_count from 1', async () => {
    const transport = { send: vi.fn(async () => { throw new Error('smtp 421'); }) };
    const { p, rows } = makePersistence();
    rows.set('row-1', row());
    const svc = new EmailService({ transport, persistence: p, retries: 1 });

    const res = await svc.deliverPersistedRow(row());

    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(res.status).toBe('failed');
    expect(rows.get('row-1')).toMatchObject({ status: 'failed', attempt_count: 2 });
  });

  it('honours maxAttempts:1 so the queue owns the retry (no 5x5 multiplication)', async () => {
    const transport = { send: vi.fn(async () => { throw new Error('smtp 535'); }) };
    const { p, rows } = makePersistence();
    rows.set('row-1', row());
    // retries: 4 would be 5 inline attempts. Under the queue it must be one.
    const svc = new EmailService({ transport, persistence: p, retries: 4 });

    await svc.deliverPersistedRow(row(), { maxAttempts: 1, priorAttempts: 0 });

    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(rows.get('row-1')).toMatchObject({ attempt_count: 1 });
  });

  it('accumulates attempt_count across redeliveries of the SAME row', async () => {
    const transport = { send: vi.fn(async () => { throw new Error('smtp 535'); }) };
    const { p, rows } = makePersistence();
    rows.set('row-1', row());
    const svc = new EmailService({ transport, persistence: p });

    for (let attempt = 1; attempt <= 3; attempt++) {
      await svc.deliverPersistedRow(row(), { maxAttempts: 1, priorAttempts: attempt - 1 });
      expect(rows.get('row-1')).toMatchObject({ attempt_count: attempt });
    }
    expect(rows.size).toBe(1); // one message, one row
  });

  it('carries the prior attempts onto a success too', async () => {
    const transport = { send: vi.fn(async () => ({ messageId: '<eventually@x>' })) };
    const { p, rows } = makePersistence();
    rows.set('row-1', row());
    const svc = new EmailService({ transport, persistence: p });

    const res = await svc.deliverPersistedRow(row(), { maxAttempts: 1, priorAttempts: 2 });

    expect(res).toMatchObject({ status: 'sent', messageId: '<eventually@x>' });
    expect(rows.get('row-1')).toMatchObject({ status: 'sent', attempt_count: 3 });
  });
});
