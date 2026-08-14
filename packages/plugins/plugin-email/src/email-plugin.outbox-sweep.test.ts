// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// EmailServicePlugin — the boot sweep for stranded `sys_email` rows (#5161).
//
// The crash these reproduce is the one nothing could recover from: a row is
// INSERTED at `status:'queued'` and the process dies before the delivery. The
// row is not synthetic — it is byte-identical to what `send()` / an app's
// `api.write` leaves behind, and it is written straight into the table so no
// afterInsert hook fires, which is exactly what "the process died" looks like
// from the next boot's point of view.
//
// Queue mode runs the REAL DbQueueAdapter, so what is asserted is the whole
// round trip: sweep → job → worker poll → the same row at `sent`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/objectql';
import { DbQueueAdapter } from '@objectstack/service-queue';
import { EmailServicePlugin } from './email-plugin.js';
import { EmailService, EMAIL_SEND_QUEUE } from './email-service.js';
import { encodeAttachmentsForRow, encodeHeadersForRow } from './sys-email-payload.js';

// ── harness ────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const min = (n: number) => n * 60_000;

/** Let the drain hook's `setTimeout(0)` and its async chain run. */
const flush = () => new Promise((r) => setTimeout(r, 5));

interface EngineOpts {
  /** Make `find` throw for the drain hook's own `where: { id }` re-read. */
  failIdLookup?: boolean;
  /**
   * Store every `sys_email` insert under THIS id instead of the one it was
   * handed, and answer with it — a datasource that assigns its own primary key
   * (#5523). The row the afterInsert hook sees then carries an id `send()` never
   * reserved, which is the whole mechanism the insert contract closes.
   */
  reKeyInsert?: string;
}

/**
 * ObjectQL-shaped engine: `where` (including the `$lt` the age gate uses),
 * `orderBy`, `limit`, and the afterInsert hook registry the outbox drain
 * installs itself into.
 */
