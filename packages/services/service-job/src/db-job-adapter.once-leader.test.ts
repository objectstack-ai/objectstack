// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13918 — a `once` schedule registered on `DbJobAdapter` must reach the SAME
 * leader-elected fire path `cron` (#2219) and `interval` (#13686) reach.
 *
 * ⚠️ What this file can and cannot measure — identical to its `interval`
 * sibling, and for the same reason. The defect is a concurrency defect across
 * OS processes and this harness is one process, so nothing here is a cluster
 * test. What IS pinned deterministically: the ROUTING (which adapter received
 * the registration, and that exactly one timer exists per job in one process),
 * and the LOCK SEMANTICS at the adapter seam (two adapter instances contending
 * for one fire against one shared lock ⇒ one execution, the loser SKIPPING
 * rather than throwing, waiting or retrying).
 *
 * The one-shot's own asymmetry, ruled at-most-once per cluster (maintainer
 * 2026-09-01): there is no later tick, so a leader that dies mid-fire loses the
 * fire outright. Nothing re-arms it and nothing here pretends otherwise — the
 * pins below assert the fire happens ONCE, never that it is redelivered.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { IJobService, JobSchedule } from '@objectstack/spec/contracts';
import { assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { DbJobAdapter } from './db-job-adapter.js';
import { CronJobAdapter } from './cron-job-adapter.js';

const TICK = 60_000;

/**
 * A `once` schedule due `ms` from NOW — built inside the test so it is read off
 * the fake clock vitest installed, never off the wall clock.
 */
function onceIn(ms: number): JobSchedule {
  return { type: 'once', at: new Date(Date.now() + ms).toISOString() };
}

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

describe('DbJobAdapter — once schedules are leader-elected (#13918)', () => {
  it('routes a once registration to the cron (leader-electing) adapter, and arms no timer of its own', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const cron = recordingCron();
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));
    const schedule = onceIn(TICK);

    await db.schedule('kickoff', schedule, handler);

    // The routing itself — asserted at the seam, not against the wall clock.
    expect(cron.calls).toEqual([{ name: 'kickoff', schedule }]);

    // …and NOTHING else armed a timer. The probe owns no clock, so ten ticks
    // must produce zero runs; a second, unelected `setTimeout` inside `inner`
    // would show up here as one.
    await vi.advanceTimersByTimeAsync(TICK * 10);
    expect(handler).not.toHaveBeenCalled();

    // The registration is still reachable through the adapter's own surface.
    expect(await db.listJobs()).toEqual(['kickoff']);
  });

  it('one process holds exactly ONE timer for a delegated once job: the deadline runs the handler once', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const acquire = vi.fn(async () => ({ release: vi.fn(async () => {}) }));
    const cron = new CronJobAdapter({ cluster: { lock: { acquire } } });
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('wait_timer', onceIn(TICK), handler);

    await vi.advanceTimersByTimeAsync(TICK);
    expect(handler).toHaveBeenCalledTimes(1);
    // A one-shot stays a one-shot: no later deadline, and no re-arm (ruled
    // at-most-once per cluster, so nothing redelivers it either).
    await vi.advanceTimersByTimeAsync(TICK * 5);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledWith('job:wait_timer', { ttlMs: 60000, waitMs: 0 });
  });

  it('THE CARD PIN — two simulated replicas, ONE deadline: exactly one execution and ONE run row', async () => {
    // One engine and one lock, two adapter stacks — the shared postgres + redis
    // of a 3-replica deployment, minus the process boundary this harness has no
    // way to cross. Today (unrouted) this executes twice and writes two rows.
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const fence = sharedLock();
    // The winner HOLDS its lease until this opens, so the loser's acquire is
    // guaranteed to land while the lock is held rather than after it is
    // released — which is what makes the count below a fact about the lock and
    // not about how many microtasks the timer flush happened to run.
    let open!: () => void;
    const lease = new Promise<void>((resolve) => { open = resolve; });
    const handler = vi.fn(async () => { await lease; });
    const schedule = onceIn(TICK);

    const replica = () => {
      const cron = new CronJobAdapter({ cluster: { lock: fence.lock } });
      return { cron, db: track(new DbJobAdapter({ engine, cron })) };
    };
    const a = replica();
    const b = replica();
    await a.db.schedule('flow_wake', schedule, handler);
    await b.db.schedule('flow_wake', schedule, handler);

    // One deadline on the wall clock reaches BOTH replicas.
    await vi.advanceTimersByTimeAsync(TICK);

    // SOFT on purpose, and only here: when this pin is red the row count below
    // is the other half of the card's evidence ("two `sys_job_run` rows today,
    // one after"), and a hard throw here would hide it. Every other assertion
    // in this file is hard.
    expect.soft(handler, 'one deadline must execute the job once across the cluster, not once per replica').toHaveBeenCalledTimes(1);
    expect(fence.acquire).toHaveBeenCalledTimes(2);
    // waitMs:0 is the "skip", spelled structurally — a waiting acquire would let
    // the loser run the same one-shot a moment later.
    expect(fence.acquire).toHaveBeenCalledWith('job:flow_wake', { ttlMs: 60000, waitMs: 0 });

    open();
    await vi.advanceTimersByTimeAsync(0);

    // The durable record agrees: one deadline, ONE run row, run_count +1.
    // Unrouted, this shared engine took one row per replica — and for a
    // one-shot there is no later tick during which a business-level marker
    // could win the race, so both land inside the same short window.
    const runs = engine.rows('sys_job_run').filter((r) => r.job_name === 'flow_wake');
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe('success');
    expect(engine.rows('sys_job')[0].run_count).toBe(1);
  });

  it('the replica that loses the lock SKIPS: it resolves, it does not throw and it does not retry', async () => {
    const engine = makeFakeEngine();
    const fence = sharedLock();
    const handler = vi.fn(async () => {});

    const replica = () => {
      const cron = new CronJobAdapter({ cluster: { lock: fence.lock } });
      return { cron, db: track(new DbJobAdapter({ engine, cron })) };
    };
    const a = replica();
    const b = replica();
    const schedule = onceIn(TICK);
    await a.db.schedule('flow_wake', schedule, handler);
    await b.db.schedule('flow_wake', schedule, handler);

    // Driven at the fire seam so both promises are observable: `b` calls acquire
    // while `a` still holds the lease.
    const fireA = (a.cron as any).runScheduled('flow_wake');
    const fireB = (b.cron as any).runScheduled('flow_wake');
    await expect(Promise.all([fireA, fireB])).resolves.toHaveLength(2);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fence.acquire).toHaveBeenCalledTimes(2);
    expect(fence.held.has('job:flow_wake'), 'the winner must release its lease when the fire ends').toBe(false);
  });

  it('single-replica, no cluster driver: the once job still fires (the regression that would be worse than the defect)', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const cron = new CronJobAdapter(); // no `cluster` — nothing to elect against
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('kickoff', onceIn(TICK), handler);

    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('no cron adapter assembled: the once job still fires on the inner timer, exactly as before', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, logger }));

    await db.schedule('kickoff', onceIn(TICK), handler);

    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a once deadline already in the past arms nothing, with or without a cron adapter', async () => {
    vi.useFakeTimers();
    const past = onceIn(-TICK);

    const withCron = (() => {
      const engine = makeFakeEngine();
      const acquire = vi.fn(async () => ({ release: vi.fn(async () => {}) }));
      const cron = new CronJobAdapter({ cluster: { lock: { acquire } } });
      const handler = vi.fn(async () => {});
      return { acquire, handler, db: track(new DbJobAdapter({ engine, cron })) };
    })();
    const withoutCron = (() => {
      const engine = makeFakeEngine();
      const handler = vi.fn(async () => {});
      return { handler, db: track(new DbJobAdapter({ engine })) };
    })();

    await withCron.db.schedule('overdue', past, withCron.handler);
    await withoutCron.db.schedule('overdue', past, withoutCron.handler);

    await vi.advanceTimersByTimeAsync(TICK * 5);
    expect(withCron.handler).not.toHaveBeenCalled();
    expect(withCron.acquire).not.toHaveBeenCalled();
    expect(withoutCron.handler).not.toHaveBeenCalled();
    // …and it is still registered, so an operator can still trigger it by hand.
    expect(await withCron.db.listJobs()).toEqual(['overdue']);
  });

  it('manual trigger() still runs on THIS node while another replica holds the lock', async () => {
    const engine = makeFakeEngine();
    const cron = new CronJobAdapter({ cluster: { lock: denies() } });
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('flow_wake', onceIn(TICK), handler);
    // Reaches `inner`, which still holds the registration: a delegated job that
    // vanished from `inner` would throw `Job "…" not found` right here.
    await db.trigger('flow_wake');

    expect(handler).toHaveBeenCalledTimes(1);
    expect(await db.listJobs()).toEqual(['flow_wake']);
  });

  it('replay() and getExecutions() still work for a delegated once job', async () => {
    const engine = makeFakeEngine();
    const cron = new CronJobAdapter({ cluster: { lock: denies() } });
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('flow_wake', onceIn(TICK), handler);
    await db.replay('flow_wake');

    expect(handler).toHaveBeenCalledTimes(1);
    expect((await db.getExecutions('flow_wake')).map((e) => e.status)).toEqual(['success']);
    expect(engine.rows('sys_job_run').some((r) => r.trigger === 'replay')).toBe(true);
  });

  it('cancel() before the deadline stops the delegated once job on BOTH adapters', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const acquire = vi.fn(async () => ({ release: vi.fn(async () => {}) }));
    const cron = new CronJobAdapter({ cluster: { lock: { acquire } } });
    const handler = vi.fn(async () => {});
    const db = track(new DbJobAdapter({ engine, cron }));

    await db.schedule('flow_wake', onceIn(TICK), handler);
    await db.cancel('flow_wake');

    await vi.advanceTimersByTimeAsync(TICK * 5);
    expect(handler).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(await db.listJobs()).toEqual([]);
    expect(engine.rows('sys_job')[0]).toMatchObject({ name: 'flow_wake', active: false });
  });

  it('still upserts the sys_job row for a delegated once schedule', async () => {
    vi.useFakeTimers();
    const engine = makeFakeEngine();
    const db = track(new DbJobAdapter({ engine, cron: recordingCron() }));
    const schedule = onceIn(TICK);

    await db.schedule('kickoff', schedule, async () => {});

    expect(engine.rows('sys_job')[0]).toMatchObject({
      name: 'kickoff',
      schedule_type: 'once',
      schedule_expression: (schedule as { at: string }).at,
      active: true,
    });
  });

  it('DECLARED CONTROL — cron and interval routing are unchanged', async () => {
    const engine = makeFakeEngine();
    const cron = recordingCron();
    const db = track(new DbJobAdapter({ engine, cron }));
    const cronSchedule: JobSchedule = { type: 'cron', expression: '0 0 30 2 *' };
    const intervalSchedule: JobSchedule = { type: 'interval', intervalMs: TICK };

    await db.schedule('nightly_report', cronSchedule, async () => {});
    await db.schedule('heartbeat', intervalSchedule, async () => {});

    expect(cron.calls).toEqual([
      { name: 'nightly_report', schedule: cronSchedule },
      { name: 'heartbeat', schedule: intervalSchedule },
    ]);
    expect(await db.listJobs()).toEqual(['nightly_report', 'heartbeat']);
  });
});
