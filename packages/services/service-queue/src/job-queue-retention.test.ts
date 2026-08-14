// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// #5179 — `sys_job_queue` only ever grew: the adapter marked a delivered
// message `completed` and nothing ever touched the row again. The fix is the
// object's own ADR-0057 `lifecycle.retention` declaration, swept by the ONE
// platform-owned Reaper (`LifecycleService`, @objectstack/objectql) — not a
// second sweeper inside the adapter's poll loop.
//
// What this file pins is therefore the CONTRACT the two sides share:
//   1. the declaration itself (window, and that it only ever names `completed`);
//   2. that the declared window can never be shorter than the adapter's
//      idempotency window — the dedup rule reads terminal rows that the Reaper
//      is allowed to delete, so ordering those two windows is what keeps
//      "dedup inside the window" true;
//   3. that applying the declared policy repeatedly bounds the table while
//      leaving live work (`pending`/`running`) and the dead-letter queue
//      (`dlq`/`failed`) alone at ANY age.
//
// The Reaper's own semantics (that it merges `retention.onlyWhen` into the
// delete filter) are pinned upstream in
// `packages/objectql/src/lifecycle/lifecycle-service.test.ts` ("merges
// retention.onlyWhen into the reap filter (mixed tables, #2834)"); `sweep()`
// below is a faithful mirror of that same where-clause construction
// (`{ created_at: { $lt: cutoff }, ...onlyWhen }`, `multi: true`, system
// context) so this package can assert the consequences without depending on
// the engine.

import { describe, it, expect, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, LifecycleService } from '@objectstack/objectql';
import { SysJobQueue } from '@objectstack/platform-objects/audit';
import { DbQueueAdapter, completedRetentionWindowMs } from './db-queue-adapter.js';
import { QueueServicePlugin } from './queue-service-plugin.js';
import { lifecycleDurationMs } from './common.js';

const QUEUE_TABLE = 'sys_job_queue';
const DEFAULT_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Row = Record<string, any>;

/**
 * In-memory engine mirroring the two call shapes this test needs:
 *  - the adapter's `where:` equality find / `(table, {id, ...patch})` update
 *    (same contract as `db-queue-adapter.test.ts`);
 *  - the Reaper's `delete(table, { where, multi: true })` with a `$lt`
 *    operator, which the row-by-row `where.id` delete of the adapter's own
 *    `purge()` does not exercise.
 */