function fakeEngine(opts: EngineOpts = {}) {
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
    tables,
    rows: (t: string) => [...rowsOf(t)],
    /** Seed a row WITHOUT firing hooks — "the process died after the insert". */
    seed(table: string, row: Record<string, any>) {
      const t = rowsOf(table);
      t.push({ ...row });
      tables.set(table, t);
    },
    registerHook(event: string, fn: (ctx: any) => any, _meta?: unknown) {
      (hooks[event] ??= []).push(fn);
    },
    unregisterHooksByPackage(_pkg: string) { /* single-boot harness */ },
    /** The registered afterInsert handlers, for poisoning them directly. */
    afterInsertHooks: () => hooks.afterInsert ?? [],
    async find(table: string, o: any = {}) {
      if (opts.failIdLookup && table === 'sys_email' && typeof o?.where?.id === 'string') {
        throw new Error('datasource connection lost');
      }
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
      const reKeyed = opts.reKeyInsert && table === 'sys_email';
      const row = reKeyed ? { ...data, id: opts.reKeyInsert } : { ...data };
      const t = rowsOf(table);
      t.push(row);
      tables.set(table, t);
      for (const fn of hooks.afterInsert ?? []) await fn({ object: table, result: row });
      return { id: row.id };
    },
    async update(table: string, patch: any) {
      const r = rowsOf(table).find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not found in ${table}`);
      Object.assign(r, patch);
      return r;
    },
    async delete(table: string, o: any) {
      // [#4550] Pinned to ObjectQL.delete's OWN dispatch predicate, like the
      // other doubles in this package. A fake looser than the engine it stands
      // in for is how #4434 shipped a dead REST route with its suite green, and
      // the case a hand-written mirror always drops is the scalar test
      // (`where: { id: { $in: [...] } }` looks like an id and is not one).
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
  return { now: () => new Date(t), advance: (ms: number) => { t += ms; } };
}

interface BootOpts {
  queue?: boolean;
  plugin?: Record<string, unknown>;
  transport?: { send: (m: any) => Promise<any> };
  engine?: EngineOpts;
}

async function boot(opts: BootOpts = {}) {
  const engine = fakeEngine(opts.engine);
  const clock = fakeClock();
  const transport = opts.transport ?? { send: vi.fn(async () => ({ messageId: '<sent@x>' })) };
  const adapter = new DbQueueAdapter({
    engine: engine as never,
    clock,
    options: { autoStart: false, pollIntervalMs: 60_000, defaultMaxAttempts: 3 },
  });
  const services: Record<string, unknown> = { manifest: { register: () => {} }, objectql: engine };
  if (opts.queue) services.queue = adapter;

  const ctx = fakeCtx(services);
  const plugin = new EmailServicePlugin({ seedTemplates: false, transport, ...(opts.plugin ?? {}) });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);

  /** A row `send()` (or an app write) committed, then the process died. */
  const strand = (id: string, createdAt: string) => engine.seed('sys_email', {
    id,
    from_address: 'no-reply@example.test',
    to_addresses: 'user@example.test',
    subject: `Stranded ${id}`,
    body_text: 'hello',
    status: 'queued',
    attempt_count: 0,
    created_at: createdAt,
  });

  /**
   * The same crash, for a message that carried custom headers and a small
   * attachment (#5177) — the columns are written exactly as `send()` writes
   * them, via the same encoders.
   */
  const strandWithParts = (id: string, createdAt: string) => {
    const encoded = encodeAttachmentsForRow([
      { filename: '对账单.txt', content: '金额:¥1.00', cid: 'stmt@inline' },
    ]);
    if (encoded.kind !== 'inline') throw new Error(`fixture is not storable: ${encoded.kind}`);
    engine.seed('sys_email', {
      id,
      from_address: 'no-reply@example.test',
      to_addresses: 'user@example.test',
      subject: `Stranded ${id}`,
      body_text: 'hello',
      headers_json: encodeHeadersForRow({ 'X-Campaign': 'spring' }),
      attachments_json: encoded.json,
      status: 'queued',
      attempt_count: 0,
      created_at: createdAt,
    });
  };

  return {
    plugin, ctx, engine, adapter, clock, transport, strand, strandWithParts,
    service: () => services.email as EmailService,
    sysEmail: () => engine.rows('sys_email'),
    jobs: () => engine.rows('sys_job_queue'),
    /** Boot, then wait for the (deliberately un-awaited) sweep to settle. */
    async ready() {
      await ctx.fire('kernel:ready');
      return plugin.outboxSweepSettled;
    },
  };
}

const errorLines = (ctx: { logger: { error: ReturnType<typeof vi.fn> } }) =>
  ctx.logger.error.mock.calls.map((c) => String(c[0]));
const infoLines = (ctx: { logger: { info: ReturnType<typeof vi.fn> } }) =>
  ctx.logger.info.mock.calls.map((c) => String(c[0]));

beforeEach(() => { vi.clearAllMocks(); vi.setSystemTime(new Date(NOW)); });

// ── inline mode ────────────────────────────────────────────────────────────

describe('boot sweep — inline delivery', () => {
  it('advances a row stranded by a crash to sent, instead of leaving it at queued forever', async () => {
    const h = await boot();
    h.strand('row-crashed', ago(min(30)));

    const swept = await h.ready();

    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(h.sysEmail()[0]).toMatchObject({
      id: 'row-crashed', status: 'sent', message_id: '<sent@x>', attempt_count: 1,
    });
    expect(swept).toMatchObject({ scanned: 1, sent: 1, failed: 0 });
    expect(infoLines(h.ctx).join('\n')).toMatch(/outbox sweep — 1 sys_email row\(s\) stranded/);
  });

  it('finalizes an unsendable row as failed rather than leaving it stranded', async () => {
    const h = await boot({ transport: { send: vi.fn(async () => { throw new Error('535 auth failed'); }) } });
    h.strand('row-bad', ago(min(30)));

    const swept = await h.ready();

    expect(h.sysEmail()[0]).toMatchObject({ id: 'row-bad', status: 'failed', attempt_count: 1 });
    expect(String(h.sysEmail()[0].error)).toMatch(/535 auth failed/);
    expect(swept).toMatchObject({ failed: 1 });
    expect(errorLines(h.ctx).join('\n')).toMatch(/never reached a recipient/);
  });

  it('re-delivers a stranded row WITH its headers and attachment, inline too (#5177)', async () => {
    // Inline mode reaches the transport straight from the sweep, so this is
    // the shortest path from a persisted row to the wire — and the one that
    // proves the columns, not the queue, are what carries the parts.
    const h = await boot();
    h.strandWithParts('row-rich-inline', ago(min(30)));

    const swept = await h.ready();

    expect(swept).toMatchObject({ scanned: 1, sent: 1 });
    expect(vi.mocked(h.transport.send).mock.calls[0][0]).toMatchObject({
      headers: { 'X-Campaign': 'spring' },
      attachments: [{ filename: '对账单.txt', content: '金额:¥1.00', cid: 'stmt@inline' }],
    });
  });

  it('does not touch a row that was inserted seconds ago', async () => {
    // Another instance is delivering it right now; a boot must not race it.
    const h = await boot();
    h.strand('row-fresh', ago(3_000));

    const swept = await h.ready();

    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.sysEmail()[0]).toMatchObject({ status: 'queued' });
    expect(swept).toMatchObject({ scanned: 0 });
  });
});

// ── queue mode ─────────────────────────────────────────────────────────────

describe('boot sweep — durable queue delivery', () => {
  it('re-queues the stranded row as an { rowId } job that a worker then delivers', async () => {
    const h = await boot({ queue: true, plugin: { queueDelivery: true } });
    h.strand('row-crashed', ago(min(30)));

    const swept = await h.ready();

    // The sweep publishes; it does NOT deliver in the boot path.
    expect(swept).toMatchObject({ scanned: 1, requeued: 1, sent: 0 });
    expect(h.transport.send).not.toHaveBeenCalled();
    expect(h.jobs()).toHaveLength(1);
    expect(h.jobs()[0]).toMatchObject({ queue: EMAIL_SEND_QUEUE, status: 'pending' });
    // Same payload shape as send()'s own publish — one producer, not two.
    expect(JSON.parse(h.jobs()[0].payload_json)).toEqual({ rowId: 'row-crashed' });
    expect(h.jobs()[0].idempotency_key).toBe('sys_email:row-crashed');

    await h.adapter.pollOnce();

    expect(h.sysEmail()).toHaveLength(1);              // still ONE row
    expect(h.sysEmail()[0]).toMatchObject({ id: 'row-crashed', status: 'sent', attempt_count: 1 });
    expect(h.jobs()[0]).toMatchObject({ status: 'completed' });
  });

  it('re-delivers a stranded row WITH its headers and attachment (#5177)', async () => {
    // A crash must not silently downgrade the message. Before #5177 the row
    // had nowhere to keep either part, so a swept row was necessarily sent
    // stripped — the loss looked exactly like a successful delivery.
    const h = await boot({ queue: true, plugin: { queueDelivery: true } });
    h.strandWithParts('row-rich', ago(min(30)));

    await h.ready();
    await h.adapter.pollOnce();

    expect(h.sysEmail()[0]).toMatchObject({ id: 'row-rich', status: 'sent' });
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.transport.send).mock.calls[0][0]).toMatchObject({
      headers: { 'X-Campaign': 'spring' },
      attachments: [{ filename: '对账单.txt', content: '金额:¥1.00', cid: 'stmt@inline' }],
    });
  });

  it('collapses onto an existing pending job instead of racing a second worker', async () => {
    // The other half of a crash: the row AND its job survived (the process died
    // between publishing and the worker running). Re-publishing a second job
    // would put two workers on one row.
    const h = await boot({ queue: true, plugin: { queueDelivery: true } });
    h.strand('row-published', ago(min(30)));
    await h.adapter.publish(EMAIL_SEND_QUEUE, { rowId: 'row-published' }, {
      idempotencyKey: 'sys_email:row-published',
    });

    await h.ready();

    expect(h.jobs()).toHaveLength(1);

    await h.adapter.pollOnce();
    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(h.sysEmail()[0]).toMatchObject({ status: 'sent' });
  });
});

// ── the drain hook's own failures ──────────────────────────────────────────

describe('drain-hook failures are reported at error, with consequence and fix', () => {
  it('a delivery that throws is an error, not a warn — the mail was not sent', async () => {
    const h = await boot({ engine: { failIdLookup: true } });
    await h.ready();

    // An app-inserted outbox row: the hook fires, its re-read explodes.
    await h.engine.insert('sys_email', {
      id: 'row-app', from_address: 'a@b.test', to_addresses: 'c@d.test',
      subject: 'App', body_text: 'x', status: 'queued', created_at: new Date(NOW).toISOString(),
    });
    await flush();

    const line = errorLines(h.ctx).find((l) => l.includes('outbox drain FAILED'));
    expect(line, 'drain failure must be reported at error level').toBeTruthy();
    expect(h.ctx.logger.warn.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/outbox drain/);
    expect(line!).toMatch(/row 'row-app'/);
    expect(line!).toMatch(/was NOT sent/);                 // consequence …
    expect(line!).toMatch(/stays at `queued`/);            // … concretely
    expect(line!).toMatch(/boot outbox sweep/);            // fix: what picks it up
    expect(line!).toMatch(/Durable queue delivery/);       // fix: how to stop waiting
    expect(line!).toMatch(/datasource connection lost/);   // cause
  });

  it('a hook that breaks before it can even schedule delivery is an error too', async () => {
    const h = await boot();
    await h.ready();

    // A row object whose property access throws — the synchronous arm of the
    // hook, which used to swallow into a warn nobody reads.
    const poison = new Proxy({}, { get() { throw new Error('row proxy exploded'); } });
    for (const fn of h.engine.afterInsertHooks()) await fn(poison);

    const line = errorLines(h.ctx).find((l) => l.includes('outbox drain hook error'));
    expect(line, 'hook breakage must be reported at error level').toBeTruthy();
    expect(line!).toMatch(/never scheduled for delivery/);
    expect(line!).toMatch(/boot outbox sweep/);
    expect(line!).toMatch(/row proxy exploded/);
  });

  it('reports at error when the sweep itself cannot run', async () => {
    const h = await boot();
    h.engine.find = (async () => { throw new Error('no such table: sys_email'); }) as never;

    const swept = await h.ready();

    expect(swept).toBeUndefined();
    const line = errorLines(h.ctx).find((l) => l.includes('boot sweep of stranded sys_email rows FAILED'));
    expect(line, 'a swallowed sweep failure is the durability loss itself').toBeTruthy();
    expect(line!).toMatch(/still sitting at `queued`/);
    expect(line!).toMatch(/no such table/);
  });
});

// ── the default path is untouched ──────────────────────────────────────────

describe('normal delivery is unchanged', () => {
  it('send() still delivers inline and the sweep finds nothing to do', async () => {
    const h = await boot();
    const swept = await h.ready();

    const res = await h.service().send({ to: 'a@b.com', from: 'x@y.com', subject: 'Hi', text: 'hello' });

    expect(res).toMatchObject({ status: 'sent', messageId: '<sent@x>' });
    expect(swept).toMatchObject({ scanned: 0 });
    expect(h.transport.send).toHaveBeenCalledTimes(1);
  });

  it('an app-inserted row is still drained by the afterInsert hook, exactly once', async () => {
    const h = await boot();
    await h.ready();

    await h.engine.insert('sys_email', {
      id: 'row-app', from_address: 'a@b.test', to_addresses: 'c@d.test',
      subject: 'App', body_text: 'x', status: 'queued', attempt_count: 0,
      created_at: new Date(NOW).toISOString(),
    });
    await flush();

    expect(h.transport.send).toHaveBeenCalledTimes(1);
    expect(h.sysEmail()[0]).toMatchObject({ id: 'row-app', status: 'sent', message_id: '<sent@x>' });
    expect(h.ctx.logger.error).not.toHaveBeenCalled();
  });
});

// ── the insert id contract, at the seam that motivated it (#5523) ───────────

describe('a datasource that re-keys a sys_email insert', () => {
  it('makes send() reject by name instead of double-sending through the drain hook', async () => {
    // The full mechanism, end to end, through the REAL plugin persistence
    // adapter (which forwards the engine's own answer rather than laundering it
    // back into `row.id`):
    //
    //   send() mints id → reserves it → engine.insert stores the row under
    //   'db-pk-7' and fires afterInsert with THAT id → the drain hook asks
    //   isServiceManaged('db-pk-7'), gets false, and schedules a delivery of
    //   its own → insert returns 'db-pk-7'.
    //
    // Before the contract check, `send()` then adopted 'db-pk-7' and delivered
    // the message a second time down its own path: two deliveries of one mail
    // and two terminal updates racing on one row. The only thing that ever
    // stopped it was the drain hook's `setTimeout(0)` losing to send()'s inline
    // delivery — so this transport is deliberately SLOWER than that timer,
    // which is what real network I/O is. Reverting the check turns the
    // `toHaveBeenCalledTimes(1)` below into 2.
    const transport = {
      send: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 25));
        return { messageId: '<sent@x>' };
      }),
    };
    const h = await boot({ engine: { reKeyInsert: 'db-pk-7' }, transport });
    await h.ready();

    await expect(
      h.service().send({ to: 'a@b.com', from: 'x@y.com', subject: 'Hi', text: 'hello' }),
    ).rejects.toThrow(/EmailPersistence\.insert must return the row's own id/);

    // Give the hook's already-scheduled delivery time to finish. It is NOT
    // cancellable: the hook runs synchronously inside `engine.insert`, i.e.
    // before `insert` has even returned to the service, so the contract check
    // cannot pre-empt it. What the check removes is send()'s SECOND delivery —
    // the row that did land is still delivered once, by the hook, and the
    // caller is told loudly that its persistence is misconfigured.
    await new Promise((r) => setTimeout(r, 120));

    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(h.sysEmail()).toHaveLength(1);
    expect(h.sysEmail()[0]).toMatchObject({ id: 'db-pk-7', status: 'sent' });
  });
});
