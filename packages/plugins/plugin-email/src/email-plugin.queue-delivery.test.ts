// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// EmailServicePlugin — durable queue delivery, end to end (#5160).
//
// These run the REAL `DbQueueAdapter` over a fake ObjectQL engine holding both
// `sys_email` and `sys_job_queue`, so what is asserted is the actual round
// trip: `send()` writes the row and publishes, a worker poll delivers it, and
// a failing transport is retried by the queue until the job lands in the DLQ.
// A hand-written stub queue could not show the two halves agreeing, and the
// halves disagreeing is the whole risk — the pre-#5160 subscriber called
// `send()`, so every queue retry inserted ANOTHER sys_email row.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMemoryQueue } from '@objectstack/core';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { DbQueueAdapter } from '@objectstack/service-queue';
import { EmailServicePlugin, resolveDurableQueue } from './email-plugin.js';
import { EmailService, EMAIL_SEND_QUEUE } from './email-service.js';

// ── harness ────────────────────────────────────────────────────────────────

interface Resolved { value: unknown; source?: string }

function fakeSettings(values: Record<string, Resolved>) {
  const listeners: Array<() => void> = [];
  const actions = new Map<string, (a: any) => Promise<any>>();
  return {
    createClient: () => ({}),
    getNamespace: async () => ({ values }),
    subscribe: (_ns: string, cb: () => void) => { listeners.push(cb); },
    registerAction: (ns: string, id: string, fn: (a: any) => Promise<any>) => {
      actions.set(`${ns}/${id}`, fn);
    },
    async save(patch: Record<string, Resolved>) {
      Object.assign(values, patch);
      for (const l of listeners) l();
      await new Promise((r) => setTimeout(r, 0));
    },
    action: (id: string) => actions.get(`mail/${id}`),
  };
}

/**
 * Engine mimicking objectql's `where:`-based find and
 * `(table, { id, ...patch })` update — the same shape
 * `service-queue`'s own adapter tests use, so the queue half is exercised
 * against the signatures the real engine has.
 */
