// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sweepStrandedOutbox — the consumer `status:'queued'` never had (#5161).
//
// What these pin, in order of what actually costs money when it is wrong:
//   1. a stranded row is advanced, so `queued` stops being a terminal state;
//   2. a row that is merely YOUNG is not touched — sweeping live work is how a
//      restart would send somebody's mail twice;
//   3. the route follows the configured mode (queue publish vs inline
//      delivery), and the queue route reuses `send()`'s own producer;
//   4. the failure paths are loud and bounded.

import { describe, it, expect, vi } from 'vitest';
import {
  sweepStrandedOutbox,
  OUTBOX_SWEEP_MIN_AGE_MS,
  OUTBOX_OBJECT,
  type OutboxSweepService,
} from './outbox-sweep.js';

const NOW = Date.UTC(2026, 7, 4, 12, 0, 0);
const ago = (ms: number) => new Date(NOW - ms).toISOString();

/** Minutes, in ms — the age gate's unit. */
const min = (n: number) => n * 60_000;

interface RowSeed {
  id: string;
  created_at: string;
  status?: string;
  message_id?: string;
}

/**
 * Engine mirroring the `where` / `orderBy` / `limit` subset ObjectQL answers,
 * INCLUDING the `{ $lt: … }` operator the age gate is written in — a double
 * that ignored the operator would report the gate working while it filtered
 * nothing.
 */
function fakeEngine(seed: RowSeed[]) {
  const rows = seed.map((r) => ({ status: 'queued', ...r }) as Record<string, any>);
  const matches = (row: any, where: Record<string, any>) =>
    Object.entries(where).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        return Object.entries(v).every(([op, target]) => {
          if (op === '$lt') return row[k] < (target as any);
          throw new Error(`fake driver: unsupported operator ${op}`);
        });
      }
      return row[k] === v;
    });
  const find = vi.fn(async (object: string, opts: any = {}) => {
    if (object !== OUTBOX_OBJECT) return [];
    let out = opts.where ? rows.filter((r) => matches(r, opts.where)) : [...rows];
    for (const ord of [...(opts.orderBy ?? [])].reverse()) {
      out.sort((a, b) => {
        const av = a[ord.field], bv = b[ord.field];
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * (ord.order === 'desc' ? -1 : 1);
      });
    }
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  });
  return { rows, find };
}

interface ServiceOpts {
  /** true ⇒ queue mode (publish succeeds), false ⇒ inline. */
  enqueue?: boolean | ((rowId: string) => boolean);
  deliver?: (row: Record<string, any>) => any;
  managed?: string[];
}

function fakeService(opts: ServiceOpts = {}) {
  const managed = new Set(opts.managed ?? []);
  const enqueuePersistedRow = vi.fn(async (rowId: string) => (
    typeof opts.enqueue === 'function' ? opts.enqueue(rowId) : opts.enqueue === true
  ));
  const deliverPersistedRow = vi.fn(async (row: Record<string, any>) => (
    opts.deliver ? opts.deliver(row) : { id: String(row.id), status: 'sent', messageId: '<x@y>' }
  ));
  return {
    isServiceManaged: (id: string) => managed.has(id),
    enqueuePersistedRow,
    deliverPersistedRow,
  } as unknown as OutboxSweepService & {
    enqueuePersistedRow: ReturnType<typeof vi.fn>;
    deliverPersistedRow: ReturnType<typeof vi.fn>;
  };
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const lines = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => String(c[0]));

// ── 1. the stranded row is advanced ────────────────────────────────────────

