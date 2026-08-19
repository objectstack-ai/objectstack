// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// EmailServicePlugin — large attachments end to end (objectstack#5172).
//
// Nothing here is mocked at the seams that matter: the queue is the REAL
// `DbQueueAdapter` over a `sys_job_queue` table, so what is asserted is the
// entire round trip a 300 KB invoice actually takes —
//
//   send() → upload → sys_email row holding a REFERENCE → email.send.async
//   job → worker poll → download → transport receives the whole message →
//   row `sent` → a DELAYED email.attachment.reclaim job → (24h) → poll →
//   bytes gone, audit metadata still on the row.
//
// …plus the two failure shapes the maintainer's ruling singles out: a
// deployment with no storage capability must keep delivering these messages
// whole (loudly, inline), and content whose row was deleted must still be
// reclaimed rather than orphaned.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { DbQueueAdapter } from '@objectstack/service-queue';
import { EmailServicePlugin } from './email-plugin.js';
import type { EmailService } from './email-service.js';
import { SYS_EMAIL_ATTACHMENT_LIMIT_BYTES } from './sys-email-payload.js';
import {
  EMAIL_ATTACHMENT_KEY_PREFIX,
  EMAIL_ATTACHMENT_RECLAIM_QUEUE,
  EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
} from './attachment-storage.js';

const NOW = Date.UTC(2026, 7, 5, 12, 0, 0);
const HOUR = 3600_000;
/** A 300 KB invoice — over the in-row budget, which is what makes it #5172's. */
const INVOICE = Buffer.alloc(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES + 44_000, 0x25);

// ── harness ────────────────────────────────────────────────────────────────

