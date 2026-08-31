// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13686 — an `interval` schedule registered on `DbJobAdapter` must reach the
 * SAME leader-elected fire path a `cron` schedule reaches.
 *
 * ⚠️ What this file can and cannot measure. The defect is a concurrency defect
 * across OS processes and this harness is one process, so nothing here is a
 * cluster test. What IS pinned deterministically: the ROUTING (which adapter
 * received the registration, and that exactly one timer exists per job in one
 * process), and the LOCK SEMANTICS at the adapter seam (two adapter instances
 * contending for one fire against one shared lock ⇒ one execution, the loser
 * SKIPPING rather than throwing, waiting or retrying). Whether a redis fence
 * behaves that way across three real replicas is measurable only on a real
 * multi-replica deployment.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IJobService, JobSchedule } from '@objectstack/spec/contracts';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DbJobAdapter } from './db-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';

const TICK = 60_000;
const IV: JobSchedule = { type: 'interval', intervalMs: TICK };

function makeFakeEngine() {
  const tables = new Map<string, any[]>();
  return {
    tables,
    rows(table: string) { return tables.get(table) ?? []; },
    async find(table: string, opts: any = {}) {
      const t = tables.get(table) ?? [];
      const matched = opts.where
        ? t.filter((r) => Object.entries(opts.where).every(([k, v]) => {
            // REFUSE what this double does not implement, rather than reading a
            // combinator as if it were a column name.
            if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
            return r[k] === v;
          }))
        : [...t];
      // The caller's bound, applied AFTER the filter and by PRESENCE: a `limit`
      // of zero is a bound of zero rows, not an absent bound.
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
    async insert(table: string, data: any) {
      const t = tables.get(table) ?? [];
      t.push({ ...data });
      tables.set(table, t);
      return { id: data.id };
    },
    async update(table: string, data: any, options?: Record<string, unknown>) {
      // Hold this double to ObjectQL.update's own dispatch rule, so it cannot be
      // looser than the engine `DbJobAdapter` really writes through.
      assertEngineUpdateDispatch(data, options);
      const r = (tables.get(table) ?? []).find((x) => x.id === data.id);
      if (r) Object.assign(r, data);
      return r;
    },
  };
}

/**
 * A cron adapter that RECORDS what it was handed and owns no clock of its own.
 * It is the routing probe: with it in place, anything that still fires came
 * from a timer `DbJobAdapter` armed somewhere else.
 */
function recordingCron() {
  const calls: Array<{ name: string; schedule: JobSchedule }> = [];
  const svc: IJobService & { calls: typeof calls } = {
    calls,
    async schedule(name: string, schedule: JobSchedule) { calls.push({ name, schedule }); },
    async cancel() {},
    async trigger() {},
    async getExecutions() { return []; },
    async listJobs() { return []; },
  };
  return svc;
}

/** One lock shared by every simulated replica — the redis fence's stand-in. */
function sharedLock() {
  const held = new Set<string>();
  const acquire = vi.fn(async (key: string) => {
    if (held.has(key)) return null; // another node is the leader for this fire
    held.add(key);
    return { release: vi.fn(async () => { held.delete(key); }) };
  });
  return { lock: { acquire }, acquire, held };
}

const denies = () => ({ acquire: vi.fn(async () => null) });

const built: Array<{ destroy(): Promise<void> }> = [];
function track<T extends { destroy(): Promise<void> }>(a: T): T { built.push(a); return a; }

afterEach(async () => {
  while (built.length) await built.pop()!.destroy();
  vi.useRealTimers();
});

describe('DbJobAdapter — interval schedules are leader-elected (#13686)', () => {
  it('routes an interval registration to the cron (leader-electing) adapter, and arms no timer of its own', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const cron = recordingCron();
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('heartbeat', IV, handler);

    // The routing itself — asserted at the seam, not against the wall clock.
    expect(cron.calls).toEqual([{ name: 'heartbeat', schedule: IV }]);

    // …and NOTHING else armed a timer. The probe owns no clock, so ten ticks
    // must produce zero runs; a second, unelected `setInterval` inside `inner`
    // would show up here as ten.
    await vi.advanceTimersByTimeAsync(TICK * 10);
    expect(handler).not.toHaveBeenCalled();

    // The registration is still reachable through the adapter's own surface.
    expect(await db.listJobs()).toEqual(['heartbeat']);
  });

  it('one process holds exactly ONE timer for a delegated interval job: a tick runs the handler once', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const acquire = vi.fn(async () => ({ release: vi.fn(async () => {}) }));
    const cron = new CronJobAdapter({ cluster: { lock: { acquire } } });
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('sla_escalation', IV, handler);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(handler).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(handler).toHaveBeenCalledTimes(2);
    // One lock acquire per fire — the fence counter the field report watched
    // stand still for 100 seconds.
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire).toHaveBeenCalledWith('job:sla_escalation', { ttlMs: 60000, waitMs: 0 });
  });

  it('two simulated replicas contending for ONE fire: exactly one executes, the loser SKIPS', async () => {
    // One engine and one lock, two adapter stacks — the shared postgres + redis
    // of a 3-replica deployment, minus the process boundary this harness has no
    // way to cross.
    const engine = makeFakeEngine();
    const fence = sharedLock();
    const handler = vi.fn(async () => {});

    const replica = () => {
      const cron = new CronJobAdapter({ cluster: { lock: fence.lock } });
      return { cron, db: track(new DbJobAdapter({ engine, cron })) };
    };
    const a = replica();
    const b = replica();
    await a.db.schedule('sla_escalation', IV, handler);
    await b.db.schedule('sla_escalation', IV, handler);

    // Both replicas reach the same fire. Started together on purpose: `b` calls
    // acquire while `a` still holds the lease.
    const fireA = (a.cron as any).runScheduled('sla_escalation');
    const fireB = (b.cron as any).runScheduled('sla_escalation');
    // The loser SKIPS: it resolves, it does not throw and it does not retry.
    await expect(Promise.all([fireA, fireB])).resolves.toHaveLength(2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fence.acquire).toHaveBeenCalledTimes(2);
    // waitMs:0 is the "skip", spelled structurally — a waiting acquire would let
    // the loser run the same tick a moment later.
    expect(fence.acquire).toHaveBeenCalledWith('job:sla_escalation', { ttlMs: 60000, waitMs: 0 });

    // The durable record agrees: one tick, ONE run row, run_count +1. Unrouted,
    // this shared engine took one row per replica — the shape the field report
    // caught as six notification inserts inside 54 ms.
    const runs = engine.rows('sys_job_run').filter((r) => r.job_name === 'sla_escalation');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(engine.rows('sys_job')[0].run_count).toBe(1);
  });

  it('single-replica, no cluster driver: the interval job still fires (the regression that would be worse than the defect)', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const cron = new CronJobAdapter(); // no `cluster` — nothing to elect against
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('nightly_sweep', IV, handler);

    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('no cron adapter assembled: the interval job still fires on the inner timer, and says it is unelected', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, logger }));

    await db.schedule('nightly_sweep', IV, handler);

    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(
      logger.warn.mock.calls.some((c) => String(c[0]).includes('NO leader election')),
      'a cron-less assembly cannot elect anything — that has to be said, not inferred from duplicate rows',
    ).toBe(true);
  });

  it('manual trigger() still runs on THIS node while another replica holds the lock', async () => {
    const engine = makeFakeEngine();
    const cron = new CronJobAdapter({ cluster: { lock: denies() } });
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('sla_escalation', IV, handler);
    // Reaches `inner`, which still holds the registration: a delegated job that
    // vanished from `inner` would throw `Job "…" not found` right here.
    await db.trigger('sla_escalation');

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('replay() and getExecutions() still work for a delegated interval job', async () => {
    const engine = makeFakeEngine();
    const cron = new CronJobAdapter({ cluster: { lock: denies() } });
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('sla_escalation', IV, handler);
    await db.replay('sla_escalation');

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await db.getExecutions('sla_escalation')).map((e) => e.status)).toEqual(['success']);
    expect(engine.rows('sys_job_run').some((r) => r.trigger === 'replay')).toBe(true);
  });

  it('still upserts the sys_job row for a delegated interval schedule', async () => {
    const engine = makeFakeEngine();
    const db = track(new DbJobAdapter({ engine, cron: recordingCron() }));

    await db.schedule('heartbeat', IV, async () => {});

    expect(engine.rows('sys_job')[0]).toMatchObject({
      name: 'heartbeat',
      schedule_type: 'interval',
      schedule_expression: String(TICK),
      active: true,
    });
  });

  it('DECLARED CONTROL — cron routing is unchanged: delegated to the cron adapter, still registered for trigger()', async () => {
    const engine = makeFakeEngine();
    const cron = recordingCron();
    const db = track(new DbJobAdapter({ engine, cron }));
    const schedule: JobSchedule = { type: 'cron', expression: '0 0 30 2 *' };

    await db.schedule('nightly_report', schedule, async () => {});

    expect(cron.calls).toEqual([{ name: 'nightly_report', schedule }]);
    expect(await db.listJobs()).toEqual(['nightly_report']);
  });
});