function makeFakeEngine() {
  const tables = new Map<string, Row[]>();
  function matches(row: Row, where: Record<string, any>): boolean {
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        // NULL-safe like SQL: a row with no value never satisfies `$lt`.
        if ('$lt' in v && (row[k] == null || !(String(row[k]) < String(v.$lt)))) return false;
        if ('$in' in v && !(v.$in as unknown[]).includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  }
  return {
    tables,
    rows(): Row[] {
      return tables.get(QUEUE_TABLE) ?? [];
    },
    // [#5195] The two members `LifecycleService` needs to sweep through this
    // fake for real, so the floor can be proven end-to-end rather than
    // re-mirrored: the object set it iterates, and the driver hook it consults
    // for space reclaim (none here).
    registry: { getAllObjects: () => [SysJobQueue as any] },
    getDriverForObject: () => undefined,
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      let out = opts.where ? t.filter((r) => matches(r, opts.where)) : [...t];
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
    async insert(table: string, data: Row) {
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, patch: Row) {
      const r = (tables.get(table) ?? []).find((x) => x.id === patch.id);
      if (!r) throw new Error(`row ${patch.id} not found in ${table}`);
      Object.assign(r, patch);
      return r;
    },
    async delete(table: string, opts: any) {
      // [#4550] Opened with ObjectQL.delete's OWN dispatch predicate rather
      // than a hand-mirrored `if`: a double looser than the engine it stands
      // in for is how #4434 shipped a dead REST route with its suite green,
      // and the case a mirror always drops is the one that only LOOKS like an
      // id (`where: { id: { $in: [...] } }` without `multi`).
      const dispatch = assertEngineDeleteDispatch(opts);
      const t = tables.get(table) ?? [];
      if (dispatch.kind === 'multi') {
        const keep = t.filter((r) => !matches(r, opts?.where ?? {}));
        tables.set(table, keep);
        return t.length - keep.length; // drivers report a deleted count
      }
      tables.set(table, t.filter((r) => r.id !== dispatch.id));
      return { id: dispatch.id };
    },
  };
}

/** Mutable clock — the adapter stamps `created_at` from it. */
function makeClock(startMs: number) {
  let ms = startMs;
  return {
    now: () => new Date(ms),
    advance(byMs: number) { ms += byMs; },
    get ms() { return ms; },
  };
}

/**
 * Apply `sys_job_queue`'s DECLARED retention exactly as `LifecycleService`
 * would (single bulk delete, system context) and return the row count deleted.
 * Reads the declaration rather than restating it, so a change to the object
 * definition changes what this sweep does — the same coupling production has.
 */
async function sweep(engine: ReturnType<typeof makeFakeEngine>, nowMs: number): Promise<number> {
  const lc = SysJobQueue.lifecycle!;
  const retention = lc.retention!;
  const cutoff = new Date(nowMs - lifecycleDurationMs(retention.maxAge)).toISOString();
  const deleted = await engine.delete(QUEUE_TABLE, {
    where: { created_at: { $lt: cutoff }, ...(retention.onlyWhen ?? {}) },
    multi: true,
    context: { isSystem: true, positions: [], permissions: [] },
  });
  return deleted as number;
}

describe('sys_job_queue retention declaration (#5179)', () => {
  it('declares an ADR-0057 retention window that only ever names completed rows', () => {
    const lc = SysJobQueue.lifecycle;
    expect(lc).toBeDefined();
    // `transient` (workflow / ephemeral state) — NOT telemetry/event/audit,
    // which ADR-0057 §3.6 relocates to the dedicated `telemetry` datasource.
    // A live work queue must not change stores as a side effect of cleanup.
    expect(lc?.class).toBe('transient');
    expect(lc?.retention?.maxAge).toBe('7d');
    // The dead-letter queue is the reason this filter exists: `dlq`/`failed`
    // wait for a human, `pending`/`running` are undelivered work.
    expect(lc?.retention?.onlyWhen).toEqual({ status: 'completed' });
    expect(lc?.ttl).toBeUndefined();      // TTL has no row filter — it would eat the DLQ
    expect(lc?.archive).toBeUndefined();  // and archive is incompatible with onlyWhen
  });

  it('keeps the retention window ≥ the adapter default idempotency window', () => {
    // The invariant the dedup rule rests on. If someone shortens the declared
    // window below the dedup window, this fails before a duplicate delivery
    // ever teaches anyone about it in production.
    expect(completedRetentionWindowMs()).toBeGreaterThanOrEqual(DEFAULT_IDEMPOTENCY_WINDOW_MS);
    expect(completedRetentionWindowMs()).toBe(7 * DAY);
  });

  it('parses lifecycle duration literals the way @objectstack/objectql does', () => {
    // Mirror of `parseLifecycleDuration` (coarse bounds: y = 365d).
    expect(lifecycleDurationMs('6h')).toBe(6 * HOUR);
    expect(lifecycleDurationMs('7d')).toBe(7 * DAY);
    expect(lifecycleDurationMs('12w')).toBe(12 * 7 * DAY);
    expect(lifecycleDurationMs('1y')).toBe(365 * DAY);
    expect(() => lifecycleDurationMs('7 days')).toThrow(/invalid lifecycle duration/);
  });
});

describe('DbQueueAdapter window ordering (#5179)', () => {
  it('refuses to construct with an idempotency window longer than the retention', () => {
    expect(() => new DbQueueAdapter({
      engine: makeFakeEngine(),
      options: { autoStart: false, idempotencyWindowMs: 8 * DAY },
    })).toThrow(/exceeds the retention window/);
  });

  it('accepts an idempotency window equal to the retention window', () => {
    expect(() => new DbQueueAdapter({
      engine: makeFakeEngine(),
      options: { autoStart: false, idempotencyWindowMs: completedRetentionWindowMs() },
    })).not.toThrow();
  });
});

describe('declared retention bounds sys_job_queue (#5179)', () => {
  let engine: ReturnType<typeof makeFakeEngine>;
  let clock: ReturnType<typeof makeClock>;
  let adapter: DbQueueAdapter;

  beforeEach(() => {
    engine = makeFakeEngine();
    clock = makeClock(Date.parse('2026-01-01T00:00:00.000Z'));
    adapter = new DbQueueAdapter({
      engine,
      clock,
      options: { pollIntervalMs: 60_000, autoStart: false, defaultMaxAttempts: 3 },
    });
  });

  it('bounds the table over a long publish→completed run', async () => {
    await adapter.subscribe('email.send.async', async () => { /* delivered */ });

    // 60 days, one message a day, a sweep after each — the shape #5160 gives
    // this table once every queued email lands here.
    for (let day = 0; day < 60; day++) {
      await adapter.publish('email.send.async', { day });
      await adapter.pollOnce();
      await sweep(engine, clock.ms);
      clock.advance(DAY);
      // Bounded at every point in the run, not just at the end: the window
      // holds 7 days of completed rows plus the one published today.
      expect(engine.rows().length).toBeLessThanOrEqual(8);
    }

    const rows = engine.rows();
    expect(rows.every((r) => r.status === 'completed')).toBe(true);
    // Without the policy this run would leave 60 permanent rows.
    expect(rows.length).toBeLessThanOrEqual(8);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('never sweeps dlq, failed, pending or running rows however old', async () => {
    const ancient = new Date(clock.ms - 3650 * DAY).toISOString();
    engine.tables.set(QUEUE_TABLE, [
      { id: 'm_dlq', queue: 'q', status: 'dlq', payload_json: '{}', created_at: ancient },
      { id: 'm_failed', queue: 'q', status: 'failed', payload_json: '{}', created_at: ancient },
      { id: 'm_pending', queue: 'q', status: 'pending', payload_json: '{}', created_at: ancient },
      { id: 'm_running', queue: 'q', status: 'running', payload_json: '{}', created_at: ancient },
      { id: 'm_done', queue: 'q', status: 'completed', payload_json: '{}', created_at: ancient },
    ]);

    const deleted = await sweep(engine, clock.ms);

    expect(deleted).toBe(1);
    expect(engine.rows().map((r) => r.id).sort())
      .toEqual(['m_dlq', 'm_failed', 'm_pending', 'm_running']);

    // A ten-year-old dead letter is still listable and replayable — that is
    // what the dead-letter queue IS.
    const failed = await adapter.listFailed('q');
    expect(failed.map((f) => f.id)).toEqual(['m_dlq']);
  });

  it('leaves completed rows inside the dedup window alone, so dedup still holds', async () => {
    await adapter.subscribe('billing', async () => { /* delivered */ });
    const first = await adapter.publish('billing', { invoice: 1 }, { idempotencyKey: 'inv-1' });
    await adapter.pollOnce();
    expect(engine.rows()[0]!.status).toBe('completed');

    // Late in the 24h dedup window — well inside the 7d retention window, so
    // the sweep must not take it.
    clock.advance(23 * HOUR);
    expect(await sweep(engine, clock.ms)).toBe(0);
    expect(engine.rows()).toHaveLength(1);

    const again = await adapter.publish('billing', { invoice: 1 }, { idempotencyKey: 'inv-1' });
    expect(again).toBe(first);
    expect(engine.rows()).toHaveLength(1);
  });

  it('sweeps a completed row only long after its dedup window has expired', async () => {
    await adapter.subscribe('billing', async () => { /* delivered */ });
    const first = await adapter.publish('billing', { invoice: 2 }, { idempotencyKey: 'inv-2' });
    await adapter.pollOnce();

    // Past the retention window (and therefore, by construction, long past
    // the dedup window): the row goes, and the key is publishable again —
    // which is the dedup contract, not a violation of it.
    clock.advance(7 * DAY + HOUR);
    expect(await sweep(engine, clock.ms)).toBe(1);
    expect(engine.rows()).toHaveLength(0);

    const again = await adapter.publish('billing', { invoice: 2 }, { idempotencyKey: 'inv-2' });
    expect(again).not.toBe(first);
    expect(engine.rows()).toHaveLength(1);
    expect(engine.rows()[0]!.status).toBe('pending');
  });

  it('a sweep mid-flight cannot take a message that has not been delivered yet', async () => {
    // Old row, still `pending` because its handler was never registered:
    // exactly the row an age-only policy would have thrown away.
    engine.tables.set(QUEUE_TABLE, [{
      id: 'm_stuck',
      queue: 'slow',
      status: 'pending',
      payload_json: JSON.stringify({ v: 1 }),
      attempts: 0,
      max_attempts: 3,
      scheduled_for: new Date(clock.ms - 30 * DAY).toISOString(),
      created_at: new Date(clock.ms - 30 * DAY).toISOString(),
    }]);

    expect(await sweep(engine, clock.ms)).toBe(0);

    const seen: unknown[] = [];
    await adapter.subscribe('slow', async (msg) => { seen.push(msg.data); });
    await adapter.pollOnce();

    expect(seen).toEqual([{ v: 1 }]);
    expect(engine.rows()[0]!.status).toBe('completed');
  });
});

// #5195 — the invariant above is enforced against the object's DECLARATION,
// which the adapter's constructor can read. ADR-0057 P4 also lets an operator
// override that window at runtime through the `lifecycle` settings namespace,
// and the constructor cannot see that at all: set
// `retention_overrides.sys_job_queue.maxAge = '1h'` and completed rows are
// reaped an hour after they are written while publish keeps dedupping against
// 24h — duplicate deliveries resume, silently.
//
// These run the REAL `LifecycleService` over the REAL `SysJobQueue`
// declaration, so what is pinned is the two packages agreeing, not this file's
// idea of either.
describe('a lifecycle settings override cannot undercut the dedup window (#5195)', () => {
  const OVERRIDE_1H = { retention_overrides: { [QUEUE_TABLE]: { maxAge: '1h' } } };

  function fakeSettings(values: Record<string, unknown>) {
    return {
      async get(_ns: string, key: string) {
        return key in values
          ? { value: values[key], source: 'global' }
          : { value: undefined, source: 'default' };
      },
    };
  }

  function lifecycle(
    engine: ReturnType<typeof makeFakeEngine>,
    clock: ReturnType<typeof makeClock>,
    settings: unknown,
    logger: { info(m: string): void; warn(m: string): void; error(m: string): void },
  ) {
    return new LifecycleService({
      getEngine: () => engine as any,
      logger,
      now: () => clock.ms,
      getSettings: () => settings as any,
    });
  }

  function collectingLogger() {
    const errors: string[] = [];
    return {
      errors,
      info: () => {},
      warn: () => {},
      error: (m: string) => { errors.push(m); },
    };
  }

  /** Publish → deliver → age past the override window, then sweep. */
  async function ageACompletedMessage(
    engine: ReturnType<typeof makeFakeEngine>,
    clock: ReturnType<typeof makeClock>,
  ): Promise<{ adapter: DbQueueAdapter; firstId: string }> {
    const adapter = new DbQueueAdapter({
      engine,
      clock,
      options: { autoStart: false, pollIntervalMs: 60_000 },
    });
    await adapter.subscribe('billing', async () => { /* delivered */ });
    const firstId = await adapter.publish('billing', { invoice: 7 }, { idempotencyKey: 'inv-7' });
    await adapter.pollOnce();
    expect(engine.rows()[0]!.status).toBe('completed');
    // Past the 1h override, far inside both the 7d declaration and the 24h
    // dedup window: the exact gap #5195 is about.
    clock.advance(2 * HOUR);
    return { adapter, firstId };
  }

  it('REPRODUCES the bypass when no floor is registered: the row is reaped and the duplicate lands', async () => {
    const engine = makeFakeEngine();
    const clock = makeClock(Date.parse('2026-03-01T00:00:00.000Z'));
    const { adapter, firstId } = await ageACompletedMessage(engine, clock);

    await lifecycle(engine, clock, fakeSettings(OVERRIDE_1H), collectingLogger()).sweep();

    // Nothing kept the reaper off the row the dedup check reads…
    expect(engine.rows()).toHaveLength(0);
    // …so the same key publishes again, 2 hours into a 24 hour window.
    const again = await adapter.publish('billing', { invoice: 7 }, { idempotencyKey: 'inv-7' });
    expect(again).not.toBe(firstId);
    expect(engine.rows()).toHaveLength(1);
  });

  it('rejects the override once the adapter has registered its floor — dedup keeps holding', async () => {
    const engine = makeFakeEngine();
    const clock = makeClock(Date.parse('2026-03-01T00:00:00.000Z'));
    const { adapter, firstId } = await ageACompletedMessage(engine, clock);
    const logger = collectingLogger();

    const svc = lifecycle(engine, clock, fakeSettings(OVERRIDE_1H), logger);
    svc.registerRetentionFloor(QUEUE_TABLE, adapter.retentionFloor());
    const report = await svc.sweep();

    // The declared 7d window runs instead of the 1h override…
    expect(engine.rows()).toHaveLength(1);
    expect(report.swept[0]!.cutoff).toBe(new Date(clock.ms - 7 * DAY).toISOString());
    // …and the re-publish is still deduplicated to the original message.
    const again = await adapter.publish('billing', { invoice: 7 }, { idempotencyKey: 'inv-7' });
    expect(again).toBe(firstId);
    expect(engine.rows()).toHaveLength(1);

    // Loud, with the consequence and both fixes an operator needs.
    expect(report.floorViolations).toHaveLength(1);
    expect(report.floorViolations[0]).toMatchObject({
      object: QUEUE_TABLE,
      policy: 'retention',
      scope: 'global',
      override: '1h',
      floorMs: DEFAULT_IDEMPOTENCY_WINDOW_MS,
      declaredBy: 'com.objectstack.service.queue',
    });
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('duplicate deliveries resume silently');
    expect(logger.errors[0]).toContain('lifecycle.retention_overrides.sys_job_queue.maxAge');
    expect(logger.errors[0]).toContain('idempotencyWindowMs');
  });

  it('a legal override (≥ the dedup window) still takes effect', async () => {
    const engine = makeFakeEngine();
    const clock = makeClock(Date.parse('2026-03-01T00:00:00.000Z'));
    const adapter = new DbQueueAdapter({ engine, clock, options: { autoStart: false } });
    // 2d: shorter than the declared 7d, longer than the 24h dedup window.
    const svc = lifecycle(
      engine,
      clock,
      fakeSettings({ retention_overrides: { [QUEUE_TABLE]: { maxAge: '2d' } } }),
      collectingLogger(),
    );
    svc.registerRetentionFloor(QUEUE_TABLE, adapter.retentionFloor());

    const report = await svc.sweep();

    expect(report.floorViolations).toEqual([]);
    expect(report.swept[0]!.cutoff).toBe(new Date(clock.ms - 2 * DAY).toISOString());
  });

  it('the floor carries the CONFIGURED idempotency window, not the default', () => {
    const adapter = new DbQueueAdapter({
      engine: makeFakeEngine(),
      options: { autoStart: false, idempotencyWindowMs: 3 * DAY },
    });
    // A static key on the object declaration could never say this — the number
    // is a per-kernel construction option.
    expect(adapter.idempotencyWindowMs).toBe(3 * DAY);
    expect(adapter.retentionFloor()).toMatchObject({
      policy: 'retention',
      minWindowMs: 3 * DAY,
      declaredBy: 'com.objectstack.service.queue',
    });

    const engine = makeFakeEngine();
    const clock = makeClock(Date.parse('2026-03-01T00:00:00.000Z'));
    const svc = lifecycle(
      engine,
      clock,
      fakeSettings({ retention_overrides: { [QUEUE_TABLE]: { maxAge: '2d' } } }),
      collectingLogger(),
    );
    svc.registerRetentionFloor(QUEUE_TABLE, adapter.retentionFloor());
    // 2d clears the 24h default but NOT this adapter's 3d window.
    return svc.sweep().then((report) => {
      expect(report.floorViolations).toHaveLength(1);
      expect(report.floorViolations[0]!.floorMs).toBe(3 * DAY);
    });
  });

  it('QueueServicePlugin registers the floor at kernel:ready (the wiring, not just the ability)', async () => {
    const engine = makeFakeEngine();
    const clock = makeClock(Date.parse('2026-03-01T00:00:00.000Z'));
    const svc = lifecycle(engine, clock, fakeSettings(OVERRIDE_1H), collectingLogger());

    const readyHooks: Array<() => Promise<void>> = [];
    const services = new Map<string, unknown>([
      ['manifest', { register: () => {} }],
      ['objectql', engine],
      ['lifecycle', svc],
    ]);
    const ctx: any = {
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      getService: (name: string) => {
        if (!services.has(name)) throw new Error(`no service '${name}'`);
        return services.get(name);
      },
      registerService: (name: string, s: unknown) => { services.set(name, s); },
      replaceService: (name: string, s: unknown) => { services.set(name, s); },
      hook: (name: string, fn: () => Promise<void>) => {
        if (name === 'kernel:ready') readyHooks.push(fn);
      },
    };

    const plugin = new QueueServicePlugin({ adapter: 'db', db: { pollIntervalMs: 60_000 } });
    await plugin.init(ctx);
    for (const fn of readyHooks) await fn();
    await plugin.destroy();

    // An unswept-by-1h row is the observable proof the plugin did the wiring —
    // the ability to register a floor is worth nothing if nobody calls it.
    engine.tables.set(QUEUE_TABLE, [{
      id: 'm_old', queue: 'q', status: 'completed', payload_json: '{}',
      created_at: new Date(clock.ms - 3 * HOUR).toISOString(),
    }]);
    const report = await svc.sweep();

    expect(engine.rows()).toHaveLength(1);
    expect(report.floorViolations[0]).toMatchObject({
      object: QUEUE_TABLE,
      floorMs: DEFAULT_IDEMPOTENCY_WINDOW_MS,
      declaredBy: 'com.objectstack.service.queue',
    });
  });
});