describe('sweepStrandedOutbox — the row nobody was consuming', () => {
  it('delivers a row left behind by a process that died after the insert', async () => {
    // The exact scenario: a `queued` row committed, the drain hook never
    // completed, no queue job exists. Before #5161 nothing ever read it again.
    const engine = fakeEngine([{ id: 'row-crashed', created_at: ago(min(30)) }]);
    const service = fakeService();
    const logger = fakeLogger();

    const res = await sweepStrandedOutbox({ engine, service, logger, now: () => NOW });

    expect(service.deliverPersistedRow).toHaveBeenCalledTimes(1);
    expect(service.deliverPersistedRow.mock.calls[0][0]).toMatchObject({ id: 'row-crashed' });
    expect(res).toMatchObject({ scanned: 1, sent: 1, requeued: 0, failed: 0, skipped: 0 });
  });

  it('queries only queued rows past the age gate, oldest first, bounded', async () => {
    const engine = fakeEngine([]);
    await sweepStrandedOutbox({ engine, service: fakeService(), now: () => NOW });

    const [object, opts] = engine.find.mock.calls[0] as [string, any];
    expect(object).toBe('sys_email');
    expect(opts.where).toEqual({
      status: 'queued',
      created_at: { $lt: new Date(NOW - OUTBOX_SWEEP_MIN_AGE_MS).toISOString() },
    });
    expect(opts.orderBy).toEqual([{ field: 'created_at', order: 'asc' }]);
    expect(opts.limit).toBeGreaterThan(0);
    expect(opts.context).toMatchObject({ isSystem: true });
  });

  it('says nothing at all when there is nothing stranded (the healthy boot)', async () => {
    const logger = fakeLogger();
    const res = await sweepStrandedOutbox({ engine: fakeEngine([]), service: fakeService(), logger, now: () => NOW });
    expect(res).toMatchObject({ scanned: 0, sent: 0, requeued: 0 });
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

// ── 2. the age gate ────────────────────────────────────────────────────────

describe('the age gate — a young row is somebody else\'s in-flight work', () => {
  it('leaves a row inserted seconds ago alone, and takes the old one', async () => {
    // A sibling instance inserted `row-fresh` two seconds ago and its drain
    // hook is mid-flight. Sweeping it would send that message twice, and this
    // instance's own boot time cannot tell the two rows apart — only age can.
    const engine = fakeEngine([
      { id: 'row-fresh', created_at: ago(2_000) },
      { id: 'row-old', created_at: ago(min(45)) },
    ]);
    const service = fakeService();

    const res = await sweepStrandedOutbox({ engine, service, now: () => NOW });

    expect(service.deliverPersistedRow).toHaveBeenCalledTimes(1);
    expect(service.deliverPersistedRow.mock.calls[0][0]).toMatchObject({ id: 'row-old' });
    expect(res.scanned).toBe(1);
  });

  it('holds a row until it crosses the gate, then sweeps it', async () => {
    const engine = fakeEngine([{ id: 'row-1', created_at: ago(min(4)) }]);
    const service = fakeService();

    expect((await sweepStrandedOutbox({ engine, service, now: () => NOW })).scanned).toBe(0);
    // …the next boot, ten minutes later.
    const later = await sweepStrandedOutbox({ engine, service, now: () => NOW + min(10) });
    expect(later).toMatchObject({ scanned: 1, sent: 1 });
  });
});

// ── 3. routing + idempotency backstops ─────────────────────────────────────

describe('routing follows the configured delivery mode', () => {
  it('queue mode: publishes the row through send()\'s own producer, never the transport', async () => {
    const engine = fakeEngine([
      { id: 'row-a', created_at: ago(min(30)) },
      { id: 'row-b', created_at: ago(min(20)) },
    ]);
    const service = fakeService({ enqueue: true });
    const logger = fakeLogger();

    const res = await sweepStrandedOutbox({ engine, service, logger, now: () => NOW });

    expect(service.enqueuePersistedRow.mock.calls.map((c) => c[0])).toEqual(['row-a', 'row-b']);
    expect(service.deliverPersistedRow).not.toHaveBeenCalled();
    expect(res).toMatchObject({ scanned: 2, requeued: 2, sent: 0, failed: 0 });
    expect(lines(logger.info)[0]).toMatch(/2 re-queued for durable delivery/);
  });

  it('falls back to inline delivery when the publish fails — the row is already committed', async () => {
    const engine = fakeEngine([{ id: 'row-a', created_at: ago(min(30)) }]);
    const service = fakeService({ enqueue: false });

    const res = await sweepStrandedOutbox({ engine, service, now: () => NOW });

    expect(service.enqueuePersistedRow).toHaveBeenCalledWith('row-a');
    expect(service.deliverPersistedRow).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ requeued: 0, sent: 1 });
  });

  it('never touches a row this process is delivering right now', async () => {
    const engine = fakeEngine([
      { id: 'row-managed', created_at: ago(min(30)) },
      { id: 'row-free', created_at: ago(min(30)) },
    ]);
    const service = fakeService({ managed: ['row-managed'] });

    const res = await sweepStrandedOutbox({ engine, service, now: () => NOW });

    expect(service.deliverPersistedRow).toHaveBeenCalledTimes(1);
    expect(service.deliverPersistedRow.mock.calls[0][0]).toMatchObject({ id: 'row-free' });
    expect(res).toMatchObject({ scanned: 2, sent: 1, skipped: 1 });
  });

  it('never re-sends a row the transport already accepted', async () => {
    // `message_id` set with the status update lost (a crash between the two
    // writes) — the same guard the email.send.async subscriber applies.
    const engine = fakeEngine([{ id: 'row-sent', created_at: ago(min(30)), message_id: '<already@x>' }]);
    const service = fakeService();

    const res = await sweepStrandedOutbox({ engine, service, now: () => NOW });

    expect(service.deliverPersistedRow).not.toHaveBeenCalled();
    expect(service.enqueuePersistedRow).not.toHaveBeenCalled();
    expect(res).toMatchObject({ scanned: 1, skipped: 1 });
  });
});

// ── 4. failure paths ───────────────────────────────────────────────────────

describe('failures are loud, counted, and never stop the batch', () => {
  it('records an inline delivery that failed and reports the consequence at error', async () => {
    const engine = fakeEngine([{ id: 'row-a', created_at: ago(min(30)) }]);
    const service = fakeService({
      deliver: () => ({ id: 'row-a', status: 'failed', error: '535 authentication failed' }),
    });
    const logger = fakeLogger();

    const res = await sweepStrandedOutbox({ engine, service, logger, now: () => NOW });

    expect(res).toMatchObject({ scanned: 1, failed: 1, sent: 0 });
    const err = lines(logger.error).join('\n');
    expect(err).toMatch(/could NOT be delivered/);
    expect(err).toMatch(/never reached a recipient/);   // consequence
    expect(err).toMatch(/Durable queue delivery/);      // fix
  });

  it('keeps going after a row that throws, and says so once', async () => {
    const engine = fakeEngine([
      { id: 'row-bad', created_at: ago(min(30)) },
      { id: 'row-bad-2', created_at: ago(min(29)) },
      { id: 'row-good', created_at: ago(min(28)) },
    ]);
    const service = fakeService({
      deliver: (row) => {
        if (String(row.id).startsWith('row-bad')) throw new Error('engine exploded');
        return { id: row.id, status: 'sent' };
      },
    });
    const logger = fakeLogger();

    const res = await sweepStrandedOutbox({ engine, service, logger, now: () => NOW });

    expect(res).toMatchObject({ scanned: 3, failed: 2, sent: 1 });
    // One per-row line (say it once), plus the batch summary error.
    const perRow = lines(logger.error).filter((l) => l.includes("could not advance sys_email row"));
    expect(perRow).toHaveLength(1);
    expect(perRow[0]).toMatch(/row-bad/);
    expect(perRow[0]).toMatch(/engine exploded/);
  });

  it('[#9657] reports a stranded row to a sink with NO `error` — at warn, not in silence', async () => {
    // `SweepLogger.error` is declared OPTIONAL, and the per-row report used to
    // be `logger?.error?.(…)`: against a `{ info, warn }` sink it emitted
    // NOTHING, so the message that stays `queued` forever was reported by
    // nobody while the server kept looking healthy.
    const engine = fakeEngine([{ id: 'row-bad', created_at: ago(min(30)) }]);
    const service = fakeService({
      deliver: () => { throw new Error('engine exploded'); },
    });
    const logger = { info: vi.fn(), warn: vi.fn() };

    const res = await sweepStrandedOutbox({ engine, service, logger, now: () => NOW });

    expect(res).toMatchObject({ scanned: 1, failed: 1 });
    const warned = lines(logger.warn).filter((l) => l.includes('could not advance sys_email row'));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toMatch(/row-bad/);
    expect(warned[0]).toMatch(/engine exploded/);   // the cause survives the fallback
  });

  it('[#9748] the batch SUMMARY also reaches a sink with NO `error` — at warn, not in silence', async () => {
    // #9657 repaired the PER-ROW line above; this summary sits outside any
    // `catch`, so the durability gate could not see it and it kept the
    // `logger?.error?.(…)` spelling. Against a `{ info, warn }` sink the repair
    // therefore made the split WORSE, not better: the detail survived at `warn`
    // while the TOTAL — how many accepted messages never reached anyone —
    // vanished. The counts and the detail reported through different channels.
    const engine = fakeEngine([
      { id: 'row-bad-1', created_at: ago(min(30)) },
      { id: 'row-bad-2', created_at: ago(min(29)) },
    ]);
    const service = fakeService({
      deliver: () => { throw new Error('engine exploded'); },
    });
    const logger = { info: vi.fn(), warn: vi.fn() };

    const res = await sweepStrandedOutbox({ engine, service, logger, now: () => NOW });

    expect(res).toMatchObject({ scanned: 2, failed: 2 });
    const summary = lines(logger.warn).filter((l) => l.includes('could NOT be delivered'));
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatch(/2 stranded sys_email row\(s\)/);   // the COUNT is the whole point
    expect(summary[0]).toMatch(/never reached a recipient/);       // consequence survives the fallback
    expect(summary[0]).toMatch(/Durable queue delivery/);          // and so does the fix
  });

  it('[#9748] a sink that HAS `error` still gets the summary at error, not downgraded', async () => {
    // The fallback must not cost a capable sink its level — the reach for
    // `error` was right; only its absence of a fallback was wrong.
    const engine = fakeEngine([{ id: 'row-bad-1', created_at: ago(min(30)) }]);
    const service = fakeService({
      deliver: () => { throw new Error('engine exploded'); },
    });
    const logger = fakeLogger();

    await sweepStrandedOutbox({ engine, service, logger, now: () => NOW });

    expect(lines(logger.error).filter((l) => l.includes('could NOT be delivered'))).toHaveLength(1);
    expect(lines(logger.warn).filter((l) => l.includes('could NOT be delivered'))).toHaveLength(0);
  });

  it('[#9754] a sink with NO `warn` cannot be spelled at all — the TYPE forbids the silence', async () => {
    // THE HARM, reproduced before the fix is believed. Until #9754 every member
    // of `SweepLogger` was optional, so `{ info }` was a legal sink — and
    // against it BOTH repaired reports print nothing at all: each reaches for
    // `error`, finds none, falls back to `warn`, and finds none of that either.
    // Mail the platform accepted and never delivered, reported to nobody. The
    // cast below buys exactly what the old contract handed out for free.
    const engine = fakeEngine([{ id: 'row-bad-1', created_at: ago(min(30)) }]);
    const service = fakeService({
      deliver: () => { throw new Error('engine exploded'); },
    });
    const silent = { info: vi.fn() };

    const res = await sweepStrandedOutbox({
      engine,
      service,
      logger: silent as unknown as NonNullable<Parameters<typeof sweepStrandedOutbox>[0]['logger']>,
      now: () => NOW,
    });

    expect(res).toMatchObject({ scanned: 1, failed: 1 });
    // Not "logged at the wrong level" — not logged AT ALL, on either report.
    expect(lines(silent.info).filter((l) => l.includes('could NOT be delivered'))).toHaveLength(0);
    expect(lines(silent.info).filter((l) => l.includes('engine exploded'))).toHaveLength(0);

    // THE CONTRACT. Without that cast the same sink no longer compiles: `warn`
    // is non-optional on `SweepLogger` (#9754), so a caller cannot hand over a
    // sink with nowhere to put a durability report. Restore `warn?` in
    // outbox-sweep.ts and this directive turns into an "Unused
    // '@ts-expect-error' directive" error — which is how this assertion proves
    // it is live rather than decorative.
    await sweepStrandedOutbox({
      engine,
      service,
      // @ts-expect-error — #9754: a SweepLogger MUST declare a `warn` channel
      logger: { info: vi.fn() },
      now: () => NOW,
    });
  });

  it('propagates a failure of the query itself — the sweep did not happen', async () => {
    const engine = { find: vi.fn(async () => { throw new Error('no such table: sys_email'); }) };
    await expect(sweepStrandedOutbox({ engine, service: fakeService(), now: () => NOW }))
      .rejects.toThrow(/no such table/);
  });

  it('bounds the batch and says more remain', async () => {
    const engine = fakeEngine(
      Array.from({ length: 5 }, (_, i) => ({ id: `row-${i}`, created_at: ago(min(30 + i)) })),
    );
    const logger = fakeLogger();

    const res = await sweepStrandedOutbox({ engine, service: fakeService(), logger, now: () => NOW, limit: 3 });

    expect(res).toMatchObject({ scanned: 3, sent: 3, truncated: true });
    expect(lines(logger.info)[0]).toMatch(/Batch limit 3 reached — more rows remain/);
  });

  it('an exactly-full batch is not reported as truncated', async () => {
    // Read one row past the limit, so "there are more" is a fact rather than an
    // inference from a full page — otherwise every boot with exactly `limit`
    // stranded rows tells the operator to expect a second sweep that has
    // nothing to do.
    const engine = fakeEngine(
      Array.from({ length: 3 }, (_, i) => ({ id: `row-${i}`, created_at: ago(min(30 + i)) })),
    );
    const logger = fakeLogger();

    const res = await sweepStrandedOutbox({ engine, service: fakeService(), logger, now: () => NOW, limit: 3 });

    expect(res).toMatchObject({ scanned: 3, sent: 3, truncated: false });
    expect(lines(logger.info)[0]).not.toMatch(/Batch limit/);
  });

  it('summarises a normal sweep in one info line', async () => {
    const engine = fakeEngine([{ id: 'row-a', created_at: ago(min(30)) }]);
    const logger = fakeLogger();

    await sweepStrandedOutbox({ engine, service: fakeService(), logger, now: () => NOW });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const line = lines(logger.info)[0];
    expect(line).toMatch(/outbox sweep — 1 sys_email row\(s\) stranded at 'queued' for over 5m/);
    expect(line).toMatch(/1 sent inline, 0 failed, 0 skipped\./);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