/** ObjectQL-shaped engine: equality + `$lt`, ordering, limits, hooks. */
function fakeEngine() {
  const tables = new Map<string, any[]>();
  const hooks: Record<string, Array<(ctx: any) => any>> = {};
  const rowsOf = (t: string) => tables.get(t) ?? [];
  const matches = (row: any, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$lt') return row[k] < (target as any);
          throw new Error(`fakeEngine: unsupported operator ${op}`);
        });
      }
      return row[k] === v;
    });
  const engine = {
    rows: (t: string) => [...rowsOf(t)],
    registerHook(event: string, fn: (ctx: any) => any, _meta?: unknown) {
      (hooks[event] ??= []).push(fn);
    },
    unregisterHooksByPackage(_pkg: string) { /* single-boot harness */ },
    async find(table: string, o: any = {}) {
      let out = o.where ? rowsOf(table).filter((r) => matches(r, o.where)) : [...rowsOf(table)];
      for (const ord of [...(o.orderBy ?? [])].reverse()) {
        out.sort((a, b) => {
          const av = a[ord.field], bv = b[ord.field];
          if (av === bv) return 0;
          return (av > bv ? 1 : -1) * (ord.order === 'desc' ? -1 : 1);
        });
      }
      if (o.offset) out = out.slice(o.offset);
      if (o.limit) out = out.slice(0, o.limit);
      return out;
    },
    async insert(table: string, data: any) {
      const row = { ...data };
      const t = rowsOf(table);
      t.push(row);
      tables.set(table, t);
      for (const fn of hooks.afterInsert ?? []) await fn({ object: table, result: row });
      return { id: data.id };
    },
    async update(table: string, patch: any) {
      const r = rowsOf(table).find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not found in ${table}`);
      Object.assign(r, patch);
      return r;
    },
    async delete(table: string, o: any) {
      // [#4550/#5197] Pinned to ObjectQL.delete's own dispatch predicate.
      const dispatch = assertEngineDeleteDispatch(o);
      if (dispatch.kind === 'multi') {
        const survivors = rowsOf(table).filter((r) => !matches(r, o?.where ?? {}));
        const deleted = rowsOf(table).length - survivors.length;
        tables.set(table, survivors);
        return { deleted };
      }
      tables.set(table, rowsOf(table).filter((r) => r.id !== dispatch.id));
      return { id: dispatch.id };
    },
  };
  return engine;
}

/** In-memory `storage` capability, shaped like `IStorageService`. */
function fakeStorage(opts: { failUpload?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  return {
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
    async delete(key: string) { objects.delete(key); },
    async exists(key: string) { return objects.has(key); },
    async getInfo(key: string) {
      return { key, size: objects.get(key)?.byteLength ?? 0, lastModified: new Date() };
    },
  };
}

function fakeCtx(services: Record<string, unknown>) {
  const handlers: Record<string, Array<() => Promise<void> | void>> = {};
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger,
    getService: <T,>(name: string): T => {
      if (!(name in services)) throw new Error(`service '${name}' not registered`);
      return services[name] as T;
    },
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    hook: (name: string, fn: () => Promise<void> | void) => { (handlers[name] ??= []).push(fn); },
    fire: async (name: string) => { for (const fn of handlers[name] ?? []) await fn(); },
  };
}

function fakeClock(startMs = NOW) {
  let t = startMs;
  return {
    now: () => new Date(t),
    advance: (ms: number) => { t += ms; vi.setSystemTime(new Date(t)); },
  };
}

interface BootOpts {
  storage?: ReturnType<typeof fakeStorage> | null;
  transport?: { send: (m: any) => Promise<any> };
}

async function boot(opts: BootOpts = {}) {
  const engine = fakeEngine();
  const clock = fakeClock();
  const storage = opts.storage === null ? undefined : (opts.storage ?? fakeStorage());
  const transport = opts.transport ?? { send: vi.fn(async () => ({ messageId: '<sent@x>' })) };
  const adapter = new DbQueueAdapter({
    engine: engine as never,
    clock,
    options: { autoStart: false, pollIntervalMs: 60_000, defaultMaxAttempts: 3 },
  });
  const services: Record<string, unknown> = {
    manifest: { register: () => {} },
    objectql: engine,
    queue: adapter,
  };
  if (storage) services['storage'] = storage;

  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({
    seedTemplates: false,
    transport,
    queueDelivery: true,
    defaultFrom: 'no-reply@example.test',
  });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  await ctx.fire('kernel:ready');
  await plugin.outboxSweepSettled;

  return {
    plugin, ctx, engine, adapter, clock, transport, storage,
    service: () => services.email as EmailService,
    sysEmail: () => engine.rows('sys_email'),
    jobs: (queue?: string) => engine.rows('sys_job_queue').filter((j) => !queue || j.queue === queue),
    infoLines: () => ctx.logger.info.mock.calls.map((c) => String(c[0])).join('\n'),
    errorLines: () => ctx.logger.error.mock.calls.map((c) => String(c[0])).join('\n'),
  };
}

beforeEach(() => { vi.clearAllMocks(); vi.setSystemTime(new Date(NOW)); });

// ── the whole chain ────────────────────────────────────────────────────────

describe('a 300 KB attachment now gets the durability guarantee', () => {
  it('goes out through the queue, whole, and its content dies with the delivery', async () => {
    const h = await boot();

    // 1. send() — the caller is told `queued` and NOTHING has been sent yet.
    const res = await h.service().send({
      to: 'client@example.test',
      subject: 'Invoice #42',
      text: 'attached',
      attachments: [{ filename: 'invoice.pdf', content: INVOICE, contentType: 'application/pdf' }],
    });
    expect(res.status).toBe('queued');
    expect(h.transport.send).not.toHaveBeenCalled();

    // 2. The row holds a REFERENCE plus the audit metadata — not 400 KB of base64.
    const row = h.sysEmail()[0];
    const [el] = JSON.parse(row.attachments_json);
    expect(el).toMatchObject({
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      size: INVOICE.byteLength,
      contentForm: 'buffer',
    });
    expect(el.inline).toBeUndefined();
    expect(el.storageKey).toContain(`${EMAIL_ATTACHMENT_KEY_PREFIX}/${res.id}/`);
    expect(row.attachments_json.length).toBeLessThan(400);
    expect(h.storage!.objects.get(el.storageKey)!.equals(INVOICE)).toBe(true);

    // 3. The worker rebuilds the message from the row + storage, and the
    //    transport sees the attachment byte for byte.
    await h.adapter.pollOnce();
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    const sent = (h.transport.send as any).mock.calls[0][0];
    expect(sent.attachments).toHaveLength(1);
    expect((sent.attachments[0].content as Buffer).equals(INVOICE)).toBe(true);
    expect(h.sysEmail()[0]).toMatchObject({ status: 'sent', message_id: '<sent@x>', attempt_count: 1 });

    // 4. Reclamation is armed, one grace window out — and is NOT due yet.
    const reclaimJobs = h.jobs(EMAIL_ATTACHMENT_RECLAIM_QUEUE);
    expect(reclaimJobs).toHaveLength(1);
    expect(JSON.parse(reclaimJobs[0].payload_json)).toEqual({ rowId: res.id, keys: [el.storageKey] });
    expect(new Date(reclaimJobs[0].scheduled_for).getTime())
      .toBe(NOW + EMAIL_ATTACHMENT_RECLAIM_GRACE_MS);

    // 5. Inside the window the content is untouched — an operator can still
    //    answer "what exactly did we send?".
    h.clock.advance(HOUR);
    await h.adapter.pollOnce();
    expect(h.storage!.objects.size).toBe(1);

    // 6. Past the window it is reclaimed, and the row keeps the audit facts.
    h.clock.advance(EMAIL_ATTACHMENT_RECLAIM_GRACE_MS);
    await h.adapter.pollOnce();

    expect(h.storage!.objects.size).toBe(0);
    const [after] = JSON.parse(h.sysEmail()[0].attachments_json);
    expect(after.storageKey).toBeUndefined();
    expect(after.contentReclaimedAt).toBeDefined();
    expect(after).toMatchObject({
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      size: INVOICE.byteLength,
      hash: el.hash,
    });
    // The message itself is still fully auditable.
    expect(h.sysEmail()[0]).toMatchObject({
      status: 'sent',
      subject: 'Invoice #42',
      to_addresses: 'client@example.test',
    });
  });

  it('reclaims content whose row was deleted (the #5192 retention case) instead of orphaning it', async () => {
    const h = await boot();
    const res = await h.service().send({
      to: 'client@example.test',
      subject: 'Invoice #43',
      text: 'attached',
      attachments: [{ filename: 'invoice.pdf', content: INVOICE }],
    });
    await h.adapter.pollOnce();
    expect(h.storage!.objects.size).toBe(1);

    // A declarative `retention` policy in the #5192 shape reaps the row — a
    // bulk, predicate-shaped delete, exactly what LifecycleService issues.
    await h.engine.delete('sys_email', { where: { status: 'sent' }, multi: true });
    expect(h.sysEmail()).toHaveLength(0);

    // The job carries the KEYS, so the deletion of the row is not the loss of
    // the last pointer to the bytes — it is the clearest possible signal that
    // nothing needs them.
    h.clock.advance(EMAIL_ATTACHMENT_RECLAIM_GRACE_MS + HOUR);
    await h.adapter.pollOnce();

    expect(h.storage!.objects.size).toBe(0);
    expect(h.infoLines()).toContain('no longer exists');
    expect(h.jobs(EMAIL_ATTACHMENT_RECLAIM_QUEUE)[0].status).toBe('completed');
    void res;
  });

  it('small attachments are untouched by all of this — still inline, still queued (#5177)', async () => {
    const h = await boot();

    const res = await h.service().send({
      to: 'client@example.test',
      subject: 'Receipt',
      text: 'attached',
      attachments: [{ filename: 'r.txt', content: '¥1.00' }],
    });
    await h.adapter.pollOnce();

    const [el] = JSON.parse(h.sysEmail()[0].attachments_json);
    expect(el.inline).toBeDefined();
    expect(el.storageKey).toBeUndefined();
    expect(h.storage!.objects.size).toBe(0);
    expect(h.jobs(EMAIL_ATTACHMENT_RECLAIM_QUEUE)).toHaveLength(0);
    expect(h.sysEmail()[0]).toMatchObject({ id: res.id, status: 'sent' });
    const sent = (h.transport.send as any).mock.calls[0][0];
    expect(sent.attachments[0].content).toBe('¥1.00');
  });
});

// ── the deployments that cannot store out of row ───────────────────────────

describe('a deployment without the storage capability', () => {
  it('still delivers the message WHOLE, inline, and says what to mount', async () => {
    const h = await boot({ storage: null });

    const res = await h.service().send({
      to: 'client@example.test',
      subject: 'Invoice #44',
      text: 'attached',
      attachments: [{ filename: 'invoice.pdf', content: INVOICE }],
    });

    // Delivered, not dropped, not stripped — the pre-#5172 behaviour exactly.
    expect(res.status).toBe('sent');
    const sent = (h.transport.send as any).mock.calls[0][0];
    expect((sent.attachments[0].content as Buffer).equals(INVOICE)).toBe(true);
    // Nothing queued, nothing in the column.
    expect(h.jobs()).toHaveLength(0);
    expect(h.sysEmail()[0].attachments_json).toBeUndefined();
    // Loud, with the obstacle and the fix.
    const info = h.infoLines();
    expect(info).toContain('no storage capability is mounted');
    expect(info).toContain('@objectstack/service-storage');
  });

  it('falls back the same way when the upload itself fails, and reports the durability loss', async () => {
    const h = await boot({ storage: fakeStorage({ failUpload: true }) });

    const res = await h.service().send({
      to: 'client@example.test',
      subject: 'Invoice #45',
      text: 'attached',
      attachments: [{ filename: 'invoice.pdf', content: INVOICE }],
    });

    expect(res.status).toBe('sent');
    expect(h.jobs()).toHaveLength(0);
    expect(h.storage!.objects.size).toBe(0);
    expect(h.errorLines()).toContain('could not be stored out of row');
    expect(h.errorLines()).toContain('bucket is on fire');
  });
});