function fakeEngine() {
  const tables = new Map<string, any[]>();
  const rowsOf = (t: string) => tables.get(t) ?? [];
  const matches = (row: any, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row[k] === v;
    });
  return {
    tables,
    rows: (t: string) => [...rowsOf(t)],
    async find(table: string, opts: any = {}) {
      let out = opts.where ? rowsOf(table).filter((r) => matches(r, opts.where)) : [...rowsOf(table)];
      if (opts.orderBy) {
        for (const ord of [...opts.orderBy].reverse()) {
          out.sort((a, b) => {
            const av = a[ord.field], bv = b[ord.field];
            if (av === bv) return 0;
            const cmp = av > bv ? 1 : -1;
            return ord.order === 'desc' ? -cmp : cmp;
          });
        }
      }
      if (opts.offset) out = out.slice(opts.offset);
      if (opts.limit) out = out.slice(0, opts.limit);
      return out;
    },
    async insert(table: string, data: any) {
      const t = rowsOf(table);
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, patch: any) {
      const r = rowsOf(table).find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not found in ${table}`);
      Object.assign(r, patch);
      return r;
    },
    async delete(table: string, opts: any) {
      // [#4550] Pinned to ObjectQL.delete's OWN dispatch predicate. A double
      // looser than the engine it stands in for is how #4434 shipped a REST
      // route that answered 500 to every caller with its suite green — and
      // the half a hand-written mirror drops is exactly the scalar test
      // (`where: { id: { $in: [...] } }` looks like an id and is not one).
      const dispatch = assertEngineDeleteDispatch(opts);
      if (dispatch.kind === 'multi') {
        const survivors = rowsOf(table).filter((r) => !matches(r, opts?.where ?? {}));
        const deleted = rowsOf(table).length - survivors.length;
        tables.set(table, survivors);
        return { deleted };
      }
      tables.set(table, rowsOf(table).filter((r) => r.id !== dispatch.id));
      return { id: dispatch.id };
    },
  };
}

function fakeCtx(services: Record<string, unknown>) {
  const hooks: Record<string, Array<() => Promise<void> | void>> = {};
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger,
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (hooks[name] ??= []).push(fn); },
    /** Mirrors ObjectKernel's `context.trigger`: a throwing handler fails the boot. */
    fire: async (name: string) => { for (const fn of hooks[name] ?? []) await fn(); },
  };
}

/** Last element — the package's tsconfig lib predates Array.prototype.at. */
function last<T>(arr: T[]): T | undefined { return arr[arr.length - 1]; }

const MAIL_DEFAULTS: Record<string, Resolved> = {
  provider: { value: 'log', source: 'global' },
  from_email: { value: 'no-reply@example.test', source: 'global' },
  from_name: { value: 'ObjectStack', source: 'default' },
  queue_delivery: { value: false, source: 'default' },
};

/** A movable clock so queue backoff can be stepped over without real waiting. */
function fakeClock(startMs = Date.UTC(2026, 7, 4, 12, 0, 0)) {
  let t = startMs;
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
}

interface BootOpts {
  /** 'db' = real DbQueueAdapter, 'degraded' = the kernel's in-memory fallback, 'none' = no service. */
  queue?: 'db' | 'degraded' | 'none';
  mail?: Record<string, Resolved>;
  plugin?: Record<string, unknown>;
  transport?: { send: (m: any) => Promise<any> };
}

async function boot(opts: BootOpts = {}) {
  const engine = fakeEngine();
  const clock = fakeClock();
  const settings = fakeSettings({ ...MAIL_DEFAULTS, ...(opts.mail ?? {}) });
  const transport = opts.transport ?? { send: vi.fn(async () => ({ messageId: '<sent@x>' })) };

  const adapter = new DbQueueAdapter({
    engine: engine as never,
    clock,
    options: { autoStart: false, pollIntervalMs: 60_000, defaultMaxAttempts: 3 },
  });
  const services: Record<string, unknown> = {
    manifest: { register: () => {} },
    objectql: engine,
    settings,
  };
  const mode = opts.queue ?? 'db';
  if (mode === 'db') services.queue = adapter;
  if (mode === 'degraded') services.queue = createMemoryQueue();

  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({ seedTemplates: false, transport, ...(opts.plugin ?? {}) });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  const ready = () => ctx.fire('kernel:ready');
  return {
    plugin, ctx, engine, settings, adapter, clock, transport, ready,
    service: () => services.email as EmailService,
    sysEmail: () => engine.rows('sys_email'),
    jobs: () => engine.rows('sys_job_queue'),
  };
}

// ── the durable-queue discriminator ────────────────────────────────────────

describe('resolveDurableQueue', () => {
  it('rejects the kernel in-memory fallback — it cannot carry a durable job', () => {
    // ObjectKernel pre-injects this on every boot with no queue plugin. It
    // delivers synchronously and un-awaited, with no durability, retry or DLQ,
    // so `getService('queue') !== undefined` is not the question to ask.
    const fallback = createMemoryQueue();
    expect(typeof fallback.publish).toBe('function');
    expect(resolveDurableQueue(() => fallback)).toBeUndefined();
  });

  it('accepts a real adapter, and reports absence as absence', () => {
    const adapter = new DbQueueAdapter({ engine: fakeEngine() as never, options: { autoStart: false } });
    expect(resolveDurableQueue(() => adapter)).toBe(adapter);
    expect(resolveDurableQueue(() => { throw new Error('not registered'); })).toBeUndefined();
    expect(resolveDurableQueue(() => ({}))).toBeUndefined();
  });
});

// ── end to end ─────────────────────────────────────────────────────────────

describe('queue delivery — round trip', () => {
  it('send() returns queued, then a worker poll advances the SAME row to sent', async () => {
    const h = await boot({ plugin: { queueDelivery: true } });
    await h.ready();

    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'hello' });

    // 1. Answer to the caller — and it is true, not hopeful.
    expect(res).toMatchObject({ status: 'queued' });
    expect(h.transport.send).not.toHaveBeenCalled();
    // 2. The row is in the database…
    expect(h.sysEmail()).toHaveLength(1);
    expect(h.sysEmail()[0]).toMatchObject({ id: res.id, status: 'queued', attempt_count: 0 });
    // 3. …and the job is in sys_job_queue, referencing it. A process death
    //    here loses neither; that is the difference from the momentary
    //    `queued` the inline path writes.
    expect(h.jobs()).toHaveLength(1);
    expect(h.jobs()[0]).toMatchObject({ queue: EMAIL_SEND_QUEUE, status: 'pending' });
    expect(JSON.parse(h.jobs()[0].payload_json)).toEqual({ rowId: res.id });

    await h.adapter.pollOnce();

    expect(h.sysEmail()).toHaveLength(1);                       // still ONE row
    expect(h.sysEmail()[0]).toMatchObject({
      id: res.id, status: 'sent', message_id: '<sent@x>', attempt_count: 1,
    });
    expect(h.jobs()[0]).toMatchObject({ status: 'completed', attempts: 1 });
  });

  it('carries custom headers and a small attachment all the way to the worker (#5177)', async () => {
    // The capability #5177 adds, end to end: these messages used to be pushed
    // back onto inline delivery because a row could not rebuild them, so the
    // durable path was closed to exactly the mail most worth making durable.
    const h = await boot({ plugin: { queueDelivery: true } });
    await h.ready();

    const res = await h.service().send({
      to: 'a@b.com',
      subject: '对账单',
      text: 'hello',
      headers: { 'X-Campaign': 'spring', 'List-Unsubscribe': '<mailto:u@example.test>' },
      attachments: [
        { filename: '对账单.txt', content: '金额:¥1.00' },
        { filename: 'logo.png', content: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png', cid: 'logo@inline' },
      ],
    });

    expect(res.status).toBe('queued');
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.sysEmail()[0].headers_json).toBeTruthy();
    expect(h.sysEmail()[0].attachments_json).toBeTruthy();

    await h.adapter.pollOnce();

    expect(h.sysEmail()).toHaveLength(1);
    expect(h.sysEmail()[0]).toMatchObject({ id: res.id, status: 'sent' });
    const delivered = vi.mocked(h.transport.send).mock.calls[0][0];
    expect(delivered.headers).toEqual({ 'X-Campaign': 'spring', 'List-Unsubscribe': '<mailto:u@example.test>' });
    // Both content forms come back as the arm they were sent as.
    expect(delivered.attachments[0]).toEqual({ filename: '对账单.txt', content: '金额:¥1.00' });
    expect(delivered.attachments[1]).toMatchObject({
      filename: 'logo.png', contentType: 'image/png', cid: 'logo@inline',
    });
    expect(Buffer.compare(delivered.attachments[1].content, Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(0);
  });

  it('SMTP 535: the queue retries with backoff, exhausts, and DLQs — one row throughout', async () => {
    // The regression the issue names: the old subscriber called `send()`, so
    // each redelivery INSERTED a new sys_email row. Five attempts, five rows,
    // four of them stuck at `failed`, none carrying the real attempt count.
    const send = vi.fn(async () => { throw new Error('535 5.7.8 authentication failed'); });
    const h = await boot({
      transport: { send },
      // retries: 2 ⇒ 3 total attempts, in the queue rather than in-process.
      plugin: { queueDelivery: true, retries: 2 },
    });
    await h.ready();

    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'hello' });
    expect(h.jobs()[0].max_attempts).toBe(3);

    for (let attempt = 1; attempt <= 3; attempt++) {
      await h.adapter.pollOnce();
      expect(send, `transport calls after attempt ${attempt}`).toHaveBeenCalledTimes(attempt);
      // ONE row, its attempt_count accumulating on it.
      expect(h.sysEmail(), `sys_email rows after attempt ${attempt}`).toHaveLength(1);
      expect(h.sysEmail()[0].attempt_count).toBe(attempt);
      h.clock.advance(10 * 60_000);   // step over the backoff window
    }

    // Terminal state: the job is dead-lettered, the row records the failure.
    expect(h.jobs()[0]).toMatchObject({ status: 'dlq', attempts: 3 });
    expect(h.jobs()[0].last_error).toMatch(/535/);
    expect(h.sysEmail()[0]).toMatchObject({ id: res.id, status: 'failed', attempt_count: 3 });
    expect(h.sysEmail()[0].error).toMatch(/535 5\.7\.8/);

    // …and it is reachable for an operator to replay.
    const failed = await h.adapter.listFailed(EMAIL_SEND_QUEUE);
    expect(failed).toHaveLength(1);
    expect(failed[0].data).toEqual({ rowId: res.id });
  });

  it('a transport that recovers on the second attempt sends once, on one row', async () => {
    let calls = 0;
    const send = vi.fn(async () => {
      if (++calls === 1) throw new Error('421 service unavailable');
      return { messageId: '<recovered@x>' };
    });
    const h = await boot({ transport: { send }, plugin: { queueDelivery: true, retries: 3 } });
    await h.ready();

    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'hello' });
    await h.adapter.pollOnce();
    expect(h.sysEmail()[0]).toMatchObject({ status: 'failed', attempt_count: 1 });

    h.clock.advance(10 * 60_000);
    await h.adapter.pollOnce();

    expect(h.sysEmail()).toHaveLength(1);
    expect(h.sysEmail()[0]).toMatchObject({
      id: res.id, status: 'sent', message_id: '<recovered@x>', attempt_count: 2,
    });
    expect(h.jobs()[0]).toMatchObject({ status: 'completed' });
  });

  it('ignores a redelivery of a row that is already sent', async () => {
    const h = await boot({ plugin: { queueDelivery: true } });
    await h.ready();
    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'hello' });
    await h.adapter.pollOnce();
    expect(h.transport.send).toHaveBeenCalledTimes(1);

    // A lease expiry / a second worker puts the same job back on the wire.
    await h.engine.update('sys_job_queue', { id: h.jobs()[0].id, status: 'pending' });
    await h.adapter.pollOnce();

    expect(h.transport.send).toHaveBeenCalledTimes(1);   // never sent twice
    expect(h.sysEmail()[0]).toMatchObject({ id: res.id, status: 'sent', attempt_count: 1 });
  });

  it('does not retry forever on a vanished row — it reports the loss and completes', async () => {
    const h = await boot({ plugin: { queueDelivery: true } });
    await h.ready();
    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'hello' });
    await h.engine.delete('sys_email', { where: { id: res.id } });

    await h.adapter.pollOnce();

    // No number of retries makes a deleted row reappear.
    expect(h.jobs()[0]).toMatchObject({ status: 'completed' });
    const line = String(last(h.ctx.logger.error.mock.calls)?.[0] ?? '');
    expect(line).toMatch(/no longer exists/);
    expect(line).toMatch(/NEVER be delivered/);
  });

  it('still accepts the legacy payload shape, delivering it inline exactly once', async () => {
    // Producers written against the pre-#5160 subscriber publish a raw
    // SendEmailInput. Routing that back through `send()` while queue mode is
    // on would re-publish the message being consumed — an endless loop.
    const h = await boot({ plugin: { queueDelivery: true } });
    await h.ready();

    await h.adapter.publish(EMAIL_SEND_QUEUE, { to: 'a@b.com', subject: 'Legacy', text: 'x' });
    await h.adapter.pollOnce();

    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(h.sysEmail()).toHaveLength(1);
    expect(h.sysEmail()[0]).toMatchObject({ subject: 'Legacy', status: 'sent' });
    expect(h.jobs()).toHaveLength(1);            // no re-publish
    expect(h.jobs()[0].status).toBe('completed');
  });
});

// ── default path ───────────────────────────────────────────────────────────

describe('queue delivery off (default)', () => {
  it('sends inline and publishes nothing, even with a durable queue mounted', async () => {
    const h = await boot();
    await h.ready();

    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'hello' });

    expect(res).toMatchObject({ status: 'sent', messageId: '<sent@x>' });
    expect(h.jobs()).toHaveLength(0);
    expect(h.sysEmail()[0]).toMatchObject({ status: 'sent', attempt_count: 1 });
  });
});

// ── gate 1: constructor / CLI declaration ──────────────────────────────────

describe('constructor gate — an undeliverable declaration fails the boot', () => {
  it('throws when no queue service is registered', async () => {
    const h = await boot({ queue: 'none', plugin: { queueDelivery: true } });
    await expect(h.ready()).rejects.toThrow(/queueDelivery is enabled but no durable queue service/);
  });

  it('throws when the only queue is the kernel in-memory fallback', async () => {
    // The case a bare presence check would wave through, and the reason this
    // gate reads `__serviceInfo` instead: the fallback has a `publish`, so
    // `send()` would answer `queued` for a job nothing can retry or recover.
    const h = await boot({ queue: 'degraded', plugin: { queueDelivery: true } });
    await expect(h.ready()).rejects.toThrow(/no durability, retry or DLQ/);
  });

  it('throws when sys_email persistence is off — nothing for a job to reference', async () => {
    const h = await boot({ plugin: { queueDelivery: true, persist: false } });
    await expect(h.ready()).rejects.toThrow(/persistence is disabled/);
  });

  it('names both the consequence and the way out', async () => {
    const h = await boot({ queue: 'none', plugin: { queueDelivery: true } });
    await expect(h.ready()).rejects.toThrow(/lost if it dies/);
    const h2 = await boot({ queue: 'none', plugin: { queueDelivery: true } });
    await expect(h2.ready()).rejects.toThrow(/OS_EMAIL_QUEUE_ENABLED=false/);
  });

  it('boots normally when the declaration CAN be honoured', async () => {
    const h = await boot({ plugin: { queueDelivery: true } });
    await expect(h.ready()).resolves.toBeUndefined();
  });

  it('does not fire for an undeclared deployment — no queue, no queue mode, no error', async () => {
    const h = await boot({ queue: 'none' });
    await expect(h.ready()).resolves.toBeUndefined();
    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'x' });
    expect(res.status).toBe('sent');
  });
});

// ── gate 2: settings page ──────────────────────────────────────────────────

describe('settings gate — a save degrades, it never breaks the boot or the mail', () => {
  it('hot-enables queue delivery when the toggle is saved on', async () => {
    const h = await boot();
    await h.ready();
    expect((await h.service().send({ to: 'a@b.com', subject: 'Before', text: 'x' })).status).toBe('sent');

    await h.settings.save({ queue_delivery: { value: true, source: 'global' } });

    const res = await h.service().send({ to: 'a@b.com', subject: 'After', text: 'x' });
    expect(res.status).toBe('queued');
    expect(h.jobs()).toHaveLength(1);
    expect(JSON.parse(h.jobs()[0].payload_json)).toEqual({ rowId: res.id });
    expect(h.ctx.logger.error).not.toHaveBeenCalled();
  });

  it('hot-disables it again', async () => {
    const h = await boot({ mail: { queue_delivery: { value: true, source: 'global' } } });
    await h.ready();
    expect((await h.service().send({ to: 'a@b.com', subject: 'On', text: 'x' })).status).toBe('queued');

    await h.settings.save({ queue_delivery: { value: false, source: 'global' } });

    expect((await h.service().send({ to: 'a@b.com', subject: 'Off', text: 'x' })).status).toBe('sent');
    expect(h.jobs()).toHaveLength(1);   // only the first send's job
  });

  it('with no durable queue: logs at error, keeps sending inline, does NOT throw', async () => {
    const h = await boot({ queue: 'none' });
    await h.ready();

    await h.settings.save({ queue_delivery: { value: true, source: 'global' } });

    const line = String(h.ctx.logger.error.mock.calls[0][0]);
    expect(line).toMatch(/durable queue delivery/i);
    expect(line).toMatch(/still being SENT/);
    expect(line).toMatch(/service-queue/);
    // A save must not stop the mail: what degraded is durability, not delivery.
    const res = await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'x' });
    expect(res.status).toBe('sent');
    expect(last(h.sysEmail())).toMatchObject({ status: 'sent' });
  });

  it('leaves the constructor declaration alone while the toggle is merely defaulted', async () => {
    // `source: 'default'` is nobody's decision. Reading it as one would let a
    // settings page no operator has opened switch off a declared deployment
    // mode on the next save of an unrelated field.
    const h = await boot({
      plugin: { queueDelivery: true },
      mail: { queue_delivery: { value: false, source: 'default' } },
    });
    await h.ready();

    await h.settings.save({ from_name: { value: 'Acme', source: 'global' } });

    expect((await h.service().send({ to: 'a@b.com', subject: 'Hi', text: 'x' })).status).toBe('queued');
  });
});

// ── mail/test ──────────────────────────────────────────────────────────────

describe('mail/test is never queued', () => {
  it('sends inline and reports the transport result, with queue mode on', async () => {
    const h = await boot({
      plugin: { queueDelivery: true },
      mail: { queue_delivery: { value: true, source: 'global' } },
    });
    await h.ready();

    const result = await h.settings.action('test')!({
      values: { provider: 'log', from_email: 'no-reply@example.test' },
      payload: {},
      ctx: { body: { to: 'ops@example.test' } },
    });

    // The answer came from the TRANSPORT — it either sent or it did not —
    // and never from the queue. "Queued" is exactly the non-answer #5087
    // removed from this button.
    expect(result.ok).toBe(true);
    expect(String(result.message)).toMatch(/Sent test email to ops@example\.test/);
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(h.jobs()).toHaveLength(0);
    // The audit row is finalized, not left at `queued` for a worker.
    expect(last(h.sysEmail())).toMatchObject({ status: 'sent' });
  });

  it('reports a real SMTP failure instead of enqueueing it', async () => {
    const h = await boot({
      transport: { send: vi.fn(async () => { throw new Error('535 5.7.8 authentication failed'); }) },
      plugin: { queueDelivery: true },
      mail: { queue_delivery: { value: true, source: 'global' } },
    });
    await h.ready();

    const result = await h.settings.action('test')!({
      values: { provider: 'log', from_email: 'no-reply@example.test' },
      payload: {},
      ctx: { body: { to: 'ops@example.test' } },
    });

    expect(result.ok).toBe(false);
    expect(String(result.message)).toMatch(/535 5\.7\.8/);
    expect(h.jobs()).toHaveLength(0);
  });
});

beforeEach(() => { vi.clearAllMocks(); });
